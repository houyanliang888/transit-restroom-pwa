'use strict';

/* 出行助手 · 附近公厕与乘车导航 PWA
 * 两种模式（按是否填高德 Key 自动切换）：
 *  - embed（内嵌）：填了高德 JS API Key → 本页内直接显示附近列表、画线、导航（最实用）
 *  - lite （临时）：没填 Key → 浏览器定位后，跳你手机地图 App 按当前位置搜索，零注册零费用
 */

const STORE_KEY = 'amap_key_v1';
const SEC_KEY   = 'amap_sec_v1';   // 高德 JS API 2.0 安全密钥（securityJsCode），不配地图白屏
const WS_KEY_STORE = 'amap_web_key_v1';  // 备用通道：Web服务 API Key（不受域名白名单限制）
const CITY_KEY  = 'last_city_v1';
const SELCITY_KEY = 'selected_city_v1';
const PROV_KEY  = 'map_provider_v1';

/* 内置高德 Key（侯哥申请，已配域名白名单防盗刷）。
 * 用户未在 ⚙ 自填时直接使用内置值 → 推广时任何人打开即用，无需配置。 */
const DEFAULT_AMAP_KEY = '52acfdb74e31a72793d0b8bfd459aa88';
const DEFAULT_AMAP_SEC = 'fcb59b20ee438f984b347c10b035c1cf';
/* 内置「Web服务」Key —— 走 JSONP 备用通道，不受域名白名单限制，任何域名都能用。
 * 用途：① JS 通道不可用时的兜底；② 别人在别的域名打开时也能正常搜索/规划。 */
const DEFAULT_WEB_KEY = '8c7f3a832c406cfed4d74b8ed0a94b02';

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
/* 内置城市中心坐标表（WGS-84，运行时转 GCJ-02）。
 * 作用：选城市时不依赖高德地理编码接口——即使 Key 白名单没配好，"附近/路线/查线"也能正常工作。 */
const CITY_COORDS = {
  '北京': [116.407, 39.904], '上海': [121.473, 31.230], '广州': [113.264, 23.129], '深圳': [114.058, 22.543],
  '成都': [104.066, 30.572], '杭州': [120.155, 30.274], '西安': [108.948, 34.263], '重庆': [106.551, 29.563],
  '武汉': [114.305, 30.593], '南京': [118.797, 32.060], '天津': [117.190, 39.125], '长沙': [112.938, 28.228],
  '郑州': [113.625, 34.746], '青岛': [120.383, 36.067], '厦门': [118.089, 24.480], '昆明': [102.833, 24.881],
  '沈阳': [123.429, 41.796], '大连': [121.618, 38.914], '苏州': [120.585, 31.299], '长治': [112.113, 36.191],
  '太原': [112.549, 37.857], '石家庄': [114.502, 38.045], '济南': [117.000, 36.675], '合肥': [117.283, 31.861],
  '福州': [119.306, 26.075], '南昌': [115.858, 28.682], '贵阳': [106.630, 26.647], '南宁': [108.320, 22.824],
  '海口': [110.199, 20.044], '兰州': [103.834, 36.061], '西宁': [101.778, 36.617], '银川': [106.278, 38.466],
  '呼和浩特': [111.670, 40.818], '乌鲁木齐': [87.617, 43.793], '拉萨': [91.114, 29.653], '温州': [120.699, 27.994],
  '宁波': [121.550, 29.874], '无锡': [120.302, 31.574], '常州': [119.947, 31.772], '南通': [120.864, 32.016],
  '徐州': [117.185, 34.272], '扬州': [119.421, 32.393], '镇江': [119.452, 32.204], '泰州': [119.915, 32.484],
  '盐城': [120.164, 33.347], '淮安': [119.015, 33.610], '连云港': [119.179, 34.600], '临沂': [118.356, 35.104],
  '烟台': [121.448, 37.464], '潍坊': [119.107, 36.709], '淄博': [118.048, 36.814], '唐山': [118.180, 39.631],
  '洛阳': [112.454, 34.619], '襄阳': [112.144, 32.042], '宜昌': [111.290, 30.702], '桂林': [110.290, 25.274],
  '珠海': [113.554, 22.225], '东莞': [113.746, 23.047], '佛山': [113.122, 23.029], '泉州': [118.590, 24.874],
  '汕头': [116.708, 23.371], '湛江': [110.364, 21.275], '鞍山': [122.995, 41.110], '吉林': [126.553, 43.843],
  '长春': [125.323, 43.817], '哈尔滨': [126.535, 45.803], '大庆': [125.112, 46.590], '包头': [109.840, 40.658],
  '赤峰': [118.887, 42.258], '秦皇岛': [119.600, 39.935], '保定': [115.482, 38.867], '邯郸': [114.539, 36.626],
  '开封': [114.307, 34.798], '安阳': [114.352, 36.103], '新乡': [113.883, 35.303], '大同': [113.295, 40.090],
  '晋城': [112.851, 35.497], '阳泉': [113.583, 37.861], '临汾': [111.519, 36.088], '运城': [111.004, 35.023],
  '遵义': [106.937, 27.707], '绵阳': [104.741, 31.464], '南充': [106.083, 30.795], '宜宾': [104.630, 28.760],
  '攀枝花': [101.716, 26.580], '丽江': [100.233, 26.872], '大理': [100.268, 25.606], '三亚': [109.508, 18.247],
  '喀什': [75.990, 39.470], '克拉玛依': [84.886, 45.580], '敦煌': [94.661, 40.142], '嘉峪关': [98.277, 39.787],
};

function updateCityTag() {
  const el = $('cityTag');
  const modeTag = (mode === 'embed') ? '✓完整版' : '⚠临时版';
  if (selectedCity) el.textContent = modeTag + '·' + selectedCity + '（已选）';
  else if (currentCity) el.textContent = modeTag + '·' + currentCity;
  else el.textContent = modeTag + '·定位中…';
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
    const timer = setTimeout(() => reject(new Error('加载超时（15秒）')), 15000);
    s.onload = () => { clearTimeout(timer); window.AMap ? resolve(window.AMap) : reject(new Error('AMap 未就绪')); };
    s.onerror = () => { clearTimeout(timer); reject(new Error('高德脚本加载失败')); };
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
  // 优先用 Web 服务逆地理编码（不依赖已失效的 JS API Key，最可靠）
  wsRegeo(ll).then(r => {
    if (r && r.city) {
      currentCity = r.city;
      localStorage.setItem(CITY_KEY, currentCity);
      try { transfer.setCity(currentCity); } catch (e) {}
      try { lineSearch.setCity(currentCity); } catch (e) {}
      updateCityTag();
    }
  }).catch(() => {
    // JS API 兜底（旧路径），其 Key 失效时不会更新城市，但不会报错
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
  });
}
/* 城市名 → 中心点坐标（内嵌模式手动选城市时，用中心坐标做"附近/路线"基准） */
function cityToCenter(name) {
  return new Promise((resolve, reject) => {
    // 优先用内置坐标表（不依赖高德接口，白名单没配好也能用）
    const key = (name || '').replace(/市$/, '').trim();
    const hit = CITY_COORDS[key] || CITY_COORDS[name];
    if (hit) {
      const g = wgs84ToGcj02(hit[1], hit[0]);
      resolve([g.lng, g.lat]);
      return;
    }
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
      let ctDone = false;
      const ctTimer = setTimeout(() => {
        if (ctDone) return; ctDone = true;
        toast('城市定位超时' + keyErrorHint('timeout'));
      }, 12000);
      cityToCenter(selectedCity).then(ll => {
        ctDone = true; clearTimeout(ctTimer);
        cityCenterCache[selectedCity] = ll;
        doNearby(keyword, colorKey, ll);
      }).catch(err => {
        ctDone = true; clearTimeout(ctTimer);
        toast('城市定位失败' + keyErrorHint((err && err.message) || 'error'));
      });
      return;
    }
    center = cityCenterCache[selectedCity];
  } else if (!center) {
    toast('请先定位或选择城市'); locateMe(); return;
  }
  doNearby(keyword, colorKey, center);
}
/* 周边搜索三级兜底：小城市类型码 POI 稀疏（如长治 2km 内搜不到公厕），
 * 依次尝试 ① 类型码 3km ② 关键词"厕所" 5km ③ 关键词原名 5km */
function wsNearbyChain(keyword, center) {
  const alt = { '公共厕所': '厕所', '厕所': '公共厕所' };
  return wsPlaceAround(keyword, center, 3000).then(items => {
    if (items.length || !POI_TYPES[keyword]) return { items: items, kw: keyword, radius: 3000 };
    const kw2 = alt[keyword] || keyword;
    return wsPlaceAround(kw2, center, 5000).then(items2 => {
      if (items2.length) return { items: items2, kw: kw2, radius: 5000 };
      return wsPlaceAround(keyword, center, 5000).then(items3 =>
        ({ items: items3, kw: keyword, radius: 5000 }));
    });
  });
}
function doNearby(keyword, colorKey, center) {
  if (!navigator.onLine) { toast('当前无网络，请连网后重试'); return; }
  clearOverlays();
  addMarker(center, selectedCity || '我的位置', COLORS.me);

  let done = false;
  const timer = setTimeout(() => {
    if (done) return;
    done = true;
    toast('搜索超时，请检查网络后重试');
  }, 20000);

  // 主通道：Web 服务 API（JSONP，不受域名白名单限制，已实测可用）
  const wsP = webKey()
    ? wsNearbyChain(keyword, center).then(r => {
        if (done) return 'late';
        done = true; clearTimeout(timer);
        if (!r.items.length) { toast('附近 ' + (r.radius / 1000) + ' 公里内未找到「' + r.kw + '」'); return 'empty'; }
        const color = COLORS[colorKey] || COLORS.bus;
        r.items.forEach(it => addMarker(it.loc, it.name, color));
        renderList(r.items);
        try { map.setFitView(overlays, false, [40, 40, 40, 40]); } catch (e) {}
        openSheet(r.kw + '（' + r.items.length + '）');
        return 'ok';
      }).catch(err => { return 'fail:' + ((err && err.message) || 'error'); })
    : Promise.resolve('skip');

  // 增强通道：JS API（若可用则补充距离/画线；不可用不影响结果）
  const c = new AMap.LngLat(center[0], center[1]);
  placeSearch.searchNearBy(keyword, c, 3000, (status, res) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (status !== 'complete' || !res.poiList || !res.poiList.pois.length) {
      wsP.then(r => {
        if (r === 'ok' || r === 'empty' || r === 'late') return;
        if (typeof r === 'string' && r.indexOf('fail:') === 0) showNearbyFallback(keyword, center, new Error(r.slice(5)));
        else if (r === 'skip') showNearbyFallback(keyword, center, new Error(status));
      });
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
  if (!transfer) {
    $('routePanel').innerHTML = '<p class="hint">路线规划模块未加载（多为 Key 白名单限制），请检查高德后台域名白名单。</p>';
    toast('路线模块未加载'); return;
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
  // 并行：Web 服务通道（已验证可用，不受域名限制）先行出结果
  if (webKey()) { wsFallbackRoute(start, dest); }
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
        // JS 通道失败：Web 通道已在并行跑，这里不覆盖它的结果
        if (webKey()) return;
        markWsFailed();
        $('routePanel').innerHTML = '<p class="hint">规划失败 ' + keyErrorHint(status) + '。换个目的地或稍后再试。</p>'
          + '<button class="li-go" id="btnFallbackNav" style="width:100%;margin-top:8px">改用手机地图规划这条路线</button>';
        const b = document.getElementById('btnFallbackNav');
        if (b) b.addEventListener('click', () => {
          const d = ($('destInput2').value || '').trim();
          const p = PROVIDERS[provider()];
          window.open(p.search(d, null), '_blank');
          toast('已用' + p.name + '规划：' + d);
        });
        toast('路线规划失败');
      }
    });
  } catch (err) {
    done = true;
    clearTimeout(timer);
    if (!webKey()) {
      $('routePanel').innerHTML = '<p class="hint">规划出错：' + (err && err.message ? err.message : '未知错误') + '，请重试。</p>';
    }
  }
}
function searchLine() {
  const name = $('lineInput').value.trim();
  if (!name) { toast('请输入线路名，如 地铁1号线 / 1路'); return; }
  if (!lineSearch && !webKey()) { toast('线路查询模块未加载（多为 Key 白名单限制）'); return; }
  const city = selectedCity || currentCity;
  if (!city) { toast('请先定位或选择城市'); return; }
  try { if (lineSearch) lineSearch.setCity(city); } catch (e) {}
  let lineDone = false;
  const lineTimer = setTimeout(() => {
    if (lineDone) return;
    lineDone = true;
    toast('查询超时' + keyErrorHint('timeout'));
  }, 15000);
  const onLine = (status, res) => {
    if (lineDone) return;
    lineDone = true;
    clearTimeout(lineTimer);
    if (status !== 'complete' || !res.lineInfo || !res.lineInfo.length) {
      markWsFailed();
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
  };
  if (lineSearch) {
    lineSearch.search(name, onLine);
  }
  // Web 服务通道（已验证可用，不受域名限制）：优先，且能拿到全程 polyline
  if (webKey()) {
    wsLineQuery(name, city).then(res => {
      if (!res || !res.stations || !res.stations.length) { toast('未找到「' + name + '」，确认线路名或城市'); return; }
      // Web 通道已出结果，清掉 JS 通道的 15 秒兜底计时器，避免结果出来还弹"查询超时"
      if (!lineDone) { lineDone = true; clearTimeout(lineTimer); }
      clearOverlays();
      const color = ((res.name || '') + (res.type || '')).includes('地铁') ? COLORS.metro : COLORS.bus;
      if (res.polyline && res.polyline.length) {
        try {
          const poly = new AMap.Polyline({ path: res.polyline, strokeColor: color, strokeWeight: 6, strokeOpacity: 0.85, zIndex: 8 });
          map.add(poly); overlays.push(poly);
        } catch (e) {}
      }
      res.stations.forEach(s => addMarker(s.loc, s.name, color));
      renderList(res.stations.map((s, i) => ({
        name: (i + 1) + '. ' + s.name,
        addr: (res.startStop ? '始：' + res.startStop + '　' : '') + (res.endStop ? '终：' + res.endStop : ''),
        dist: '', loc: s.loc,
      })));
      if (overlays.length) try { map.setFitView(overlays, false, [40, 40, 40, 40]); } catch (e) {}
      openSheet((res.name || name) + '（' + res.stations.length + ' 站）');
    }).catch(err => {
      toast('查询失败' + keyErrorHint((err && err.message) || 'error'));
    });
  }
}
/* Web 服务 API：查线路站点 + 全程走向
 * 注意：extensions=all 时 buslines 在返回体顶层（不是 result.buslines）；
 *       location 字段是字符串 "lng,lat"，需 parseLoc 解析。 */
function wsLineQuery(name, city) {
  const k = webKey();
  if (!k) return Promise.reject(new Error('NO_WEB_KEY'));
  const url = 'https://restapi.amap.com/v3/bus/linename?key=' + encodeURIComponent(k)
    + '&city=' + encodeURIComponent(city || '')
    + '&keywords=' + encodeURIComponent(name)
    + '&extensions=all';
  return jsonp(url, 15000).then(d => {
    if (!d || d.status !== '1') throw new Error((d && d.info) || '线路查询失败');
    const lines = d.buslines || (d.result && d.result.buslines) || [];
    if (!lines.length) return null;
    const line = lines[0];
    // 站点字段是 busstops（不是 stations），含 id/location/name/sequence
    const st = (line.busstops || line.stations || [])
      .map(s => ({ name: s.name, loc: parseLoc(s.location) }))
      .filter(x => x.loc && x.name);
    // polyline 解析全程走向
    const poly = [];
    if (line.polyline) {
      line.polyline.split(';').forEach(pt => {
        const a = pt.split(',');
        if (a.length >= 2) {
          const lng = parseFloat(a[0]), lat = parseFloat(a[1]);
          if (!isNaN(lng) && !isNaN(lat)) poly.push([lng, lat]);
        }
      });
    }
    // 没有站点时，用 polyline 首尾点兜底
    let stations = st;
    if (!stations.length && poly.length) {
      stations = [
        { name: line.start_stop || '起点', loc: poly[0] },
        { name: line.end_stop || '终点', loc: poly[poly.length - 1] },
      ];
    }
    return {
      name: line.name,
      stations: stations,
      polyline: poly,
      startStop: line.start_stop,
      endStop: line.end_stop,
      type: line.type,
    };
  });
}
function showNearbyFallback(keyword, center, err) {
  markWsFailed();
  const ul = $('resultList');
  ul.innerHTML = '<li class="hint">搜索失败' + keyErrorHint((err && err.message) || 'error') + '</li>';
  const li = document.createElement('li');
  li.innerHTML = '<button class="li-go" style="width:100%">改用手机地图搜索「' + escapeHTML(keyword) + '」</button>';
  li.querySelector('button').addEventListener('click', () => openMapSearch(keyword));
  ul.appendChild(li);
  openSheet(keyword + '（搜索失败）');
  toast('搜索失败');
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

/* 备用通道：Web 服务 API 规划路线（已实测可用，不受域名白名单限制）
 * 返回结构要点：d.route.transits[] → segments[] →
 *   公交信息在 segment.bus.buslines[]（含 name/polyline/stops）
 *   步行路径在 segment.walking.steps[].polyline
 */
function wsFallbackRoute(start, dest) {
  const baseCity = selectedCity || currentCity || '';
  $('routePanel').innerHTML = '<p class="hint">规划中…</p>';
  // 出发城市缺失时（GPS 刚打开还没反查完），先用起点坐标反查拿到城市
  const cityP = baseCity ? Promise.resolve(baseCity)
    : wsRegeo(start).then(r => r && r.city ? r.city : '').catch(() => '');
  cityP.then(city => {
    // 带着确定的城市 + 用户坐标去匹配目的地，彻底杜绝"高铁站"被匹配到外省
    return resolveDest(dest, city, myLocation).then(m => {
      const hint = '✅ 已匹配目的地：<b>' + escapeHTML(m.name) + '</b>'
        + (m.city && m.city !== city ? '（' + escapeHTML(m.city) + '）' : '');
      return wsTransit(start, m.loc, city || m.city).then(d => ({ d: d, m: m, hint: hint }));
    });
  }).then(({ d, m, hint }) => {
    const plans = (d.route && d.route.transits) || [];
    if (!plans.length) {
      $('routePanel').innerHTML = '<p class="hint">' + hint + '<br/>这两点之间暂无公交/地铁方案，试试更近的目的地。</p>';
      return;
    }
    let html = '<div style="font-size:12px;color:#16a34a;margin-bottom:6px">' + hint + '</div>';
    plans.slice(0, 3).forEach(p => {
      let segs = '';
      let path = [];
      (p.segments || []).forEach(s => {
        // 步行段
        const steps = (s.walking && s.walking.steps) || [];
        const walkDist = s.walking ? Math.round((s.walking.distance || 0) / 10) : 0;
        steps.forEach(st => {
          if (st.polyline) st.polyline.split(';').forEach(pt => {
            const a = pt.split(',');
            if (a.length >= 2) path.push([parseFloat(a[0]), parseFloat(a[1])]);
          });
        });
        if (walkDist > 30) segs += '🚶 步行约 ' + (walkDist / 100) + ' 公里<br/>';
        // 公交段
        const buslines = (s.bus && s.bus.buslines) || [];
        buslines.forEach(b => {
          // Web API：线路名在 b.name，站点数在 b.via_num，首末站在 departure_stop/arrival_stop（是对象，取 .name）
          const names = b.name || (b.lines || []).map(l => l.name).filter(Boolean).join('/') || '公交';
          const stopCount = b.via_num || (b.stops || b.busstops || []).length || 0;
          const from = stopName(b.departure_stop), to = stopName(b.arrival_stop);
          segs += '🚌 ' + names + (stopCount ? '（' + stopCount + ' 站）' : '')
            + (from ? '　' + from + (to ? ' → ' + to : '') : '') + '<br/>';
          if (b.polyline) b.polyline.split(';').forEach(pt => {
            const a = pt.split(',');
            if (a.length >= 2) path.push([parseFloat(a[0]), parseFloat(a[1])]);
          });
          (b.stops || b.busstops || []).forEach(st => {
            const loc = parseLoc(st.location);
            if (loc) path.push(loc);
          });
        });
      });
      const mins = p.duration ? Math.round(p.duration / 60) : (p.time || '?');
      const km = Math.round((p.distance || 0) / 100) / 10;
      html += '<div style="border:1px solid var(--line);border-radius:10px;padding:8px;margin-bottom:8px">'
        + '<b>' + mins + ' 分钟 · ' + km + ' 公里</b><br/>'
        + '<span style="font-size:12px;color:#475569;line-height:1.8">' + (segs || '直达') + '</span></div>';
      // 地图画线
      try {
        if (path.length > 1) {
          const poly = new AMap.Polyline({ path: path, strokeColor: COLORS.bus, strokeWeight: 7, strokeOpacity: 0.9, zIndex: 9 });
          map.add(poly); overlays.push(poly);
          const mk = new AMap.Marker({ position: [m.loc[0], m.loc[1]], title: m.name, offset: new AMap.Pixel(-15, -32), content: pinHTML(COLORS.bus, m.name), zIndex: 12 });
          map.add(mk); overlays.push(mk);
        }
      } catch (e) {}
    });
    $('routePanel').innerHTML = html;
    try { map.setFitView(overlays, false, [60, 60, 60, 60]); } catch (e) {}
  }).catch(err => {
    $('routePanel').innerHTML = '<p class="hint">规划失败' + keyErrorHint((err && err.message) || 'error') + '。</p>'
      + '<button class="li-go" id="btnFallbackNav" style="width:100%;margin-top:8px">改用手机地图规划这条路线</button>';
    const b = document.getElementById('btnFallbackNav');
    if (b) b.addEventListener('click', () => {
      const d = ($('destInput2').value || '').trim();
      const p = PROVIDERS[provider()];
      window.open(p.search(d, null), '_blank');
    });
  });
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
  // 优先读路线面板（embed 面板）里用户刚输入的目的地，再退回 lite 面板
  const d2 = ($('destInput2') && $('destInput2').value || '').trim();
  const d1 = ($('destInput') && $('destInput').value || '').trim();
  const dest = d2 || d1;
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
  $('webKeyInput').value = localStorage.getItem(WS_KEY_STORE) || '';
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
    const s = $('secInput').value.trim();
    const wk = $('webKeyInput').value.trim();
    if (k) localStorage.setItem(STORE_KEY, k);
    if (s) localStorage.setItem(SEC_KEY, s); else localStorage.removeItem(SEC_KEY);
    if (wk) localStorage.setItem(WS_KEY_STORE, wk); else localStorage.removeItem(WS_KEY_STORE);
    $('settingsModal').classList.add('hidden');
    location.reload();
  });
  $('btnHelp').addEventListener('click', () => $('helpModal').classList.remove('hidden'));
  $('btnHelpClose').addEventListener('click', () => $('helpModal').classList.add('hidden'));
  $('btnSelfCheck').addEventListener('click', runSelfCheck);
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

/* ================= 接口自检（诊断高德 Key / 白名单是否通） ================= */
function wsProbe(path, params, cb) {
  // 直接调高德 Web 服务接口，读取真实返回码（用于判断白名单/Key 状态）
  const url = 'https://restapi.amap.com/' + path + '?' + Object.keys(params)
    .map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  fetch(url, { referrer: location.href }).then(r => r.json()).then(cb).catch(() => cb({ status: '0', info: 'NETWORK_FAIL' }));
}
function runSelfCheck() {
  const box = $('selfCheckBox');
  box.classList.remove('hidden');
  box.innerHTML = '<p class="hint">检测中…（约 5 秒）</p>';
  const key = (localStorage.getItem(STORE_KEY) || DEFAULT_AMAP_KEY).trim();
  const sec = (localStorage.getItem(SEC_KEY) || DEFAULT_AMAP_SEC).trim();
  const rows = [];

  // ① Web端(JS API) Key 是否可用
  wsProbe('v3/log/init', { key: key, jscode: sec, s: 'rsv3', product: 'JsInit', platform: '' }, (d) => {
    rows.push({
      name: '① JS API Key 鉴权',
      ok: d && d.status === '1',
      msg: d && d.status === '1' ? '✓ 通过（Key 与安全密钥有效）'
          : '✗ ' + (d && d.info || '未知') + (d && d.infocode ? '（' + d.infocode + '）' : ''),
      fix: (d && d.status !== '1') ? 'Key 或安全密钥不匹配 / 已失效 → 去高德控制台检查，或重新生成一份 Key + 安全密钥' : ''
    });
    step2();
  });

  // ② 业务接口（受域名白名单管控）
  function step2() {
    wsProbe('v3/geocode/geo', { key: key, jscode: sec, address: '长治' }, (d) => {
      const ok = d && d.status === '1';
      rows.push({
        name: '② 地理编码 / 附近搜索 / 路线',
        ok: ok,
        msg: ok ? '✓ 通过（白名单已生效，功能可用）'
                : '✗ ' + (d && d.info || '未知') + (d && d.infocode ? '（' + d.infocode + '）' : ''),
        fix: ok ? '' : '此接口受「域名白名单」管控：高德控制台 → 该 Key → 域名白名单，填 houyanliang888.github.io（不带 https:// 和路径），保存后等 5–30 分钟再测'
      });
      render();
    });
  }
  function render() {
    box.innerHTML = rows.map(r =>
      `<div style="border:1px solid ${r.ok ? '#16a34a' : '#ef4444'};border-radius:10px;padding:10px;margin-bottom:8px;font-size:13px">
        <div style="font-weight:700;color:${r.ok ? '#16a34a' : '#dc2626'};margin-bottom:4px">${r.name}</div>
        <div>${r.msg}</div>
        ${r.fix ? '<div style="margin-top:6px;color:#64748b;line-height:1.6">' + r.fix + '</div>' : ''}
      </div>`).join('')
      + '<p class="hint">提示：白名单修改后高德需 5–30 分钟同步，期间接口仍会返回 INVALID_USER_KEY，属正常现象。</p>';
  }
}

/* ================= 备用通道：高德 Web 服务 API（JSONP）
 * 背景：JS API 的服务端接口受「域名白名单」管控，别人在别的域名下用就打不开。
 * Web 服务 API 用 key 直连 + JSONP 回调，不校验页面域名 → 任何人打开都能用。
 * 注意：Web 服务 API 需要在控制台另建一个「Web服务」类型的 Key（同样是免费、0 元）。
 */
function webKey() { return (localStorage.getItem(WS_KEY_STORE) || DEFAULT_WEB_KEY).trim(); }

function jsonp(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const cb = '__ws_cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const s = document.createElement('script');
    let done = false;
    const timer = setTimeout(() => {
      if (done) return; done = true;
      try { delete window[cb]; } catch (e) {}
      if (s.parentNode) s.parentNode.removeChild(s);
      reject(new Error('请求超时'));
    }, timeout);
    window[cb] = (data) => {
      if (done) return; done = true;
      clearTimeout(timer);
      try { delete window[cb]; } catch (e) {}
      if (s.parentNode) s.parentNode.removeChild(s);
      resolve(data);
    };
    s.onerror = () => {
      if (done) return; done = true;
      clearTimeout(timer);
      try { delete window[cb]; } catch (e) {}
      if (s.parentNode) s.parentNode.removeChild(s);
      reject(new Error('网络请求失败'));
    };
    s.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'callback=' + cb;
    document.head.appendChild(s);
  });
}

/* 带一次重试的 JSONP：手机网络抖动 / 高德 QPS 瞬时限流时，超时自动再试一次 */
function jsonpRetry(url, timeout, tries) {
  tries = tries == null ? 2 : tries;
  return jsonp(url, timeout || 15000).catch(err => {
    const msg = (err && err.message) || '';
    if (tries > 1 && (msg.indexOf('超时') >= 0 || /timeout/i.test(msg))) {
      return new Promise(r => setTimeout(r, 700)).then(() => jsonpRetry(url, timeout, tries - 1));
    }
    throw err;
  });
}

/* POI 类型码：经实测「公交站/地铁站」用类型码查不到，改用关键词更可靠（返回名称带"(公交站)"后缀）
 * 公共厕所用 types=120302 精确匹配（纯关键词会混入住宅区） */
const POI_TYPES = {
  '公共厕所': '120302',
};

/* 兼容高德 location 字段：extensions=base 时是字符串 "lng,lat"，all 时是对象 */
function parseLoc(loc) {
  if (!loc) return null;
  if (typeof loc === 'string') {
    const a = loc.split(',');
    if (a.length >= 2) {
      const lng = parseFloat(a[0]), lat = parseFloat(a[1]);
      if (!isNaN(lng) && !isNaN(lat)) return [lng, lat];
    }
    return null;
  }
  if (typeof loc.lng === 'number' && typeof loc.lat === 'number') return [loc.lng, loc.lat];
  return null;
}

/* Web 服务 API：周边搜索（JSONP 带重试，小城市网络慢也扛得住） */
function wsPlaceAround(keyword, center, radius) {
  const k = webKey();
  if (!k) return Promise.reject(new Error('NO_WEB_KEY'));
  const types = POI_TYPES[keyword];
  const city = selectedCity || currentCity || '';
  let url = 'https://restapi.amap.com/v3/place/around'
    + '?key=' + encodeURIComponent(k)
    + '&location=' + center[0] + ',' + center[1]
    + '&radius=' + radius + '&sortrule=distance&offset=25&page=1&extensions=base';
  if (types) {
    url += '&types=' + types;
  } else {
    url += '&keywords=' + encodeURIComponent(keyword);
    if (city) url += '&city=' + encodeURIComponent(city);
  }
  return jsonpRetry(url, 15000).then(d => {
    if (!d || d.status !== '1') throw new Error((d && d.info) || '搜索失败');
    return (d.pois || []).map(p => ({
      name: p.name,
      addr: p.address || '',
      dist: p.distance,
      loc: parseLoc(p.location),
    })).filter(x => x.loc);
  });
}
/* 站点名兼容：extensions=all 时 departure_stop/arrival_stop 是对象 {id,name,location}，
 * 直接拼接会打出 [object Object]，必须取 .name */
function stopName(s) {
  if (!s) return '';
  if (typeof s === 'string') return s;
  return s.name || '';
}

/* Web 服务 API：关键词搜索（用于目的地匹配，可限定城市） */
function wsTextSearch(keyword, city, citylimit) {
  const k = webKey();
  if (!k) return Promise.reject(new Error('NO_WEB_KEY'));
  let url = 'https://restapi.amap.com/v3/place/text?key=' + encodeURIComponent(k)
    + '&keywords=' + encodeURIComponent(keyword)
    + '&offset=5&page=1&extensions=base';
  if (city) url += '&city=' + encodeURIComponent(city);
  if (citylimit) url += '&citylimit=true';
  return jsonpRetry(url, 15000).then(d => {
    if (!d || d.status !== '1') throw new Error((d && d.info) || '搜索失败');
    return (d.pois || []).map(p => {
      let cname = p.cityname || '';
      if (cname === '[]') cname = '';
      return {
        name: p.name,
        addr: (p.pname || '') + cname + (p.adname || '') + (p.address && p.address !== '[]' ? ' ' + p.address : ''),
        city: cname,
        loc: parseLoc(p.location),
      };
    }).filter(x => x.loc);
  });
}
/* 目的地解析（优先就近，杜绝匹配外省）：
 * 0. 若有用户坐标 origin：先以坐标为中心 60km 内搜同名地点（最可靠，"高铁站"一定落在本地）；
 * 1. 本市限定搜索（citylimit）—— 高德 QPS 限流时重试 4 次，绝不退化到无约束全国搜索；
 * 2. 本市搜索为空，再走地理编码；
 * 3. 最后才全国兜底。
 * 同一「城市/坐标 + 目的地」命中缓存直接返回（躲 QPS + 重复查询秒出）。 */
const _destCache = {};
function resolveDest(name, city, origin) {
  const key = (name || '') + '@' + (city || '') + '@' + (origin ? 'g' : '');
  if (_destCache[key]) return Promise.resolve(_destCache[key]);
  const retry = (fn, n, wait) => {
    const attempt = (k) => fn().catch(err => {
      if (k <= 1) return [];
      return new Promise(r => setTimeout(r, wait)).then(() => attempt(k - 1));
    });
    return attempt(n);
  };
  const fromNear = origin
    ? wsPlaceAround(name, origin, 60000).catch(() => []).then(items => items.slice(0, 1).map(it => ({ name: it.name, addr: it.addr, city: city || '', loc: it.loc })))
    : Promise.resolve([]);
  return fromNear.then(near => {
    if (near.length) { _destCache[key] = near[0]; return near[0]; }
    return retry(() => wsTextSearch(name, city || '', true), 4, 1200)
      .then(l1 => l1.length ? l1 : wsGeocode(name).then(loc => [{ name: name, addr: '地理编码匹配', city: '', loc: loc }]).catch(() => []))
      .then(l2 => l2.length ? l2 : retry(() => wsTextSearch(name, '', false), 2, 1200))
      .then(list => {
        if (!list.length) throw new Error('目的地没找到，试试更具体的名字（如「长治东站」）');
        const m = list[0];
        _destCache[key] = m;
        return m;
      });
  });
}
/* Web 服务 API：地理编码 */
function wsGeocode(addr) {
  const k = webKey();
  if (!k) return Promise.reject(new Error('NO_WEB_KEY'));
  const url = 'https://restapi.amap.com/v3/geocode/geo?key=' + encodeURIComponent(k)
    + '&address=' + encodeURIComponent(addr);
  return jsonp(url).then(d => {
    if (!d || d.status !== '1' || !d.geocodes || !d.geocodes.length) throw new Error((d && d.info) || '地理编码失败');
    const loc = parseLoc(d.geocodes[0].location);
    if (!loc) throw new Error('地理编码结果异常');
    return loc;
  });
}
/* Web 服务 API：逆地理编码（坐标→城市）—— 不依赖已失效的 JS API Key，
 * 保证 GPS 定位后能可靠拿到 currentCity（否则"高铁站"等目的地会被匹配到外省） */
function wsRegeo(ll) {
  const k = webKey();
  if (!k) return Promise.reject(new Error('NO_WEB_KEY'));
  const url = 'https://restapi.amap.com/v3/geocode/regeo?key=' + encodeURIComponent(k)
    + '&location=' + ll[0] + ',' + ll[1] + '&extensions=base';
  return jsonpRetry(url, 15000).then(d => {
    if (!d || d.status !== '1' || !d.regeocode) throw new Error((d && d.info) || '逆地理编码失败');
    const c = d.regeocode.addressComponent || {};
    const city = (c.city || c.province || '').replace(/市$/, '');
    return { city: city, full: (c.province || '') + (city ? city + '市' : '') + (c.district || '') };
  });
}
/* Web 服务 API：公交路径规划 */
function wsTransit(start, dest, city) {
  const k = webKey();
  if (!k) return Promise.reject(new Error('NO_WEB_KEY'));
  const url = 'https://restapi.amap.com/v3/direction/transit/integrated'
    + '?key=' + encodeURIComponent(k)
    + '&origin=' + start[0] + ',' + start[1]
    + '&destination=' + dest[0] + ',' + dest[1]
    + '&city=' + encodeURIComponent(city || '')
    + '&cityd=' + encodeURIComponent(city || '')
    + '&strategy=0&extensions=all';
  return jsonp(url).then(d => {
    if (!d || d.status !== '1') throw new Error((d && d.info) || '规划失败');
    return d;
  });
}

/* ================= 智能降级 =================
 * 若高德 Key 存在但服务端接口全线失败（白名单未生效 / Key 未被接受 / 额度耗尽），
 * 自动降级为「跳手机地图」可用状态 —— 保证推广给陌生人时不会点了没反应。
 */
let wsFailStreak = 0;   // 连续失败次数
function markWsFailed() {
  wsFailStreak++;
  if (wsFailStreak >= 3 && mode === 'embed') {
    toast('高德接口不可用，已切换为手机地图模式', 4000);
    degradeToLite();
  }
}
function degradeToLite() {
  mode = 'lite';
  try { $('litePanel').classList.remove('hidden'); } catch (e) {}
  try { $('map').style.display = 'none'; } catch (e) {}
  try { $('providerSel').value = provider(); } catch (e) {}
  // 降级时把引导文案改成"接口暂不可用"，避免误导
  try {
    $('liteBadge') && ($('liteBadge').textContent = '手机地图模式 · 功能可用');
    $('liteTip') && ($('liteTip').innerHTML = '📡 高德接口暂时不可用，已自动切换为<strong>手机地图模式</strong>：下方三个按钮会直接在你的地图 App 里搜索并显示结果，功能一样，只是多跳一步。');
    $('liteStatus') && ($('liteStatus').textContent = '点击下方按钮开始使用');
  } catch (e) {}
  updateCityTag();
}

/* ================= 启动 ================= */
/* 全局错误兜底：任何脚本错误都提示出来，避免"点了没反应"却无从排查 */
window.addEventListener('error', (e) => {
  const msg = e.message || '';
  // 高德瓦片 worker 的已知无害报错，不打扰用户
  if (msg.indexOf('Unimplemented type') >= 0) return;
  try { toast('脚本出错：' + msg + '，请刷新重试', 5000); } catch (_) {}
});

let bound = false;
function ensureBind() {
  if (bound) return;
  bound = true;
  try { bindAll(); }
  catch (err) { try { toast('界面初始化出错：' + (err.message || err), 5000); } catch (_) {} }
}

async function boot() {
  const key = localStorage.getItem(STORE_KEY) || DEFAULT_AMAP_KEY;
  const sec = localStorage.getItem(SEC_KEY) || DEFAULT_AMAP_SEC;
  try {
    AMap = await loadAMap(key, sec);   // loadAMap 内置 15 秒超时，不会永远挂起
    initMap();
  } catch (e) {
    /* Key 失效/断网则降级临时模式 */
    toast('地图加载失败，进入临时版（' + (e.message || '原因未知') + '）', 4000);
    enterLite();
  } finally {
    ensureBind();                      // 无论如何都保证按钮事件被绑定
    setTimeout(() => {
      if (mode === 'embed') {
        toast('✓ 完整版已启用：可查附近/路线/查线', 3000);
      } else {
        toast('⚠ 当前是临时版：高德 Key 未生效（多为域名白名单限制），功能会跳转到地图 App', 6000);
      }
      updateCityTag();
    }, 900);
  }
}

boot();
