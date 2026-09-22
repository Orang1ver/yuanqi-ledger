/**
 * 自做饭菜的折算 —— **全部是纯函数**。
 *
 * 纪律（与 `core.ts` / `lookup.ts` 同款，破坏任何一条都会让数字变成幻觉）：
 *
 * 1. **不 import UI / Next / localStorage。** 本文件只在类型上用一下 `MyRecipe`
 *    （`import type`，编译后完全擦掉，不会把数据层的 localStorage 牵进来）。
 *    这样它能在 Node 里被单测 —— 而"一道菜算出多少热量"恰恰最该被测试覆盖。
 *
 * 2. **加权求和只用 `core.ts` 的 `nutritionOf` + `addNutrition`，不写第二套乘法。**
 *    每 100g 那一步也走既有的 `scaleNutrition`（值是 ÷ 成品重量 × 100，不是 `grams / 100 * k`）。
 *    一句话：**这个文件里一次 `* k` 都不该出现。** 有的话就是"数字出现了第二条来路"。
 *
 * 3. **找不到的配料不猜、不静默吞掉。** 该条按 0 计入，并把 `foodId` 回报给调用方 ——
 *    界面据此显示「有 N 个配料失效了，请重新选」。宁可让用户去修，
 *    也不要拿一份少了主料的热量当成这顿饭的数。
 */

import type { MyRecipe } from "../storage/myRecipes";
import { addNutrition, nutritionOf, scaleNutrition } from "./core";
import type { FoodCategory, FoodItem, NutritionValues } from "./types";

/**
 * 折算出来的食物条目的 `source`。
 * 明确写出**它不是抄来的** —— 这一点很重要：库里其余 200 多条都有各自的具体出处
 * （包装营养表、官方成分表…），而这一条是"照你的配料与成品重量现算的"。
 */
export const RECIPE_SOURCE = "自做饭菜（按配料与成品重量折算）";

/** 查配料用的函数。刻意**传进来**而不是在这里 import 食物库 —— 见文件头第 1 条 */
export type FoodLookup = (id: string) => FoodItem | undefined;

/**
 * 配料总重 —— 成品重量（`yieldG`）的默认值。
 *
 * 非法克数按 0 计（不是抛错）：用户正在输入时 `""` 会临时变成 NaN，
 * 那一刻整道菜的合计不该炸，只该少算那一行。
 */
export function totalPartsGrams(r: Pick<MyRecipe, "parts">): number {
  return r.parts.reduce((sum, p) => sum + (Number.isFinite(p.grams) && p.grams > 0 ? p.grams : 0), 0);
}

/**
 * 按配料加权求和 —— 「这道菜的配料一共含多少」。
 *
 * ⚠️ 这个数是**下锅前**的总量，不是你能吃到的量（煮了会缩水、汤会留在锅里）。
 * 所以它只用来当 `yieldG` 的默认值，不进任何展示口径。
 */
export function recipeTotals(
  r: MyRecipe,
  byId: FoodLookup,
): { values: NutritionValues; missing: string[] } {
  // 从零开始加：`addNutrition` 对"两边都没标"的营养素给 undefined，
  // 所以起点不能写成 `{ kcal:0, ..., sugar: 0 }` —— 那会把"没数据"变成 0。
  let values: NutritionValues = { kcal: 0, protein: 0, fat: 0, carb: 0 };
  const missing: string[] = [];

  for (const p of r.parts) {
    const food = byId(p.foodId);
    if (!food) {
      // 该条按 0 计，但**必须回报** —— 少一样主料照样"算得出数字"，那才是最难发现的错
      missing.push(p.foodId);
      continue;
    }
    values = addNutrition(values, nutritionOf(food, p.grams));
  }

  return { values, missing };
}

/**
 * 折算成**每 100g 成品**的数值 —— 这是唯一能进账本的口径。
 *
 * `yieldG` 非法（≤0 / 非数字 / 非有限）时返回 `null`：**不许拿它去除**。
 * 除一个 0 会得到 `Infinity`，它一路走到界面上就是「∞ kcal」或「NaN」，
 * 而那种数会写进用户的账本快照里 —— 到那时谁也说不清当初发生了什么。
 *
 * ⚠️ 判据必须是 `Number.isFinite` 而不只是 `> 0`：`Infinity > 0` 是**真**，
 * 于是 `100 / Infinity = 0` 会把整道菜静默折成"每 100g 全 0 热量"——
 * 一个看起来完全正常、却根本不对的数字（2026-09-22 由单测抓到）。
 */
export function recipePer100(
  r: MyRecipe,
  byId: FoodLookup,
): { per100: NutritionValues; missing: string[] } | null {
  if (!Number.isFinite(r.yieldG) || r.yieldG <= 0) return null;
  const { values, missing } = recipeTotals(r, byId);
  // 走既有的 scaleNutrition（值 × 100 ÷ 成品重量），不是另写一次 per-100g 折算
  return { per100: scaleNutrition(values, 100 / r.yieldG), missing };
}

/**
 * 这道菜的"类"，按**贡献热量最大的那样配料**定。
 *
 * 为什么需要一个类：`FoodItem.category` 是必填，而质量分的「蔬果」那一维是按分类算供能占比的 ——
 * 分类定错会直接改分数。为什么不随手写死一个（比如一律"荤菜"）：
 * 那会把"清炒时蔬"也记成荤菜，于是自己做的菜**永远不给蔬果加分**，
 * 而用户明明吃了两盘青菜。
 *
 * 为什么按**热量**而不是按重量或按条数：那一维本来就是热量口径的，
 * 按热量匹类才内部一致（三斤白菜的热量也比不过一勺油，这是对的）。
 *
 * ⚠️ 这是**折算**、不是判定"这道菜是什么"。所以「展开成多条」那条路不用它 ——
 * 那条路上每样配料各自带着自己真实的分类进账本，比这里准。这条只服务于「合成一条」。
 */
function dominantCategory(r: MyRecipe, byId: FoodLookup): FoodCategory {
  let best: { category: FoodCategory; kcal: number } | null = null;
  for (const p of r.parts) {
    const food = byId(p.foodId);
    if (!food) continue;
    const kcal = nutritionOf(food, p.grams).kcal;
    if (!best || kcal > best.kcal) best = { category: food.category, kcal };
  }
  // 一样配料都查不到时兜「荤菜」：宁可让蔬果那一维**少给分**，
  // 也不要凭空给一份自己都不知道是什么的东西加上蔬果的分。
  // （实际上这条路走不到 —— 有配料失效时界面根本不允许「合成一条」。）
  return best?.category ?? "meat";
}

/**
 * 造一个**能当记账来源**的 `FoodItem`（每 100g 口径，id 复用菜谱 id）。
 *
 * 它存在的意义是：`recordDietEntry({ food })` 这条链只认 `FoodItem`，
 * 而数值必须由 `nutritionOf` 从那一次乘法算出来。所以这里把"每 100g 的折算结果"
 * 包成一个 `FoodItem`，账本的数值来路就仍然只有一条。
 *
 * 返回 `null` 表示**折不出来**（成品重量非法）—— 调用方必须据此拒绝记账，
 * 而不是自己凑一个数。
 */
export function recipeToFoodItem(r: MyRecipe, byId: FoodLookup): FoodItem | null {
  const per = recipePer100(r, byId);
  if (!per) return null;
  const { per100 } = per;

  return {
    id: r.id,
    name: r.name,
    category: dominantCategory(r, byId),
    unit: "g",
    kcal: per100.kcal,
    protein: per100.protein,
    fat: per100.fat,
    carb: per100.carb,
    // 「没标」就**不写这个键**，保持对象干净（同 FoodPhotoSheet 的做法）——
    // 写 0 会被下游当成"这条标了 0"（地雷 11）
    ...(per100.sodium === undefined ? {} : { sodium: per100.sodium }),
    ...(per100.fiber === undefined ? {} : { fiber: per100.fiber }),
    ...(per100.sugar === undefined ? {} : { sugar: per100.sugar }),
    source: RECIPE_SOURCE,
  };
}
