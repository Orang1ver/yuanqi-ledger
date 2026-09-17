/**
 * 数据延续自检的执行入口。
 *
 * 干三件事：
 *   1) 用项目自带的 tsc 把 lib/ + scripts/check-data-continuity.ts 编成 CommonJS 到 .tmp-check/
 *   2) 补一份 seed JSON（tsc 对 JSON 的产出行为不必依赖，自己拷更稳）
 *   3) 用 node 跑产物，把退出码原样透出去
 *
 * 为什么不直接用 tsx / node --experimental-strip-types：
 * 两者都绕不开"无扩展名相对导入"的解析问题（打包器能解、Node 不能），
 * 而 tsc 编成 CJS 之后 require 自带补后缀行为，且用的是项目已装的编译器，不多拉依赖。
 *
 * 用法：npm run check:data
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, ".tmp-check");
const entry = join(outDir, "scripts", "check-data-continuity.js");

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
  console.error("\n编译失败，自检未执行。");
  process.exit(1);
}

// 种子数据：tsc 未必把 .json 搬到 outDir，自己拷一份最稳
const seedSrc = join(root, "data", "takeoutSeed.json");
if (existsSync(seedSrc)) {
  mkdirSync(join(outDir, "data"), { recursive: true });
  cpSync(seedSrc, join(outDir, "data", "takeoutSeed.json"));
}

if (!existsSync(entry)) {
  console.error(`编译产物缺失：${entry}`);
  process.exit(1);
}

try {
  await import(pathToFileURL(entry).href);
} catch (e) {
  console.error("\n自检执行失败：\n", e);
  process.exit(1);
}
