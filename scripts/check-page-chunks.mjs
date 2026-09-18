#!/usr/bin/env node
/**
 * 页面分包检查：食物库只许进**需要它**的页面。
 *
 * 为什么需要它：`lib/nutrition/library.ts` 会带上整份食物 JSON（223 条，约 50KB / gzip 9KB）。
 * 需要它的是**饮食页、菜单库、首页推荐**；
 * **健康小屋与周报不需要** —— 周报的质量分只依赖记录里的营养快照，不查库。
 *
 * 这类错误的特点：**写代码时完全看不出来**（一行 `import` 而已），
 * 要到构建产物里翻 chunk 才会发现，而那时页面已经白涨了十几 KB。
 * 所以它得是一条能重复跑的检查，而不是一次性的核对。
 *
 * 判据：拿食物库独有的 id `noodles-dry` 当探针词 ——
 * 用 id 而不是中文名，是因为它不会受编码 / minify 影响，也不会在别处出现。
 *
 * 用法：
 *   BASE_PATH=/yuanqi-ledger npm run build   # 必须先构建，这条检查看的是产物
 *   node scripts/check-page-chunks.mjs
 *   YQ_SELFTEST=1 node scripts/check-page-chunks.mjs   # 自证：见文件末尾的边界说明
 *
 * 退出码：0 = 通过；1 = 有问题；2 = 自证失败（闸门形同虚设）
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const OUT = "out";
const SELFTEST = process.env.YQ_SELFTEST === "1";
const norm = (s) => s.replace(/\\/g, "/");

/** 食物库独有的 id（见 data/foods.zh.json） */
const PROBE = "noodles-dry";

/** 这些页面**必须**带上食物库 —— 写反了就会变成"一个永远绿的检查" */
const MUST_HAVE = ["index.html", "diet/index.html", "takeout/index.html"];
/** 这些页面**不许**带上食物库 */
const MUST_NOT_HAVE = ["health/index.html", "weekly/index.html"];

if (!existsSync(OUT)) {
  console.error(`✗ 找不到 ${OUT}/ —— 先构建再跑这条检查。`);
  console.error("  BASE_PATH=/yuanqi-ledger npm run build");
  console.error("  这条检查看的是**构建产物**：没构建就算「通过」等于没有闸门。");
  process.exit(1);
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (st.size > 0) acc.push(p);
  }
  return acc;
}

const files = walk(OUT);

// ---------- 哪些 chunk 含食物库 ----------

const libChunks = new Set();
let libBytes = 0;
for (const f of files) {
  if (!f.endsWith(".js")) continue;
  const raw = readFileSync(f, "utf8");
  if (!raw.includes(PROBE)) continue;
  libChunks.add(norm(relative(OUT, f)).split("/").pop());
  libBytes += Buffer.byteLength(raw);
}

if (libChunks.size === 0) {
  /*
   * 探针失灵 = 这条检查会永远通过。宁可在这里失败，也不能静默放过 ——
   * 那正是"永远绿的闸门"，比没有闸门更糟（人会以为它证明了什么）。
   */
  console.error(`✗ 没有任何 chunk 含探针词「${PROBE}」。`);
  console.error("  要么食物库根本没被打包（那首页/饮食页就查不到食物了），");
  console.error("  要么 id 被改过导致探针失效。两种情况都得先查清楚。");
  process.exit(1);
}

// ---------- 各页面引用了哪些 chunk ----------

const pages = [];
for (const f of files) {
  if (!f.endsWith(".html")) continue;
  const html = readFileSync(f, "utf8");
  const refs = [
    ...new Set([...html.matchAll(/\/_next\/static\/[^"']*?([^/"']+\.js)/g)].map((m) => m[1])),
  ];
  pages.push({
    page: norm(relative(OUT, f)),
    refCount: refs.length,
    has: refs.filter((n) => libChunks.has(n)),
  });
}

// ---------- 自证模式 ----------

let sabotaged = null;
if (SELFTEST) {
  const victim = pages.find((p) => p.page === "weekly/index.html");
  if (!victim) {
    console.error("✗ 自证失败：产物里找不到 weekly 页面，破坏点没落到位");
    process.exit(2);
  }
  victim.has = [...libChunks];
  sabotaged = "把 weekly 页面记成引用了食物库的 chunk";
}

// ---------- 判定 ----------

const problems = [];
for (const p of pages) {
  if (MUST_HAVE.includes(p.page) && p.has.length === 0) {
    problems.push(
      `「${p.page}」需要食物库，构建产物里却没带上 —— 要么这个页面查不到食物，要么探针词失效了`,
    );
  }
  if (MUST_NOT_HAVE.includes(p.page) && p.has.length > 0) {
    problems.push(
      `「${p.page}」不该带食物库，却引用了 ${p.has.join("、")}` +
        `（约 ${(libBytes / 1024).toFixed(0)}KB 白涨 —— 查一下是不是有人顺手 import 了 library）`,
    );
  }
}

// ---------- 输出 ----------

console.log("=".repeat(72));
console.log(SELFTEST ? "页面分包检查 · 自证模式" : "页面分包检查");
console.log("=".repeat(72));
if (sabotaged) console.log(`已故意破坏：${sabotaged}\n`);
console.log(`食物库 chunk ${libChunks.size} 个 · 原始共 ${(libBytes / 1024).toFixed(1)}KB · 探针「${PROBE}」\n`);

for (const p of pages.sort((a, b) => a.page.localeCompare(b.page))) {
  const want = MUST_HAVE.includes(p.page) ? "需要" : MUST_NOT_HAVE.includes(p.page) ? "不要" : "无关";
  const got = p.has.length ? "有" : "没有";
  const bad = problems.some((x) => x.includes(`「${p.page}」`));
  console.log(
    `  ${bad ? "✗" : "✓"} ${p.page.padEnd(20)} ${want.padEnd(4)}食物库 / 实际${got.padEnd(3)}` +
      `（引用 ${String(p.refCount).padStart(2)} 个 js）`,
  );
}

if (!problems.length) {
  console.log("\n✓ 分包正确：食物库只出现在需要它的页面上。");
  console.log("=".repeat(72));
} else {
  console.log(`\n发现 ${problems.length} 个问题：\n`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log("=".repeat(72));
}

/*
 * 自证的边界（说清楚，免得被当成"证明了一切"）：
 *
 * 这里的破坏是在**内存里**伪造「weekly 引用了食物库」，验的是**判定逻辑**会不会报错。
 * 真实场景（weekly 里真的多了一行 `import ... library`）需要重新构建才能造，
 * 脚本内做不到。那一步在本闸门第一次落地时手动做过：
 *   给 app/weekly/page.tsx 加 import → build → 跑本检查 → 确实变红；
 *   撤销后重新构建 → 恢复绿。记录见 CHANGELOG 的 0.7.4 一节。
 */
if (SELFTEST) {
  const caught = problems.some((p) => p.includes("weekly/index.html"));
  if (!caught) {
    console.error("\n✗ 自证失败：伪造了「weekly 引用了食物库」，检查却没拦下 —— 判定逻辑坏了。");
    process.exit(2);
  }
  console.log("\n✓ 自证通过：伪造的违规被拦下了。");
  console.log("  注意这只验了判定逻辑，真实构建场景的自证见本文件末尾的说明。");
  console.log("=".repeat(72));
  process.exit(0);
}

process.exit(problems.length ? 1 : 0);
