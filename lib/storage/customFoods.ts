/**
 * 我的食物库 —— 用户自己加的食物（`FoodItem[]`，键 `recipe.customFoods.v1`）。
 *
 * ⚠️ **本文件不许 import 食物库 JSON**（`data/foods.zh.json`）。
 * 理由与 `diet.ts` 同款：那份 JSON 有几百条数据，一旦牵进来就会被塞进
 * **每一个**用到它的页面的 bundle。用户加的东西是**运行时数据**，
 * 与构建期的内置库本来就是两回事。两者在检索层合并（`lib/nutrition/lookup.ts`）。
 *
 * 三条刻意的选择：
 *
 * 1) **复用 `FoodItem`，不新增字段。** 数值来源全靠 `source` 字符串表达 ——
 *    "拍照读出来的"和"用户手输的"都记在 `source` 里，这样整条记账链
 *    （`recordDietEntry` → `nutritionOf`）不需要任何改动就知道该怎么处理它。
 *    多开一个字段意味着下游每一处都要多认一个概念，而收益只是让 UI 少读一行字符串。
 *
 * 2) **id 带 `user-` 前缀。** 内置库的 id 是手写短词（`yezhi`、`latte`），
 *    前缀让"这条是用户自己加的"在**数据层面**就看得出来，不用回头查另一个库。
 *    也顺手保证了与内置 id 不会撞车。
 *
 * 3) **去重按归一化名字**（去空白 + 小写，照 `library.ts` 的 `normalize`）。
 *    但这里**不自己实现一份 normalize** —— 那份判据只能有一处（地雷 29），
 *    所以从 `library.ts` 导入。注意导入的是**纯函数**，不会把 JSON 牵进来。
 */

import { v4 as uuid } from "uuid";
import type { FoodItem } from "../nutrition/types";
// ⚠️ 只导 `normalize` 这一个**纯函数**，不是整库 JSON ——
// 它住在 library.ts 里但本身不碰 JSON，把它复用过来不会牵进几百条数据。
import { normalize } from "../nutrition/library";
import { KEYS } from "./keys";
import { readJSON, writeJSON } from "./io";

/**
 * 上限。到顶就拒绝新增并报错，而不是**悄悄丢掉最旧的一条** ——
 * 用户加的东西删哪条都是错的，只能让他自己决定。
 *
 * 500 这个数的来路：一条 FoodItem 序列化后约 200~300 字节，
 * 500 条 ≈ 150KB，离 localStorage 常见的 5MB 配额还差得远，
 * 但它已经远超"一个人自己会加的食物"的合理规模 ——
 * 到这儿还没到顶说明用法出问题了（比如误把整库导进来）。
 */
export const CUSTOM_FOODS_LIMIT = 500;

/** 名字查重的键：正式名 + 全部别名，任意一个撞上就算重复 */
function nameKeys(food: Pick<FoodItem, "name" | "alias">): string[] {
  return [food.name, ...(food.alias ?? [])].map(normalize).filter(Boolean);
}

export function loadCustomFoods(): FoodItem[] {
  return readJSON<FoodItem[]>(KEYS.customFoods, []);
}

/** 存储满 / 隐私模式禁用存储时抛这个，让 UI 能说人话 */
export class CustomFoodStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomFoodStorageError";
  }
}

/**
 * 写入。**显式检查写没写进去** —— `writeJSON` 是静默失败的
 * （见 `io.ts` 注释：quota 满 / 隐私模式下 catch 掉不打断用户）。
 * 对着数据来说，静默失败是**最坏**的结果：用户以为存上了，关掉再打开就没了。
 * 所以这里写完再读回来比一次，确认真的落盘了。
 */
function persist(list: FoodItem[]): void {
  writeJSON(KEYS.customFoods, list);
  const back = readJSON<FoodItem[]>(KEYS.customFoods, []);
  if (back.length !== list.length) {
    throw new CustomFoodStorageError(
      "这条没能存进本机 —— 存储空间可能满了（或浏览器处于隐私模式）。" +
        "可以先到「设置」里导出备份，再删掉一些不用的食物。",
    );
  }
}

/** 新增的结果。`duplicate` 有值表示撞了名字 —— **没写进去**，由 UI 决定要不要覆盖 */
export type AddCustomFoodResult = {
  list: FoodItem[];
  added: FoodItem;
  /** 撞名的既有条目（归一化后同名）。有值就说明这次**没新增** */
  duplicate?: FoodItem;
};

/**
 * 加一条到「我的食物库」。
 *
 * 撞名时**不覆盖**，而是把既有的那条报回去让 UI 决定 ——
 * 静默覆盖会毁掉用户之前的编辑，而这是没法撤销的。
 *
 * @throws {CustomFoodStorageError} 到上限、或存不进去
 */
export function addCustomFood(
  food: Omit<FoodItem, "id"> & { id?: string },
): AddCustomFoodResult {
  const list = loadCustomFoods();

  const keys = new Set(nameKeys(food));
  const duplicate = list.find((f) => nameKeys(f).some((k) => keys.has(k)));
  if (duplicate) {
    // 组装出「本来会加进去的那条」，方便 UI 拿它做预览/覆盖
    const prepared: FoodItem = { ...food, id: food.id ?? `user-${uuid()}` };
    return { list, added: prepared, duplicate };
  }

  if (list.length >= CUSTOM_FOODS_LIMIT) {
    throw new CustomFoodStorageError(
      `「我的食物库」最多放 ${CUSTOM_FOODS_LIMIT} 条，已经满了。` +
        `先删掉一些不用的，再加新的。`,
    );
  }

  const added: FoodItem = { ...food, id: food.id ?? `user-${uuid()}` };
  const next = [...list, added];
  persist(next);
  return { list: next, added };
}

/**
 * 覆盖式新增：撞名就替换掉既有的那条，保留它原来的 id
 * （因为已记的账引用的是那个 id，换 id 会让旧记录找不到这条食物）。
 *
 * 用户点了「覆盖」时走这里。
 */
export function overwriteCustomFood(
  food: Omit<FoodItem, "id"> & { id?: string },
  existingId: string,
): FoodItem[] {
  const list = loadCustomFoods();
  const prepared: FoodItem = { ...food, id: existingId };
  const next = list.map((f) => (f.id === existingId ? prepared : f));
  persist(next);
  return next;
}

/** 改一条。`id` 与 `name` 允许改，但 `id` 改了会让已记的账指不过来 —— 调用方自己拿主意 */
export function updateCustomFood(id: string, patch: Partial<FoodItem>): FoodItem[] {
  const list = loadCustomFoods();
  const next = list.map((f) => (f.id === id ? { ...f, ...patch, id: f.id } : f));
  persist(next);
  return next;
}

export function removeCustomFood(id: string): FoodItem[] {
  const list = loadCustomFoods();
  const next = list.filter((f) => f.id !== id);
  persist(next);
  return next;
}

/** 按 id 取一条。找不到返回 `undefined`（不是抛错 —— 调用点多半是要展示，不是要崩） */
export function customFoodById(id: string): FoodItem | undefined {
  return loadCustomFoods().find((f) => f.id === id);
}

/** 给「我的食物库」设置面板用：条数 */
export function customFoodCount(): number {
  return loadCustomFoods().length;
}
