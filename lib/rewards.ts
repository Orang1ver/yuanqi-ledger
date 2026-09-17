/**
 * 打卡奖励：判定「今日是否完成」、算连续天数、发放里程碑徽章。
 *
 * 完成标准（与用户确认过的口径）：**喝水达标 且 步数达标**。
 * 判定依赖健康档案算出的 targets，所以**没填档案就不判定、不发奖励**。
 *
 * ⚠️ 奖励只发不收：事后把水量减下去不会撤销已达成的记录。
 */

import type { DailyCheckin, RewardState } from "./types";
import type { DailyHealthTargets } from "./health";
import { addDays } from "./date";

export const EMPTY_REWARDS: RewardState = { days: {}, badges: {}, celebrated: [] };

/** 读进来的旧数据可能缺字段或类型不对，一律归一化，避免后续代码到处判空 */
export function normalizeRewards(raw: unknown): RewardState {
  const r = (raw ?? {}) as Partial<RewardState>;
  return {
    days: r.days && typeof r.days === "object" ? r.days : {},
    badges: r.badges && typeof r.badges === "object" ? r.badges : {},
    celebrated: Array.isArray(r.celebrated) ? r.celebrated : [],
  };
}

// ---------- 判定 ----------

export type CheckinCompletion = {
  waterDone: boolean;
  stepsDone: boolean;
  /** 两项都达标才算今天完成 */
  allDone: boolean;
};

export function evaluateCheckin(
  checkin: Pick<DailyCheckin, "waterMl" | "steps"> | null | undefined,
  targets: Pick<DailyHealthTargets, "waterTarget" | "stepsTarget"> | null | undefined,
): CheckinCompletion {
  if (!targets) return { waterDone: false, stepsDone: false, allDone: false };
  const waterDone = (checkin?.waterMl ?? 0) >= targets.waterTarget;
  const stepsDone = (checkin?.steps ?? 0) >= targets.stepsTarget;
  return { waterDone, stepsDone, allDone: waterDone && stepsDone };
}

// ---------- 连续天数 ----------

function countBack(days: Record<string, unknown>, fromISO: string, limit = 400): number {
  let n = 0;
  let cursor = fromISO;
  while (n < limit && days[cursor]) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

/**
 * 当前连续天数。
 * 今天已达标就从今天数；今天还没达标则从昨天数 ——
 * 否则白天一打开就显示 0 天，明明昨天刚坚持过却像断签了，很打击人。
 */
export function calcCurrentStreak(days: Record<string, unknown>, todayISOStr: string): number {
  if (days[todayISOStr]) return countBack(days, todayISOStr);
  return countBack(days, addDays(todayISOStr, -1));
}

/** 逐日扫描求最长连续段（不依赖已存的 streak 值，作为兜底） */
function calcLongestByScan(days: Record<string, unknown>): number {
  const dates = Object.keys(days).sort();
  let best = 0;
  let run = 0;
  let prev = "";
  for (const d of dates) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  return best;
}

/** 历史最长连续。用于徽章授予 —— 断签后已获得的徽章不收回 */
export function calcMaxStreak(days: Record<string, { streak: number }>): number {
  let max = 0;
  for (const d of Object.values(days)) {
    if (d && typeof d.streak === "number" && d.streak > max) max = d.streak;
  }
  return Math.max(max, calcLongestByScan(days));
}

// ---------- 徽章 ----------

export type Badge = {
  id: string;
  days: number;
  emoji: string;
  label: string;
};

export const BADGES: Badge[] = [
  { id: "streak-3", days: 3, emoji: "🌱", label: "坚持 3 天" },
  { id: "streak-7", days: 7, emoji: "🌿", label: "一周不落" },
  { id: "streak-14", days: 14, emoji: "🌳", label: "两周坚持" },
  { id: "streak-30", days: 30, emoji: "🏅", label: "满月达成" },
  { id: "streak-60", days: 60, emoji: "🏆", label: "两月坚持" },
  { id: "streak-100", days: 100, emoji: "👑", label: "百日打卡" },
];

export function pendingBadges(streak: number, owned: Record<string, string>): Badge[] {
  return BADGES.filter((b) => streak >= b.days && !owned[b.id]);
}

/** 下一个还没拿到的徽章（用于"还差 N 天"提示） */
export function nextBadge(owned: Record<string, string>): Badge | null {
  return BADGES.find((b) => !owned[b.id]) ?? null;
}

// ---------- 结算 ----------

/**
 * 按日期升序整体重算每天的连续值。
 *
 * 为什么必须整体重算：补录中间某天会把原本断开的两段连起来
 * （例如已有 1、2 和 4、5，补上 3 之后，5 那天的连续值应从 2 变成 5）。
 * 只更新被补的那一天会留下错误的历史值。
 */
export function recomputeStreaks(
  days: Record<string, { streak: number; at: number }>,
): Record<string, { streak: number; at: number }> {
  const next: Record<string, { streak: number; at: number }> = {};
  for (const d of Object.keys(days).sort()) {
    const prev = next[addDays(d, -1)];
    next[d] = { streak: prev ? prev.streak + 1 : 1, at: days[d].at };
  }
  return next;
}

export type RecordResult = {
  state: RewardState;
  /** 这次是否新增了一天（决定要不要给用户提示） */
  isNew: boolean;
  streak: number;
  newBadges: Badge[];
};

/** 把某天标记为「已达标」。幂等：已记录过的日期不会重复记 */
export function recordCompletedDay(prev: RewardState, dateISO: string): RecordResult {
  const state = normalizeRewards(prev);
  if (state.days[dateISO]) {
    return { state, isNew: false, streak: state.days[dateISO].streak, newBadges: [] };
  }

  const days = recomputeStreaks({ ...state.days, [dateISO]: { streak: 0, at: Date.now() } });
  const streak = days[dateISO].streak;
  // 徽章按"重算后的历史最长"授予 —— 补录可能把两段连起来，从而越过某个里程碑
  const newBadges = pendingBadges(calcMaxStreak(days), state.badges);
  const badges = { ...state.badges };
  for (const b of newBadges) badges[b.id] = dateISO;

  return { state: { days, badges, celebrated: state.celebrated }, isNew: true, streak, newBadges };
}

export type SettleResult = {
  state: RewardState;
  /** 这次是否首次达标（决定要不要弹庆祝） */
  firstTimeToday: boolean;
  streak: number;
  newBadges: Badge[];
};

/** 结算「今天」的打卡：记录 + 标记已庆祝 */
export function settleCheckin(prev: RewardState, todayISOStr: string): SettleResult {
  const r = recordCompletedDay(prev, todayISOStr);
  const celebrated = r.state.celebrated.includes(todayISOStr)
    ? r.state.celebrated
    : [...r.state.celebrated, todayISOStr];
  return {
    state: { ...r.state, celebrated },
    firstTimeToday: r.isNew,
    streak: r.streak,
    newBadges: r.newBadges,
  };
}

/** 已经庆祝过今天就返回 true（避免反复加水量重复弹窗） */
export function hasCelebrated(state: RewardState, todayISOStr: string): boolean {
  return state.celebrated.includes(todayISOStr);
}
