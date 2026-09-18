/**
 * 菜单库菜品的营养估算（纯函数）。
 *
 * 外卖/菜单库里的菜名是用户自己写的（「黄焖鸡米饭（微辣）」），食物库里没有这道菜，
 * 也不可能为每家店建一条 —— 同一道菜在不同店的油、糖、份量能差出一倍。
 * 所以这里只做两件事：尽力把**菜名里的食材**对应到库里，然后**给一个区间，不给一个确定的数**。
 *
 * ⚠️ 一条踩过的路：一开始只把整条菜名匹配到**一种**食物上，结果
 * 「黄焖鸡米饭」匹配到了「米饭」，算出 232 kcal —— 真实的黄焖鸡米饭是这个的两三倍。
 * 一个看起来精确的错数，比一句"估不出来"有害得多。所以现在是**拆食材再求和**：
 * 黄焖鸡米饭 → 鸡 + 米饭。
 *
 * 为什么必须是区间：屏幕上写「黄焖鸡米饭 620kcal」是假精确 ——
 * 用户会拿它当账算，而它跟实际可能差 40%。写「400~840kcal」才是诚实的。
 * 食物库自己的 `source` 里就写着「餐馆做法估算（较家常 +20~40% 油脂）」，
 * 所以区间宽度是照着那句话定的：
 *  - 整条菜名就是库里那条食物的**主名**（「清炒时蔬」）→ ±15%
 *  - 其余情况（拆出多种食材、只命中别名、名字对不上）→ ±35%
 * 拆出来的食材越多，"每样各多少克"越不确定，所以宽区间是对的。
 *
 * ⚠️ **本文件 import 了食物库**（`library.ts` 会带上那份 JSON）。
 */

import { addNutrition, fallbackGrams, nutritionOf, round } from "./core";
import { allFoods, foodById } from "./library";
import type { FoodItem, NutritionValues } from "./types";

/** 菜名匹配的可信度档位 */
export type DishMatchHow = "exact" | "loose";

const SPREAD_EXACT = 0.15;
const SPREAD_LOOSE = 0.35;

/**
 * 菜名里「被认出来的字」低于这个比例就不估了。
 *
 * 这条是被「黄焖鸡米饭」逼出来的：它只能命中「米饭」，算出来 232 kcal ——
 * 而真实的黄焖鸡米饭六百多，**区间上沿都够不着**。这种数比"估不出来"有害得多：
 * 用户会拿它当账算。所以宁可拒绝，让他手动关联一次（关联过一次就记住了）。
 */
const MIN_COVERED = 0.6;

/** 拆出来的一种食材 */
export type DishIngredient = {
  foodId: string;
  foodName: string;
  /** 落在菜名里的那个词（可能是别名） */
  matchedBy: string;
  grams: number;
};

export type MenuNutrition =
  /** 用户手动关联到了库里的一条食物 —— 数字与饮食记录同源 */
  | {
      kind: "linked";
      foodId: string;
      foodName: string;
      grams: number;
      nutrition: NutritionValues;
      basis: string;
    }
  /** 拆食材估出来的区间 */
  | {
      kind: "guess";
      how: DishMatchHow;
      ingredients: DishIngredient[];
      /** 区间半宽（比例）。界面显示「±35%」用 */
      spread: number;
      /** 区间下沿 / 上沿，整数 kcal */
      loKcal: number;
      hiKcal: number;
      /** 区间中点，用于排序与汇总 */
      kcal: number;
      /** 各营养素的中点值，界面必须标成估算 */
      nutrition: NutritionValues;
      basis: string;
    }
  /** 连猜都猜不出来 —— 不编数字 */
  | {
      kind: "none";
      basis: string;
      /**
       * 已经认出来的食材（可能为空）。
       *
       * 这部分**不参与任何数字** —— 它只是给界面用来"一键关联"的线索：
       * 「砂锅米线」我们认出了「米线」，那就把米线摆出来让用户点一下，
       * 而不是让他自己再去搜一遍。不给数字，但把已经知道的事说满。
       */
      recognized: DishIngredient[];
    };

/** 菜单库里一条菜最少要知道这些才能估 */
export type DishLike = {
  name: string;
  /** 用户手动关联的食物 id */
  foodId?: string;
  /** 关联时指定的克数；不给就按分类兜底 */
  grams?: number;
};

/** 去掉「（微辣）」这类括注 —— 它们对营养判断没有信息量，反而会挡住匹配 */
function stripParens(s: string): string {
  return s.replace(/[（(][^）)]*[）)]/g, "").trim();
}

/** 取名字里括号内的限定语：「奶茶（半糖）」→「半糖」 */
function variantHint(n: string): string | null {
  const m = n.match(/[（(]([^）)]*)[）)]/);
  return m ? m[1] : null;
}

/**
 * 糖度近似对照。库里「奶茶」正好有全糖 / 半糖 / 无糖三档，
 * 而用户写的往往是「三分糖」「少糖」这类说法 —— 不映射的话，
 * 「珍珠奶茶（三分糖）」会命中全糖那档，热量直接高估三成以上。
 */
/**
 * 「同名多档」的挑选规则：用户说法里出现某个词，就挑对应的那一档。
 *
 * 原来这张表叫 `SUGAR_SYNONYMS`，只认糖度（奶茶的全糖 / 半糖 / 无糖）。
 * 现在库里有了别的多档食物 —— 红烧肉分肥瘦、蛋炒饭分油多油少 —— 所以泛化成通用的。
 *
 * ⚠️ 只在**同一主名的兄弟**之间挑（见 `preferVariant` 的实现）——
 * 所以「少油」绝不会把一杯奶茶挑成「蛋炒饭（少油）」，
 * 「肥」也不会让「肥牛」跑去命中红烧肉那一组。
 */
const VARIANT_SYNONYMS: { variants: string[]; prefer: string }[] = [
  // 糖度（奶茶）
  { variants: ["无糖", "零糖", "去糖", "0糖"], prefer: "无糖" },
  { variants: ["半糖", "三分糖", "五分糖", "微糖", "少糖"], prefer: "半糖" },
  { variants: ["全糖", "正常糖", "标准糖", "七分糖"], prefer: "全糖" },
  // 肥瘦（红烧肉）
  { variants: ["瘦", "不肥", "精瘦"], prefer: "瘦" },
  { variants: ["肥", "偏肥", "很肥", "带肥"], prefer: "肥" },
  // 用油（蛋炒饭）
  { variants: ["少油", "不油", "清淡"], prefer: "少油" },
  { variants: ["多油", "重油", "油大"], prefer: "多油" },
];

/**
 * 同名多档（「奶茶（全糖）」/「（半糖）」/「（无糖）」）时，按用户写的限定语挑一档。
 * 只在这类**同主名、仅括注不同**的组里挑，不会拿别的东西来顶替。
 */
function preferVariant(food: FoodItem, dishName: string): FoodItem {
  const base = stripParens(food.name);
  const siblings = allFoods().filter((f) => f.id !== food.id && stripParens(f.name) === base);
  if (!siblings.length) return food;
  for (const syn of VARIANT_SYNONYMS) {
    if (!syn.variants.some((v) => dishName.includes(v))) continue;
    const target = siblings.find((f) => (variantHint(f.name) ?? "").includes(syn.prefer));
    if (target) return target;
  }
  return food;
}

type NameHit = { food: FoodItem; matchedBy: string };

/**
 * 在剩下的串里找最长的库名。
 *
 * 必须先长后短：串里同时含「米饭」和某个更短的别名时，要认更具体的完整名词。
 * 单字别名（「鸡」「蛋」）一律不用 —— 命中率太低，容易把整道菜认成另一样。
 */
function longestHit(text: string): NameHit | null {
  let best: NameHit | null = null;
  let bestLen = 0;
  for (const food of allFoods()) {
    for (const candidate of [food.name, ...(food.alias ?? [])]) {
      if (candidate.length < 2) continue;
      if (!text.includes(candidate)) continue;
      if (candidate.length > bestLen) {
        bestLen = candidate.length;
        best = { food, matchedBy: candidate };
      }
    }
  }
  return best;
}

/**
 * 把菜名拆成若干食材：反复取最长的命中，把命中的词从串里挖掉，再找下一个。
 *
 * 挖掉而不是整条匹配，是为了让「番茄鸡蛋米线」能拆出番茄 / 鸡蛋 / 米线三样，
 * 而不是只认到「米线」就把另外两样的热量丢了。
 */
export function splitDishIngredients(rawName: string): DishIngredient[] {
  let rest = stripParens(rawName);
  const out: DishIngredient[] = [];
  const seen = new Set<string>();

  while (rest.length >= 2) {
    const hit = longestHit(rest);
    if (!hit) break;
    // 「奶茶（三分糖）」要认到半糖那档，而不是默认的全糖
    const food = preferVariant(hit.food, rawName);
    // 同一食材出现两次就停，避免「蛋炒蛋」这类名字把循环拖住
    if (seen.has(food.id)) {
      rest = rest.replace(hit.matchedBy, "");
      continue;
    }
    seen.add(food.id);
    out.push({
      foodId: food.id,
      foodName: food.name,
      matchedBy: hit.matchedBy,
      grams: fallbackGrams(food),
    });
    rest = rest.replace(hit.matchedBy, "");
  }
  return out;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/** 只留汉字与字母数字：标点与「套餐」「+」这类连接符不参与「认没认出来」的判断 */
function meaningfulChars(s: string): string[] {
  return [...s].filter((c) => /[\u4e00-\u9fa5a-zA-Z0-9]/.test(c));
}

/** 被认出来的字占比。用来判断这条菜名到底拆干净了没有 */
function coveredRatio(dishName: string, ingredients: readonly DishIngredient[]): number {
  const chars = meaningfulChars(stripParens(dishName));
  if (!chars.length) return 0;
  const matched = ingredients.reduce((n, i) => n + meaningfulChars(i.matchedBy).length, 0);
  return Math.min(1, matched / chars.length);
}

/**
 * 给一条菜单菜估营养。
 *
 * 刻意**不接收**调用方传来的任何营养数值：数字只有两条合法来路 ——
 * 用户关联的 foodId 查表，或菜名拆出的食材查表，两条都走 `nutritionOf`。
 */
export function estimateDish(dish: DishLike): MenuNutrition {
  // 1) 用户关联过的，优先 —— 这是他自己的判断，比机器猜的可信
  if (dish.foodId) {
    const food = foodById(dish.foodId);
    if (food) {
      const grams = dish.grams && dish.grams > 0 ? dish.grams : fallbackGrams(food);
      return {
        kind: "linked",
        foodId: food.id,
        foodName: food.name,
        grams,
        nutrition: nutritionOf(food, grams),
        basis: `按你关联的「${food.name}」${fmt(grams)}g 算的`,
      };
    }
  }

  // 2) 拆菜名里的食材
  const ingredients = splitDishIngredients(dish.name);
  if (!ingredients.length) {
    return {
      kind: "none",
      basis: `库里没有能和「${dish.name}」对上的食材，估不出来`,
      recognized: [],
    };
  }

  // 拆不干净就干脆不估：漏掉的那几样只会让真实值更高，给个够不着的区间是骗人
  const covered = coveredRatio(dish.name, ingredients);
  if (covered < MIN_COVERED) {
    const found = ingredients.map((i) => `「${i.foodName}」`).join("、");
    return {
      kind: "none",
      basis: `只认出${found}，菜名剩下的部分没法对上库里的食物，怕估少了就不估了 —— 下面点一下就能关联`,
      recognized: ingredients,
    };
  }

  const nutrition = ingredients.reduce<NutritionValues>(
    (acc, ing) => {
      const food = foodById(ing.foodId);
      return food ? addNutrition(acc, nutritionOf(food, ing.grams)) : acc;
    },
    { kcal: 0, protein: 0, fat: 0, carb: 0 },
  );

  // 整条菜名就等于库里某条食物的**主名**时，可信度最高（「清炒时蔬」）。
  // 命中别名不算 —— 比如「珍珠奶茶」命中「奶茶（全糖）」，名字对不上，
  // 配方多半也就对不上，那种情况必须给宽区间。
  const cleaned = stripParens(dish.name);
  const exact = ingredients.length === 1 && cleaned === ingredients[0].foodName;
  const how: DishMatchHow = exact ? "exact" : "loose";
  const spread = exact ? SPREAD_EXACT : SPREAD_LOOSE;

  const parts = ingredients.map((i) => `「${i.foodName}」${fmt(i.grams)}g`).join(" + ");
  return {
    kind: "guess",
    how,
    ingredients,
    spread,
    loKcal: Math.round(nutrition.kcal * (1 - spread)),
    hiKcal: Math.round(nutrition.kcal * (1 + spread)),
    kcal: Math.round(nutrition.kcal),
    nutrition,
    basis:
      how === "exact"
        ? `按库里的${parts}估，同名的菜各家做法不同`
        : `按${parts}估，每样各多少、怎么做的都得看那家店`,
  };
}

/** 区间文案。`±15%` 与 `400~840 kcal` 一起给 —— 前者说可信度，后者是能被记住的数 */
export function describeEstimate(m: MenuNutrition): string {
  if (m.kind === "none") return m.basis;
  if (m.kind === "linked") return `${Math.round(m.nutrition.kcal)} kcal · 已关联`;
  const pct = Math.round(m.spread * 100);
  return `${m.loKcal}~${m.hiKcal} kcal（±${pct}%）`;
}

/** 汇总一批菜。`unknown` 是估不出来的条数 —— 界面必须说出来，不能当 0 */
export function sumEstimates(list: readonly MenuNutrition[]): {
  loKcal: number;
  hiKcal: number;
  known: number;
  unknown: number;
} {
  let lo = 0;
  let hi = 0;
  let known = 0;
  let unknown = 0;
  for (const m of list) {
    if (m.kind === "none") {
      unknown += 1;
      continue;
    }
    known += 1;
    if (m.kind === "linked") {
      const k = Math.round(m.nutrition.kcal);
      lo += Math.round(k * (1 - SPREAD_EXACT));
      hi += Math.round(k * (1 + SPREAD_EXACT));
    } else {
      lo += m.loKcal;
      hi += m.hiKcal;
    }
  }
  return { loKcal: round(lo, 0), hiKcal: round(hi, 0), known, unknown };
}
