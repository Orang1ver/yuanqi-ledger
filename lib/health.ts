/**
 * 健康档案 → 每日目标。
 *
 * 公式与口径（换实现也不能换口径，否则用户的"目标"会莫名其妙地变）：
 * - BMR：Mifflin-St Jeor
 * - TDEE：BMR × 活动系数
 * - 目标热量：TDEE + 目标偏移，且有下限（不鼓励激进节食）
 * - 喝水：体重 × 35ml，取整到 50ml，夹在 1500~3500
 * - 步数：按活动水平
 * - BMI：中国成人标准分级
 */

import type { ActivityLevel, DailyCheckin, HealthGoal, HealthProfile } from "./types";

export const ACTIVITY_LEVELS: {
  label: ActivityLevel;
  desc: string;
  factor: number;
  stepsTarget: number;
}[] = [
  { label: "久坐少动", desc: "基本只上课/伏案，很少运动", factor: 1.2, stepsTarget: 6000 },
  { label: "轻度活动", desc: "每周散步或轻运动 1-3 次", factor: 1.375, stepsTarget: 8000 },
  { label: "中度活动", desc: "每周运动 3-5 次", factor: 1.55, stepsTarget: 10000 },
  { label: "高度活动", desc: "几乎每天运动", factor: 1.725, stepsTarget: 12000 },
];

export const HEALTH_GOALS: { key: HealthGoal; desc: string; calorieDelta: number }[] = [
  { key: "减脂", desc: "温和减脂，不节食", calorieDelta: -350 },
  { key: "增肌", desc: "配合运动适当多吃", calorieDelta: 250 },
  { key: "维持健康", desc: "保持现在的状态", calorieDelta: 0 },
];

export function calcBMR(p: Pick<HealthProfile, "sex" | "age" | "heightCm" | "weightKg">): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  return Math.round(p.sex === "男" ? base + 5 : base - 161);
}

export function calcTDEE(p: HealthProfile): number {
  const factor = ACTIVITY_LEVELS.find((a) => a.label === p.activityLevel)?.factor ?? 1.375;
  return Math.round(calcBMR(p) * factor);
}

/** 目标热量。下限按性别区分，避免学生党把自己饿着 */
export function calcCalorieTarget(p: HealthProfile): number {
  const delta = HEALTH_GOALS.find((g) => g.key === p.goal)?.calorieDelta ?? 0;
  const floor = p.sex === "男" ? 1600 : 1300;
  return Math.max(floor, calcTDEE(p) + delta);
}

/** 喝水目标：每公斤体重约 35ml，取整到 50ml，限制在 1500~3500ml */
export function calcWaterTarget(p: Pick<HealthProfile, "weightKg">): number {
  const raw = p.weightKg * 35;
  return Math.min(3500, Math.max(1500, Math.round(raw / 50) * 50));
}

export function calcStepsTarget(p: Pick<HealthProfile, "activityLevel">): number {
  return ACTIVITY_LEVELS.find((a) => a.label === p.activityLevel)?.stepsTarget ?? 8000;
}

export function calcBMI(p: Pick<HealthProfile, "heightCm" | "weightKg">): number {
  const h = p.heightCm / 100;
  if (h <= 0) return 0;
  return Math.round((p.weightKg / (h * h)) * 10) / 10;
}

/** 中国成人 BMI 标准 */
export function bmiLabel(bmi: number): string {
  if (bmi <= 0) return "";
  if (bmi < 18.5) return "偏轻";
  if (bmi < 24) return "正常";
  if (bmi < 28) return "超重";
  return "肥胖";
}

export type DailyHealthTargets = {
  bmr: number;
  tdee: number;
  calorieTarget: number;
  waterTarget: number;
  stepsTarget: number;
  bmi: number;
  bmiLabel: string;
};

export function calcDailyTargets(p: HealthProfile): DailyHealthTargets {
  const bmi = calcBMI(p);
  return {
    bmr: calcBMR(p),
    tdee: calcTDEE(p),
    calorieTarget: calcCalorieTarget(p),
    waterTarget: calcWaterTarget(p),
    stepsTarget: calcStepsTarget(p),
    bmi,
    bmiLabel: bmiLabel(bmi),
  };
}

/** 目标体重区间（BMI 18.5~23.9）对应的体重范围，用于给建议 */
export function healthyWeightRange(p: Pick<HealthProfile, "heightCm">): { min: number; max: number } {
  const h = p.heightCm / 100;
  return {
    min: Math.round(18.5 * h * h * 10) / 10,
    max: Math.round(23.9 * h * h * 10) / 10,
  };
}

/** 把健康档案 + 今日打卡拼成一段注入 AI 的上下文；没有档案时返回空串 */
export function buildHealthContext(
  profile: HealthProfile | null,
  today: DailyCheckin | null,
  targets?: DailyHealthTargets | null,
): string {
  if (!profile) return "";
  const t = targets ?? calcDailyTargets(profile);
  const lines = [
    `性别：${profile.sex}；年龄：${profile.age} 岁；身高：${profile.heightCm}cm；体重：${profile.weightKg}kg（BMI ${t.bmi}，${t.bmiLabel}）`,
    `活动水平：${profile.activityLevel}`,
    `健康目标：${profile.goal}`,
    `每日热量参考：约 ${t.calorieTarget} kcal（基础代谢 ${t.bmr} kcal）`,
  ];
  if (profile.allergies.trim()) lines.push(`忌口/过敏：${profile.allergies.trim()}`);
  if (profile.conditions.trim()) lines.push(`身体状况：${profile.conditions.trim()}`);
  if (today) {
    const parts = [
      `喝水 ${today.waterMl}ml（目标 ${t.waterTarget}ml）`,
      `步数 ${today.steps}（目标 ${t.stepsTarget}）`,
    ];
    if (today.sleepHours) parts.push(`睡眠约 ${today.sleepHours} 小时`);
    if (today.mood) parts.push(`状态${today.mood === "好" ? "不错" : today.mood === "累" ? "比较累" : "一般"}`);
    lines.push(`今日打卡：${parts.join("，")}`);
  }
  return lines.join("\n");
}

/** 本周打卡汇总，供每周分析使用 */
export function buildWeekHealthSummary(checkins: DailyCheckin[]): string {
  if (checkins.length === 0) return "";
  const avg = (nums: number[]) => (nums.length ? Math.round(nums.reduce((s, n) => s + n, 0) / nums.length) : 0);
  const waters = checkins.filter((c) => c.waterMl > 0).map((c) => c.waterMl);
  const steps = checkins.filter((c) => c.steps > 0).map((c) => c.steps);
  const sleeps = checkins.map((c) => c.sleepHours).filter((n): n is number => !!n);
  const parts: string[] = [`有打卡记录 ${checkins.length} 天`];
  if (waters.length) parts.push(`日均喝水约 ${avg(waters)}ml`);
  if (steps.length) parts.push(`日均步数约 ${avg(steps)}`);
  if (sleeps.length) parts.push(`日均睡眠约 ${avg(sleeps)} 小时`);
  return parts.join("，");
}
