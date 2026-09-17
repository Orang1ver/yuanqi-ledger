/**
 * 一键发布。
 *
 * 做四件事：
 *   1) 校验版本一致性（package.json / CHANGELOG.md / lib/changelog.ts 三处必须同步）
 *   2) 以正确的 BASE_PATH 构建静态产物
 *   3) **给 out/sw.js 注入版本号与构建号** —— 源码里是占位符，注入后缓存名才会变，
 *      浏览器才会认为 SW 更新了、才会清掉旧缓存（详见 public/sw.js 的注释）
 *   4) 把 out/ 推到 gh-pages 分支，并给源码打 tag
 *
 * 为什么必须第 3 步：如果 SW 文件字节不变，浏览器永远不会更新它，
 * 用户（尤其是 iOS 主屏 App）会一直卡在旧版本上。这是本项目历史上最难查的一类问题。
 *
 * 用法：
 *   node scripts/deploy.mjs                 # 正常发布
 *   node scripts/deploy.mjs --dry           # 只构建 + 注入，不推不 tag
 *   BASE_PATH=/foo node scripts/deploy.mjs  # 覆盖子路径（默认 /yuanqi-ledger）
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
const DRY = process.argv.includes("--dry");
const BASE_PATH = process.env.BASE_PATH || "/yuanqi-ledger";
const REMOTE = process.env.DEPLOY_REMOTE || "mine";
const BRANCH = "gh-pages";

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const version = pkg.version;

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32", ...opts });
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

if (DRY) {
  console.log("\n✓ dry-run 完成，产物在 out/（未推送）");
  process.exit(0);
}

// ---------- 4. 推 gh-pages ----------

/*
 * out/ 每次构建都会被清空（连同里面的 .git），所以这里每次都要重新 init ——
 * 不能指望"上次已经建好仓库了"。gh-pages 分支只承载构建产物，与源码历史无关。
 */
console.log("\n▶ 发布到 gh-pages");
run("git", ["init", "-b", BRANCH], { cwd: OUT });
run("git", ["add", "-A"], { cwd: OUT });
run("git", ["-c", "user.name=deploy", "-c", "user.email=deploy@local", "commit", "-m", `build: v${version} (${buildId})`], {
  cwd: OUT,
});
run("git", ["push", "--force", REMOTE, `${BRANCH}:${BRANCH}`], { cwd: OUT });
run("git", ["tag", "-f", `v${version}`], { cwd: ROOT });
run("git", ["push", "--force", REMOTE, `v${version}`], { cwd: ROOT });

console.log(`
✓ 发布完成 v${version}
  GitHub Pages 构建 + CDN 传播可能要 1~3 分钟，别只看脚本输出就断定失败。
  确认线上版本：
  curl -s "https://orang1ver.github.io${BASE_PATH}/sw.js?cb=$(date +%s)" | grep -o 'const APP_VERSION = "[^"]*"'
`);
