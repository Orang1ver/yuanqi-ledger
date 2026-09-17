/**
 * 一餐饭的记录（MealRecord）。
 *
 * 兼容性要点：早期版本的记录**没有 time 字段**，只有固定餐次。
 * 读的时候统一补一个近似时间，否则排序和展示会乱。
 */

import { v4 as uuid } from "uuid";
import type { MealRecord, WeeklyInsight, UserProfile, CommonIngredient } from "../types";
import { KEYS } from "./keys";
import { readJSON, writeJSON } from "./io";
import { addDays, approxTimeForSlot, mealSlotFromTime, weekStartOf } from "../date";
import { DEFAULT_INGREDIENTS } from "../tags";

// ---------- 一餐饭 ----------

/** 补 time / mealSlot，保证排序与展示一致 */
function normalizeMeal(m: MealRecord): MealRecord {
  if (m.time) return { ...m, mealSlot: m.mealSlot ?? mealSlotFromTime(m.time) };
  const time = approxTimeForSlot(m.mealSlot);
  return { ...m, time, mealSlot: m.mealSlot ?? mealSlotFromTime(time) };
}

export function loadMealRecords(): MealRecord[] {
  return readJSON<MealRecord[]>(KEYS.meals, []).map(normalizeMeal);
}

export function addMealRecord(m: Omit<MealRecord, "id" | "createdAt" | "mealSlot">): MealRecord {
  const record: MealRecord = {
    ...m,
    mealSlot: mealSlotFromTime(m.time),
    id: uuid(),
    createdAt: Date.now(),
  };
  writeJSON(KEYS.meals, [record, ...loadMealRecords()]);
  return record;
}

export function updateMealRecord(id: string, patch: Partial<MealRecord>): void {
  const all = loadMealRecords();
  const at = all.findIndex((r) => r.id === id);
  if (at < 0) return; // 找不到就什么都不做，别白写一次 localStorage

  const prev = all[at];
  const merged: MealRecord = { ...prev, ...patch };

  // 时间一改，语义餐次就得跟着重算；否则「19:30」配着「早餐」自相矛盾
  if (patch.time !== undefined) merged.mealSlot = mealSlotFromTime(patch.time);

  // 模型给的原始结果一旦被人动过，就降级标成 ai-edited ——
  // 留着这个标记，日后才回答得了「AI 到底猜得准不准」
  if (prev.source === "ai" && (patch.dishes !== undefined || patch.time !== undefined)) {
    merged.source = "ai-edited";
  }

  all[at] = merged;
  writeJSON(KEYS.meals, all);
}

export function deleteMealRecord(id: string): void {
  writeJSON(KEYS.meals, loadMealRecords().filter((m) => m.id !== id));
}

export function getMealsInWeek(weekStartISO: string): MealRecord[] {
  return loadMealRecords().filter((m) => weekStartOf(m.date) === weekStartISO);
}

/** 最近 N 天（含今天）的记录，用于"最近常吃"与饮食账本复用 */
export function getRecentMeals(days: number, todayISOStr: string): MealRecord[] {
  const from = addDays(todayISOStr, -(days - 1));
  return loadMealRecords().filter((m) => m.date >= from && m.date <= todayISOStr);
}

// ---------- 每周分析缓存 ----------

export function loadWeeklyInsight(weekStart: string): WeeklyInsight | null {
  return readJSON<Record<string, WeeklyInsight>>(KEYS.weeklyInsight, {})[weekStart] ?? null;
}

export function saveWeeklyInsight(w: WeeklyInsight): void {
  const all = readJSON<Record<string, WeeklyInsight>>(KEYS.weeklyInsight, {});
  all[w.weekStart] = w;
  writeJSON(KEYS.weeklyInsight, all);
}

// ---------- 用户饮食习惯笔记 ----------

export function loadUserProfile(): UserProfile | null {
  return readJSON<UserProfile | null>(KEYS.userProfile, null);
}

export function saveUserProfile(content: string): void {
  writeJSON<UserProfile>(KEYS.userProfile, { content, updatedAt: Date.now() });
}

// ---------- 常用食材 ----------

export function loadCommonIngredients(): CommonIngredient[] {
  return readJSON<CommonIngredient[]>(KEYS.ingredients, []);
}

export function addCommonIngredient(label: string): CommonIngredient {
  const item: CommonIngredient = { id: uuid(), label, createdAt: Date.now() };
  writeJSON(KEYS.ingredients, [...loadCommonIngredients(), item]);
  return item;
}

export function removeCommonIngredient(id: string): void {
  writeJSON(
    KEYS.ingredients,
    loadCommonIngredients().filter((i) => i.id !== id),
  );
}

/**
 * 首次使用时播种默认食材。
 * ⚠️ 判断条件是"清单为空"，这里安全 —— 因为清空食材清单不是常见操作，
 * 且即便触发也只是补回几个默认项。**菜单库不要照抄这个写法**（见 takeout.ts）。
 */
export function seedDefaultIngredientsIfEmpty(): void {
  if (loadCommonIngredients().length > 0) return;
  writeJSON(
    KEYS.ingredients,
    DEFAULT_INGREDIENTS.map<CommonIngredient>((label) => ({ id: uuid(), label, createdAt: Date.now() })),
  );
}
