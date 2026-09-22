/* 元气账本 —— 离线缓存 Service Worker
   只缓存同源静态资源；DeepSeek / Open Food Facts 等跨域请求一律直连，不缓存。

   版本化：下面两行常量在源码里是**占位符**，由 scripts/deploy.mjs 发布时从
   package.json 读版本号、生成构建号后替换。
   缓存名带版本与构建号 —— SW 字节一变浏览器就会更新它，activate 会清掉旧缓存，
   这样部署后客户端不会一直卡在旧资源上（iOS 主屏 App 尤其明显）。 */
const APP_VERSION = "1.5.0";
const BUILD_ID = "20260922.1231";
const CACHE = `yuanqi-v${APP_VERSION}-${BUILD_ID}`;
const CORE = ["./", "./health/", "./takeout/", "./weekly/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // 逐个 add：用 addAll 的话，只要有一个路径 404，整个核心缓存都会失败且被静默吞掉
      Promise.all(CORE.map((url) => cache.add(url).catch(() => {}))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        const others = keys.filter((k) => k !== CACHE);
        // 有其他缓存 = 这次是"替换旧版本"，值得通知用户；空手而来 = 首次安装，不必打扰
        return Promise.all(others.map((k) => caches.delete(k))).then(() => others.length > 0);
      })
      .then((isUpgrade) => {
        if (!isUpgrade) return;
        // 广播带上新版本号，页面据此显示「发现新版本」
        self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
          clients.forEach((client) => client.postMessage({ type: "SW_UPDATED", version: APP_VERSION }));
        });
      }),
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  // 页面点"立即更新"后跳过等待并通知所有页面刷新
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 跨域（AI 接口、条码查询）不插手

  // 页面导航：网络优先且强制验证（不走 HTTP 缓存，部署后第一次打开必拿新版），
  // 离线时回退到缓存的对应页面
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req, { cache: "no-cache" })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("./"))),
    );
    return;
  }

  // 静态资源：缓存优先，后台更新
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});
