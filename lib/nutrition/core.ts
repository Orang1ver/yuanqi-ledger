/**
 * 营养计算核心 —— 全部是纯函数。
 *
 * 纪律（三条，破坏任何一条都会让数字变成幻觉）：
 *
 * 1. **没有 import 任何 UI / Next / localStorage。** 只有计算。
 * 2. **数字只能来自这里。** 模型可以帮忙理解「一包薯片」是什么，但不许它给出热量值。
 * 3. **「没数据」不许当 0。** 库里查不到钠时是 `undefined`，求和时跳过并单独报覆盖率，
 *    绝不把它当成 0 混进总和 —— 那是这类 App 最常见的说谎方式。
 */

import { MEAL_SLOTS } from "../tags";
import type { MealSlot } from "../tags";
import type {
  DietEntry,
  DietEntrySource,
  FoodCategory,
  FoodItem,
  FoodPortion,
  NutritionTargets,
  NutritionTotals,
  NutritionValues,
  NutrientStatus,
  PortionRule,
  PortionTable,
  TargetDirection,
} from "./types";
import { categoryLabel } from "./types";

// ---------- 基础换算 ----------

/** 四舍五入到指定小数位。浮点求和会攒出 0.30000000000000004 这种尾巴，展示前收一下 */
export function round(v: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/**
 * 某种食物吃 `grams` 克时的营养值。
 * 库里的数值一律是每 100g，所以这里只有一次乘法 —— 没有别的地方再算 nutrition。
 */
export function nutritionOf(food: FoodItem, grams: number): NutritionValues {
  const k = grams / 100;
  return {
    kcal: food.kcal * k,
    protein: food.protein * k,
    fat: food.fat * k,
    carb: food.carb * k,
    sodium: food.sodium === undefined ? undefined : food.sodium * k,
    fiber: food.fiber === undefined ? undefined : food.fiber * k,
  };
}

/** 按倍数缩放。`undefined` 保持 `undefined`（未知 × n 仍然是未知，不是 0） */
export function scaleNutrition(v: NutritionValues, times: number): NutritionValues {
  return {
    kcal: v.kcal * times,
    protein: v.protein * times,
    fat: v.fat * times,
    carb: v.carb * times,
    sodium: v.sodium === undefined ? undefined : v.sodium * times,
    fiber: v.fiber === undefined ? undefined : v.fiber * times,
  };
}

/**
 * 相加。**低层原语**，用于两份都已确定完整的数据（如「主食 + 主菜」）。
 * 有一部分是 `undefined` 时，结果取已知的那部分 —— 因此**它不适合用来做跨条目的汇总**，
 * 那种场景请用 `sumNutrition()`，它会一并把覆盖度算出来告诉你少了多少。
 */
export function addNutrition(a: NutritionValues, b: NutritionValues): NutritionValues {
  const opt = (x: number | undefined, y: number | undefined) =>
    x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0);
  return {
    kcal: a.kcal + b.kcal,
    protein: a.protein + b.protein,
    fat: a.fat + b.fat,
    carb: a.carb + b.carb,
    sodium: opt(a.sodium, b.sodium),
    fiber: opt(a.fiber, b.fiber),
  };
}

/** 展示用：收掉浮点尾巴 */
export function roundValues(v: NutritionValues, digits = 1): NutritionValues {
  return {
    kcal: Math.round(v.kcal),
    protein: round(v.protein, digits),
    fat: round(v.fat, digits),
    carb: round(v.carb, digits),
    sodium: v.sodium === undefined ? undefined : Math.round(v.sodium),
    fiber: v.fiber === undefined ? undefined : round(v.fiber, digits),
  };
}

// ---------- 汇总 ----------

/**
 * 把若干条记录汇总成当日的总量，并报出**数据覆盖度**。
 *
 * 覆盖度是这个函数存在的理由：上层必须能说出
 * 「今天钠 1800mg（基于 72% 的记录）」，而不是给出一个看起来很确定的假数字。
 */
export function sumNutrition(entries: readonly DietEntry[]): NutritionTotals {
  let kcal = 0;
  let protein = 0;
  let fat = 0;
  let carb = 0;
  let sodiumSum = 0;
  let fiberSum = 0;
  let sodiumKnown = 0;
  let fiberKnown = 0;

  for (const e of entries) {
    const n = e.nutrition;
    kcal += n.kcal;
    protein += n.protein;
    fat += n.fat;
    carb += n.carb;
    if (n.sodium !== undefined) {
      sodiumSum += n.sodium;
      sodiumKnown += 1;
    }
    if (n.fiber !== undefined) {
      fiberSum += n.fiber;
      fiberKnown += 1;
    }
  }

  const total = entries.length;
  return {
    values: {
      kcal,
      protein,
      fat,
      carb,
      // 一条都没有钠数据时给 undefined，而不是 0 —— 空集合的总和是"未知"，不是"零"
      sodium: sodiumKnown ? sodiumSum : undefined,
      fiber: fiberKnown ? fiberSum : undefined,
    },
    entries: total,
    sodiumCoverage: total ? sodiumKnown / total : 0,
    fiberCoverage: total ? fiberKnown / total : 0,
  };
}

/** 按日期分组汇总，日期升序 */
export function totalsByDate(
  entries: readonly DietEntry[],
): { date: string; totals: NutritionTotals }[] {
  const map = new Map<string, DietEntry[]>();
  for (const e of entries) {
    const list = map.get(e.date);
    if (list) list.push(e);
    else map.set(e.date, [e]);
  }
  return [...map.entries()]
    .map(([date, list]) => ({ date, totals: sumNutrition(list) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 按餐次分组，顺序固定为早/午/晚/加餐（不按数据出现的先后） */
export function groupByMealSlot(
  entries: readonly DietEntry[],
): { slot: MealSlot; entries: DietEntry[]; totals: NutritionTotals }[] {
  return MEAL_SLOTS.map((slot) => {
    const list = entries.filter((e) => e.mealSlot === slot);
    return { slot, entries: list, totals: sumNutrition(list) };
  });
}

// ---------- 结构分析 ----------

/** 三大营养素供能比（百分比，合计约 100）。总热量为 0 时返回全 0 */
export function energyRatios(v: NutritionValues): { protein: number; fat: number; carb: number } {
  const eP = v.protein * 4;
  const eF = v.fat * 9;
  const eC = v.carb * 4;
  const sum = eP + eF + eC;
  if (sum <= 0) return { protein: 0, fat: 0, carb: 0 };
  return {
    protein: (eP / sum) * 100,
    fat: (eF / sum) * 100,
    carb: (eC / sum) * 100,
  };
}

/** 每公斤体重摄入的蛋白质（g/kg）。体重非法时返回 0 */
export function proteinPerKg(v: NutritionValues, weightKg: number): number {
  if (!(weightKg > 0)) return 0;
  return v.protein / weightKg;
}

/** 各分类贡献的热量及占比，降序。用于回答「今天的热量主要来自哪儿」 */
export function categoryEnergyShare(
  entries: readonly DietEntry[],
): { category: FoodCategory | "unknown"; label: string; kcal: number; share: number }[] {
  const acc = new Map<FoodCategory | "unknown", number>();
  let total = 0;
  for (const e of entries) {
    const key: FoodCategory | "unknown" = e.category ?? "unknown";
    acc.set(key, (acc.get(key) ?? 0) + e.nutrition.kcal);
    total += e.nutrition.kcal;
  }
  return [...acc.entries()]
    .map(([category, kcal]) => ({
      category,
      label: category === "unknown" ? "未分类" : categoryLabel(category),
      kcal,
      share: total > 0 ? kcal / total : 0,
    }))
    .sort((a, b) => b.kcal - a.kcal);
}

/**
 * 贡献最大的若干条目。回答「今天的热量/钠主要是哪几样拉起来的」——
 * 这条比一个总分有用得多，因为它直接指向可以改的那一样东西。
 */
export function topContributors(
  entries: readonly DietEntry[],
  key: "kcal" | "protein" | "fat" | "carb" | "sodium",
  limit = 5,
): { entry: DietEntry; value: number }[] {
  return entries
    .map((entry) => ({ entry, value: entry.nutrition[key] ?? 0 }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

// ---------- 与目标对比 ----------

/** 各项目标的方向语义。band 表示「落在区间里」，不是越多越好也不是越少越好 */
const TARGET_META: {
  key: NutrientStatus["key"];
  label: string;
  unit: string;
  direction: TargetDirection;
  /** band 型的容差（±），如 0.1 表示上下浮动 10% 都算达标 */
  tolerance?: number;
}[] = [
  { key: "kcal", label: "热量", unit: "kcal", direction: "band", tolerance: 0.1 },
  { key: "protein", label: "蛋白质", unit: "g", direction: "atLeast" },
  { key: "fat", label: "脂肪", unit: "g", direction: "band", tolerance: 0.15 },
  { key: "carb", label: "碳水", unit: "g", direction: "band", tolerance: 0.15 },
  { key: "sodium", label: "钠", unit: "mg", direction: "atMost" },
  { key: "fiber", label: "膳食纤维", unit: "g", direction: "atLeast" },
];

/** 各项实际摄入的取值。sodium/fiber 可能没有数据 */
function intakeOf(t: NutritionTotals, key: NutrientStatus["key"]): number | undefined {
  return key === "sodium" ? t.values.sodium : key === "fiber" ? t.values.fiber : t.values[key];
}

/**
 * 有数据但**不全**时的提醒语。
 *
 * 这一条是被食物库的实际情况逼出来的：库里 184 条**全都有钠**，但**有 110 条没有纤维**。
 * 于是"今天纤维 8g"这种数字，可能只基于 9 条记录里的 2 条。
 * 如果只在完全没有数据时才提示，那这种"部分数据算出来的确定数字"就会一路绿灯 ——
 * 它比完全没有数据更危险，因为它看起来是有依据的。
 */
function coverageNote(key: NutrientStatus["key"], intake: NutritionTotals): string | undefined {
  if (key !== "sodium" && key !== "fiber") return undefined;
  const cov = key === "sodium" ? intake.sodiumCoverage : intake.fiberCoverage;
  if (cov >= 0.9) return undefined;
  return `只基于 ${Math.round(cov * 100)}% 的记录，其余条目没有这项数据`;
}

/**
 * 把摄入量与目标逐项对比。
 *
 * 数据不全时不硬判：钠没有数据就返回 `unknown` 并附说明，
 * 让界面显示「钠：暂无足够数据」而不是「钠：0mg，达标」——后者是错的，且会让人放心地吃咸。
 */
export function compareToTargets(
  intake: NutritionTotals,
  targets: NutritionTargets,
): NutrientStatus[] {
  return TARGET_META.map((meta) => {
    const target = targets[meta.key];
    const value = intakeOf(intake, meta.key);

    const base = {
      key: meta.key,
      label: meta.label,
      target,
      unit: meta.unit,
      direction: meta.direction,
      intake: value ?? 0,
    };

    if (value === undefined) {
      const coverage = meta.key === "sodium" ? intake.sodiumCoverage : intake.fiberCoverage;
      return {
        ...base,
        ratio: 0,
        verdict: "unknown" as const,
        note: `只有 ${Math.round(coverage * 100)}% 的记录含有这项数据，先补齐再判断`,
      };
    }
    if (!(target > 0)) {
      return { ...base, ratio: 0, verdict: "unknown" as const, note: "还没有目标值" };
    }

    const ratio = value / target;
    let verdict: NutrientStatus["verdict"];

    if (meta.direction === "atLeast") {
      verdict = ratio >= 1 ? "ok" : ratio >= 0.7 ? "ok" : "low";
      // 够 70% 就算基本达标，避免把「差一点点」说成问题 —— 建议只该指向真正要改的事
    } else if (meta.direction === "atMost") {
      verdict = ratio <= 1 ? "ok" : "high";
    } else {
      const tol = meta.tolerance ?? 0.1;
      verdict = ratio < 1 - tol ? "low" : ratio > 1 + tol ? "high" : "ok";
    }

    return { ...base, ratio, verdict, note: coverageNote(meta.key, intake) };
  });
}

// ---------- 份量解析 ----------

/** 查不到份量规则时的兜底克数（按分类给一个常识值，并在界面标「估算」） */
export const FALLBACK_GRAMS: Record<FoodCategory, number> = {
  staple: 200,
  meat: 150,
  veg: 200,
  protein: 100,
  fruit: 200,
  snack: 50,
  drink: 330,
  soup: 300,
  seasoning: 10,
  alcohol: 330,
};

/**
 * 在份量表里找「这个食物用这个量词」对应多少克。
 *
 * 匹配规则：
 *  - 先按量词精确匹配（「杯」只认「杯」，不认「大杯」）
 *  - 再在 `match` 里做**子串**匹配，命中食物名或任一别名即可
 *  - 同一量词下**先命中先取**，所以特例必须写在通用规则前面
 *
 * 返回值带上是哪条规则命中的，方便界面把依据显示给用户看。
 */
export function resolvePortion(
  table: PortionTable,
  food: Pick<FoodItem, "name" | "alias" | "category">,
  unit: string,
  label?: string,
): { grams: number; portion: FoodPortion; rule: PortionRule } | null {
  const names = [food.name, ...(food.alias ?? [])];
  for (const rule of table.rules) {
    if (rule.unit !== unit) continue;
    if (!rule.match.some((m) => names.some((n) => n.includes(m)))) continue;

    const portion =
      (label ? rule.portions.find((p) => p.label === label || p.label.includes(label)) : undefined) ??
      rule.portions.find((p) => p.isDefault) ??
      rule.portions[0];
    if (!portion) continue;
    return { grams: portion.grams, portion, rule };
  }
  return null;
}

/** 兜底：按分类给克数。返回 0 表示连兜底都没有 */
export function fallbackGrams(food: Pick<FoodItem, "category">): number {
  return FALLBACK_GRAMS[food.category] ?? 0;
}

// ---------- 组装一条记录 ----------

/**
 * 组装一条饮食记录。
 *
 * 刻意把 `id` 与 `createdAt` 作为参数传进来，而不是在这里生成 ——
 * 那样会让这个函数变得不纯（依赖时钟与随机数），不好测。
 * 生成 id 是调用方的事。
 *
 * `grams` 是唯一参与营养计算的值，所以这里由它反推 `amount` 与 `unitLabel` 的展示，
 * 而不是反过来用 `amount × 单位` 去算营养 —— 那份换算只在一个地方做。
 */
export function makeDietEntry(input: {
  id: string;
  createdAt: number;
  date: string;
  time: string;
  mealSlot: MealSlot;
  food?: FoodItem;
  name: string;
  amount: number;
  unitLabel: string;
  grams: number;
  source: DietEntrySource;
}): DietEntry {
  const { food, grams, ...rest } = input;
  const nutrition = food
    ? nutritionOf(food, grams)
    : { kcal: 0, protein: 0, fat: 0, carb: 0 };

  return {
    ...rest,
    foodId: food?.id,
    category: food?.category,
    grams,
    nutrition,
  };
}
