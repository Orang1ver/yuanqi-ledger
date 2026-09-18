#!/usr/bin/env node
/**
 * 食物库与份量表的数据质检闸门。
 *
 * 为什么需要它：这个库是**手录**的，几百个数字里必然会有打错的。
 * 靠人眼复核几百行数字是不现实的，但**成分表自己会露馅** ——
 * 蛋白质和碳水约 4 kcal/g、脂肪约 9 kcal/g，所以
 * `蛋白×4 + 脂肪×9 + 碳水×4` 应当约等于标注热量。
 * 把这条关系当断言，手滑打错一位就当场拦下。
 *
 * 它抓得到什么：算术错误、字段名写错、别名撞车、份量表引用了不存在的食物、体积失控。
 * 它抓不到什么：**「自洽但错」**。若某个食物的热量与三大营养素一起写错且比例自洽，
 * 这个闸门会放行 —— 那需要第二道参照校核（在本机跑，参照集不进仓库）。
 * 脚本会把这个边界打印出来，不让人误以为它证明了「数据全对」。
 *
 * 用法：
 *   node scripts/check-nutrition.mjs               # 正常校验
 *   YQ_SELFTEST=1 node scripts/check-nutrition.mjs # 自证：先故意改坏一条，验证确实会被拦下
 *
 * 退出码：0 = 通过（自证模式下 = 确实拦住了）；1 = 有问题；2 = 自证失败（闸门形同虚设）
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SELFTEST = process.env.YQ_SELFTEST === "1";

// ---------- 常量 ----------

const CATEGORIES = ["staple", "meat", "veg", "protein", "fruit", "snack", "drink", "soup", "seasoning", "alcohol"];
const CATEGORY_LABELS = {
  staple: "主食", meat: "荤菜", veg: "素菜", protein: "蛋豆乳", fruit: "水果",
  snack: "零食", drink: "饮料", soup: "汤粥", seasoning: "油脂调味", alcohol: "酒类",
};

/** 闭合校验的容差。分档是因为不同类食物的偏差来源不同 */
const TOLERANCE = {
  default: 0.15,
  // 蔬菜水果的纤维与有机酸也供能，但不计入三大营养素，比值天然偏低
  highFiber: 0.25,
  // 纯油脂：算式应当几乎精确
  pureFat: 0.05,
};
const HIGH_FIBER_CATEGORIES = new Set(["veg", "fruit"]);

/** 低于这个热量就不做闭合校验：低热量食物的比值误差没有意义（分母太小） */
const CLOSURE_KCAL_FLOOR = 20;

/** 每 100g 的物理上限 */
const LIMITS = {
  kcal: 900,      // 纯油脂约 899
  macro: 100,     // 蛋白/脂肪/碳水各自不可能超过 100g
  sodium: 40000,  // 纯食盐约 39311 mg/100g
};

/** 各分类至少要有多少条，避免某类空着导致统计口径出现「其他」一大坨 */
const MIN_PER_CATEGORY = 4;

/** 体积预算：懒加载后 gzip 传出去的字节数 */
const GZIP_BUDGET = 100 * 1024;

// ---------- 载入 ----------

function loadJson(rel) {
  const abs = join(ROOT, rel);
  try {
    return { data: JSON.parse(readFileSync(abs, "utf8")), raw: readFileSync(abs) };
  } catch (err) {
    console.error(`✗ 读不了 ${rel}：${err.message}`);
    process.exit(1);
  }
}

const foodsFile = loadJson("data/foods.zh.json");
const portionsFile = loadJson("data/foodPortions.json");
const LIBRARY = foodsFile.data;
const PORTIONS = portionsFile.data;

// ---------- 自证模式：先故意改坏一条 ----------

let sabotaged = null;
if (SELFTEST) {
  const victim = LIBRARY.items.find((x) => x.id === "shupian");
  if (!victim) {
    console.error("✗ 自证失败：找不到用来做实验的条目 shupian");
    process.exit(2);
  }
  victim.fat = 3.4; // 正确值是 34 —— 差一位小数，算式就会对不上

  /*
   * 第二处破坏，专门喂给下面「份量表联动」那条检查。
   *
   * 两条检查长在两处，破坏点就必须落在两处：只破坏一处的话，另一条检查全绿
   * 也说明不了它会拦人。这个坑踩过一次（见 AGENTS.md 地雷 23）——
   * 当时补丁先被另一道防线挡掉，于是误判成"检查不灵敏"。
   *
   * 这条假食物的三大营养素是配平过的（4×4 + 4×9 + 15×4 = 112，对 100 差 12%，
   * 在容差内），所以它只会触发"没有任何份量规则命中"这一个问题，不会串味。
   */
  LIBRARY.items.push({
    id: "yq-selftest-orphan",
    name: "自证用孤儿食物",
    category: "veg",
    unit: "g",
    kcal: 100,
    protein: 4,
    fat: 4,
    carb: 15,
    source: "自证用（只在这个模式下存在）",
  });

  /*
   * 第三处破坏，喂给「干重食物的份量口径」那条检查。
   *
   * 做法是**抽掉碗的干重专门规则**，让「挂面」重新掉回 `碗[面条] = 250g` 那条熟重规则。
   * 刻意只抽「碗」、留着「份」：两条都抽的话，粉丝（干）会变成"一条规则都命中不了"，
   * 于是 ④b 先报出来 —— 那测到的是 ④b，不是 ④c（地雷 23：破坏必须走到被测的那一层）。
   */
  const dryBowlIdx = PORTIONS.rules.findIndex(
    (r) => r.unit === "碗" && (r.match ?? []).includes("干米粉"),
  );
  if (dryBowlIdx < 0) {
    console.error("✗ 自证失败：找不到碗的干重专门规则 —— 破坏点根本没落到位");
    process.exit(2);
  }
  PORTIONS.rules.splice(dryBowlIdx, 1);

  sabotaged =
    `把「${victim.name}」的脂肪从 34 改成 3.4；` +
    "并塞进一条没有任何份量规则能命中的食物「自证用孤儿食物」；" +
    "再抽掉碗的干重专门规则，让「挂面」掉回熟重的 250g";
}

// ---------- 收集问题 ----------

const problems = [];
const fail = (where, msg) => problems.push({ where, msg });

// ---------- ① 顶层结构 ----------

if (typeof LIBRARY.meta?.version !== "number") fail("foods.zh.json", "meta.version 缺失或不是数字");
if (!LIBRARY.meta?.unit) fail("foods.zh.json", "meta.unit 缺失 —— 数值口径必须写明白");
if (!LIBRARY.meta?.updated) fail("foods.zh.json", "meta.updated 缺失");
if (!Array.isArray(LIBRARY.items)) {
  fail("foods.zh.json", "items 不是数组");
  report();
}
if (typeof PORTIONS.meta?.version !== "number") fail("foodPortions.json", "meta.version 缺失");
if (!Array.isArray(PORTIONS.rules)) fail("foodPortions.json", "rules 不是数组");

// ---------- ② 逐条校验食物 ----------

const ids = new Map();
const nameOwners = new Map(); // 归一化名字 → food id（检测撞车）

const norm = (s) => String(s).replace(/[\s\u3000]+/g, "").toLowerCase();
const num = (v) => typeof v === "number" && Number.isFinite(v);

for (const [i, f] of (LIBRARY.items ?? []).entries()) {
  const at = `items[${i}]${f?.id ? ` (${f.id})` : ""}`;

  if (!f || typeof f !== "object") { fail(at, "不是对象"); continue; }
  if (!f.id) fail(at, "缺 id");
  if (!f.name) fail(at, "缺 name");
  if (!f.source) fail(at, "缺 source —— 数值来源必须标清楚，不许留空");
  if (!CATEGORIES.includes(f.category)) fail(at, `category 非法：${JSON.stringify(f.category)}`);
  if (f.unit !== "g" && f.unit !== "ml") fail(at, `unit 只能是 g 或 ml，实际是 ${JSON.stringify(f.unit)}`);

  if (f.id) {
    if (ids.has(f.id)) fail(at, `id 重复（已被 ${ids.get(f.id)} 占用）`);
    else ids.set(f.id, f.name);
  }

  // 名字与别名撞车：两样食物共用一个名字，检索时就会忽左忽右
  for (const n of [f.name, ...(f.alias ?? [])]) {
    if (!n) continue;
    const key = norm(n);
    const owner = nameOwners.get(key);
    if (owner && owner !== f.id) fail(at, `「${n}」这个名字已经被 ${owner} 占用，检索会产生歧义`);
    else nameOwners.set(key, f.id);
  }

  // 数值本身
  for (const k of ["kcal", "protein", "fat", "carb"]) {
    if (!num(f[k])) fail(at, `${k} 不是有效数字：${JSON.stringify(f[k])}`);
    else if (f[k] < 0) fail(at, `${k} 是负数：${f[k]}`);
  }
  if (num(f.kcal) && f.kcal > LIMITS.kcal) fail(at, `热量 ${f.kcal} 超过每 100g 的物理上限 ${LIMITS.kcal}`);
  for (const k of ["protein", "fat", "carb"]) {
    if (num(f[k]) && f[k] > LIMITS.macro) fail(at, `${k} ${f[k]} 超过 100g/100g`);
  }
  if (f.sodium !== undefined) {
    if (!num(f.sodium) || f.sodium < 0) fail(at, `sodium 不是有效数字：${JSON.stringify(f.sodium)}`);
    else if (f.sodium > LIMITS.sodium) fail(at, `钠 ${f.sodium} 超过纯食盐的 ${LIMITS.sodium}`);
  }
  if (f.fiber !== undefined && (!num(f.fiber) || f.fiber < 0)) fail(at, `fiber 不是有效数字：${JSON.stringify(f.fiber)}`);

  // 三大营养素之和不能超过总质量
  if (num(f.protein) && num(f.fat) && num(f.carb)) {
    const mass = f.protein + f.fat + f.carb;
    if (mass > 100.5) fail(at, `蛋白+脂肪+碳水 = ${mass.toFixed(1)}g，超过 100g/100g（水的存在决定了这不可能）`);
  }

  // 闭合校验
  if (num(f.kcal) && num(f.protein) && num(f.fat) && num(f.carb)) {
    if (f.category === "alcohol") {
      // 乙醇 7 kcal/g，不在三大营养素里，这条算式对酒类不成立 —— 明确豁免而不是放宽容差
    } else if (f.kcal < CLOSURE_KCAL_FLOOR) {
      // 低热量食物跳过：分母太小，比值没有意义
    } else {
      const computed = f.protein * 4 + f.fat * 9 + f.carb * 4;
      const delta = Math.abs(computed - f.kcal) / f.kcal;
      const isPureFat = num(f.fat) && f.fat >= 90;
      const tol = isPureFat ? TOLERANCE.pureFat : HIGH_FIBER_CATEGORIES.has(f.category) ? TOLERANCE.highFiber : TOLERANCE.default;
      if (delta > tol) {
        fail(
          at,
          `闭合校验不过：${f.protein}×4 + ${f.fat}×9 + ${f.carb}×4 = ${computed.toFixed(1)}，` +
            `与标注热量 ${f.kcal} 差 ${(delta * 100).toFixed(1)}%，超过容差 ${(tol * 100).toFixed(0)}%`,
        );
      }
    }
  }
}

// ---------- ③ 分类覆盖 ----------

const byCategory = new Map(CATEGORIES.map((c) => [c, 0]));
for (const f of LIBRARY.items ?? []) {
  if (byCategory.has(f.category)) byCategory.set(f.category, byCategory.get(f.category) + 1);
}
for (const [c, n] of byCategory) {
  if (n < MIN_PER_CATEGORY) fail("分类覆盖", `${CATEGORY_LABELS[c]}(${c}) 只有 ${n} 条，至少要 ${MIN_PER_CATEGORY} 条`);
}

// ---------- ④ 份量表 ----------

const allNames = new Set();
for (const f of LIBRARY.items ?? []) {
  for (const n of [f.name, ...(f.alias ?? [])]) if (n) allNames.add(n);
}

for (const [i, r] of (PORTIONS.rules ?? []).entries()) {
  const at = `rules[${i}] 量词「${r?.unit ?? "?"}」`;
  if (!r || typeof r !== "object") { fail(at, "不是对象"); continue; }
  if (!r.unit) fail(at, "缺 unit");
  if (!Array.isArray(r.match) || r.match.length === 0) fail(at, "match 必须是非空数组");
  if (!Array.isArray(r.portions) || r.portions.length === 0) { fail(at, "portions 必须是非空数组"); continue; }

  const defaultCount = r.portions.filter((p) => p.isDefault).length;
  if (defaultCount > 1) fail(at, `有 ${defaultCount} 个默认档，只能有一个`);

  for (const [j, p] of r.portions.entries()) {
    const pat = `${at} 第 ${j + 1} 档`;
    if (!p?.label) fail(pat, "缺 label");
    if (!num(p?.grams) || p.grams <= 0) fail(pat, `grams 必须是正数，实际 ${JSON.stringify(p?.grams)}`);
    if (p?.range) {
      if (!Array.isArray(p.range) || p.range.length !== 2) fail(pat, "range 必须是两个数字的数组");
      else {
        const [lo, hi] = p.range;
        if (!num(lo) || !num(hi) || lo > hi) fail(pat, `range 非法：[${lo}, ${hi}]`);
        else if (p.grams < lo || p.grams > hi) fail(pat, `默认值 ${p.grams} 不在自己声明的区间 [${lo}, ${hi}] 内`);
      }
    }
  }

  // 死规则：match 里的词一条食物都命中不了，多半是打错了食物名
  const hits = (r.match ?? []).filter((m) => [...allNames].some((n) => n.includes(m)));
  if (!hits.length) fail(at, `match 里的词没有任何一条食物命中：[${(r.match ?? []).join("、")}] —— 是不是食物名打错了？`);
}

// ---------- ④b 份量表与食物库的联动 ----------

/*
 * 每条食物至少要有一条份量规则命中它。
 *
 * 命中不了的话，用户写「一份草莓」「一个土豆」时 `resolvePortion` 查不到这个组合，
 * 会**静默**退化成按分类兜底的估算克数 —— 界面上照样出一个数字，
 * 只是那个数字没有任何依据，而且用户看不出来。
 *
 * 这条检查是补上来的：在它之前，食物库和份量表各校各的，
 * 19 条食物「有名字、有营养值、但没有一条份量规则」这件事一直没人看见。
 */
const portionCovered = new Set();
for (const r of PORTIONS.rules ?? []) {
  for (const f of LIBRARY.items ?? []) {
    const names = [f.name, ...(f.alias ?? [])];
    if ((r.match ?? []).some((m) => names.some((n) => n.includes(m)))) portionCovered.add(f.id);
  }
}
for (const f of LIBRARY.items ?? []) {
  if (f?.id && !portionCovered.has(f.id)) {
    fail(
      `${f.id} (${f.name})`,
      "没有任何份量规则命中它 —— 写「一份 / 一个」时会静默走分类兜底估算，出来的数字没有依据",
    );
  }
}

// ---------- ④c 干重食物不许用熟重的克数 ----------

/*
 * 「挂面」是**干重**数据（346 kcal/100g），而份量表里 `碗[面条] = 250g` 是**熟重**。
 * 挂面的别名「干面条」含「面条」，于是它命中了那条熟重规则 ——
 * 「一碗挂面」算出 865 kcal，真实约 280，**高估三倍**，而且界面上看不出任何异常。
 * 同一个错在库里躺着三条：挂面、米粉（干）、粉丝（干）。
 *
 * ④b 那条抓不到它：那条只问"有没有规则命中"，不问"命中的规则口径对不对" ——
 * 命中得越"成功"，错得越彻底。
 *
 * 判据是**口径**而不是克数大小：80g 和 250g 谁对，光看数字判不出来，只有 note 知道。
 * 所以要求干重食物的每条命中规则，默认档的 note 必须写明是干重（含「干重」或「按干」）。
 */
const isDryFood = (f) =>
  /干重/.test(f.source ?? "") ||
  /（干）|\(干\)/.test(f.name ?? "") ||
  (f.alias ?? []).some((a) => /（干）|\(干\)/.test(a ?? ""));

const portionUnits = [...new Set((PORTIONS.rules ?? []).map((r) => r.unit).filter(Boolean))];
let dryCombos = 0;

for (const f of LIBRARY.items ?? []) {
  if (!isDryFood(f)) continue;
  const names = [f.name, ...(f.alias ?? [])].filter(Boolean);

  for (const unit of portionUnits) {
    // 与 core.ts 的 resolvePortion 保持同一个顺序：同一量词下先命中先取
    const rule = (PORTIONS.rules ?? []).find(
      (r) => r.unit === unit && (r.match ?? []).some((m) => names.some((n) => n.includes(m))),
    );
    if (!rule) continue;

    const portion = rule.portions.find((p) => p.isDefault) ?? rule.portions[0];
    dryCombos++;

    if (!/干重|按干/.test(portion?.note ?? "")) {
      const grams = portion?.grams ?? 0;
      fail(
        `${f.id} (${f.name}) · 量词「${unit}」`,
        `干重数据（${f.kcal} kcal/100g）命中了熟重口径的规则「${portion?.label ?? "?"}」` +
          `：${grams}g → ${((f.kcal * grams) / 100).toFixed(0)} kcal（note：${portion?.note ?? "未注明"}）。` +
          "干面 / 干粉煮熟或泡发后重量翻几倍，按熟重克数算会高估数倍 —— " +
          "修法是在这条通用规则**前面**插一条按干重给克数的专门规则，note 里写明「按干…」",
      );
    }
  }
}

// ---------- ⑤ 体积预算 ----------

const rawBytes = foodsFile.raw.length;
const gzipBytes = gzipSync(foodsFile.raw).length;
if (gzipBytes > GZIP_BUDGET) {
  fail("体积预算", `食物库 gzip 后 ${(gzipBytes / 1024).toFixed(1)}KB，超过预算 ${(GZIP_BUDGET / 1024).toFixed(0)}KB`);
}

// ---------- 输出 ----------

function report() {
  const items = LIBRARY.items ?? [];
  const rules = PORTIONS.rules ?? [];
  const portionCount = rules.reduce((s, r) => s + (r.portions?.length ?? 0), 0);

  console.log("=".repeat(72));
  console.log(SELFTEST ? "食物库质检闸门 · 自证模式" : "食物库质检闸门");
  console.log("=".repeat(72));
  if (sabotaged) console.log(`已故意破坏：${sabotaged}\n`);

  console.log(`食物 ${items.length} 条 · 份量规则 ${rules.length} 条（${portionCount} 个档位）`);
  console.log(`体积 原始 ${(rawBytes / 1024).toFixed(1)}KB · gzip ${(gzipBytes / 1024).toFixed(1)}KB（预算 ${(GZIP_BUDGET / 1024).toFixed(0)}KB）`);
  console.log("\n分类覆盖：");
  for (const [c, n] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${CATEGORY_LABELS[c].padEnd(6)} ${String(n).padStart(3)} 条`);
  }

  const checked = items.filter((f) => f.category !== "alcohol" && num(f.kcal) && f.kcal >= CLOSURE_KCAL_FLOOR).length;
  const skipped = items.length - checked;
  console.log(
    `\n闭合校验：检查了 ${checked} 条，跳过 ${skipped} 条` +
      `（酒类含乙醇、热量低于 ${CLOSURE_KCAL_FLOOR} kcal 的条目算式不适用）`,
  );
  console.log(`干重口径：检查了 ${dryCombos} 个「干重食物 × 量词」组合 —— 口径必须写明是干重`);

  if (!problems.length) {
    console.log("\n✓ 没发现问题。");
    console.log("  注意：本闸门只能发现算术错误与结构问题，**证明不了数值全对** ——");
    console.log("  数值本身错但比例自洽的情况，需要另一道参照校核。");
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
  // 三处破坏各对应一条检查，三条都必须在 problems 里出现才算自证通过。
  // 只断言"有问题"是不够的：那样其中一条检查坏掉了也照样绿。
  const expectKinds = ["闭合校验不过", "没有任何份量规则命中", "干重数据"];
  const missingKinds = expectKinds.filter((k) => !problems.some((p) => p.msg.includes(k)));
  if (missingKinds.length) {
    console.error(`\n✗ 自证失败：故意改坏了数据，这些检查却没拦下 —— ${missingKinds.join("、")}。`);
    console.error("  永远通过的闸门等于没有闸门，先去修那条检查。");
    process.exit(2);
  }
  console.log(`\n✓ 自证通过：三处破坏都被对应的检查拦下了（共 ${problems.length} 个问题）。`);
  console.log("  永远通过的闸门等于没有闸门，所以这一步不能省。");
  process.exit(0);
}

process.exit(failed);
