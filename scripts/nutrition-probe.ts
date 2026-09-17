/**
 * 营养探针 —— P1 的验收工具。
 *
 * 做一件事：把一句中文口语（如「一包薯片，一杯奶茶」）算成营养数字，
 * 并且把**每个数字的依据**摆出来：命中了库里哪一条、用了哪条份量规则、折算成多少克。
 *
 * 为什么先有它、后有界面：P1 的价值主张是"数字可信"，而可信与否只有在
 * 能把依据打印出来的时候才验得了。界面上做不到这一点（屏幕装不下），
 * 命令行可以。
 *
 * 本脚本的解析刻意很浅（正则 + 份量表），**只覆盖「数量 + 量词 + 食物名」这一形态**。
 * 真正的口语解析（歧义消解、LLM 兜底）是 P2 的事，这里只是把数据层验通。
 *
 * 用法：
 *   npm run probe -- --text "一包薯片，一杯奶茶"
 *   npm run probe -- --text "两个鸡蛋 一碗米饭" --kcal 1800 --sodium 1500
 *   npm run probe -- --text "一杯奶茶" --json     # 输出机器可读结果
 */

import { makeDietEntry, resolvePortion, roundValues, sumNutrition, compareToTargets, fallbackGrams } from "../lib/nutrition/core";
import { findFoodByName, libraryMeta, portionTable, foodCount, searchFoods } from "../lib/nutrition/library";
import { parseFragment, splitFragments } from "../lib/nutrition/parse";
import { referenceTargets } from "../lib/nutrition/targets";
import type { DietEntry, FoodItem, NutritionTotals } from "../lib/nutrition/types";
import { formatDateISO, mealSlotFromTime, nowHM } from "../lib/date";

// ---------- 参数 ----------

const argv = process.argv.slice(2);
function argValue(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const text = argValue("--text");
const wantJson = argv.includes("--json");
const refKcal = Number(argValue("--kcal") ?? 2000);
const refSodium = Number(argValue("--sodium") ?? 2000);

if (!text) {
  console.error("用法：npm run probe -- --text \"一包薯片，一杯奶茶\" [--kcal 1800] [--sodium 1500] [--json]");
  process.exit(2);
}

// ---------- 逐段解析 ----------

type Item = {
  fragment: string;
  /** 剥掉时间词/动词后的部分，展示出来便于解释「为什么这样算」 */
  cleaned: string;
  amount: number;
  unit?: string;
  query: string;
  food?: FoodItem;
  grams?: number;
  /** 这个克数是怎么来的 —— 必须能说清，否则数字不可信 */
  basis: string;
  estimated: boolean;
  entry?: DietEntry;
  failed?: string;
};

function resolveOne(fragment: string, index: number): Item {
  const parsed = parseFragment(fragment);
  const item: Item = {
    fragment,
    cleaned: parsed.cleaned,
    amount: parsed.amount,
    unit: parsed.unit,
    query: parsed.name,
    basis: "",
    estimated: false,
  };

  // 先精确名，再模糊检索 —— 精确命中优先，避免「奶茶」被「奶茶（无糖）」抢走
  const food = findFoodByName(parsed.name) ?? searchFoods(parsed.name, 1)[0];
  if (!food) {
    item.failed = `库里没有匹配到「${parsed.name}」`;
    return item;
  }
  item.food = food;

  let grams: number;
  if (parsed.unit === "克") {
    grams = parsed.amount;
    item.basis = `直接给了克数 ${parsed.amount}g`;
  } else if (parsed.unit) {
    const hit = resolvePortion(portionTable(), food, parsed.unit);
    if (hit) {
      grams = hit.grams * parsed.amount;
      const range = hit.portion.range ? `，常见区间 ${hit.portion.range[0]}~${hit.portion.range[1]}g` : "";
      item.basis = `${parsed.amount} × 「${hit.portion.label}」${hit.grams}g${range}`;
    } else {
      // 份量表里没有这条组合 —— 按分类兜底，并**明确标成估算**
      grams = fallbackGrams(food) * parsed.amount;
      item.estimated = true;
      item.basis = `份量表里没有「${parsed.unit}」这条，按${food.category}分类兜底 ${fallbackGrams(food)}g × ${parsed.amount}（估算）`;
    }
  } else {
    grams = fallbackGrams(food) * parsed.amount;
    item.estimated = true;
    item.basis = `没写份量，按分类兜底 ${fallbackGrams(food)}g × ${parsed.amount}（估算）`;
  }

  item.grams = grams;
  const now = Date.now();
  const hm = nowHM();
  item.entry = makeDietEntry({
    id: `probe-${index}`,
    createdAt: now,
    date: formatDateISO(new Date()),
    time: hm,
    mealSlot: mealSlotFromTime(hm),
    food,
    name: food.name,
    amount: parsed.amount,
    unitLabel: parsed.unit ?? "克",
    grams,
    source: "db",
  });
  return item;
}

const fragments = splitFragments(text);
const items = fragments.map((f, i) => resolveOne(f, i));
const entries = items.map((x) => x.entry).filter((e): e is DietEntry => !!e);
const totals: NutritionTotals = sumNutrition(entries);
const targets = referenceTargets(refKcal, refSodium);
const statuses = compareToTargets(totals, targets);

// ---------- 输出 ----------

const meta = libraryMeta();

if (wantJson) {
  console.log(
    JSON.stringify(
      {
        text,
        items: items.map((x) => ({
          fragment: x.fragment,
          matched: x.food ? { id: x.food.id, name: x.food.name, source: x.food.source } : null,
          amount: x.amount,
          unit: x.unit ?? null,
          grams: x.grams ?? null,
          basis: x.basis,
          estimated: x.estimated,
          failed: x.failed ?? null,
        })),
        totals: roundValues(totals.values),
        coverage: { sodium: totals.sodiumCoverage, fiber: totals.fiberCoverage },
        referenceTargets: targets,
        statuses,
      },
      null,
      2,
    ),
  );
  process.exit(items.some((x) => x.failed) ? 1 : 0);
}

const line = "─".repeat(66);
const f1 = (n: number) => n.toFixed(1);

console.log("元气账本 · 营养探针");
console.log(`输入  ${text}`);
console.log(`食物库 ${foodCount()} 条（${meta.updated}）· 数值口径：${meta.unit}`);

console.log(`\n${line}`);
console.log("逐项追溯");
console.log(line);

for (const x of items) {
  if (x.failed) {
    console.log(`\n✗ 「${x.fragment}」`);
    console.log(`    ${x.failed}，未计入合计`);
    continue;
  }
  const n = x.entry!.nutrition;
  console.log(`\n✓ 「${x.fragment}」 → ${x.food!.name}  (库 id: ${x.food!.id})`);
  if (x.cleaned !== x.fragment) console.log(`    解析：剥掉时间词与动词 → 「${x.cleaned}」`);
  console.log(`    折算：${x.basis} → 共 ${x.grams}g${x.estimated ? "  ⚠ 估算" : ""}`);
  console.log(`    依据（每 100${x.food!.unit}）：${x.food!.kcal} kcal · 蛋白 ${x.food!.protein}g · 脂肪 ${x.food!.fat}g · 碳水 ${x.food!.carb}g${x.food!.sodium !== undefined ? ` · 钠 ${x.food!.sodium}mg` : " · 钠 无数据"}`);
  console.log(`    来源：${x.food!.source}`);
  console.log(
    `    本条：${f1(n.kcal)} kcal · 蛋白 ${f1(n.protein)}g · 脂肪 ${f1(n.fat)}g · 碳水 ${f1(n.carb)}g` +
      (n.sodium !== undefined ? ` · 钠 ${Math.round(n.sodium)}mg` : " · 钠 ——"),
  );
}

const r = roundValues(totals.values);
console.log(`\n${line}`);
console.log("合计");
console.log(line);
console.log(
  `${r.kcal} kcal · 蛋白 ${f1(r.protein)}g · 脂肪 ${f1(r.fat)}g · 碳水 ${f1(r.carb)}g · ` +
    (r.sodium !== undefined ? `钠 ${r.sodium}mg` : "钠 无数据"),
);
console.log(`钠数据覆盖 ${entries.filter((e) => e.nutrition.sodium !== undefined).length}/${entries.length} 条`);

console.log(`\n${line}`);
console.log(`对比参考目标：${refKcal} kcal / 钠 ${refSodium}mg`);
console.log("（这是探针的参考日，不是你的真实目标 —— 真实目标由健康档案推导）");
console.log(line);

for (const s of statuses) {
  if (s.verdict === "unknown") {
    console.log(`  ${s.label.padEnd(5)} ——    ${s.note ?? "暂无数据"}`);
    continue;
  }
  const pct = Math.round(s.ratio * 100);
  const bar = "█".repeat(Math.min(20, Math.round(s.ratio * 20))).padEnd(20, "·");
  const mark = s.verdict === "ok" ? " " : s.verdict === "high" ? "↑" : "↓";
  const shown = s.unit === "kcal" || s.unit === "mg" ? Math.round(s.intake) : f1(s.intake);
  const targetShown = s.unit === "kcal" || s.unit === "mg" ? Math.round(s.target) : f1(s.target);
  console.log(`  ${s.label.padEnd(5)} ${String(shown).padStart(6)} / ${String(targetShown).padStart(6)} ${s.unit.padEnd(4)} ${String(pct).padStart(3)}% ${bar} ${mark}`);
}

console.log(`\n方向说明：热量/脂肪/碳水看「是否落在区间」，钠看「别超」，蛋白/纤维看「够不够」。`);
console.log(`标记 ↑ = 超了，↓ = 不足，无标记 = 在范围内。`);

process.exit(items.some((x) => x.failed) ? 1 : 0);
