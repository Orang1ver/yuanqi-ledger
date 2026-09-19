# 元气账本 · 安卓壳「无感更新」（OTA）实施方案

> 状态：**方案已定、尚未实现**。这份文档是给接手实现的人看的，不是完成记录。
> 起因：用户问「能在 app 内实现收到更新通知更新吗」，在四条路径里选定了
> **「安卓壳无感更新（OTA）」** —— 即**不重新安装 APK** 就能用上新版本。

---

## 0. 一句话目标

安卓壳里的 App 打开时自己发现新版 → 后台把新版网页资源下好 → **下次启动直接是新版**，
不再需要「下载 3.7MB 安装包 → 系统弹框 → 手动点安装」这一串动作。

---

## 1. 现状盘点

### ✅ 已经就绪、直接复用

| 东西 | 位置 | 说明 |
|---|---|---|
| 远端版本查询 | `lib/update.ts` | 已能读 `version.json`、按数字段比版本号、区分壳/网页、失败一律 `null` |
| 检查时机 | `app/components/shell/UpdateBanner.tsx` | 打开 / 回前台 / 网络恢复三时机，已跑通 |
| 外壳判定 | `lib/update.ts` `isNativeShell()` | `window.Capacitor.isNativePlatform()`，不 import Capacitor 包 |
| 线上基址常量 | `lib/update.ts` `REMOTE_SITE` | 壳里唯一可用的绝对地址 |
| **OTA 所需的全部原生能力** | **Capacitor 7 内置，见 §2** | **不需要写一行 Java，也不需要新增原生插件** |
| 发布脚本 | `scripts/deploy.mjs` | `version.json` 由它生成，加字段有现成位置 |
| 资源规模 | `out/` = **85 个文件 / 1.8MB** | 很小，逐个文件下载完全可行 |

### ❌ 缺的

1. 站点上没有「这一版的网页资源清单」（现在 `version.json` 只有 `version` 与 `apk`）
2. 没有任何下载、落盘、校验、切换的代码
3. **没有真机/模拟器** ← 最大缺口，见 §7

---

## 2. 关键机制（**先读懂这五条，否则会做错**）

全部结论来自本仓已装的 Capacitor 7 源码，不是推测。

### 2.1 内置 `WebView` 插件默认注册，JS 可直接调

- `node_modules/@capacitor/android/capacitor/.../Bridge.java:666` → `registerPlugin(com.getcapacitor.plugin.WebView.class)`
- 插件没有指定 `name`，所以 `pluginId` 退化成**类名 `WebView`**（`Bridge.java:734-744`）
- 它暴露四个方法（`.../plugin/WebView.java`）：
  | JS 方法 | 作用 |
  |---|---|
  | `setServerBasePath({path})` | **让 WebView 从设备上的绝对目录加载资源**（OTA 的核心） |
  | `setServerAssetPath({path})` | 切回打包在 APK 里的 assets（回滚用） |
  | `getServerBasePath()` | 查当前基址 |
  | `persistServerBasePath()` | 把当前基址写进 SharedPreferences，**跨启动生效** |

调用方式：`registerPlugin("WebView")` 或 `Capacitor.Plugins.WebView`（JS 侧无对应 npm 包，走原生代理）。

### 2.2 冷启动会自动恢复上次的基址

`Bridge.java:295-305`：启动时若 `!isDeployDisabled()` 且 `!isNewBinary()`，
从 `CapWebViewSettings/serverBasePath` 读路径，**且 `new File(path).exists()` 才用**。
→ 目录被删/写坏时会**自动退回打包资源**，这是一层白送的保护。

### 2.3 ⚠️ 换 APK 会清空 OTA 基址（这是设计上要利用的性质）

`Bridge.java:433-460` `isNewBinary()`：把当前包的 `versionCode`/`versionName` 与上次记录比，
**任一不同 → 把 `CapWebViewSettings/serverBasePath` 置空**，并视为"新二进制"。

本仓 `android/app/build.gradle:20` 的 `vCode = major*10000 + minor*100 + patch`、
`versionName = pkg.version`，**每发一版必变**。

→ 结论：**APK 是基线，OTA 只服务「基线到线上之间的差」**。
装了新版 APK 的人自动回到打包资源，不需要任何清理逻辑。**不要试图绕过它。**

### 2.4 `setServerBasePath` 接受的是**文件系统绝对路径**

`Bridge.java:1423` → `localServer.hostFiles(path)` → `WebViewLocalServer.java:650`
（`hostFiles` 只是把 `basePath` 记下来，`isAsset=false`），随后 `webView.loadUrl(appUrl)` 重载。

→ 所以路径形如 `/data/user/0/com.orang1ver.yuanqiledger/files/ota/1.3.0`，
**不带 `file://` 前缀**。`Filesystem.getUri()` 返回的是 `file://…`，要剥掉。

### 2.5 ⚠️ 壳里的 Service Worker 会和 OTA 打架

`android/app/src/main/assets/public/sw.js` 是**打包进 APK 的**，在 `https://localhost` 下注册。
它会把 `yuanqi-v*` 缓存里的旧资源返回给页面。
**如果不处理，OTA 切到新目录后页面可能仍拿到旧缓存**（表现为"更了个寂寞"）。

→ 切换成功后**必须清掉 `caches.keys()` 里 `yuanqi-v*` 的缓存**（`UpdateBanner.forceRefresh` 里已有同款代码可抄）。
→ 这条**必须在 §6 的 spike 里先验证**，不能假设。

---

## 3. 三条路对比（结论：走 A）

| | **A. 自研：内置 WebView 插件 + Filesystem** ✅ | B. 靠 Service Worker 从网络拉 | C. 用 Capgo（`@capgo/capacitor-updater`） |
|---|---|---|---|
| 新增依赖 | 只加官方 `@capacitor/filesystem` | **零** | 第三方大件 + 配套服务/账号 |
| 原生代码 | 可选十余行 Java（仅用于自动回滚） | 不需要 | 不需要（但需按它要求改 MainActivity） |
| 依赖的机制 | Capacitor **官方稳定 API** | ⚠️ 壳内 SW 能否拦截 `https://localhost` **从未验证过** | 黑盒 |
| 坏包兜底 | sha256 校验 + 自动回滚 + 重装 APK | 缓存被清就回退，不可控 | 它有 `notifyAppReady` |
| 与本仓风格 | 自研、可单测、可自证 | 隐式、难验证 | 依赖外部 |

**B 的致命问题**：整套机制押在「Capacitor 的 WebView 里 Service Worker 真的在拦截请求」这一个
从未验证的假设上，且失败时表现为静默（拿旧资源）。**先做 §6 spike 可以证伪它，但不值得为省一个官方插件去赌。**

**C 的代价**：引入第三方运行时 + 需要维护 app 与 update server 的对应关系，与这个项目
「零后端、依赖尽量少、每一步能自证」的风格不符。

---

## 4. 分步实施（方案 A）

> 全程遵守仓库纪律：**先开 `feat/` 分支**，用户确认后才 `--no-ff` merge 回 `main`；
> 成块新功能 → **MINOR**（下一版 `1.3.0`）。

### 步骤 0 · spike：三件必须先验证的事（**做完全部实现之前**）

在真机（或模拟器）上，用最小改动验证：

1. **`registerPlugin("WebView")` 能不能调到** —— 确认 `getServerBasePath()` 返回打包资源路径。
2. **`Directory.Data` 下的目录能不能被 `hostFiles` 服务** —— 手写一个 `hello.html` 到
   `Directory.Data/ota/spike/`，`setServerBasePath` 指向它，看是否真的加载了那个文件。
3. **壳里 SW 的实际行为** —— 在壳里读 `navigator.serviceWorker.controller` 是否为非 null、
   `caches.keys()` 里有什么。这决定 §2.5 的处理是"必须清"还是"根本不存在"。

**spike 的产出是结论，不是代码** —— 结果写回本文档，再决定往下走。
⚠️ 如果 1 或 2 失败，方案 A 不成立，改走 C（并在本文档里写明为什么）。

#### ✅ 步骤 0 实测结果（2026-09-19，真机 vivo V2520A / Android 16 / arm64）

在分支 `feat/ota-spike` 上用一个**临时调试卡**（`app/components/dev/OtaSpikeCard.tsx`，验证完已删除）
跑通了全部五步，真机截图判读如下：

| # | 问题 | 实测结果 | 结论 |
|---|---|---|---|
| 1 | `registerPlugin("WebView")` 能否调用 | `getServerBasePath()` 返回 `{"path":"public"}` | ✅ **成立 —— 一行 Java 都不用写** |
| 2 | `Directory.Data` 目录能否被服务 | 写入 `ota-spike/index.html` 后，`setServerBasePath` 指向 `/data/user/0/com.orang1ver.yuanqiledger/files/ota-spike`，**页面真的变成了那个文件** | ✅ **方案 A 路线成立** |
| 3 | 壳里 SW 的实际行为 | `SW 注册数: 1`、`scope=https://localhost/`、`active=activated`、**`controller=https://localhost/sw.js`**、`caches=["yuanqi-v1.2.0-20260919.1553"]` | ⚠️ **SW 确实仍控制着 OTA 页面、旧缓存仍在**（危害见下） |

另实测到两条对实现有直接影响的细节：

- **`getServerBasePath()` 的默认值是字符串 `"public"`**，不是 `null` / 空串 ——
  判断「当前跑的是打包资源还是 OTA 版」时**别拿 `null` 当判据**。
- ✅ **不调 `persistServerBasePath` 时，`setServerBasePath` 只影响当前会话**：
  `am force-stop` 后重开**干净回到打包资源**。这既给了 spike 一条安全退路，
  也是「**先切过去试用、确认没问题再持久化**」这个实现策略的依据。

**第 3 条到底会不会打架** —— 读 `public/sw.js` 的 fetch 分支后，危害比预想的小得多：

- **导航请求（`req.mode === "navigate"`）走「网络优先」**（`sw.js:57-68`）→ OTA 后拿得到新 `index.html`。
- **静态资源走「缓存优先」**（`sw.js:70-82`），但 Next.js 产物里 chunk 文件名**带内容 hash** →
  新版本引用的是**全新 URL**，`caches.match` 天然 miss、回落网络 → **不会拿到旧 JS**。

所以真正受影响的只是**不带 hash 的同名资源**（`sw.js` 自身、图标、`manifest.json` 之类），
返回旧版基本无害。**结论：OTA 完成后仍应清一次 `yuanqi-v*` 缓存（成本极低、消除隐患），
但不必为它设计复杂机制。** ⚠️ 这一条要在真 OTA 时用**完整产物**再确认一次，
**别只凭这次的推理就当成结论**。

### 步骤 1 · 站点侧：发布「资源清单」

`scripts/deploy.mjs` 在生成 `version.json` 时**追加一个 `ota` 字段**（老字段一个都不动）：

```jsonc
{
  "version": "1.3.0",
  "apk": "apk/yuanqi-ledger-1.3.0.apk",
  "ota": {
    "files": [
      { "path": "index.html", "bytes": 12345, "sha256": "…" },
      { "path": "_next/static/…", "bytes": 23456, "sha256": "…" }
    ]
  }
}
```

- 清单里只放 **`out/` 里真正给壳用的文件**：**排除** `version.json`、`apk/**`、`sw.js`
  （SW 见 §2.5，先排除、由 spike 结论再定）。
- `sha256` 由 deploy 时算（Node `crypto`），**不要手写**。
- 体积估算：85 个文件 ≈ 7~8KB，可接受。
- ⚠️ 老 APK 只读 `version` 与 `apk`，**多出字段是安全的** —— 但不要动既有字段。

### 步骤 2 · `lib/ota.ts`（纯逻辑，可单测，不碰 UI / Capacitor）

放在 `lib/` 里，遵守「`lib/` 是脱离打包器的领域层、用相对导入、不 import UI/Next/localStorage」的约束：

- `parseManifest(raw)` —— 校验清单结构，坏数据返回 `null`（**照抄 `fetchRemoteVersion` 的风格：失败是常态**）
- `planDownload(manifest, presentSet)` —— 返回「要下哪些文件」（`presentSet` 是本地已有的
  路径→sha256 映射，相同就跳过 → 白送一个增量更新）
- `verifyFile(bytes, expectedSha256)` —— 比对
- `isComplete(manifest, verifiedSet)` —— 全部到位才算成功
- `otaDir(version)` —— 目录名拼接

⚠️ 红线复述：**不要在这里写任何营养数字相关的逻辑**；也不要引用 `data/` 下的任何东西。

### 步骤 3 · 下载与落盘

- 加依赖：`@capacitor/filesystem@^7`（与已装的 Capacitor 7 对齐）。
  registry 实测可达（`registry.npmjs.org` 200）；**若装不上，见 §7 的替代路**。
- 流程：拉 `version.json` → 比版本号 → 拉清单 → 逐文件 `fetch(REMOTE_SITE + path)`
  → `crypto.subtle.digest("SHA-256")` 校验（`https://localhost` 是 secure context，WebCrypto 可用）
  → `Filesystem.writeFile` 写到 `Directory.Data` 的 `ota/<version>.tmp/`
- 85 个请求 / 1.8MB，**只在发现新版时发生一次**。不要做并发炸弹，**串行或小并发（≤4）**。
- 失败：**整个 `.tmp` 目录作废**，不要留着半个包 —— 半个包比没有包更危险。

### 步骤 4 · 原子切换

1. 全部校验通过 → `Filesystem.rename(ota/<version>.tmp → ota/<version>)`
2. **清 `yuanqi-v*` 缓存**（§2.5）
3. `WebView.setServerBasePath({ path: <绝对路径> })` → `persistServerBasePath()`
4. 删掉更早的旧版本目录（只留当前 + 上一个，用于回滚）

⚠️ **必须原子**：`Bridge` 启动时用 `new File(path).exists()` 判断，半成品目录一旦被选中
就是白屏。所以**先下到 `.tmp`、校验通过再改名**，任何一步失败都不改名。

### 步骤 5 · 自动回滚保险（**需要十余行 Java，推荐做**）

纯 JS 的死结：**新版本要是白屏，JS 根本跑不起来，没人能回滚。**
但"重装 APK 就能救回来"这条退路是存在的（§2.3 会清空基址），**代价是用户得自己去找安装包**。

推荐加保险（改动很小，`MainActivity.java` 现在是空壳）：

> 在 `super.onCreate()` **之前**读一个 `pending` 标记：
> 若「上次切了版本但没等到确认」→ 直接清掉 `serverBasePath` / 指向上一版 → 回到能用的那一版。
> 启动成功后（web 侧跑起来的第一件事）把标记清掉。

- 标记与基址写进 `CapWebViewSettings` 那套 SharedPreferences 的**旁边**（自己起一个键，别复用 Capacitor 的）。
- ⚠️ 注意顺序：`BridgeActivity.onCreate` 里 `Bridge` 才创建，而 `loadUrl` 也发生在里面 ——
  **必须在 `super.onCreate()` 之前**把 `serverBasePath` 那一项改好，否则来不及。

**若不做这一步**，就要在 CHANGELOG 里如实写明「OTA 失败需要重装 APK 自救」，不要在文档里假装有回滚。

### 步骤 6 · UI

在 `SettingsDialog` 的更新区加一块状态（复用现有 `yq-btn` / `yq-hint` 样式）：

- 「已下载 v1.3.0，重启生效」+ 一个「立即重启」按钮
- 或失败时：「上次更新没成功，已回到 v1.2.0」
- ⚠️ 别在 `UpdateBanner` 里塞第二套逻辑 —— 它的语义是「网页版刷新 / 壳里下载 APK」，
  OTA 成功是**第三种状态**，要么明确改造它，要么让设置面板承担。**改之前想清楚，别让两个组件各说各话。**

### 步骤 7 · 测试

能单测的（进 `npm test` 的清单，现在 295 条）：
- `lib/ota.test.ts`：清单解析（坏 JSON / 缺字段 / 空清单）、版本比较复用 `lib/update.ts` 的 `isNewer`、
  增量计划（全相同 → 不下任何文件；一个不同 → 只下那个）、校验不符 → 整体作废

**冒烟测不了 OTA**（冒烟跑的是浏览器，没有 `window.Capacitor`）—— 见 §7。

---

## 5. 必须遵守的项目约束（摘要，完整见 `AGENTS.md`）

- `recipe.*` 键名与 JSON 结构**逐字保留**，只许加字段
- **公开产物零来源表述**；新增第三方依赖**先确认许可**（`@capacitor/filesystem` = MIT，与项目一致）
- `lib/` 用**相对导入**，不 import UI / Next / localStorage
- 新增检查**必须能自证会失败**（`YQ_SELFTEST=1`）
- 版本号三处同步：`package.json` / `CHANGELOG.md` / `lib/changelog.ts`
- **发布顺序不变**：先 `npm run android:apk`，再 `node scripts/deploy.mjs`
  —— 否则站点上没有新 APK 与清单
- 七道闸门全跑（`build` / `test` / `check:data` / `smoke` / `check:nutrition` /
  `check:reference` / `check:chunks` / `verify-subpath`）

---

## 6. 明确不做（边界）

- ❌ **远程推送**（关掉 App 也能收到）—— 需要 Firebase + 一个持有 token 并触发发送的服务端，
  与「纯静态 + 零后端 + 数据只在本机」直接冲突
- ❌ **静默安装 APK** —— 平台禁止（非商店分发必须用户点确认），root 才能绕
- ❌ **把壳改成 `server.url` 直接加载线上站点** —— 离线立刻废掉，等于把 App 降级成书签
- ❌ **引入 Capgo / Appflow** —— 见 §3
- ❌ **动 `version.json` 的既有字段** —— 老 APK 还在读

---

## 7. 验收门槛（真机）—— ✅ 已具备（2026-09-19）

~~这台机器没有安卓真机，也没有模拟器~~ —— **已解决：真机到位，OTA 可以做真实验收**。
设备 vivo V2520A / Android 16 / arm64，adb = `D:/Android/Sdk/platform-tools/adb.exe`；
1.2.0 已装上并逐项验证（数据持久化、覆盖安装不丢数据、应用内更新横幅正常），
**「APK 从未真机装过」这笔账已闭合**。

保留下面这段，是为了说明**为什么真机不可替代**：

- **闸门证明不了 OTA**。单测只覆盖 `lib/ota.ts` 的纯逻辑；`npm run smoke` 跑的是真实 Edge，
  里面 `window.Capacitor` 根本不存在，**OTA 那条分支永远走不到**。
- 也就是说：**没有真机，就只能交付「代码写好 + 逻辑单测通过」，OTA 本身仍是未验证状态** ——
  同 1.0.0 以来对 APK 一直的处理方式。**不要把它写成已验证。**

三条路，实现前先定：

| 选项 | 成本 | 说明 |
|---|---|---|
| **用户拿一台安卓手机**（推荐） | 最低 | 现在的 APK 只要 `adb install -r` 就能装；验证 OTA 也只是"装旧版 → 触发更新 → 重启看版本" |
| 本机建 AVD | 中 | 要下系统镜像（~1.5GB）并确认 WHPX/HAXM 可用；`scripts/android/setup-sdk.ps1` 是现成的入口 |
| 不做真机验证 | 零 | 那就**如实标注「OTA 未经真机验证」**，不要含糊 |

### 真机操作要点（本次实测踩过，别重复踩）

1. ⚠️ **vivo 会在 `adb install` 时弹系统确认框**，被拒时报
   `INSTALL_FAILED_ABORTED: User rejected permissions`。**同一个包换个时机重试即可**
   （实测第一次被拒、重试成功）。始终不行就把包 `adb push` 到 `/sdcard/Download/` 让用户手动点装。
2. ⚠️ **WebView 里的 DOM 不给 `uiautomator` 看**（dump 出来只有一个 `WebView` 节点、`text=""`），
   只能 `input tap x y` 坐标点击。`screencap` 出图是 1080×2376，
   **显示坐标 ×2.209 = 设备坐标**（别按 1024 的高度算，会偏）。
3. 抓启动日志要 `logcat -c` + `am force-stop` 后重启，否则只会看到
   「Activity not started, its current task has been brought to the front」。
4. `apksigner` / `aapt2` 记得 `export JAVA_HOME="D:/Android/jdk-21"`，且路径要写
   **Unix 形式**（`/d/Android/Sdk/build-tools/34.0.0`），否则在 Git Bash 里找不到。

**另：第一次带 OTA 的 APK 必须重装一次** —— 老 APK 里没有 OTA 代码，指望不上自更新。

---

## 8. 关键文件速查

| 事项 | 文件 |
|---|---|
| 现有版本检查逻辑（复用） | `lib/update.ts`、`lib/update.test.ts` |
| 现有更新横幅（要决定怎么扩展） | `app/components/shell/UpdateBanner.tsx` |
| 设置面板（OTA 状态入口） | `app/components/shell/SettingsDialog.tsx` |
| **内置 WebView 插件（OTA 的原生能力）** | `node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/plugin/WebView.java` |
| 基址恢复 / 新二进制判定 / `hostFiles` | 同目录 `Bridge.java`（§2 已给行号）、`WebViewLocalServer.java:650` |
| 发布脚本（要加 `ota` 清单） | `scripts/deploy.mjs` |
| 打 APK（发布顺序的第一步） | `scripts/android/build-apk.ps1`、`npm run android:apk` |
| 安卓工程配置 | `capacitor.config.ts`、`android/app/build.gradle`（`vCode` 在 20 行） |
| 新增（步骤 2） | `lib/ota.ts`、`lib/ota.test.ts` |
| 新增（步骤 1） | `scripts/` 下生成清单的那段（并入 `deploy.mjs`） |
