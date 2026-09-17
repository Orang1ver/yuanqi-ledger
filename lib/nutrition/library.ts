/**
 * 食物库的读取与检索。
 *
 * 与 `core.ts` 的分工：本文件负责「找到是哪一种食物」，core 负责「算多少」。
 * 两边都不碰 UI。
 *
 * 数据是静态 JSON，跟着包一起分发，运行时不联网 —— 所以断网也能记账，
 * 这是这个应用敢说自己「数据只存在本地」的前提之一（条码查询是唯一的例外，见 P2）。
 */

import rawFoods from "../../data/foods.zh.json";
import rawPortions from "../../data/foodPortions.json";
import type { FoodCategory, FoodItem, FoodLibrary, PortionTable } from "./types";

/**
 * JSON 的字面量类型推断不会收窄到我们的联合类型（`category` 推成 `string`），
 * 所以这里显式断言一次。真正的把关在 `scripts/check-nutrition.mjs` ——
 * 由脚本逐条校验字段与取值，而不是指望类型系统替我们验数据文件。
 */
const LIBRARY = rawFoods as unknown as FoodLibrary;
const PORTIONS = rawPortions as unknown as PortionTable;

// ---------- 索引（只建一次） ----------

let idIndex: Map<string, FoodItem> | null = null;
let nameIndex: Map<string, FoodItem> | null = null;

/** 归一化：去空白、统一大小写。全角空格也一并干掉，中文输入法常带 */
function normalize(s: string): string {
  return s.replace(/[\s\u3000]+/g, "").toLowerCase();
}

function ensureIndexes(): void {
  if (idIndex && nameIndex) return;
  idIndex = new Map();
  nameIndex = new Map();
  for (const food of LIBRARY.items) {
    idIndex.set(food.id, food);
    for (const n of [food.name, ...(food.alias ?? [])]) {
      const key = normalize(n);
      // 先到先得：别名撞车时以先录入的为准，避免同一句口语忽左忽右
      if (!nameIndex.has(key)) nameIndex.set(key, food);
    }
  }
}

// ---------- 元信息 ----------

export function libraryMeta(): FoodLibrary["meta"] {
  return LIBRARY.meta;
}

export function portionTable(): PortionTable {
  return PORTIONS;
}

export function allFoods(): readonly FoodItem[] {
  return LIBRARY.items;
}

export function foodById(id: string): FoodItem | undefined {
  ensureIndexes();
  return idIndex!.get(id);
}

/** 按名字或别名精确命中（忽略空白与大小写）。「土豆片」能找到「薯片」 */
export function findFoodByName(text: string): FoodItem | undefined {
  ensureIndexes();
  return nameIndex!.get(normalize(text));
}

/**
 * 模糊检索。
 *
 * 打分而不是简单过滤，是因为中文口语里「草莓酸奶」这种词会同时命中「草莓」和「酸奶」，
 * 而用户想要的往往是那个名字更完整、更具体的。分数由四档构成：
 * 完全等于 > 以查询开头 > 包含查询 > 被查询包含（用户说了更长的句子）。
 */
export function searchFoods(query: string, limit = 20): FoodItem[] {
  const q = normalize(query);
  if (!q) return [];

  const scored: { food: FoodItem; score: number }[] = [];
  for (const food of LIBRARY.items) {
    let best = 0;
    for (const n of [food.name, ...(food.alias ?? [])]) {
      const nn = normalize(n);
      if (nn === q) best = Math.max(best, 100);
      else if (nn.startsWith(q)) best = Math.max(best, 80);
      else if (nn.includes(q)) best = Math.max(best, 60);
      else if (q.includes(nn)) best = Math.max(best, 40);
    }
    if (best > 0) scored.push({ food, score: best });
  }

  return scored
    // 同分时短名字优先（「米饭」比「糙米饭」更可能是用户想说的那个），再按 id 定序保证结果稳定
    .sort((a, b) => b.score - a.score || a.food.name.length - b.food.name.length || (a.food.id < b.food.id ? -1 : 1))
    .slice(0, limit)
    .map((x) => x.food);
}

export function foodsByCategory(category: FoodCategory): FoodItem[] {
  return LIBRARY.items.filter((f) => f.category === category);
}

/** 库里一共有多少条 */
export function foodCount(): number {
  return LIBRARY.items.length;
}
