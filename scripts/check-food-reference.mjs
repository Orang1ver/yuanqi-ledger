#!/usr/bin/env node
/**
 * 数值引用台账的闸门。
 *
 * 它回答一个 check:nutrition 回答不了的问题：**这条数值是哪来的、能不能复核。**
 * `check:nutrition` 只能证明算术自洽（蛋白×4 + 脂肪×9 + 碳水×4 ≈ 热量），
 * 它抓不到「自洽但错」——比如整条数据抄错一位、或者根本不是这个食物。
 * 要挡那一类，只能让每条数值都指到一个**能点开的出处**。
 *
 * ⚠️ **台账只记引用标识，不复制表格数值。** 两个理由：
 *   1) 版权：把《中国食物成分表》的表格数值整体复制进一个 MIT 仓库，是另一回事；
 *   2) 仓库里 `check-nutrition.mjs` 开头就写了「参照集不进仓库」的既有约定。
 *   要核对就拿着 `page` 回官网按编号查 —— 这才是"可复核"。
 *   **所以本脚本证明不了数值对不对**，它只保证"每条都有据可查、出处没写错"。
 *
 * 用法：
 *   node scripts/check-food-reference.mjs
 *   YQ_SELFTEST=1 node scripts/check-food-reference.mjs   # 自证：删一条登记，必须被拦下
 *
 * 退出码：0 = 通过（自证模式下 = 确实拦住了）；1 = 有问题；2 = 自证失败（闸门形同虚设）
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SELFTEST = process.env.YQ_SELFTEST === "1";

/**
 * 食物条目的 `source` 里出现这个词，就认作「用了外部权威来源」，必须有台账。
 * 用标记词而不是硬编码 id 列表：将来换库、加库，只要 source 写法一致就自动被管起来。
 */
const REF_MARK = "中国食物成分表";

function loadJson(rel) {
  try {
    return JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
  } catch (err) {
    console.error(`✗ 读不了 ${rel}：${err.message}`);
    process.exit(1);
  }
}

const LIBRARY = loadJson("data/foods.zh.json");
const SOURCES = loadJson("data/foodSources.json");

const problems = [];
const fail = (where, msg) => problems.push({ where, msg });

// ---------- 自证模式：先故意删掉一条登记 ----------

let sabotaged = null;
if (SELFTEST) {
  const victim = (SOURCES.entries ?? []).find((e) => e.foodId === "juancai");
  if (!victim) {
    console.error("✗ 自证失败：台账里找不到用来做实验的条目 juancai");
    process.exit(2);
  }
  SOURCES.entries = SOURCES.entries.filter((e) => e !== victim);
  sabotaged = `删掉「${victim.foodId}」这条台账登记（它的 source 仍写着 ${REF_MARK}）`;
}

// ---------- ① 台账本身的结构 ----------

if (!SOURCES.meta?.std) fail("foodSources.json", "meta 缺 std —— 台账必须写清引用的是哪个库");
if (!SOURCES.meta?.org) fail("foodSources.json", "meta 缺 org —— 出处要落到具体机构");
if (!Array.isArray(SOURCES.entries)) {
  fail("foodSources.json", "entries 不是数组");
  report();
}

const byId = new Map((LIBRARY.items ?? []).map((f) => [f.id, f]));
const registered = new Set();

for (const [i, e] of (SOURCES.entries ?? []).entries()) {
  const at = `entries[${i}]${e?.foodId ? ` (${e.foodId})` : ""}`;
  if (!e || typeof e !== "object") {
    fail(at, "不是对象");
    continue;
  }
  if (!e.foodId) {
    fail(at, "缺 foodId");
    continue;
  }
  if (!byId.has(e.foodId)) fail(at, "库里没有这个 food id —— 台账指向了一条不存在的食物");
  if (!Number.isInteger(e.page) || e.page <= 0) fail(at, `page 必须是正整数，实际 ${JSON.stringify(e.page)}`);
  if (!e.retrieved) fail(at, "缺 retrieved —— 台账要记清是什么时候取的");
  if (registered.has(e.foodId)) fail(at, "foodId 重复登记");
  registered.add(e.foodId);
}

// ---------- ② 写了外部来源的条目，必须有台账 ----------

const needRef = (LIBRARY.items ?? []).filter((f) => String(f.source ?? "").includes(REF_MARK));
for (const f of needRef) {
  if (!registered.has(f.id)) {
    fail(
      `${f.id} (${f.name})`,
      `source 写着「${REF_MARK}」，但 foodSources.json 里没有对应登记 —— 这条数值没有可复核的来路`,
    );
  }
}

// ---------- ③ 台账与 source 要同进同出（不许有单边） ----------

for (const id of registered) {
  const f = byId.get(id);
  if (f && !String(f.source ?? "").includes(REF_MARK)) {
    fail(
      `entries (${id})`,
      `台账里登记了出处，但这条的 source 里没写「${REF_MARK}」—— 两边对不上，挑一个改`,
    );
  }
}

// ---------- 输出 ----------

function report() {
  console.log("=".repeat(72));
  console.log(SELFTEST ? "数值引用台账闸门 · 自证模式" : "数值引用台账闸门");
  console.log("=".repeat(72));
  if (sabotaged) console.log(`已故意破坏：${sabotaged}\n`);

  const total = (LIBRARY.items ?? []).length;
  const marked = (LIBRARY.items ?? []).filter((f) => String(f.source ?? "").includes(REF_MARK)).length;
  console.log(`食物 ${total} 条 · 其中标了「${REF_MARK}」的 ${marked} 条 · 台账登记 ${(SOURCES.entries ?? []).length} 条`);
  if (SOURCES.meta?.std) console.log(`引用：${SOURCES.meta.org}《${SOURCES.meta.std}》 ${SOURCES.meta.site ?? ""}`);

  if (!problems.length) {
    console.log("\n✓ 没发现问题。");
    console.log("  注意：本闸门只保证「每条都有据可查、出处没写错」，**证明不了数值对不对** ——");
    console.log("  台账里存的是引用标识而不是数值，要核对请拿 page 回官网按编号查。");
    console.log("=".repeat(72));
    return 0;
  }

  console.log(`\n发现 ${problems.length} 个问题：\n`);
  for (const p of problems.slice(0, 40)) console.log(`  ✗ ${p.where}\n    ${p.msg}`);
  if (problems.length > 40) console.log(`\n  …另有 ${problems.length - 40} 个未展开`);
  console.log("=".repeat(72));
  return 1;
}

const failed = report();

if (SELFTEST) {
  const caught = problems.some((p) => p.msg.includes("没有可复核的来路"));
  if (!caught) {
    console.error("\n✗ 自证失败：删掉一条台账登记，闸门却没拦下 —— 这个闸门形同虚设。");
    process.exit(2);
  }
  console.log(`\n✓ 自证通过：缺台账的条目确实被拦下了（共 ${problems.length} 个问题）。`);
  process.exit(0);
}

process.exit(failed);
