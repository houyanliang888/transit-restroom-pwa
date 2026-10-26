/* 出行助手 PWA 离线缓存
 * 策略：网络优先，失败回退到缓存（保证 App 界面离线可开；地图数据仍需联网）
 * 重要：只有「页面导航请求」失败才回退到首页 HTML；
 *      JS/CSS 等资源失败绝不回退到 HTML——否则 HTML 会被浏览器当 JS 执行，整个应用崩溃（表现为所有按钮无反应）。
 */
const CACHE = 'transit-pwa-v7-cityretry';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) =>
      Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 高德地图脚本/接口/瓦片不缓存，直接走网络
  if (url.hostname.includes('amap.com') || url.hostname.includes('amapusercontent.com')) {
    return;
  }
  e.respondWith(
    fetch(e.request).catch(() => {
      // 仅页面导航失败才回退首页；其他资源失败就明确失败，绝不能拿 HTML 冒充 JS
      if (e.request.mode === 'navigate') return caches.match('./');
      return caches.match(e.request).then((r) => r || Response.error());
    })
  );
});
