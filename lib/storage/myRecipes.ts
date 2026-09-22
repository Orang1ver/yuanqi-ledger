/**
 * 我的菜谱 —— 用户自己组合出来的菜（`MyRecipe[]`，键 `recipe.myRecipes.v1`）。
 *
 * ⚠️ **为什么与「我的食物库」分开，而不是塞进 `customFoods`。**
 * `FoodItem` 是"一种食材 / 一份成品"，一行数据就说完；而一道自做饭菜是
 * **若干食材按克数组合**、再除以成品重量的一张表。硬塞进 `FoodItem` 只能把配方
 * 写成字符串塞进 `source`，于是每处想用它的人都得解析一遍 —— 那才是真的"每处都要多认一个概念"。
 * 判据与 `FoodItem.sugar` 那次破例同一条：能塞进既有字段的是元信息，塞不进去的是新东西。
 *
 * ⚠️ **形状刻意照 `data/foodRecipes.json` 的 `{ foodId, yieldG, parts: [{ foodId, grams }] }`。**
 * 理由不是好看：将来某道自做饭菜"申请进正式库"时，它能**直接**喂进
 * `scripts/check-food-reference.mjs` 的重算逻辑（那套逻辑喂的是同一种形状），
 * 不必再造第二种配方表示 —— 两份表示必然各自漂移。
 *
 * ⚠️ **本文件不许 import 食物库 JSON**（同 `customFoods.ts:4` 与 `diet.ts` 的理由）：
 * 那份 JSON 有几百条数据，牵进来就会被塞进**每一个**用到本模块的页面。
 * 配料怎么查是**调用方**的事（按 `foodId` 传一个 `byId` 进来，见 `lib/nutrition/recipe.ts`）。
 */

import { v4 as uuid } from "uuid";
import { KEYS } from "./keys";
import { readJSON, writeJSON } from "./io";

/** 一道自做饭菜。字段与 `data/foodRecipes.json` 的条目同形，只多一个 `id` 与时间戳 */
export type MyRecipe = {
  /** `recipe-<uuid>`。前缀让"这条是自做饭菜"在数据层面就看得出来 */
  id: string;
  name: string;
  /** 成品重量（g）。默认 = 配料总重，允许用户改 */
  yieldG: number;
  /** 配料：库里的一条食物 + 下锅前的克数 */
  parts: { foodId: string; grams: number }[];
  createdAt: number;
  note?: string;
};

/**
 * 上限。到顶就拒绝新增并报错，而不是**悄悄丢掉最旧的一条**。
 *
 * 200 这个数的来路：菜谱比食物大得多（一道菜十来行配料），一份序列化后约 700~1500 字节，
 * 200 份 ≈ 200KB，离 localStorage 常见的 5MB 配额还很远，但它已经远超
 * "一个人自己会做的菜"的合理规模 —— 到这儿还没到顶说明用法出问题了。
 */
export const MY_RECIPES_LIMIT = 200;

export function loadMyRecipes(): MyRecipe[] {
  return readJSON<MyRecipe[]>(KEYS.myRecipes, []);
}

/** 存储满 / 隐私模式禁用存储时抛这个，让 UI 能说人话 */
export class MyRecipeStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MyRecipeStorageError";
  }
}

/**
 * 写入。**显式检查写没写进去** —— `writeJSON` 是静默失败的
 * （见 `io.ts` 注释：quota 满 / 隐私模式下 catch 掉不打断用户）。
 * 对着数据来说，静默失败是**最坏**的结果：用户以为存上了，关掉再打开就没了。
 * 所以这里写完再读回来比一次，确认真的落盘了。
 *
 * ⚠️ **比的是内容，不是长度。** `customFoods.ts` 那边比长度够用（它只有增删两种动作，
 * 条数一定会变），而这里多了**改**：改一条菜谱条数不变，于是"读回来长度一样"
 * 根本不代表写进去了 —— 用户改完配方以为存上了，下次打开还是旧的那份。
 * 这正是本模块最忌讳的静默失败，所以判据收紧成逐条对内容。
 * （对象键序稳定：`back` 是从我们自己写下去的 JSON 解析回来的，与 `list` 同序。）
 */
function persist(list: MyRecipe[]): void {
  writeJSON(KEYS.myRecipes, list);
  const back = readJSON<MyRecipe[]>(KEYS.myRecipes, []);
  if (JSON.stringify(back) !== JSON.stringify(list)) {
    throw new MyRecipeStorageError(
      "这个菜谱没能存进本机 —— 存储空间可能满了（或浏览器处于隐私模式）。" +
        "可以先到「设置」里导出备份，再删掉一些不用的菜谱。",
    );
  }
}

/**
 * 新增一道菜谱。`id` 与 `createdAt` 在这里生成（调用方传了就按传的来，方便测试）。
 *
 * 刻意**不做名字查重**：与食物不同，同名菜谱是正常的（"西红柿炒鸡蛋"少放糖、多放蛋
 * 就是另一张配方），而且配方差在哪只有用户自己知道 —— 拦下来等于逼他起名字。
 *
 * @throws {MyRecipeStorageError} 到上限、或存不进去
 */
export function addMyRecipe(
  r: Omit<MyRecipe, "id" | "createdAt"> & { id?: string; createdAt?: number },
): { list: MyRecipe[]; added: MyRecipe } {
  const list = loadMyRecipes();
  if (list.length >= MY_RECIPES_LIMIT) {
    throw new MyRecipeStorageError(
      `「我的菜谱」最多放 ${MY_RECIPES_LIMIT} 份，已经满了。先删掉一些不用的，再加新的。`,
    );
  }

  const added: MyRecipe = {
    ...r,
    id: r.id ?? `recipe-${uuid()}`,
    createdAt: r.createdAt ?? Date.now(),
  };
  const next = [...list, added];
  persist(next);
  return { list: next, added };
}

/** 改一份。`id` 与 `createdAt` 不动（改了会让已记的账指不过来 / 丢时间）。 */
export function updateMyRecipe(id: string, patch: Partial<MyRecipe>): MyRecipe[] {
  const list = loadMyRecipes();
  const next = list.map((r) =>
    r.id === id ? { ...r, ...patch, id: r.id, createdAt: r.createdAt } : r,
  );
  persist(next);
  return next;
}

export function removeMyRecipe(id: string): MyRecipe[] {
  const next = loadMyRecipes().filter((r) => r.id !== id);
  persist(next);
  return next;
}

/** 按 id 取一份。找不到返回 `undefined`（不是抛错 —— 调用点多半是要展示，不是要崩） */
export function myRecipeById(id: string): MyRecipe | undefined {
  return loadMyRecipes().find((r) => r.id === id);
}
