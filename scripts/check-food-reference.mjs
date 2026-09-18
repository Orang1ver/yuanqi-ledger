#!/usr/bin/env node
/**
 * 数值引用台账的闸门。
 *
 * 它回答一个 check:nutrition 回答不了的问题：**这条数值是哪来的、能不能复核。**
 * `check:nutrition` 只能证明算术自洽（蛋白×4 + 脂肪×9 + 碳水×4 ≈ 热量），
 * 它抓不到「自洽但错」——比如整条数据抄错一位、或者根本不是这个食物。
 * 要挡那一类，只能让每条数值都指到一个**能点开的出处**。
 *
 * 食物条目在这个库里有两类来路，闸门分别管：
 *
 *  A) **抄来的**（source 标了「中国食物成分表」）→ 必须有台账登记。
 *     ⚠️ **台账只记引用标识，不复制表格数值。** 两个理由：
 *       1) 版权：把《中国食物成分表》的表格数值整体复制进一个 MIT 仓库，是另一回事；
 *       2) 仓库里 `check-nutrition.mjs` 开头就写了「参照集不进仓库」的既有约定。
 *       要核对就拿着 `page` 回官网按编号查 —— 这才是"可复核"。
 *
 *  B) **算出来的**（source 标了「按配方估算」）→ 必须有配方，而且要**重算得回去**。
 *     这类数值本来最容易变成"没人说得清怎么来的"：写个差不多的数、标一句"估算"就完了。
 *     所以配方落在 `data/foodRecipes.json` 里，本脚本拿它**重新加一遍**，
 *     与库里的值逐项比对 —— 任何一处改动（原料、克数、成品重量）都会当场对不上。
 *
 * ⚠️ 本脚本**证明不了数值对不对**：A 类它只保证"有据可查、出处没写错"，
 *    B 类它只保证"算得对"。配方本身是不是这家店的做法、原料自己准不准，它管不了。
 *
 * 用法：
 *   node scripts/check-food-reference.mjs
 *   YQ_SELFTEST=1 node scripts/check-food-reference.mjs   # 自证：删一条登记 + 改一处配方，都必须被拦下
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

/** source 里出现这个词，就认作「按配方算出来的」，必须有配方且能重算 */
const RECIPE_MARK = "按配方估算";

/**
 * 重算结果与库值的容差。
 * 库里存的是**四舍五入后**的值（热量取整、三大营养素一位小数），
 * 所以容差要容得下那次舍入，但又必须紧到"改一个克数就会被发现"。
 */
const TOL = { kcal: 1, macro: 0.15, sodium: 1 };

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
const RECIPES = loadJson("data/foodRecipes.json");

const problems = [];
const fail = (where, msg) => problems.push({ where, msg });

const byId = new Map((LIBRARY.items ?? []).map((f) => [f.id, f]));
const hasRef = (f) => String(f?.source ?? "").includes(REF_MARK);
const hasRecipe = (f) => String(f?.source ?? "").includes(RECIPE_MARK);

// ---------- 自证模式：两处破坏，各喂一条检查 ----------

let sabotaged = null;
if (SELFTEST) {
  const victim = (SOURCES.entries ?? []).find((e) => e.foodId === "juancai");
  if (!victim) {
    console.error("✗ 自证失败：台账里找不到用来做实验的条目 juancai");
    process.exit(2);
  }
  SOURCES.entries = SOURCES.entries.filter((e) => e !== victim);

  /*
   * 第二处破坏喂给「配方要能重算」那条。
   * 刻意**只改克数、不动库里的值** —— 那样重算结果必然与库里对不上。
   * （反过来"改库里的值"也行，但改数据文件容易顺手改坏别的，改配方更干净。）
   */
  const dish = (RECIPES.recipes ?? []).find((r) => r.foodId === "malatang");
  const oil = dish?.parts?.find((p) => p.foodId === "zhiwuyou");
  if (!oil) {
    console.error("✗ 自证失败：找不到麻辣烫配方里的植物油 —— 破坏点没落到位");
    process.exit(2);
  }
  oil.grams = oil.grams + 20;

  sabotaged =
    `删掉「${victim.foodId}」这条台账登记（它的 source 仍写着 ${REF_MARK}）；` +
    "再把麻辣烫配方里的植物油从 10g 改成 30g（库里的值没动）";
}

// ---------- ① 台账本身的结构 ----------

if (!SOURCES.meta?.std) fail("foodSources.json", "meta 缺 std —— 台账必须写清引用的是哪个库");
if (!SOURCES.meta?.org) fail("foodSources.json", "meta 缺 org —— 出处要落到具体机构");
if (!Array.isArray(SOURCES.entries)) {
  fail("foodSources.json", "entries 不是数组");
  report();
}

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

// ---------- ② 抄来的条目，必须有台账 ----------

/*
 * ⚠️ 按配方估算的条目 source 里**也会**出现「中国食物成分表」（配方是参照它折算的），
 * 但它没有单一页面编号可登记 —— 它是若干原料的加权和。
 * 所以这里把它们排除掉，交给下面 ④ 用「能重算」来管。
 * 两类条目**各有一套可复核的路径**，不能混着要求同一个东西。
 */
const needRef = (LIBRARY.items ?? []).filter((f) => hasRef(f) && !hasRecipe(f));
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
  if (f && !hasRef(f)) {
    fail(
      `entries (${id})`,
      `台账里登记了出处，但这条的 source 里没写「${REF_MARK}」—— 两边对不上，挑一个改`,
    );
  }
}

// ---------- ④ 算出来的条目，必须有配方、而且重算得回去 ----------

const recipeByFoodId = new Map();
for (const [i, r] of (RECIPES.recipes ?? []).entries()) {
  const at = `foodRecipes[${i}]${r?.foodId ? ` (${r.foodId})` : ""}`;
  if (!r || typeof r !== "object") {
    fail(at, "不是对象");
    continue;
  }
  if (!r.foodId) {
    fail(at, "缺 foodId");
    continue;
  }
  const dish = byId.get(r.foodId);
  if (!dish) fail(at, "库里没有这个 food id");
  else if (!hasRecipe(dish)) fail(at, `「${dish.name}」的 source 里没写「${RECIPE_MARK}」—— 两边对不上`);
  if (recipeByFoodId.has(r.foodId)) fail(at, "foodId 重复配方");
  else recipeByFoodId.set(r.foodId, r);

  if (!(typeof r.yieldG === "number" && r.yieldG > 0)) {
    fail(at, `yieldG 必须是正数，实际 ${JSON.stringify(r.yieldG)}`);
    continue;
  }
  if (!Array.isArray(r.parts) || r.parts.length === 0) {
    fail(at, "parts 必须是非空数组");
    continue;
  }

  let kcal = 0, protein = 0, fat = 0, carb = 0, sodium = 0, sodiumComplete = true;
  let partsOk = true;
  for (const [j, p] of r.parts.entries()) {
    const pat = `${at} parts[${j}]`;
    const f = byId.get(p?.foodId);
    if (!f) {
      fail(pat, `库里没有原料「${p?.foodId}」—— 配方引用了不存在的食材`);
      partsOk = false;
      continue;
    }
    if (!(typeof p.grams === "number" && p.grams > 0)) {
      fail(pat, `grams 必须是正数，实际 ${JSON.stringify(p?.grams)}`);
      partsOk = false;
      continue;
    }
    const k = p.grams / 100;
    kcal += f.kcal * k;
    protein += f.protein * k;
    fat += f.fat * k;
    carb += f.carb * k;
    if (typeof f.sodium === "number") sodium += f.sodium * k;
    else sodiumComplete = false;
  }
  if (!dish || !partsOk) continue;

  const per = (v) => (v / r.yieldG) * 100;
  const checks = [
    ["kcal", per(kcal), TOL.kcal],
    ["protein", per(protein), TOL.macro],
    ["fat", per(fat), TOL.macro],
    ["carb", per(carb), TOL.macro],
  ];
  // 原料里只要有一个缺钠数据，重算的钠就不可比 —— 跳过而不是当成 0 比
  if (sodiumComplete) checks.push(["sodium", per(sodium), TOL.sodium]);

  for (const [key, computed, tol] of checks) {
    const stored = dish[key];
    if (typeof stored !== "number") {
      fail(at, `库里的 ${key} 不是数字，没法比对`);
      continue;
    }
    if (Math.abs(computed - stored) > tol) {
      fail(
        `${r.foodId} (${dish.name}) · ${key}`,
        `按 foodRecipes.json 重算是 ${computed.toFixed(2)}，库里存的是 ${stored}（差 ${Math.abs(computed - stored).toFixed(2)}，容差 ${tol}）—— ` +
          "配方或数值有一边被改过。要么把库里的值改成重算结果，要么把配方改回去",
      );
    }
  }
}

for (const f of LIBRARY.items ?? []) {
  if (hasRecipe(f) && !recipeByFoodId.has(f.id)) {
    fail(
      `${f.id} (${f.name})`,
      `source 写着「${RECIPE_MARK}」，但 data/foodRecipes.json 里没有它的配方 —— ` +
        "这条数值没有可复核的算法，跟没标来源是一回事",
    );
  }
}

// ---------- 输出 ----------

function report() {
  console.log("=".repeat(72));
  console.log(SELFTEST ? "数值引用台账闸门 · 自证模式" : "数值引用台账闸门");
  console.log("=".repeat(72));
  if (sabotaged) console.log(`已故意破坏：${sabotaged}\n`);

  const items = LIBRARY.items ?? [];
  const marked = items.filter(hasRef).length;
  const recipes = (RECIPES.recipes ?? []).length;
  console.log(
    `食物 ${items.length} 条 · 标了「${REF_MARK}」的 ${marked} 条（其中按配方估算 ${items.filter(hasRecipe).length} 条）` +
      ` · 台账登记 ${(SOURCES.entries ?? []).length} 条 · 配方 ${recipes} 份`,
  );
  if (SOURCES.meta?.std) console.log(`引用：${SOURCES.meta.org}《${SOURCES.meta.std}》 ${SOURCES.meta.site ?? ""}`);

  if (!problems.length) {
    console.log("\n✓ 没发现问题。");
    console.log("  注意：本闸门保证的是「抄来的有据可查」+「算出来的重算得回去」，**证明不了数值对不对** ——");
    console.log("  台账存的是引用标识而不是数值，要核对请拿 page 回官网按编号查；");
    console.log("  配方的可靠性锚在原料上，原料错了它跟着错。");
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
  // 两处破坏各对应一条检查，两条都必须在 problems 里出现才算自证通过。
  // 只断言「有问题」是不够的：那样其中一条检查坏掉了也照样绿。
  const expectKinds = ["没有可复核的来路", "配方或数值有一边被改过"];
  const missing = expectKinds.filter((k) => !problems.some((p) => p.msg.includes(k)));
  if (missing.length) {
    console.error(`\n✗ 自证失败：故意改坏了数据，这些检查却没拦下 —— ${missing.join("、")}。`);
    console.error("  永远通过的闸门等于没有闸门，先去修那条检查。");
    process.exit(2);
  }
  console.log(`\n✓ 自证通过：两处破坏都被对应的检查拦下了（共 ${problems.length} 个问题）。`);
  process.exit(0);
}

process.exit(failed);
