/**
 * 运动记录的计算辅助：类型选项、排序、累计/本周统计、里程碑判定。
 * 只做纯计算，不碰存储。
 *
 * ⚠️ 里程碑（EXERCISE_MILESTONES）与打卡徽章（rewards.ts 的 BADGES）是**两套命名空间**，
 * 存在两个不同的键里，千万不能混用 —— 混了以后运动成就会污染打卡徽章墙，
 * 徽章墙上会显示"还差 N 天"这种驴唇不对马嘴的文案。
 */

import type { ExerciseAwards, ExerciseRecord, ExerciseType } from "./types";
import { addDays } from "./date";

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export const EXERCISE_TYPES: { key: ExerciseType; emoji: string; hint: string }[] = [
  { key: "散步", emoji: "🚶", hint: "时长或距离" },
  { key: "跑步", emoji: "🏃", hint: "距离更有意义" },
  { key: "爬山", emoji: "⛰️", hint: "时长或距离" },
  { key: "徒步", emoji: "🥾", hint: "距离更有意义" },
  { key: "骑行", emoji: "🚴", hint: "距离" },
  { key: "游泳", emoji: "🏊", hint: "时长" },
  { key: "球类", emoji: "⚽", hint: "时长" },
  { key: "其他", emoji: "✨", hint: "" },
];

export function exerciseEmoji(t: ExerciseType): string {
  return EXERCISE_TYPES.find((x) => x.key === t)?.emoji ?? "✨";
}

/** 徒步类（爬山 + 徒步），用于徒步里程碑 */
export function isHikeType(t: ExerciseType): boolean {
  return t === "爬山" || t === "徒步";
}

/**
 * 运动记录的**唯一**排序入口：按日期倒序，同日按 at（录入时间）倒序，最新在前。
 *
 * ⚠️ 别在界面层另写一套排序。存储层的 `loadExercises` 与 `addExercise` 都用它，
 * 少了它，补录一条旧日期的运动就会插到列表最前面（看起来是按补录时间排）。
 */
export function sortExercises(list: ExerciseRecord[]): ExerciseRecord[] {
  return [...list].sort((a, b) => (a.date === b.date ? b.at - a.at : b.date.localeCompare(a.date)));
}

export type ExerciseStats = {
  count: number;
  minutes: number;
  /** 总里程（一位小数） */
  km: number;
  hikeCount: number;
  activeDays: number;
};

export function exerciseStats(list: ExerciseRecord[]): ExerciseStats {
  const days = new Set<string>();
  let minutes = 0;
  let km = 0;
  let hikeCount = 0;
  for (const r of list) {
    days.add(r.date);
    minutes += r.minutes ?? 0;
    km += r.distanceKm ?? 0;
    if (isHikeType(r.type)) hikeCount++;
  }
  return { count: list.length, minutes, km: round1(km), hikeCount, activeDays: days.size };
}

export function weekStats(list: ExerciseRecord[], weekStartISO: string): ExerciseStats {
  const weekEnd = addDays(weekStartISO, 6);
  return exerciseStats(list.filter((r) => r.date >= weekStartISO && r.date <= weekEnd));
}

export type ExerciseMilestone = {
  id: string;
  emoji: string;
  label: string;
  /** 达成条件（纯函数，便于推演与测试） */
  test: (s: ExerciseStats) => boolean;
  /** 未达成时的进度文案，如 "还差 3 次" */
  progress: (s: ExerciseStats) => string;
};

export const EXERCISE_MILESTONES: ExerciseMilestone[] = [
  { id: "ex-first", emoji: "🌱", label: "第一次运动", test: (s) => s.count >= 1, progress: () => "还差 1 次" },
  {
    id: "ex-count-10",
    emoji: "🎯",
    label: "累计 10 次",
    test: (s) => s.count >= 10,
    progress: (s) => `还差 ${Math.max(0, 10 - s.count)} 次`,
  },
  {
    id: "ex-count-30",
    emoji: "🏅",
    label: "累计 30 次",
    test: (s) => s.count >= 30,
    progress: (s) => `还差 ${Math.max(0, 30 - s.count)} 次`,
  },
  {
    id: "ex-km-50",
    emoji: "🏃",
    label: "累计 50km",
    test: (s) => s.km >= 50,
    progress: (s) => `还差 ${round1(Math.max(0, 50 - s.km))}km`,
  },
  {
    id: "ex-km-100",
    emoji: "🏔️",
    label: "累计 100km",
    test: (s) => s.km >= 100,
    progress: (s) => `还差 ${round1(Math.max(0, 100 - s.km))}km`,
  },
  {
    id: "ex-hike-10",
    emoji: "🥾",
    label: "徒步/爬山 10 次",
    test: (s) => s.hikeCount >= 10,
    progress: (s) => `还差 ${Math.max(0, 10 - s.hikeCount)} 次`,
  },
];

/** 阈值已达成且尚未拥有 */
export function pendingMilestones(stats: ExerciseStats, owned: ExerciseAwards): ExerciseMilestone[] {
  return EXERCISE_MILESTONES.filter((m) => m.test(stats) && !owned[m.id]);
}

/** 下一个未达成的里程碑，全达成则 null */
export function nextMilestone(stats: ExerciseStats, owned: ExerciseAwards): ExerciseMilestone | null {
  return EXERCISE_MILESTONES.find((m) => !m.test(stats) && !owned[m.id]) ?? null;
}
