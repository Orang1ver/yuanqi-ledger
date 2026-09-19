/**
 * 一键发布。
 *
 * 做五件事：
 *   1) 校验版本一致性（package.json / CHANGELOG.md / lib/changelog.ts 三处必须同步）
 *   2) 以正确的 BASE_PATH 构建静态产物
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
 * 壳里唯一的更新线索就是比版本号，然后去下载新的安装包。
 * ⚠️ 顺序：**先 `npm run android:apk` 再发布**，否则 version.json 里没有安装包地址
 * （脚本会明确警告一句，不会静默漏掉）。
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
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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

console.log(`\n▶ 构建 v${version}（BASE_PATH=${BASE_PATH}）`);
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

const versionInfo = { version, build: buildId, site: SITE, apk: apkField, at: new Date().toISOString() };
writeFileSync(join(OUT, "version.json"), JSON.stringify(versionInfo, null, 2) + "\n");
console.log(`▶ version.json：${JSON.stringify(versionInfo)}`);

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
