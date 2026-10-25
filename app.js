'use strict';

/* 出行助手 · 附近公厕与乘车导航 PWA
 * 两种模式（按是否填高德 Key 自动切换）：
 *  - embed（内嵌）：填了高德 JS API Key → 本页内直接显示附近列表、画线、导航（最实用）
 *  - lite （临时）：没填 Key → 浏览器定位后，跳你手机地图 App 按当前位置搜索，零注册零费用
 */

const STORE_KEY = 'amap_key_v1';
const SEC_KEY   = 'amap_sec_v1';   // 高德 JS API 2.0 安全密钥（securityJsCode），不配地图白屏
const CITY_KEY  = 'last_city_v1';
const SELCITY_KEY = 'selected_city_v1';
const PROV_KEY  = 'map_provider_v1';

/* 内置高德 Key（侯哥申请，已配域名白名单防盗刷）。
 * 用户未在 ⚙ 自填时直接使用内置值 → 推广时任何人打开即用，无需配置。 */
const DEFAULT_AMAP_KEY = '52acfdb74e31a72793d0b8bfd459aa88';
const DEFAULT_AMAP_SEC = 'fcb59b20ee438f984b347c10b035c1cf';

let AMap = null, map = null;
let currentCity = localStorage.getItem(CITY_KEY) || '';
let selectedCity = localStorage.getItem(SELCITY_KEY) || '';  // 用户手动选择的城市（空=用 GPS）
const cityCenterCache = {};            // 城市名 → [lng,lat] 中心坐标缓存
let myLocation = null;                 // [lng, lat]（高德 GCJ-02 坐标）
let rawLocation = null;                // [lng, lat]（GPS WGS-84，未纠偏）
let overlays = [];
let placeSearch = null, transfer = null, lineSearch = null, geocoder = null;
let mode = null;                       // 'embed' | 'lite'

/* 免 Key 调起地图的 URL 模板（均无需 Key）；city 非空时限定城市，搜线路/跨城更准 */
const PROVIDERS = {
  amap: { name: '高德地图', search: (kw, ll, city) => `https://uri.amap.com/search?keyword=${enc(kw)}` + (city ? `&region=${enc(city)}` : '') + (ll ? `&location=${ll[0]},${ll[1]}&coordinate=gaode&callnative=1` : '') + `&src=tpwa` },
  baidu: { name: '百度地图', search: (kw, ll, city) => `https://map.baidu.com/search/${enc(kw)}` + (city ? `&region=${enc(city)}` : '') + (ll ? `@${ll[0]},${ll[1]}` : '') },
  qq: { name: '腾讯地图', search: (kw, ll, city) => `https://apis.map.qq.com/uri/v1/search?keyword=${enc(kw)}` + (city ? `&region=${enc(city)}` : '') + `&referer=tpwa` },
};

function enc(s) { return encodeURIComponent(s || ''); }
const $ = (id) => document.getElementById(id);
function provider() { return localStorage.getItem(PROV_KEY) || 'amap'; }
function updateCityTag() {
  const el = $('cityTag');
  if (selectedCity) el.textContent = selectedCity + '（已选）';
  else if (currentCity) el.textContent = currentCity;
  else el.textContent = '定位中…';
}

/* 坐标纠偏：浏览器 GPS 是 WGS-84，中国地图用 GCJ-02（高德/腾讯）/ BD-09（百度）。
   不纠偏会有几百米偏移；这里把 GPS 转成高德坐标，保证"附近"搜索准确居中。 */
function wgs84ToGcj02(lat, lng) {
  const a = 6378245.0, ee = 0.00669342162296594323;
  if (lng < 73.66 || lng > 135.05 || lat < 3.86 || lat > 53.55) return { lng, lat };
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
  return { lng: lng + dLng, lat: lat + dLat };
}
function transformLat(x, y) {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  r += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
  r += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
  return r;
}
function transformLng(x, y) {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  r += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
  r += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
  return r;
}

/* ---------- 轻提示 ---------- */
function toast(msg, ms = 1800) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

/* ================= 内嵌模式（embed，填了 Key） ================= */
function loadAMap(key, sec) {
  return new Promise((resolve, reject) => {
    if (window.AMap) return resolve(window.AMap);
    // JS API 2.0 必须在加载脚本前设置安全密钥，否则报 INVALID_USER_SCODE 白屏
    if (sec) window._AMapSecurityConfig = { securityJsCode: sec };
    const s = document.createElement('script');
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`
          + `&plugin=AMap.PlaceSearch,AMap.Transfer,AMap.LineSearch,AMap.Geocoder,AMap.Geolocation`;
    s.onload = () => (window.AMap ? resolve(window.AMap) : reject(new Error('AMap 未就绪')));
    s.onerror = () => reject(new Error('高德脚本加载失败'));
    document.head.appendChild(s);
  });
}

function initMap() {
  mode = 'embed';
  $('map').style.display = 'block';
  $('litePanel').classList.add('hidden');
  map = new AMap.Map('map', { zoom: 14, viewMode: '2D', resizeEnable: true });
  placeSearch = new AMap.PlaceSearch({ pageSize: 25, pageIndex: 1 });
  transfer = new AMap.Transfer({ map: map, city: currentCity, policy: AMap.TransferPolicy.LEAST_TIME, panel: 'routePanel' });
  lineSearch = new AMap.LineSearch({ city: currentCity, pageSize: 1, extensions: 'all' });
  geocoder = new AMap.Geocoder({});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  updateCityTag();
  locateMe();
}

function clearOverlays() { overlays.forEach(o => map.remove(o)); overlays = []; }

function addMarker(lnglat, title, color) {
  const m = new AMap.Marker({ position: lnglat, title: title, offset: new AMap.Pixel(-15, -32), content: pinHTML(color, title), zIndex: 12 });
  map.add(m); overlays.push(m); return m;
}
function pinHTML(color, title) {
  const label = title && title.length > 6 ? title.slice(0, 6) + '…' : (title || '');
  return `<div style="width:30px;height:40px;position:relative;transform:translateZ(0);">
    <svg viewBox="0 0 30 40" width="30" height="40" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 1C7.8 1 2 6.8 2 14c0 9.5 13 25 13 25s13-15.5 13-25C28 6.8 22.2 1 15 1z" fill="${color}"/>
      <circle cx="15" cy="14" r="6.2" fill="#fff"/>
    </svg>
    ${label ? `<span style="position:absolute;top:34px;left:50%;transform:translateX(-50%);background:#fff;color:#0f172a;font-size:10px;padding:1px 5px;border-radius:6px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.2)">${label}</span>` : ''}
  </div>`;
}
const COLORS = { bus: '#16a34a', metro: '#0ea5e9', wc: '#f59e0b', me: '#2b6cff' };

function locateMe() {
  if (!navigator.geolocation) { fallbackLocate(); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => onLocated(pos.coords.longitude, pos.coords.latitude),
    () => { toast('GPS 定位失败，尝试高精度定位'); fallbackLocate(); },
    { enableHighAccuracy: true, timeout: 9000, maximumAge: 0 }
  );
}
function fallbackLocate() {
  const geo = new AMap.Geolocation({ enableHighAccuracy: true, timeout: 9000 });
  geo.getCurrentPosition((status, result) => {
    if (status === 'complete') onLocated(result.position.lng, result.position.lat);
    else toast('定位失败，请检查定位权限');
  });
}
function onLocated(lng, lat) {
  myLocation = [lng, lat];
  rawLocation = myLocation.slice();
  map.setCenter(myLocation);
  addMarker(myLocation, '我的位置', COLORS.me);
  reverseCity(myLocation);
  toast('已定位');
}
function reverseCity(ll) {
  geocoder.getAddress(ll, (status, res) => {
    if (status === 'complete' && res.regeocode) {
      const c = res.regeocode.addressComponent;
      currentCity = (c.city || c.province || currentCity).replace(/市$/, '');
      localStorage.setItem(CITY_KEY, currentCity);
      try { transfer.setCity(currentCity); } catch (e) {}
      try { lineSearch.setCity(currentCity); } catch (e) {}
      updateCityTag();
    }
  });
}
/* 城市名 → 中心点坐标（内嵌模式手动选城市时，用中心坐标做"附近/路线"基准） */
function cityToCenter(name) {
  return new Promise((resolve, reject) => {
    if (!geocoder) return reject(new Error('地图未加载'));
    geocoder.getLocation(name, (status, res) => {
      if (status === 'complete' && res.geocodes && res.geocodes.length) {
        const loc = res.geocodes[0].location;
        resolve([loc.lng, loc.lat]);
      } else reject(new Error('城市解析失败'));
    });
  });
}
function searchNearby(keyword, colorKey) {
  let center = myLocation;
  if (selectedCity) {
    // 手动选了城市 → 以该城市中心为基准搜（提前查出差地、或定位失败时兜底）
    if (!cityCenterCache[selectedCity]) {
      toast('正在定位「' + selectedCity + '」中心…');
      cityToCenter(selectedCity).then(ll => {
        cityCenterCache[selectedCity] = ll;
        doNearby(keyword, colorKey, ll);
      }).catch(() => toast('城市解析失败，请检查城市名'));
      return;
    }
    center = cityCenterCache[selectedCity];
  } else if (!center) {
    toast('请先定位或选择城市'); locateMe(); return;
  }
  doNearby(keyword, colorKey, center);
}
function doNearby(keyword, colorKey, center) {
  if (!navigator.onLine) { toast('当前无网络，请连网后重试'); return; }
  clearOverlays();
  addMarker(center, selectedCity || '我的位置', COLORS.me);
  const c = new AMap.LngLat(center[0], center[1]);
  let done = false;
  const timer = setTimeout(() => {
    if (done) return;
    done = true;
    toast('搜索超时' + keyErrorHint('timeout'));
  }, 15000);
  placeSearch.searchNearBy(keyword, c, 2000, (status, res) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (status !== 'complete' || !res.poiList || !res.poiList.pois.length) {
      if (status !== 'complete') toast('搜索失败' + keyErrorHint(status));
      else toast('附近 2 公里内未找到「' + keyword + '」');
      return;
    }
    const pois = res.poiList.pois;
    const color = COLORS[colorKey] || COLORS.bus;
    pois.forEach(p => addMarker([p.location.lng, p.location.lat], p.name, color));
    renderList(pois.map(p => ({
      name: p.name,
      addr: p.address || ((p.pname || '') + (p.cityname || '') + (p.adname || '')),
      dist: p.distance, loc: [p.location.lng, p.location.lat],
    })));
    try { map.setFitView(overlays, false, [40, 40, 40, 40]); } catch (e) {}
    openSheet(keyword + '（' + pois.length + '）');
  });
}
function planTransfer() {
  const dest = $('destInput2').value.trim();
  if (!dest) { toast('请输入目的地'); return; }
  const city = selectedCity || currentCity;
  if (!city) { toast('请先定位或选择城市'); locateMe(); return; }
  try { transfer.setCity(city); } catch (e) {}
  const start = myLocation || cityCenterCache[city];
  if (start) { doTransfer(start, dest); return; }
  toast('正在定位「' + city + '」中心…');
  cityToCenter(city).then(ll => { cityCenterCache[city] = ll; doTransfer(ll, dest); })
    .catch(() => toast('城市解析失败，请检查城市名'));
}
function keyErrorHint(status) {
  // 把高德常见错误码翻译成大白话，方便对症处理
  const s = (status || '').toUpperCase();
  if (s.includes('SCODE') || s.includes('KEY') || s.includes('NOMATCH') || s.includes('DOMAIN'))
    return '（多是高德 Key 白名单限制：去高德后台把该 Key 的「域名白名单」设为 *.github.io 或先清空测试）';
  if (s.includes('QUOTA') || s.includes('LIMIT'))
    return '（可能是 Key 免费额度用尽，去高德控制台查看用量）';
  return '（' + status + '）';
}

function doTransfer(start, dest) {
  if (!navigator.onLine) {
    $('routePanel').innerHTML = '<p class="hint">当前无网络，请连网后重试。</p>';
    toast('无网络'); return;
  }
  $('routePanel').innerHTML = '<p class="hint">规划中…（最长约 20 秒）</p>';
  let done = false;
  const timer = setTimeout(() => {
    if (done) return;
    done = true;
    $('routePanel').innerHTML = '<p class="hint">规划超时，请检查网络后重试。</p>';
    toast('路线规划超时');
  }, 20000);
  // 高德 Transfer.search 要求 LngLat 对象或关键字字符串，普通数组可能静默失败 → 统一转换
  let origin = start;
  if (Array.isArray(start)) origin = new AMap.LngLat(start[0], start[1]);
  try {
    transfer.search(origin, dest, (status, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (status === 'complete') {
        const plans = (result && result.plans && result.plans.length) || 0;
        if (!plans) {
          $('routePanel').innerHTML = '<p class="hint">未找到合适路线，试试更具体的地名（如「长治东站」）。</p>';
        }
        // 有结果时高德自动渲染到 routePanel
      } else if (status === 'no_data') {
        $('routePanel').innerHTML = '<p class="hint">该目的地暂无公交/地铁路线，试试别的目的地。</p>';
      } else {
        $('routePanel').innerHTML = '<p class="hint">规划失败 ' + keyErrorHint(status) + '。换个目的地或稍后再试。</p>';
        toast('路线规划失败');
      }
    });
  } catch (err) {
    done = true;
    clearTimeout(timer);
    $('routePanel').innerHTML = '<p class="hint">规划出错：' + (err && err.message ? err.message : '未知错误') + '，请重试。</p>';
  }
}
function searchLine() {
  const name = $('lineInput').value.trim();
  if (!name) { toast('请输入线路名，如 地铁1号线 / 1路'); return; }
  const city = selectedCity || currentCity;
  if (!city) { toast('请先定位或选择城市'); return; }
  try { lineSearch.setCity(city); } catch (e) {}
  let lineDone = false;
  const lineTimer = setTimeout(() => {
    if (lineDone) return;
    lineDone = true;
    toast('查询超时，请检查网络后重试');
  }, 15000);
  lineSearch.search(name, (status, res) => {
    if (lineDone) return;
    lineDone = true;
    clearTimeout(lineTimer);
    if (status !== 'complete' || !res.lineInfo || !res.lineInfo.length) {
      toast('未找到「' + name + '」，确认线路名或城市'); return;
    }
    const info = res.lineInfo[0];
    clearOverlays();
    const isMetro = (info.name || '').includes('地铁');
    const color = isMetro ? COLORS.metro : COLORS.bus;
    if (info.path && info.path.length) {
      const poly = new AMap.Polyline({ path: info.path.map(p => [p.lng, p.lat]), strokeColor: color, strokeWeight: 6, strokeOpacity: 0.85, zIndex: 8 });
      map.add(poly); overlays.push(poly);
    }
    const stations = info.stations || [];
    stations.forEach(s => addMarker([s.location.lng, s.location.lat], s.name, color));
    renderList(stations.map((s, i) => ({ name: (i + 1) + '. ' + s.name, addr: info.name, dist: '', loc: [s.location.lng, s.location.lat] })));
    if (overlays.length) try { map.setFitView(overlays, false, [40, 40, 40, 40]); } catch (e) {}
    openSheet(info.name + '（' + stations.length + ' 站）');
  });
}
function renderList(items) {
  const ul = $('resultList');
  ul.innerHTML = '';
  if (!items.length) { ul.innerHTML = '<li class="hint">暂无结果</li>'; return; }
  items.forEach(it => {
    const li = document.createElement('li');
    const distTxt = (it.dist != null && it.dist !== '') ? Math.round(it.dist) + 'm' : '';
    li.innerHTML = `<div class="li-main"><div class="li-name">${escapeHTML(it.name)}</div><div class="li-sub">${escapeHTML(it.addr || '')}</div></div>`
      + (distTxt ? `<div class="li-dist">${distTxt}</div>` : '') + `<button class="li-go">导航</button>`;
    li.querySelector('.li-go').addEventListener('click', (e) => { e.stopPropagation(); goThere(it.loc, it.name); });
    li.addEventListener('click', () => { if (map) map.setCenter(it.loc); });
    ul.appendChild(li);
  });
}
function goThere(loc, name) {
  window.open(`https://uri.amap.com/navigation?to=${loc[0]},${loc[1]},${enc(name)}&mode=bus&src=tpwa&coordinate=gaode&callnative=1`, '_blank');
}
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ================= 临时模式（lite，未填 Key） ================= */
function enterLite() {
  mode = 'lite';
  $('map').style.display = 'none';
  $('litePanel').classList.remove('hidden');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  $('providerSel').value = provider();
  updateCityTag();
  locateMeLite();
}
function locateMeLite() {
  if (!navigator.geolocation) { $('liteStatus').textContent = '此设备不支持定位'; return; }
  $('liteStatus').textContent = '正在定位…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      rawLocation = [pos.coords.longitude, pos.coords.latitude];
      const g = wgs84ToGcj02(pos.coords.latitude, pos.coords.longitude);
      myLocation = [g.lng, g.lat];
      $('liteStatus').textContent = '已定位 ✓ 点击下方按钮，用手机地图搜附近';
      toast('已定位');
      reverseCityLite(pos.coords.latitude, pos.coords.longitude);
    },
    () => { $('liteStatus').textContent = '定位失败，请允许定位权限后重试'; toast('定位失败'); },
    { enableHighAccuracy: true, timeout: 9000, maximumAge: 0 }
  );
}
function reverseCityLite(lat, lng) {
  // 免 Key 逆地理（OSM，无需 Key）；失败不影响主流程，城市可手动选
  fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=zh-CN&zoom=10`)
    .then(r => r.json())
    .then(d => {
      if (d && d.address) {
        const c = d.address.city || d.address.town || d.address.state || '';
        if (c) { currentCity = c.replace(/市$/, ''); localStorage.setItem(CITY_KEY, currentCity); updateCityTag(); }
      }
    })
    .catch(() => {});
}
function openMapSearch(kw) {
  const key = provider();
  const p = PROVIDERS[key];
  // 高德：传纠偏后的 GCJ-02 坐标，确保"附近"准确居中；百度/腾讯：交 App 自身定位
  let ll = null;
  if (myLocation && key === 'amap') ll = myLocation;
  else if (myLocation) ll = myLocation; // 百度/腾讯也能收 GCJ-02 近似居中，体验可接受
  const city = selectedCity || currentCity || '';
  window.open(p.search(kw, ll, city), '_blank');
  toast('已用' + p.name + (city ? '（' + city + '）' : '（当前位置）') + '搜索：' + kw);
}
function openMapNav() {
  const dest = $('destInput').value.trim();
  if (!dest) { toast('请输入目的地'); return; }
  const p = PROVIDERS[provider()];
  window.open(p.search(dest, null), '_blank');
  toast('已打开' + p.name + '规划前往：' + dest);
}

/* ================= 通用 UI ================= */
function openSheet(title) { $('sheetTitle').textContent = title || '结果'; $('sheet').classList.add('open'); }
function closeSheet() { $('sheet').classList.remove('open'); }

/* 城市选择弹窗 */
function openCityModal() {
  $('cityInput').value = selectedCity;
  $('cityModal').classList.remove('hidden');
  setTimeout(() => { try { $('cityInput').focus(); } catch (e) {} }, 100);
}
function closeCityModal() { $('cityModal').classList.add('hidden'); }
function chooseCity(name) {
  selectedCity = (name || '').replace(/市$/, '').trim();
  if (!selectedCity) { toast('请输入城市名'); return; }
  localStorage.setItem(SELCITY_KEY, selectedCity);
  updateCityTag();
  closeCityModal();
  toast('已选择城市：' + selectedCity);
  if (mode === 'embed' && map) {
    const apply = (ll) => { myLocation = ll; map.setCenter(ll); clearOverlays(); addMarker(ll, selectedCity, COLORS.me); };
    if (cityCenterCache[selectedCity]) apply(cityCenterCache[selectedCity]);
    else cityToCenter(selectedCity).then(ll => { cityCenterCache[selectedCity] = ll; apply(ll); }).catch(() => toast('城市解析失败'));
  }
}
function useMyLocation() {
  selectedCity = '';
  localStorage.removeItem(SELCITY_KEY);
  closeCityModal();
  updateCityTag();
  toast('已切换为：我的位置');
  mode === 'embed' ? locateMe() : locateMeLite();
}

function showBox(which) {
  ['nearbyBox', 'routeBox', 'lineBox'].forEach(id => $(id).classList.add('hidden'));
  if (which) $(which).classList.remove('hidden');
}
function openSettings() {
  $('keyInput').value = localStorage.getItem(STORE_KEY) || DEFAULT_AMAP_KEY;
  $('secInput').value = localStorage.getItem(SEC_KEY) || DEFAULT_AMAP_SEC;
  $('settingsModal').classList.remove('hidden');
}
function setActive(id) {
  ['btnLocate', 'btnNearby', 'btnRoute', 'btnLine'].forEach(b => $(b).classList.remove('active'));
  if (id) $(id).classList.add('active');
}

function bindAll() {
  // 设置
  $('btnSettings').addEventListener('click', openSettings);
  $('btnSaveKey').addEventListener('click', () => {
    const k = $('keyInput').value.trim();
    if (!k) { toast('请输入 Key'); return; }
    const s = $('secInput').value.trim();
    localStorage.setItem(STORE_KEY, k);
    if (s) localStorage.setItem(SEC_KEY, s); else localStorage.removeItem(SEC_KEY);
    $('settingsModal').classList.add('hidden');
    location.reload();
  });
  $('btnHelp').addEventListener('click', () => $('helpModal').classList.remove('hidden'));
  $('btnHelpClose').addEventListener('click', () => $('helpModal').classList.add('hidden'));
  $('sheetClose').addEventListener('click', closeSheet);
  $('providerSel').addEventListener('change', () => localStorage.setItem(PROV_KEY, $('providerSel').value));

  // 城市选择
  $('cityPick').addEventListener('click', openCityModal);
  $('btnCityCancel').addEventListener('click', closeCityModal);
  $('btnCityOk').addEventListener('click', () => chooseCity($('cityInput').value));
  $('cityInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnCityOk').click(); });
  $('btnCityLocate').addEventListener('click', useMyLocation);
  document.querySelectorAll('#cityModal .city-chip').forEach(b => b.addEventListener('click', () => chooseCity(b.dataset.city)));

  // 定位
  $('btnLocate').addEventListener('click', () => { setActive('btnLocate'); mode === 'embed' ? locateMe() : locateMeLite(); });

  // 附近（底部栏 → 弹出子菜单；内嵌模式用地图搜索，临时模式跳地图）
  $('btnNearby').addEventListener('click', () => { setActive('btnNearby'); $('nearbyMenu').classList.toggle('open'); });
  $('nearbyMenu').querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      $('nearbyMenu').classList.remove('open');
      if (mode === 'embed') { showBox('nearbyBox'); searchNearby(b.dataset.kw, b.dataset.color); }
      else { openMapSearch(b.dataset.kw); }
    });
  });
  // 临时面板里的三个大按钮（直接跳地图搜）
  document.querySelectorAll('#litePanel .q').forEach(b => {
    b.addEventListener('click', () => openMapSearch(b.dataset.kw));
  });
  $('btnPlanLite').addEventListener('click', openMapNav);

  // 路线
  $('btnRoute').addEventListener('click', () => {
    setActive('btnRoute'); showBox('routeBox'); openSheet('乘车路线规划');
    setTimeout(() => (mode === 'embed' ? $('destInput2') : $('destInput')).focus(), 200);
  });
  $('btnPlan').addEventListener('click', () => mode === 'embed' ? planTransfer() : openMapNav());
  $('destInput2').addEventListener('keydown', e => { if (e.key === 'Enter') planTransfer(); });
  $('destInput').addEventListener('keydown', e => { if (e.key === 'Enter') openMapNav(); });

  // 查线
  $('btnLine').addEventListener('click', () => {
    setActive('btnLine'); showBox('lineBox'); openSheet('查询公交 / 地铁线路');
    setTimeout(() => $('lineInput').focus(), 200);
  });
  $('btnLineQuery').addEventListener('click', () => {
    const v = $('lineInput').value.trim();
    if (mode === 'embed') searchLine();
    else if (v) openMapSearch(v); else toast('请输入线路名');
  });
  $('lineInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnLineQuery').click(); });
}

/* ================= 启动 ================= */
async function boot() {
  const key = localStorage.getItem(STORE_KEY) || DEFAULT_AMAP_KEY;
  const sec = localStorage.getItem(SEC_KEY) || DEFAULT_AMAP_SEC;
  if (key) {
    try { AMap = await loadAMap(key, sec); initMap(); bindAll(); return; }
    catch (e) { /* Key 失效则降级临时模式 */ toast('Key 加载失败，进入临时版'); }
  }
  enterLite();
  bindAll();
}

boot();
