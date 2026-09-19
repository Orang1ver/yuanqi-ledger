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
 * 一个名字与查询的匹配档位。
 *
 * ⚠️ **判据只有这一份**（`searchFoods` 与 `quickadd.matchFood` 都调它）。
 * 两边各写一遍必然漂移 —— 这个项目在闸门上刚吃过一次亏（AGENTS 地雷 29）。
 *
 * 四档：完全等于(100) > 以查询开头(80) > 包含查询(60) > 被查询包含(40)。
 * 最后一档是"用户说了更长的句子"，也是**唯一会退而匹配到名字里那样原料**的一档
 * （「番茄炒蛋」→「番茄」），所以 `matchFood` 会专门对它设防。
 */
export function nameMatchScore(name: string, query: string): number {
  const nn = normalize(name);
  const q = normalize(query);
  if (!nn || !q) return 0;
  if (nn === q) return 100;
  if (nn.startsWith(q)) return 80;
  if (nn.includes(q)) return 60;
  /*
   * 「被查询包含」这一档**不收单字**。
   * 一个单字出现在句子里的任何位置都不说明用户想吃它 ——
   * 「饭」藏在「午饭吃了红烧肉」里、「面」藏在「面粉」里。
   * 而且这一档同分时是**名字短者优先**，于是单字别名会稳定地抢走
   * 本来该给「红烧肉」的位置（实测：加了别名「饭」之后，
   * 「午饭吃了红烧肉」被记成米饭）。
   * 单字仍然可以走**精确**匹配（上面那一档）—— 说「饭」就是米饭，说「醋」就是醋。
   */
  if (nn.length >= 2 && q.includes(nn)) return 40;
  return 0;
}

/** 这条食物对这条查询的最高档位，以及是哪个名字命中的 */
export function bestNameMatch(food: FoodItem, query: string): { score: number; hit: string } {
  let score = 0;
  let hit = food.name;
  for (const n of [food.name, ...(food.alias ?? [])]) {
    const s = nameMatchScore(n, query);
    if (s > score) {
      score = s;
      hit = n;
    }
  }
  return { score, hit };
}

/**
 * 模糊检索。
 *
 * 打分而不是简单过滤，是因为中文口语里「草莓酸奶」这种词会同时命中「草莓」和「酸奶」，
 * 而用户想要的往往是那个名字更完整、更具体的。分数由四档构成，见 `nameMatchScore`。
 */
export function searchFoods(query: string, limit = 20): FoodItem[] {
  const q = normalize(query);
  if (!q) return [];

  const scored: { food: FoodItem; score: number }[] = [];
  for (const food of LIBRARY.items) {
    const best = bestNameMatch(food, q).score;
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
