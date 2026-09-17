/**
 * 「今天还该吃点啥」（纯函数）。
 *
 * 与 `advice.ts` 的分工：advice 说**今天哪一项偏了**，这里说**下一口吃什么能补回来**。
 * 两者都只算事实、只输出带数字的句子 —— 措辞交给界面，不交给模型。
 *
 * 三条自律：
 * 1) **没有缺口就不推。** 今天都达标了还给一堆"建议"，是把达标变成新的焦虑。
 *    这种情况返回空数组，界面显示"今天不用特意补"。
 * 2) **推的东西必须真的对得上缺口。** 每一份候选都拿同一组缺口权重去打分，
 *    推出来的是"对上最多"的那几个，不是随机挑几个健康的。理由里要写清对上的是哪一项、
 *    大概补多少 —— 这一条让推荐可以被检验。
 * 3) **忌口优先于分数。** 命中忌口的一律剔除，不管它多能补。
 *
 * 候选有两个来源：用户自己的菜单库（他真会点这些）+ 食物库（覆盖面全）。
 * 菜单库里估不出成分的菜不参与打分 —— 算不出它补什么，就没法说它是"对上缺口的"。
 */

import type { TakeoutDish } from "../types";
import { describeGaps } from "./advice";
import { fallbackGrams, nutritionOf } from "./core";
import { allFoods, foodById } from "./library";
import { estimateDish } from "./menu";
import type { NutritionTargets, NutritionTotals } from "./types";

export type Suggestion = {
  /** 展示名：一道菜或一种食物 */
  label: string;
  from: "menu" | "food";
  /** 对上的缺口 */
  gapKey: string;
  gapLabel: string;
  /** 这一份大概多少热量。菜单来源的估算是区间，所以一并带上 */
  kcal: number;
  loKcal: number;
  hiKcal: number;
  /** 一句话说清为什么推它，带数字 */
  reason: string;
  score: number;
  foodId: string;
  /** 菜单来源才有 */
  dish?: TakeoutDish;
};

/** 各项缺口归一成 0~1 的权重：越是当下偏得多的项，越该被优先补上 */
function gapWeights(totals: NutritionTotals, targets: NutritionTargets): Map<string, number> {
  const w = new Map<string, number>();
  for (const g of describeGaps({ totals, targets })) {
    if (g.unknown || g.ratio <= 0 || g.target <= 0) continue;
    // 超标型（atMost）只有真超了才算缺口；不足型（atLeast）缺多少算多少。
    // 除以 target 是为了得到无量纲的「偏了百分之多少」——
    // 钠是 mg、纤维是 g，不归一化的话钠会把其它项全压掉。
    if (g.direction === "atMost") {
      if (g.remaining < 0) w.set(g.key, Math.min(1, -g.remaining / g.target));
    } else if (g.remaining > 0) {
      w.set(g.key, Math.min(1, g.remaining / g.target));
    }
  }
  return w;
}

type Candidate = {
  label: string;
  from: "menu" | "food";
  foodId: string;
  kcal: number;
  loKcal: number;
  hiKcal: number;
  protein: number;
  fiber: number;
  sodium: number;
  /** 是蔬果类 */
  isVegFruit: boolean;
  dish?: TakeoutDish;
};

function candidateFromFood(foodId: string): Candidate | null {
  const food = foodById(foodId);
  if (!food) return null;
  const grams = fallbackGrams(food);
  if (!grams) return null;
  const n = nutritionOf(food, grams);
  return {
    label: food.name,
    from: "food",
    foodId: food.id,
    kcal: Math.round(n.kcal),
    loKcal: Math.round(n.kcal),
    hiKcal: Math.round(n.kcal),
    protein: n.protein,
    fiber: n.fiber ?? 0,
    sodium: n.sodium ?? 0,
    isVegFruit: food.category === "veg" || food.category === "fruit",
  };
}

function candidateFromDish(dish: TakeoutDish): Candidate | null {
  const m = estimateDish(dish);
  if (m.kind === "none") return null;
  const kcal = Math.round(m.nutrition.kcal);
  return {
    label: dish.name,
    from: "menu",
    foodId: m.kind === "linked" ? m.foodId : m.ingredients[0].foodId,
    kcal,
    loKcal: m.kind === "linked" ? Math.round(kcal * 0.85) : m.loKcal,
    hiKcal: m.kind === "linked" ? Math.round(kcal * 1.15) : m.hiKcal,
    protein: m.nutrition.protein,
    fiber: m.nutrition.fiber ?? 0,
    sodium: m.nutrition.sodium ?? 0,
    isVegFruit: false,
    dish,
  };
}

/** 菜单来源的加成倍数，见下面 `scored` 里的说明 */
const MENU_BONUS = 1.3;

/** 单项契合度：越小越好的项（kcal/钠）反过来算，越大越好的项（纤维/蛋白）直接比 */
function fitFor(key: string, c: Candidate, overAmount: number, shortAmount: number): number {
  switch (key) {
    case "kcal":
      // 已经超了：这一份的热量最好别把余量之外的部分推得更大
      return overAmount > 0 ? Math.max(0, 1 - c.kcal / (overAmount + 400)) : 0;
    case "sodium":
      return 1 / (1 + c.sodium / 400);
    case "fiber":
      return shortAmount > 0 ? Math.min(1, c.fiber / (shortAmount * 0.5)) : 0;
    case "protein":
      return shortAmount > 0 ? Math.min(1, c.protein / (shortAmount * 0.5)) : 0;
    case "veg":
      return c.isVegFruit ? 1 : 0.15;
    default:
      return 0;
  }
}

/** 一项缺口对应的一句人话。界面直接用，不再润色 —— 数字都在里面 */
function reasonFor(key: string, label: string, c: Candidate, gaps: ReturnType<typeof describeGaps>): string {
  const g = gaps.find((x) => x.key === key);
  const amount = g ? Math.abs(Math.round(g.remaining)) : 0;
  const unit = g?.unit ?? "";
  switch (key) {
    case "kcal":
      return `今天热量已经超了，这一份大约 ${c.kcal} kcal，比你刚才吃的那几样轻`;
    case "sodium":
      return `今天钠超了 ${amount}${unit}，这一份钠大约 ${Math.round(c.sodium)}${unit}，算轻的`;
    case "fiber":
      return `今天纤维还差 ${amount}${unit}，这一份能补上约 ${c.fiber.toFixed(1)}${unit}`;
    case "protein":
      return `今天蛋白还差 ${amount}${unit}，这一份能补上约 ${c.protein.toFixed(1)}${unit}`;
    case "veg":
      return "今天蔬果基本没吃到，这一份是蔬果类的";
    default:
      return `${label}还差 ${amount}${unit}`;
  }
}

/**
 * 按今日缺口挑几样。没有明显缺口时返回空数组 —— 不硬凑。
 */
export function suggestForGaps(input: {
  totals: NutritionTotals;
  targets: NutritionTargets;
  /** 用户菜单库；其中估不出成分的会被跳过 */
  menuDishes?: readonly TakeoutDish[];
  /** 要避开的标签（健康档案的忌口 + 菜自己的 avoidConflicts） */
  avoid?: readonly string[];
  limit?: number;
}): Suggestion[] {
  const { totals, targets, menuDishes = [], avoid = [], limit = 3 } = input;
  if (!totals.entries) return [];

  const weights = gapWeights(totals, targets);
  if (!weights.size) return []; // 都达标了，不推

  const gaps = describeGaps({ totals, targets });
  const gapKeys = [...weights.keys()];

  const candidates: Candidate[] = [];
  for (const dish of menuDishes) {
    const conflicts = dish.avoidConflicts.filter((a) => avoid.includes(a));
    if (conflicts.length) continue; // 忌口优先于分数
    const c = candidateFromDish(dish);
    if (c) candidates.push(c);
  }
  for (const food of allFoods()) {
    if (food.category === "alcohol") continue;
    if (avoid.some((a) => food.name.includes(a))) continue;
    const c = candidateFromFood(food.id);
    if (c) candidates.push(c);
  }

  const scored = candidates.map((c) => {
    let score = 0;
    let bestKey = gapKeys[0];
    let bestContrib = -1;
    for (const key of gapKeys) {
      const g = gaps.find((x) => x.key === key);
      const over = g && g.direction === "atMost" ? Math.max(0, -g.remaining) : 0;
      const short = g && g.direction !== "atMost" ? Math.max(0, g.remaining) : 0;
      const part = (weights.get(key) ?? 0) * fitFor(key, c, over, short);
      score += part;
      if (part > bestContrib) {
        bestContrib = part;
        bestKey = key;
      }
    }
    // 菜单库的菜优先：推他真会点的东西，比推一份库里随便什么食物更有用。
    // 30% 是"表达偏好"而不是"盖过契合度"——对不上缺口的菜仍然赢不过对得上的。
    const total = c.from === "menu" ? score * MENU_BONUS : score;
    return { c, score: total, bestKey };
  });

  scored.sort((a, b) => b.score - a.score || a.c.kcal - b.c.kcal);

  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const { c, score, bestKey } of scored) {
    if (out.length >= limit) break;
    if (score <= 0) break;
    // 同一种食物不要连出两条（食物库与菜单库可能指着同一样）
    const key = `${c.from}:${c.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const g = gaps.find((x) => x.key === bestKey);
    out.push({
      label: c.label,
      from: c.from,
      gapKey: bestKey,
      gapLabel: g?.label ?? bestKey,
      kcal: c.kcal,
      loKcal: c.loKcal,
      hiKcal: c.hiKcal,
      reason: reasonFor(bestKey, g?.label ?? bestKey, c, gaps),
      score,
      foodId: c.foodId,
      dish: c.dish,
    });
  }
  return out;
}
