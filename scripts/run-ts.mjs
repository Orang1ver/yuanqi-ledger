/**
 * 通用 TS 脚本运行器：把 `lib/` 与 `scripts/` 编成 CommonJS，再交给纯 Node 跑。
 *
 * 为什么需要它：Node 原生不做"无扩展名相对导入"的解析（`import { x } from "./keys"`
 * 会直接 ERR_MODULE_NOT_FOUND），而整个 lib/ 都是那么写的。tsc 编成 CJS 之后
 * require 自带补后缀行为，用的还是项目已装的编译器，不多拉任何依赖。
 *
 * 三个用途共用这一份编译逻辑（之前是三份几乎相同的脚本，那种重复迟早会各自跑偏）：
 *   npm run check:data      数据延续自检
 *   npm run test:nutrition  营养核心单元测试（走 node --test）
 *   npm run probe           把一句中文口语算成营养数字
 *
 * 用法：
 *   node scripts/run-ts.mjs <入口.ts> [--test] [-- 传给被测脚本的参数]
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, ".tmp-check");

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
const own = sep === -1 ? argv : argv.slice(0, sep);
const passthrough = sep === -1 ? [] : argv.slice(sep + 1);

const useTestRunner = own.includes("--test");
const entryRel = own.find((a) => !a.startsWith("--"));

if (!entryRel) {
  console.error("用法：node scripts/run-ts.mjs <入口.ts> [--test] [-- 参数...]");
  process.exit(2);
}

const tscBin = join(root, "node_modules", "typescript", "bin", "tsc");
if (!existsSync(tscBin)) {
  console.error("找不到项目自带的 typescript，请先 npm install。");
  process.exit(1);
}

// 每次重建，避免上一次的残留产物造成"假通过"
rmSync(outDir, { recursive: true, force: true });

try {
  execFileSync(process.execPath, [tscBin, "-p", join(root, "tsconfig.continuity.json")], {
    cwd: root,
    stdio: "inherit",
  });
} catch {
  console.error("\n编译失败，未执行。");
  process.exit(1);
}

// data/ 下的 JSON：tsc 未必把它们搬到 outDir（行为随版本而变），自己拷一份最稳。
// 拷全部而不是点名某几个 —— 点名的话，将来新增数据文件会以"运行期缺模块"的形式报错，
// 那种错很难一眼看出是漏拷。
const dataDir = join(root, "data");
if (existsSync(dataDir)) {
  mkdirSync(join(outDir, "data"), { recursive: true });
  for (const f of readdirSync(dataDir)) {
    if (f.endsWith(".json")) copyFileSync(join(dataDir, f), join(outDir, "data", f));
  }
}

const entryAbs = resolve(root, entryRel);
const outEntry = join(outDir, relative(root, entryAbs).replace(/\.ts$/, ".js"));

if (!existsSync(outEntry)) {
  console.error(`编译产物缺失：${outEntry}`);
  console.error("（入口是否在 tsconfig.continuity.json 的 include 范围内？）");
  process.exit(1);
}

const args = useTestRunner ? ["--test", outEntry, ...passthrough] : [outEntry, ...passthrough];

try {
  execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });
} catch (e) {
  if (typeof e.status === "number") process.exit(e.status);
  console.error("\n执行失败：\n", e);
  process.exit(1);
}
