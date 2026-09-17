/**
 * 周维度的统计。
 *
 * 抽出来单独一个文件的原因：它是纯函数、可以被单测覆盖。
 * 周报页面会随视觉改版反复重写，但"这一周达标了几天"这个口径必须稳定。
 */

import type { DailyCheckin } from "./types";
import type { DailyHealthTargets } from "./health";

export type WeekReadiness = {
  /** 有记录的天数 */
  totalDays: number;
  waterDays: number;
  stepsDays: number;
  /** 两项都达标的天数 */
  bothDays: number;
  avgWater: number;
  avgSteps: number;
};

/**
 * 达标率。
 *
 * ⚠️ 分母是**这一周里真实有记录的天数**，不是固定的 7 ——
 * 用 7 当分母会让"周三才开始记录"的人在周一就永远达不到 100%，很不合理。
 * 但两项目标的判定仍要求有当日记录（没记 = 不知道，不能算达标）。
 */
export function readinessOfWeek(checkins: DailyCheckin[], targets: DailyHealthTargets): WeekReadiness {
  const totalDays = checkins.length;
  let waterDays = 0;
  let stepsDays = 0;
  let bothDays = 0;
  let waterSum = 0;
  let stepSum = 0;

  for (const c of checkins) {
    const w = c.waterMl >= targets.waterTarget;
    const s = c.steps >= targets.stepsTarget;
    if (w) waterDays++;
    if (s) stepsDays++;
    if (w && s) bothDays++;
    waterSum += c.waterMl;
    stepSum += c.steps;
  }

  const avg = (n: number) => (totalDays ? Math.round(n / totalDays) : 0);
  return {
    totalDays,
    waterDays,
    stepsDays,
    bothDays,
    avgWater: avg(waterSum),
    avgSteps: avg(stepSum),
  };
}

/** 百分比，用于进度条；分母为 0 时返回 0（不返回 NaN） */
export function pctOf(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}
