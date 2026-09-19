/**
 * 「今天吃什么」—— 从**用户自己的菜单库**里挑一道（纯函数）。
 *
 * 与同目录的另外两个引擎的分工，先写清楚，免得以后混在一起：
 *   - `advice.ts`       说**今天哪一项偏了**
 *   - `recommend.ts`    说**下一口吃什么能补回来**（缺口驱动，要先有记录）
 *   - 本文件            说**这顿到底吃哪道**（决定，不需要任何前提）
 *
 * 为什么需要它：上面那两个都要"今天已经记过东西"才说话，而
 * "我现在要吃饭了，吃什么"这个时刻恰恰**一条记录都没有**。那才是它存在的全部理由。
 *
 * 三条自律：
 * 1) **忌口优先于分数。** 命中忌口的一律剔除，不管它多常点。
 * 2) **不给数字。** 本文件**不 import 食物库、不算任何热量** —— 数字全部留给界面
 *    对**选中的那一道**调 `estimateDish()`。好处有两个：不会多出第二条数字来路，
 *    而且挑选过程对 194 道菜是常数开销（不需要逐道估算）。
 * 3) **不装聪明。** 只有两个信号：多久没吃了、点过几次。没有口味模型、没有场景推断。
 *
 * ⚠️ 与 `lib/nutrition/` 的其它文件同一条纪律：不 import UI / Next / localStorage，
 * 也**不读时钟、不掷随机数** —— `today` 与 `roll` 都由调用方传进来。
 * 这样它才能在 Node 里被直接调用、被单测、被闸门检查，也才能证明"同输入同输出"。
 */

import type { TakeoutDish } from "../types";
import { daysBetween } from "../date";

/** 挑出来的一道菜。**注意这里没有任何热量字段** —— 见文件头第 2 条 */
export type DishPick = {
  dish: TakeoutDish;
  /** 为什么推它，一句带数字的人话 */
  reason: string;
  /** 三道滤网之后还剩几道可挑 */
  poolSize: number;
  /** 用户显式收窄过（品类 / 商家） */
  narrowed: boolean;
  /** 「换一个」把已出过的排完了，只能放宽重来一轮 */
  relaxed: boolean;
  /** 多少天前吃过；`null` = 从没点过 */
  lastEatenDays: number | null;
  /** 点过几次（按天去重） */
  eatenTimes: number;
};

/**
 * 挑选结果。刻意**不是一个可空的 `DishPick`**：
 * "库是空的"和"全被忌口排除了"是两件事，用户的出路完全不同
 * （前者去录菜，后者去改档案或改菜上的忌口标签），
 * 糊成一个 `null` 的话界面就只能说一句没用的"挑不出来"。
 */
export type PickOutcome =
  | { kind: "picked"; pick: DishPick }
  | { kind: "empty-menu" }
  | { kind: "all-filtered"; total: number; byAvoid: number; byNarrow: number };

export type PickInput = {
  dishes: readonly TakeoutDish[];
  /** 今天（ISO "2026-09-17"）。由调用方给，本文件不读时钟 */
  today: string;
  /** 要避开的标签（健康档案的忌口，逐字命中，见 lib/tags.ts 的 avoidLabelsFromText） */
  avoid?: readonly string[];
  /** 只看这个品类；空 = 不限 */
  category?: string;
  /** 只看这家；空 = 不限 */
  restaurant?: string;
  /** dishId -> 最近一次吃的日期 */
  lastEaten?: ReadonlyMap<string, string>;
  /** dishId -> 吃过几次 */
  eatenCount?: ReadonlyMap<string, number>;
  /** 不想再看到这些（本次「换一个」已经出过的） */
  exclude?: readonly string[];
  /** 0..1 的随机值。界面传 `Math.random()`，测试传固定值 —— 所以结果可复现 */
  roll: number;
};

/**
 * 新鲜度权重：越久没吃越接近 1。
 *
 * 只有"最近吃过"才被压下去：3 天内 0.15、7 天内 0.35、14 天内 0.65，更久与没吃过一样是 1。
 * ⚠️ 这是**软降权，不是硬排除** —— 候选池里只剩下刚吃过的几道时，
 * 它们照样会被推出来（用一条硬规则会让"换一个"走进死路）。
 */
function freshness(lastEatenDays: number | null): number {
  if (lastEatenDays === null) return 1;
  if (lastEatenDays <= 3) return 0.15;
  if (lastEatenDays <= 7) return 0.35;
  if (lastEatenDays <= 14) return 0.65;
  return 1;
}

/**
 * 字符串 → 0..1 的确定性散列（FNV-1a 32 位）。
 *
 * 用散列而不是直接拿 `roll` 去乘：`roll` 只有一个数，直接乘等于给候选排了个固定顺序，
 * 「换一个」会沿着同一顺序一路走下去。把 `roll` 和菜的 id 拌在一起散列，
 * 才能让同一个 `roll` 稳定地得到同一道菜，而不同 `roll` 得到的分布是散的。
 */
function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0x1_0000_0000;
}

/** 习惯权重：常点的略微靠前，最多 +30%（再多就变成"永远只推那几道"） */
function habit(eatenTimes: number): number {
  return 1 + 0.1 * Math.min(eatenTimes, 3);
}

/** 一句理由。挑**信息量最大的一条真话**，不堆砌 */
function reasonFor(pick: {
  lastEatenDays: number | null;
  eatenTimes: number;
  category?: string;
  narrowed: boolean;
}): string {
  const { lastEatenDays, eatenTimes, category, narrowed } = pick;
  let base: string;
  if (lastEatenDays === null) base = "你菜单里还没点过这道";
  else if (lastEatenDays >= 7) base = `你上次点它是 ${lastEatenDays} 天前`;
  else if (eatenTimes >= 2) base = `你点过 ${eatenTimes} 次，是常点的`;
  else base = `你上次点它是 ${lastEatenDays} 天前`;
  return narrowed && category ? `${base}（在「${category}」里挑的）` : base;
}

/**
 * 挑一道。**同输入必然同输出**（`roll` 也是输入之一）。
 *
 * 顺序：硬滤网 → 打分排序 → 取第一。任何一步都不产生数字。
 */
export function pickDishForToday(input: PickInput): PickOutcome {
  const {
    dishes,
    today,
    avoid = [],
    category = "",
    restaurant = "",
    lastEaten,
    eatenCount,
    exclude = [],
    roll,
  } = input;

  if (!dishes.length) return { kind: "empty-menu" };

  // ---- 滤网 1：忌口。与 suggestForGaps 同一个口径：菜自己带的 avoidConflicts 逐字命中 ----
  const notAvoided = dishes.filter((d) => !d.avoidConflicts.some((a) => avoid.includes(a)));
  const byAvoid = dishes.length - notAvoided.length;

  // ---- 滤网 2：用户显式收窄 ----
  const narrowed = Boolean(category || restaurant);
  const inScope = notAvoided.filter(
    (d) => (!category || d.category === category) && (!restaurant || d.restaurant === restaurant),
  );
  const byNarrow = notAvoided.length - inScope.length;

  let pool = inScope;
  let relaxed = false;

  // ---- 滤网 3：本次已经出过的。排空了就放宽（「换一个」不许走进死路）----
  if (exclude.length) {
    const excluded = new Set(exclude);
    const fresh = pool.filter((d) => !excluded.has(d.id));
    if (fresh.length) pool = fresh;
    else relaxed = true;
  }

  if (!pool.length) {
    return { kind: "all-filtered", total: dishes.length, byAvoid, byNarrow };
  }

  // ---- 打分。全部来自输入，没有任何隐藏状态 ----
  const scored = pool.map((dish) => {
    const last = lastEaten?.get(dish.id);
    // daysBetween 可能返回 NaN（日期坏了）。NaN 参与比较永远是 false，
    // 会让这道菜静默地永远排最后 —— 所以这里显式退回"从没吃过"，宁可推出来也别让它消失。
    const days = last ? daysBetween(last, today) : NaN;
    const lastEatenDays = Number.isFinite(days) ? days : null;
    const eatenTimes = eatenCount?.get(dish.id) ?? 0;
    const score = freshness(lastEatenDays) * habit(eatenTimes) * (0.5 + hash01(`${roll}|${dish.id}`));
    return { dish, lastEatenDays, eatenTimes, score };
  });

  scored.sort((a, b) => b.score - a.score || (a.dish.id < b.dish.id ? -1 : 1));
  const win = scored[0];

  return {
    kind: "picked",
    pick: {
      dish: win.dish,
      reason: reasonFor({
        lastEatenDays: win.lastEatenDays,
        eatenTimes: win.eatenTimes,
        category: win.dish.category,
        narrowed,
      }),
      poolSize: pool.length,
      narrowed,
      relaxed,
      lastEatenDays: win.lastEatenDays,
      eatenTimes: win.eatenTimes,
    },
  };
}
