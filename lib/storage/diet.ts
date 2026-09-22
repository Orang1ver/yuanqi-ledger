/**
 * 饮食日记（`DietEntry[]`，键 `recipe.dietLog.v1`）。
 *
 * ⚠️ **本文件不许 import 食物库**（`lib/nutrition/library.ts`）。
 * 数据层被首页等页面共用，一旦牵进那份 JSON，184 条食物数据就会被塞进**每一个**页面的
 * bundle —— 明明只有饮食页需要它。所以这里只用 `../nutrition/core` 的纯计算
 * （它只依赖 tags 与类型，不碰 JSON），`FoodItem` 对象由调用方传进来。
 *
 * 读取时兜两种情况：早期记录可能缺 `mealSlot`（由 time 推）或缺 `time`
 * （按餐次给近似值）。这与 `meals.ts` 是同一套兜底口径。
 */

import { v4 as uuid } from "uuid";
import type { FoodItem } from "../nutrition/types";
import type { DietEntry, DietEntrySource } from "../nutrition/types";
import { makeDietEntry } from "../nutrition/core";
import type { MealSlot } from "../tags";
import { addDays, approxTimeForSlot, mealSlotFromTime } from "../date";
import { KEYS } from "./keys";
import { readJSON, writeJSON } from "./io";

// ---------- 归一化 ----------

/** 补 time / mealSlot，保证排序与展示一致 */
function normalizeEntry(e: DietEntry): DietEntry {
  const time = e.time || approxTimeForSlot(e.mealSlot);
  return { ...e, time, mealSlot: e.mealSlot ?? mealSlotFromTime(time) };
}

/** 同一天内按时间升序；时间相同按写入先后 */
function byTimeAsc(a: DietEntry, b: DietEntry): number {
  if (a.time !== b.time) return a.time < b.time ? -1 : 1;
  return a.createdAt - b.createdAt;
}

/** 日期倒序（新的在前），同一天内时间升序 —— 读列表时不用再排一次 */
function byRecent(a: DietEntry, b: DietEntry): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return byTimeAsc(a, b);
}

// ---------- 读 ----------

export function loadDietEntries(): DietEntry[] {
  return readJSON<DietEntry[]>(KEYS.dietLog, []).map(normalizeEntry).sort(byRecent);
}

/** 某一天的记录，按时间升序 —— 日视图要的就是这个顺序 */
export function entriesOn(date: string): DietEntry[] {
  return loadDietEntries()
    .filter((e) => e.date === date)
    .sort(byTimeAsc);
}

/** 闭区间 [from, to] 内的记录（ISO 字符串可直接比大小） */
export function entriesBetween(fromISO: string, toISO: string): DietEntry[] {
  return loadDietEntries().filter((e) => e.date >= fromISO && e.date <= toISO);
}

/** 最近 N 天（含今天）。用于「最近常吃」与趋势 */
export function recentDietEntries(days: number, todayISOStr: string): DietEntry[] {
  return entriesBetween(addDays(todayISOStr, -(days - 1)), todayISOStr);
}

// ---------- 写 ----------

/** 新增一条时要给的东西。营养值不在这里传 —— 由 `makeDietEntry` 从 `grams` 算 */
export type DietEntryInput = {
  date: string;
  time: string;
  mealSlot?: MealSlot;
  /** 手输的自定义食物可以不给 */
  food?: FoodItem;
  name: string;
  amount: number;
  unitLabel: string;
  grams: number;
  source: DietEntrySource;
  /**
   * 从菜单库的哪道菜记下来的。**可选**：
   * 手输、口语解析、「一顿饭」预设都没有它，只有「今天吃什么」那条路会给。
   */
  dishId?: string;
};

/**
 * 一次记 N 条。内部只读一次全量、拼一次、写一次 ——
 * 批量场景若像 `recordDietEntry` 那样每条都 load+write 全量，N 条就是 N 次整库读写。
 * 每条仍走 `makeDietEntry` → `nutritionOf`，营养数字来路不变。
 */
export function recordDietEntries(inputs: DietEntryInput[]): DietEntry[] {
  if (inputs.length === 0) return [];
  const now = Date.now();
  const base = loadDietEntries();
  const added = inputs.map((input) => {
    const time = input.time || approxTimeForSlot(input.mealSlot);
    return makeDietEntry({
      ...input,
      time,
      mealSlot: input.mealSlot ?? mealSlotFromTime(time),
      id: uuid(),
      createdAt: now,
    });
  });
  writeJSON(KEYS.dietLog, [...base, ...added].sort(byRecent));
  return added;
}

/**
 * 记一条。`id` 与 `createdAt` 在这里生成，营养值由 `makeDietEntry` 从克数算出 ——
 * 数字只有这一条来路，界面与模型都塞不进来。
 */
export function recordDietEntry(input: DietEntryInput): DietEntry {
  return recordDietEntries([input])[0];
}

/**
 * 改一条。**克数一变，营养快照必须跟着重算** ——
 * 否则记录上写着「200g」，营养值却还是 100g 时的数，这种自相矛盾最难被发现。
 * 所以这里不接收调用方传来的营养值，一律重新算。
 */
export function editDietEntry(id: string, input: Partial<DietEntryInput>): DietEntry | null {
  const all = loadDietEntries();
  const at = all.findIndex((e) => e.id === id);
  if (at < 0) return null;

  const prev = all[at];
  const time = input.time ?? prev.time;
  const mealSlot = input.mealSlot ?? (input.time ? mealSlotFromTime(time) : prev.mealSlot);

  const base = {
    id: prev.id,
    createdAt: prev.createdAt,
    date: input.date ?? prev.date,
    time,
    mealSlot,
    name: input.name ?? prev.name,
  };

  let next: DietEntry;
  if (input.food) {
    // 关联到库里的食物：营养值完全由新克数重算
    next = makeDietEntry({
      ...base,
      food: input.food,
      amount: input.amount ?? prev.amount,
      unitLabel: input.unitLabel ?? prev.unitLabel,
      grams: input.grams ?? prev.grams,
      source: input.source ?? prev.source,
    });
  } else {
    const grams = input.grams ?? prev.grams;
    next = {
      ...prev,
      ...base,
      amount: input.amount ?? prev.amount,
      unitLabel: input.unitLabel ?? prev.unitLabel,
      grams,
      // 自定义食物没有食物对象可查，只能按倍数缩放原快照
      nutrition: grams === prev.grams ? prev.nutrition : scaleSnapshot(prev, grams),
      source: input.source ?? prev.source,
    };
  }

  all[at] = next;
  writeJSON(KEYS.dietLog, all.sort(byRecent));
  return next;
}

/**
 * 没有食物对象（自定义食物）时改克数：按比例缩放原有快照。
 * 这是唯一允许「按倍数改营养值」的地方，且只在同一条记录内部 —— 不跨条目汇总。
 */
function scaleSnapshot(prev: DietEntry, grams: number): DietEntry["nutrition"] {
  if (!(prev.grams > 0)) return prev.nutrition;
  const k = grams / prev.grams;
  const n = prev.nutrition;
  return {
    kcal: n.kcal * k,
    protein: n.protein * k,
    fat: n.fat * k,
    carb: n.carb * k,
    sodium: n.sodium === undefined ? undefined : n.sodium * k,
    fiber: n.fiber === undefined ? undefined : n.fiber * k,
    // 添加糖：与上面两项同款 —— 缺了保持 undefined（不补 0）。
    // ⚠️ 漏了这一行不会报错，但会让「改一条拍照食物的克数」**静默丢掉糖快照**
    //    （对象里没有这个键 = 这条记录从此不参与糖统计），而且界面上完全看不出来。
    // ⚠️ 写成 `sugar: undefined` 也一样不行：这里造的是**要落盘快照**，
    //    多出来的 undefined 键会被 JSON 丢掉，于是内存里的快照与读回来的是两种形状。
    //    同 `core.ts` 的 `nutritionOf` —— 快照里值为 undefined 的糖键不写。
    ...(n.sugar === undefined ? {} : { sugar: n.sugar * k }),
  };
}

export function deleteDietEntry(id: string): DietEntry[] {
  const next = loadDietEntries().filter((e) => e.id !== id);
  writeJSON(KEYS.dietLog, next);
  return next;
}

/** 手工录一条自定义食物（库里没有的东西）。营养值靠用户自己填每 100g 的值 */
export function recordCustomEntry(input: {
  date: string;
  time: string;
  mealSlot?: MealSlot;
  name: string;
  grams: number;
  per100: { kcal: number; protein: number; fat: number; carb: number };
}): DietEntry {
  const k = input.grams / 100;
  const time = input.time || approxTimeForSlot(input.mealSlot);
  const entry: DietEntry = {
    id: uuid(),
    date: input.date,
    time,
    mealSlot: input.mealSlot ?? mealSlotFromTime(time),
    name: input.name,
    amount: input.grams,
    unitLabel: "克",
    grams: input.grams,
    nutrition: {
      kcal: input.per100.kcal * k,
      protein: input.per100.protein * k,
      fat: input.per100.fat * k,
      carb: input.per100.carb * k,
    },
    source: "custom",
    createdAt: Date.now(),
  };
  writeJSON(KEYS.dietLog, [...loadDietEntries(), entry].sort(byRecent));
  return entry;
}

// ---------- 派生给界面的小工具 ----------

/** 库里出现过的食物，按出现次数降序 —— 用于「最近常吃」 */
export function frequentFoods(limit = 8): { foodId: string; name: string; count: number }[] {
  const acc = new Map<string, { name: string; count: number }>();
  for (const e of loadDietEntries()) {
    if (!e.foodId) continue;
    const hit = acc.get(e.foodId);
    if (hit) hit.count += 1;
    else acc.set(e.foodId, { name: e.name, count: 1 });
  }
  return [...acc.entries()]
    .map(([foodId, v]) => ({ foodId, name: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1))
    .slice(0, limit);
}

/**
 * 「菜单库里的这道菜，我多久没吃了 / 吃过几次」。
 *
 * 只看带 `dishId` 的记录 —— 手输与口语解析的记录没有这个字段，
 * 它们本来也指不到菜单库的哪一道菜上，硬按名字去猜只会猜错（同名菜在不同店都有）。
 *
 * ⚠️ **没有这个字段的老数据不算"吃过"**：1.2.0 之前的记录一条都没有，
 * 如果把它们当成吃过，全库的菜会一夜之间变成"最近刚吃过"，推荐就废了。
 *
 * ⚠️ 一道菜如果展开成了多条（拆食材那种），`count` 会一次加多条。
 * 调用的地方用它当"常点的程度"，所以这里**按天去重**：同一天同一道菜只算一次，
 * 否则"吃过 3 次"可能只是同一顿饭里的三样食材。
 */
export function lastEatenByDish(): {
  last: Map<string, string>;
  count: Map<string, number>;
} {
  const last = new Map<string, string>();
  const days = new Map<string, Set<string>>();
  for (const e of loadDietEntries()) {
    if (!e.dishId) continue;
    const prev = last.get(e.dishId);
    if (!prev || e.date > prev) last.set(e.dishId, e.date);
    const seen = days.get(e.dishId);
    if (seen) seen.add(e.date);
    else days.set(e.dishId, new Set([e.date]));
  }
  return { last, count: new Map([...days].map(([id, set]) => [id, set.size])) };
}
