/**
 * 健康小屋的数据层：健康档案 / 每日打卡 / 体重 / 运动 / 打卡奖励。
 *
 * 这些是「元气账本」的心脏 —— 用户每天真正在写的就是这里的数据，
 * 所以每个写函数都要做到：越界拒绝、非法值不落库、同一天覆盖而不是追加。
 */

import { v4 as uuid } from "uuid";
import type {
  DailyCheckin,
  ExerciseAwards,
  ExerciseRecord,
  HealthProfile,
  RewardState,
  WeightEntry,
} from "../types";
import { KEYS } from "./keys";
import { readJSON, writeJSON } from "./io";
import { addDays, weekStartOf } from "../date";
import { sortExercises } from "../exercise";
import { normalizeRewards } from "../rewards";

// ---------- 健康档案 ----------

export function loadHealthProfile(): HealthProfile | null {
  return readJSON<HealthProfile | null>(KEYS.healthProfile, null);
}

export function saveHealthProfile(p: Omit<HealthProfile, "updatedAt">): HealthProfile {
  const profile: HealthProfile = { ...p, updatedAt: Date.now() };
  writeJSON(KEYS.healthProfile, profile);
  return profile;
}

// ---------- 每日打卡（喝水 / 步数 / 睡眠 / 心情） ----------

export function loadCheckin(date: string): DailyCheckin | null {
  return readJSON<Record<string, DailyCheckin>>(KEYS.dailyCheckins, {})[date] ?? null;
}

export function loadAllCheckins(): Record<string, DailyCheckin> {
  return readJSON<Record<string, DailyCheckin>>(KEYS.dailyCheckins, {});
}

/**
 * 写某天的打卡（增量合并）。
 * 水量与步数取 `patch` 与旧值的合并结果并夹在 ≥0；
 * 睡眠与心情用 `??` 而不是 `||` —— 否则「0 小时」这种值会被当成没填。
 */
export function saveCheckin(date: string, patch: Partial<Omit<DailyCheckin, "date">>): DailyCheckin {
  const all = readJSON<Record<string, DailyCheckin>>(KEYS.dailyCheckins, {});
  const prev = all[date];
  const next: DailyCheckin = {
    date,
    waterMl: Math.max(0, patch.waterMl ?? prev?.waterMl ?? 0),
    steps: Math.max(0, patch.steps ?? prev?.steps ?? 0),
    sleepHours: patch.sleepHours ?? prev?.sleepHours,
    mood: patch.mood ?? prev?.mood,
    updatedAt: Date.now(),
  };
  all[date] = next;
  writeJSON(KEYS.dailyCheckins, all);
  return next;
}

export function getCheckinsInWeek(weekStartISO: string): DailyCheckin[] {
  return Object.values(loadAllCheckins())
    .filter((c) => weekStartOf(c.date) === weekStartISO)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 最近 N 天（含今天）的打卡，升序。
 * 用"滚动窗口"而不是自然周：仪表盘上那 7 根柱子要的是"最近的走势"，
 * 周一打开时不该只剩一根柱子（自然周那种读法留给「本周打卡」卡）。
 */
export function getRecentCheckins(days: number, todayISOStr: string): DailyCheckin[] {
  const from = addDays(todayISOStr, -(days - 1));
  return Object.values(loadAllCheckins())
    .filter((c) => c.date >= from && c.date <= todayISOStr)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- 体重 ----------

const WEIGHT_MIN = 25;
const WEIGHT_MAX = 200;

export function loadWeights(): Record<string, WeightEntry> {
  return readJSON<Record<string, WeightEntry>>(KEYS.weights, {});
}

/** 记录某天体重（同一天覆盖）。越界则拒绝并返回 null，让调用方提示用户 */
export function saveWeight(date: string, weightKg: number): Record<string, WeightEntry> | null {
  const kg = Math.round(weightKg * 10) / 10;
  if (!Number.isFinite(kg) || kg < WEIGHT_MIN || kg > WEIGHT_MAX) return null;
  const all = loadWeights();
  all[date] = { date, weightKg: kg, at: Date.now() };
  writeJSON(KEYS.weights, all);
  return all;
}

export function removeWeight(date: string): Record<string, WeightEntry> {
  const all = loadWeights();
  delete all[date];
  writeJSON(KEYS.weights, all);
  return all;
}

// ---------- 运动 ----------

/**
 * ⚠️ 读出来就排好序（判据在 `sortExercises`）：按**运动日期**倒序，同日按录入时间倒序。
 * 存储里的顺序原本是「录入序」—— 补录一条上周的运动时它会插到最前面，
 * 列表看起来就成了按补录时间排。**存量数据也是这个顺序**，所以排序必须放在读取侧。
 */
export function loadExercises(): ExerciseRecord[] {
  return sortExercises(readJSON<ExerciseRecord[]>(KEYS.exercises, []));
}

/** 追加一条，返回最新列表（按运动日期倒序，同日按录入时间倒序） */
export function addExercise(input: Omit<ExerciseRecord, "id" | "at">): ExerciseRecord[] {
  const next = sortExercises([{ ...input, id: uuid(), at: Date.now() }, ...loadExercises()]);
  writeJSON(KEYS.exercises, next);
  return next;
}

export function removeExercise(id: string): ExerciseRecord[] {
  const next = loadExercises().filter((e) => e.id !== id);
  writeJSON(KEYS.exercises, next);
  return next;
}

export function loadExerciseAwards(): ExerciseAwards {
  return readJSON<ExerciseAwards>(KEYS.exerciseAwards, {});
}

export function saveExerciseAwards(a: ExerciseAwards): void {
  writeJSON(KEYS.exerciseAwards, a);
}

// ---------- 打卡奖励 ----------

export function loadRewards(): RewardState {
  return normalizeRewards(readJSON<unknown>(KEYS.rewards, null));
}

export function saveRewards(state: RewardState): void {
  writeJSON(KEYS.rewards, state);
}
