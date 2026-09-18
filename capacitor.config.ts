import type { CapacitorConfig } from "@capacitor/cli";

/**
 * 安卓壳的配置。
 *
 * 这个 App 本体是**纯前端静态导出**（`next build` → `out/`），所以壳里没有服务端、
 * 也没有 Capacitor 插件调用 —— 壳只干一件事：把 `out/` 装进 WebView。
 *
 * ⚠️ 打包 APK 时构建 **不能带 `BASE_PATH`**：子路径是给 GitHub Pages 用的，
 * WebView 从 `https://localhost` 起（Capacitor 的 asset loader），站点根就是 `/`。
 * 带上子路径会白屏 —— 页面能开，`_next/` 全 404。
 *
 * ⚠️ `appName` 刻意用 **ASCII**：Capacitor 会把它写进 `settings.gradle` 的
 * `rootProject.name`，而 Windows 上 Gradle 默认按 GBK 读那个文件 ——
 * 中文会变成乱码，甚至影响构建。**桌面上的显示名**靠
 * `android/app/src/main/res/values/strings.xml` 里的 `app_name`（UTF-8 XML，中文没问题）。
 */
const config: CapacitorConfig = {
  appId: "com.orang1ver.yuanqiledger",
  appName: "yuanqi-ledger",
  webDir: "out",
};

export default config;
