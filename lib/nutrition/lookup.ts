/**
 * 合并检索 —— 内置库 + 用户自己的「我的食物库」。全部是纯函数。
 *
 * 纪律（与 `core.ts` / `library.ts` 同款）：
 *
 * 1. **不碰 localStorage、不碰 UI、不 import 食物库 JSON。**
 *    用户库的数组由调用方传进来（`extra`）。这样这一层能在 Node 里被单测，
 *    也让"库存只从一处来"这条纪律继续成立。
 *
 * 2. **判据只能有一份**（AGENTS 地雷 29）。打分、排序、去重规则**完全复用**
 *    `library.ts` 的 `bestNameMatch` / `normalize` —— 这里一行匹配逻辑都不新写。
 *    历史上正是因为"同一个判据两边各写一遍"漂移过，让整个食物库闸门
 *    **全绿却失效**过一次：闸门查的是 A 判据，界面用的是 B 判据，两边早就不是一回事了。
 *
 * 3. **`extra` 为空时行为与直接调内置库完全一致。** 这条保证了接入用户库
 *    不会把原有搜索体验改掉一丝一毫 —— 没加过自定义食物的用户感觉不到这次改动。
 *
 * 为什么需要它：内置库是**构建期资产**（打进 bundle 的 JSON），运行时改不了；
 * 用户拍的照片、手输的数值必须住在一个能写的地方（`recipe.customFoods.v1`）。
 * 两者在**检索时**合并、在**存储上**分开 —— 这样"清空我的食物库"碰不到内置库，
 * 升级版本也不会把用户的东西冲掉。
 */

import {
  allFoods,
  bestNameMatch,
  foodById,
  foodsByCategory,
  normalize,
} from "./library";
import type { FoodCategory, FoodItem } from "./types";

/**
 * 排序的比较器。**与 `searchFoods` 逐字一致**：
 * 分数降序 → 同分短名优先 → 按 id 定序（保证结果稳定，不会两次搜出不同顺序）。
 *
 * 提出来单独写，是为了让"合并"与"不合并"两条路走同一个排序 ——
 * 而不是让调用方各自复制一遍比较逻辑。
 */
function byScoreThenNameThenId(
  a: { food: FoodItem; score: number },
  b: { food: FoodItem; score: number },
): number {
  return (
    b.score - a.score ||
    a.food.name.length - b.food.name.length ||
    (a.food.id < b.food.id ? -1 : 1)
  );
}

/** 按 id 去重，保留先出现的那条（内置在前 → 内置优先） */
function dedupe(foods: readonly FoodItem[]): FoodItem[] {
  const seen = new Set<string>();
  const out: FoodItem[] = [];
  for (const f of foods) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  return out;
}

/**
 * 在「内置库 + 用户库」里搜。
 *
 * 实现上**不用** `searchFoods()`：它在内部就截断到 `limit` 了，两个库各自截断
 * 会让「用户加了 20 条以后内置库全被挤出去」。这里把两边都按同一判据打分、
 * **合并后统一排序再截断**，这才是"合并检索"该有的语义。
 *
 * @param extra 用户自己的食物（`loadCustomFoods()` 的返回值）。空数组时结果与 `searchFoods` 一致
 * @param limit 上限
 */
export function searchAllFoods(
  query: string,
  extra: readonly FoodItem[],
  limit = 20,
): FoodItem[] {
  const q = normalize(query);
  if (!q) return [];

  const scored: { food: FoodItem; score: number }[] = [];
  // 两边走**同一个** bestNameMatch —— 判据只有一份
  for (const food of dedupe([...allFoods(), ...extra])) {
    const best = bestNameMatch(food, q).score;
    if (best > 0) scored.push({ food, score: best });
  }

  scored.sort(byScoreThenNameThenId);
  return scored.slice(0, limit).map((x) => x.food);
}

/**
 * 按 id 找食物：先内置、再用户库。
 *
 * 为什么要这个：已记的账里存的是 `foodId`，那条账可能在**两个库**里。
 * 只用 `foodById` 的话，用户自己加的食物的历史记录会**静默查不到** ——
 * 日列表里那一行会变成"库里没有"，而它明明就在用户自己的库里。
 */
export function findFoodByIdIn(
  id: string | undefined,
  extra: readonly FoodItem[],
): FoodItem | undefined {
  if (!id) return undefined;
  // 用户条目的 id 带 `user-` 前缀，先按前缀走快路径；
  // 但不把前缀当**判断依据** —— 不匹配就去用户库里老实 find 一遍。
  if (id.startsWith("user-")) return extra.find((f) => f.id === id);
  return extra.find((f) => f.id === id) ?? foodById(id);
}

/** 全部食物（内置 + 用户）。顺序：内置在前，用户库在后，各自保持原有顺序 */
export function allFoodsIn(extra: readonly FoodItem[]): FoodItem[] {
  return dedupe([...allFoods(), ...extra]);
}

/**
 * 按分类浏览：内置 + 用户库一并列出。
 *
 * 分类页是"我不知道叫什么、就想翻一翻"的入口 —— 如果用户加了食物却在分类页里
 * 看不到它，那他下次还得搜名字才找得到，等于白加。
 */
export function foodsByCategoryIn(
  category: FoodCategory,
  extra: readonly FoodItem[],
): FoodItem[] {
  return dedupe([...foodsByCategory(category), ...extra.filter((f) => f.category === category)]);
}
