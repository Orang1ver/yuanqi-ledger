/**
 * 一键发布。
 *
 * 做五件事：
 *   1) 校验版本一致性（package.json / CHANGELOG.md / lib/changelog.ts 三处必须同步）
 *   2) 以正确的 BASE_PATH 构建静态产物（**两份**：站点一份、给安卓壳的 OTA 产物一份，见第 2 节）
 *   3) **给 out/sw.js 注入版本号与构建号** —— 源码里是占位符，注入后缓存名才会变，
 *      浏览器才会认为 SW 更新了、才会清掉旧缓存（详见 public/sw.js 的注释）
 *   4) **发一个 `version.json`**，并把已经打好的安卓安装包一起放到站点上 ——
 *      这是「应用内更新」的接口：网页版和安卓壳都来问它"现在最新是哪个版本"
 *   5) 把 out/ 推到 gh-pages 分支，并给源码打 tag
 *
 * 为什么必须第 3 步：如果 SW 文件字节不变，浏览器永远不会更新它，
 * 用户（尤其是 iOS 主屏 App）会一直卡在旧版本上。这是本项目历史上最难查的一类问题。
 *
 * 为什么有第 4 步：**安卓壳里的资源是打包进 APK 的**，SW 永远说不了"有新版本"。
 * 壳里唯一的更新线索就是比版本号，然后去下载新版本。
 * ⚠️ 顺序：**先 `npm run android:apk` 再发布**，否则 version.json 里没有安装包地址
 * （脚本会明确警告一句，不会静默漏掉）。
 *
 * ⚠️ 一次发布要跑**两次 `next build`**（站点一次、OTA 产物一次），比从前慢一倍。
 * 这是必须的：两者的 `BASE_PATH` 不同，见第 2 节。想省掉的话只能改部署结构
 * （比如把站点挪到根域名），别想着用改写产物字符串去凑。
 *
 * 用法：
 *   node scripts/deploy.mjs                 # 正常发布
 *   node scripts/deploy.mjs --dry           # 只构建 + 注入，不推不 tag
 *   BASE_PATH=/foo node scripts/deploy.mjs  # 覆盖子路径（默认 /yuanqi-ledger）
 *
 * 有些机器上 git 连不上 github.com（DNS 被挡、必须靠 hosts 重定向、或只能按 IP 直连），
 * 这时不用改脚本也不用改仓库配置，把环境差异用两个变量带进来即可：
 *   DEPLOY_REMOTE_URL   远端 URL（可含凭据），给定时不再去查 remote 配置
 *   DEPLOY_GIT_CONFIG   空格分隔的 -c key=value 列表，会追加到每条 git 命令前
 * 例：DEPLOY_GIT_CONFIG="-c http.curloptResolve=github.com:443:140.82.112.3"
 */

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
const DIST = join(ROOT, "dist");
const DRY = process.argv.includes("--dry");
const BASE_PATH = process.env.BASE_PATH || "/yuanqi-ledger";
const REMOTE = process.env.DEPLOY_REMOTE || "origin";
const BRANCH = "gh-pages";

/**
 * 线上站点的绝对地址 —— `lib/update.ts` 里有一份同样的常量（壳里必须知道它才能查更新）。
 * ⚠️ 改域名时两处一起改。
 */
const SITE = "https://orang1ver.github.io/yuanqi-ledger";

// 环境差异走这里进来，不写进仓库配置：见文件头的用法说明。
const GIT_EXTRA = (process.env.DEPLOY_GIT_CONFIG || "").trim().split(/\s+/).filter(Boolean);

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const version = pkg.version;

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32", ...opts });
}

/** 取命令输出（run 是 stdio:inherit，抓不到文本，需要单独一个）。 */
function capture(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", ...opts }).trim();
}

/** git 命令一律带上 GIT_EXTRA。 */
function git(args, opts = {}) {
  return run("git", [...GIT_EXTRA, ...args], opts);
}

// ---------- 1. 校验版本三处同步 ----------

const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
if (!new RegExp(`^##\\s*\\[?${version.replace(/\./g, "\\.")}\\]?`, "m").test(changelog)) {
  console.error(`✗ CHANGELOG.md 顶部没有 ${version} 这一节。先补上再发布。`);
  process.exit(1);
}

const changelogTs = readFileSync(join(ROOT, "lib", "changelog.ts"), "utf8");
if (!changelogTs.includes(`"${version}"`)) {
  console.error(`✗ lib/changelog.ts 里没有 ${version}。App 内的更新日志会漏掉这一版。`);
  process.exit(1);
}

// ---------- 2. 构建 ----------

/** OTA 产物在站点上的目录；写进 `version.json` 的 `ota.base`，壳按它拼下载地址 */
const OTA_DIR = "ota";

/**
 * 断言一份产物是**按根路径**出的 —— 这是"壳里白屏 / 裸样式"的唯一防线。
 *
 * 与 `scripts/android/build-apk.ps1` 里那段断言同一套判据（那边守的是装机包，
 * 这边守的是 OTA 产物，两边喂给 WebView 的东西必须同构）。
 *
 * ⚠️ 判据不能只看 `/_next/` 存不存在：带子路径的产物照样有 `/_next/`。
 * 关键是**有没有前缀**。入口 HTML 是最典型的，但 RSC 的 `.txt`、chunk 里的
 * 运行时配置都可能带前缀，所以逐个文本文件扫一遍。
 */
function assertRootBuild(dir, label) {
  const index = join(dir, "index.html");
  if (!existsSync(index)) {
    console.error(`✗ ${label}里没有 index.html`);
    process.exit(1);
  }
  const html = readFileSync(index, "utf8");
  if (!html.includes("/_next/")) {
    console.error(`✗ ${label}的 index.html 里没有 /_next/ 引用 —— 产物不对`);
    process.exit(1);
  }

  const prefix = BASE_PATH.replace(/\/$/, "");
  if (!prefix) return; // 站点本身就部署在根时，这条判据没有意义

  /*
   * ⚠️ 判据要**精确到"根相对引用"**，不能简单 `includes(prefix + "/")`：
   * 产物里合法地带着 `https://github.com/Orang1ver/yuanqi-ledger/issues/new`
   * （反馈链接），那里面也有 `/yuanqi-ledger/` —— 一刀切会把正常产物判成坏的。
   * （第一版就是这么写的，当场误报，见提交历史。）
   *
   * 真正危险的是这两种形态：
   *   - 根相对引用：`href="/yuanqi-ledger/_next/…"`、`"/yuanqi-ledger/diet"`
   *   - Next 运行时配置：`"basePath":"/yuanqi-ledger"`
   * 前者用**负向后顾**把 GitHub 那种"前缀前面还接着域名"的地址排除掉。
   */
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const DANGER = [
    new RegExp(`(?<![A-Za-z0-9._@-])${esc}/`),
    new RegExp(`"(?:basePath|assetPrefix)":"${esc}"`),
  ];

  const TEXT = /\.(html|txt|js|css|json|svg|webmanifest)$/;
  const hits = [];
  (function scan(d, base) {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      if (ent.name.startsWith(".")) continue;
      const rel = base ? `${base}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        scan(join(d, ent.name), rel);
        continue;
      }
      if (!TEXT.test(rel)) continue;
      const text = readFileSync(join(d, ent.name), "utf8");
      if (DANGER.some((re) => re.test(text))) hits.push(rel);
    }
  })(dir, "");

  if (hits.length) {
    console.error(
      `✗ ${label}里还带着 ${prefix}/ 子路径前缀 —— 装进安卓壳里会裸样式（页面能开、CSS 与 JS 全 404）：`,
    );
    for (const h of hits.slice(0, 10)) console.error(`    ${h}`);
    if (hits.length > 10) console.error(`    …还有 ${hits.length - 10} 个`);
    process.exit(1);
  }
  console.log(`  ✓ ${label}按根路径生成`);
}

/*
 * ⚠️ 必须构建**两份**产物，因为两者基址不同：
 *
 *   - **站点**：`BASE_PATH=/yuanqi-ledger` —— GitHub Pages 的项目站点挂在子路径下
 *   - **壳内**：`BASE_PATH=""` —— Capacitor 的 WebView 从 `https://localhost` 起，站点根就是 `/`
 *
 * 拿站点那份去喂壳，HTML 里的 `/yuanqi-ledger/_next/...` 在壳里全部 404：
 * 页面内容渲染得出来、样式和 JS 一个都不加载，用户看到的是一张裸 HTML。
 * 这个坑真踩过 —— 本地构建、七道闸门、连"下载到的字节 sha256 全对"都放行，
 * 只有真机端到端才暴露。**「清单对」不等于「产物能在壳里跑」。**
 */
console.log(`\n▶ 构建壳内产物（BASE_PATH=空，给安卓壳的无感更新用）`);
run("npx", ["next", "build"], {
  env: { ...process.env, BASE_PATH: "", MSYS_NO_PATHCONV: "1" },
});
if (!existsSync(OUT)) {
  console.error("✗ 壳内构建没有产出 out/ 目录");
  process.exit(1);
}
assertRootBuild(OUT, "壳内产物");

// 挪到系统临时目录暂存：紧接着的那次构建会把 out/ 整个换掉
const STAGE = join(tmpdir(), `yuanqi-ota-payload-${Date.now()}`);
cpSync(OUT, STAGE, { recursive: true });

console.log(`\n▶ 构建站点产物（BASE_PATH=${BASE_PATH}）`);
run("npx", ["next", "build"], {
  env: { ...process.env, BASE_PATH, MSYS_NO_PATHCONV: "1" },
});

if (!existsSync(OUT)) {
  console.error("✗ 构建没有产出 out/ 目录");
  process.exit(1);
}

// ---------- 3. 注入 SW 版本 ----------

const buildId = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", ".");
const swPath = join(OUT, "sw.js");
if (!existsSync(swPath)) {
  console.error("✗ out/sw.js 不存在 —— public/sw.js 是不是被删了？");
  process.exit(1);
}
const sw = readFileSync(swPath, "utf8");
if (!sw.includes("__VERSION__") || !sw.includes("__BUILD__")) {
  console.warn("⚠ out/sw.js 里找不到占位符，可能已经被注入过。跳过注入。");
} else {
  writeFileSync(swPath, sw.replace(/__VERSION__/g, version).replace(/__BUILD__/g, buildId));
}
console.log(`▶ SW 缓存名：yuanqi-v${version}-${buildId}`);

// 子路径部署必须有 .nojekyll，否则 GitHub Pages 会忽略 _next/ 目录（白屏）
if (!existsSync(join(OUT, ".nojekyll"))) {
  console.error("✗ out/.nojekyll 缺失 —— GitHub Pages 会忽略 _next/ 导致白屏");
  process.exit(1);
}

// ---------- 3b. 应用内更新：version.json + 安装包 ----------

/*
 * 网页版与安卓壳都来问这个文件「最新是哪个版本」。
 * 壳里尤其需要它：APK 里的资源是打包进去的，SW 永远说不了"有新版本"。
 *
 * 安装包从 dist/ 拿（`npm run android:apk` 的产物），放到站点的 /apk/ 下。
 * ⚠️ gh-pages 每次是**整体强推**，所以旧版本的安装包不会堆积 —— 站点上永远只有当前这一版。
 */
const apkName = `yuanqi-ledger-${version}.apk`;
const apkSrc = join(DIST, apkName);
let apkField = null;
if (existsSync(apkSrc)) {
  const apkDir = join(OUT, "apk");
  mkdirSync(apkDir, { recursive: true });
  copyFileSync(apkSrc, join(apkDir, apkName));
  apkField = `apk/${apkName}`;
  console.log(`▶ 安装包已放进站点：apk/${apkName}（${(readFileSync(apkSrc).length / 1048576).toFixed(1)}MB）`);
} else {
  console.warn(
    `⚠ dist/${apkName} 不存在 —— 这次不会发布安装包，安卓壳收不到更新提示。\n` +
      `  想发的话：先 npm run android:apk，再重新跑一次发布。`,
  );
}

/*
 * OTA 产物：安卓壳拿着清单把**壳内那份产物**（第 2 节里 `BASE_PATH=空` 构建的那份）
 * 下载到应用私有目录，再把 WebView 基址切过去 —— 于是不换安装包也能用上新版本（实现见 docs/HANDOFF-OTA-UPDATE.md）。
 *
 * ⚠️ 放进来的**不是站点产物**，是另一次构建的结果。两者基址不同，拿站点那份去喂壳会裸样式
 * （页面能开、CSS 与 JS 全 404）—— 原因见第 2 节那段长注释。
 *
 * ⚠️ 只登记**壳真正要加载的界面资源**，三类东西必须排除：
 *   - `version.json` —— 它是"问版本"用的接口，不属于界面资源
 *   - 点开头的文件（`.nojekyll` 等）—— 那是给 GitHub Pages 看的
 *   - `sw.js` —— 壳里的 SW 会和 OTA 打架（见方案文档 §2.5），先不纳入
 *   （`apk/` 不在这份产物里：安装包是后面单独拷进站点的，壳也不会去 OTA 它）
 *
 * ⚠️ sha256 一律**现算**，不要手写 —— 手写的校验值和文件对不上时，
 * 表现是"下载每次都失败"，而且很难看出是清单的错还是文件的错。
 *
 * ⚠️ 这是**新增字段**：老 APK 只读 `version` 与 `apk`，加字段是安全的；
 * 但既有字段一个都不能动。
 */
const payloadRoot = join(OUT, OTA_DIR);
const otaFiles = [];
(function copyPayload(srcDir, rel) {
  for (const ent of readdirSync(srcDir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue;
    const relPath = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      copyPayload(join(srcDir, ent.name), relPath);
      continue;
    }
    if (relPath === "version.json" || relPath === "sw.js") continue;
    const bytes = readFileSync(join(srcDir, ent.name));
    const dest = join(payloadRoot, relPath);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(srcDir, ent.name), dest);
    otaFiles.push({
      path: relPath,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
})(STAGE, "");

// 暂存目录用完就删。删不掉也不影响发布（它在系统临时目录里），所以不因它中断
try {
  rmSync(STAGE, { recursive: true, force: true });
} catch {
  console.warn(`⚠ 临时目录没能清掉（不影响发布）：${STAGE}`);
}

if (otaFiles.length === 0) {
  console.error("✗ OTA 清单是空的 —— 壳内产物里没有可登记的资源，壳会拿到一份空清单");
  process.exit(1);
}
otaFiles.sort((a, b) => (a.path < b.path ? -1 : 1));
const otaBytes = otaFiles.reduce((n, f) => n + f.bytes, 0);
console.log(
  `▶ OTA 产物已放进站点 /${OTA_DIR}/：${otaFiles.length} 个文件 / ${(otaBytes / 1048576).toFixed(2)}MB`,
);

const versionInfo = {
  version,
  build: buildId,
  site: SITE,
  apk: apkField,
  ota: { base: OTA_DIR, files: otaFiles },
  at: new Date().toISOString(),
};
writeFileSync(join(OUT, "version.json"), JSON.stringify(versionInfo, null, 2) + "\n");
console.log(
  `▶ version.json：version=${version} apk=${apkField} ota=${OTA_DIR}/ × ${otaFiles.length} 个文件`,
);

if (DRY) {
  console.log("\n✓ dry-run 完成，产物在 out/（未推送）");
  process.exit(0);
}

// ---------- 4. 推 gh-pages ----------

/*
 * out/ 每次构建都会被清空（连同里面的 .git），所以这里每次都要重新 init ——
 * 不能指望"上次已经建好仓库了"。gh-pages 分支只承载构建产物，与源码历史无关。
 *
 * 也因为是从零 init，out/ 里没有任何 remote，不能直接 `git push origin`：
 * 远端 URL 从源码仓库的 remote 配置里取，或用 DEPLOY_REMOTE_URL 直接给。
 */
console.log("\n▶ 发布到 gh-pages");
const remoteUrl = process.env.DEPLOY_REMOTE_URL || capture("git", ["remote", "get-url", REMOTE]);
if (!remoteUrl) {
  console.error(`✗ 取不到远端 URL（remote "${REMOTE}" 没配）。用 DEPLOY_REMOTE_URL 直接给一个。`);
  process.exit(1);
}

/*
 * 提交信息写进临时文件再 `-F` 传入，不走 `-m` 参数：
 * shell:true 下 Windows 会把 `build: v1.0.0 (20260918.0054)` 里的括号当命令分隔符，
 * 结果是 `error: pathspec 'v1.0.0' did not match any file(s)`，而且报得很晚才发现。
 */
const msgFile = join(tmpdir(), `yuanqi-deploy-${buildId}.txt`);
writeFileSync(msgFile, `build: v${version} (${buildId})\n`);

git(["init", "-b", BRANCH], { cwd: OUT });
git(["add", "-A"], { cwd: OUT });
git(["-c", "user.name=deploy", "-c", "user.email=deploy@local", "commit", "-F", msgFile], { cwd: OUT });
git(["push", "--force", remoteUrl, `${BRANCH}:${BRANCH}`], { cwd: OUT });
git(["tag", "-f", `v${version}`], { cwd: ROOT });
git(["push", "--force", remoteUrl, `v${version}`], { cwd: ROOT });

console.log(`
✓ 发布完成 v${version}
  GitHub Pages 构建 + CDN 传播可能要 1~3 分钟，别只看脚本输出就断定失败。
  确认线上版本：
  curl -s "https://orang1ver.github.io${BASE_PATH}/sw.js?cb=$(date +%s)" | grep -o 'const APP_VERSION = "[^"]*"'
`);
