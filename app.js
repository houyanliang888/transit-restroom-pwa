'use strict';

/* 出行助手 · 附近公厕与乘车导航 PWA
 * 两种模式（按是否填高德 Key 自动切换）：
 *  - embed（内嵌）：填了高德 JS API Key → 本页内直接显示附近列表、画线、导航（最实用）
 *  - lite （临时）：没填 Key → 浏览器定位后，跳你手机地图 App 按当前位置搜索，零注册零费用
 */

const STORE_KEY = 'amap_key_v1';
const CITY_KEY  = 'last_city_v1';
const PROV_KEY  = 'map_provider_v1';

let AMap = null, map = null;
let currentCity = localStorage.getItem(CITY_KEY) || '';
let myLocation = null;                 // [lng, lat]（高德 GCJ-02 坐标）
let rawLocation = null;                // [lng, lat]（GPS WGS-84，未纠偏）
let overlays = [];
let placeSearch = null, transfer = null, lineSearch = null, geocoder = null;
let mode = null;                       // 'embed' | 'lite'

/* 免 Key 调起地图的 URL 模板（均无需 Key） */
const PROVIDERS = {
  amap: { name: '高德地图', search: (kw, ll) => `https://uri.amap.com/search?keyword=${enc(kw)}` + (ll ? `&location=${ll[0]},${ll[1]}&coordinate=gaode&callnative=1` : '') + `&src=tpwa` },
  baidu: { name: '百度地图', search: (kw, ll) => `https://map.baidu.com/search/${enc(kw)}` + (ll ? `@${ll[0]},${ll[1]}` : '') },
  qq: { name: '腾讯地图', search: (kw) => `https://apis.map.qq.com/uri/v1/search?keyword=${enc(kw)}&referer=tpwa` },
};

function enc(s) { return encodeURIComponent(s || ''); }
const $ = (id) => document.getElementById(id);
function provider() { return localStorage.getItem(PROV_KEY) || 'amap'; }

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
function loadAMap(key) {
  return new Promise((resolve, reject) => {
    if (window.AMap) return resolve(window.AMap);
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
  if (currentCity) $('cityTag').textContent = '城市：' + currentCity;
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
      $('cityTag').textContent = '城市：' + (c.city || c.province);
    }
  });
}
function searchNearby(keyword, colorKey) {
  if (!myLocation) { toast('请先定位'); locateMe(); return; }
  clearOverlays();
  addMarker(myLocation, '我的位置', COLORS.me);
  const center = new AMap.LngLat(myLocation[0], myLocation[1]);
  placeSearch.searchNearBy(keyword, center, 2000, (status, res) => {
    if (status !== 'complete' || !res.poiList || !res.poiList.pois.length) {
      toast('附近 2 公里内未找到「' + keyword + '」'); return;
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
  if (!myLocation) { toast('请先定位'); locateMe(); return; }
  if (!currentCity) { toast('正在获取城市，请稍候'); return; }
  $('routePanel').innerHTML = '<p class="hint">规划中…</p>';
  transfer.search(myLocation, dest, (status) => { if (status !== 'complete') toast('路线规划失败，换个目的地试试'); });
}
function searchLine() {
  const name = $('lineInput').value.trim();
  if (!name) { toast('请输入线路名，如 地铁1号线 / 1路'); return; }
  if (!currentCity) { toast('正在获取城市，请稍候'); return; }
  lineSearch.search(name, (status, res) => {
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
    },
    () => { $('liteStatus').textContent = '定位失败，请允许定位权限后重试'; toast('定位失败'); },
    { enableHighAccuracy: true, timeout: 9000, maximumAge: 0 }
  );
}
function openMapSearch(kw) {
  const key = provider();
  const p = PROVIDERS[key];
  // 高德：传纠偏后的 GCJ-02 坐标，确保"附近"准确居中；百度/腾讯：交 App 自身定位
  let ll = null;
  if (myLocation && key === 'amap') ll = myLocation;
  else if (myLocation) ll = myLocation; // 百度/腾讯也能收 GCJ-02 近似居中，体验可接受
  window.open(p.search(kw, ll), '_blank');
  toast('已用' + p.name + '（当前位置）搜索：' + kw);
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
function showBox(which) {
  ['nearbyBox', 'routeBox', 'lineBox'].forEach(id => $(id).classList.add('hidden'));
  if (which) $(which).classList.remove('hidden');
}
function openSettings() {
  $('keyInput').value = localStorage.getItem(STORE_KEY) || '';
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
    localStorage.setItem(STORE_KEY, k);
    $('settingsModal').classList.add('hidden');
    location.reload();
  });
  $('btnHelp').addEventListener('click', () => $('helpModal').classList.remove('hidden'));
  $('btnHelpClose').addEventListener('click', () => $('helpModal').classList.add('hidden'));
  $('sheetClose').addEventListener('click', closeSheet);
  $('providerSel').addEventListener('change', () => localStorage.setItem(PROV_KEY, $('providerSel').value));

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
  const key = localStorage.getItem(STORE_KEY);
  if (key) {
    try { AMap = await loadAMap(key); initMap(); bindAll(); return; }
    catch (e) { /* Key 失效则降级临时模式 */ toast('Key 加载失败，进入临时版'); }
  }
  enterLite();
  bindAll();
}

boot();
