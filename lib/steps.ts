/**
 * 喝水与步数的换算、进度、文案。
 *
 * 步数为什么只能手动录？
 * - 微信运动 `wx.getWeRunData` 只在微信小程序内可用，H5 调不到，且返回加密数据必须后端解密。
 * - 华为 Health Kit 有 Cloud REST API，但要开发者账号、要审核、换 token 要 client_secret（必须有后端）。
 * - 小米手环没有面向第三方的官方 API。
 * - iOS HealthKit / Android Health Connect 都只能在**原生 App 内**调用。
 * 结论：网页架构下只能手动。将来若加 Capacitor 壳，就在 fetchStepsFromSource 里实现即可，
 * 改动集中在下面这一个函数。
 */

export type StepSource = "manual";

export const CURRENT_STEP_SOURCE: StepSource = "manual";

export const STEP_SOURCE_LABEL: Record<StepSource, string> = {
  manual: "手动录入",
};

/** 将来接原生健康数据时在这里实现。现在固定返回 null，表示"没有自动来源" */
export async function fetchStepsFromSource(): Promise<number | null> {
  return null;
}

// ---------- 步数 ----------

export const STEP_PRESETS = [1000, 3000, 5000];

/** 手动录入的合理上限，超过多半是误输 */
export const STEP_MAX = 100000;

/** 一步约 0.7 米 */
const METERS_PER_STEP = 0.7;

export function clampSteps(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(STEP_MAX, Math.max(0, Math.round(n)));
}

/** 换算成公里（保留一位小数），给用户一个直观的距离感 */
export function stepsToKm(steps: number): number {
  return Math.round((steps * METERS_PER_STEP) / 100) / 10;
}

// ---------- 喝水 ----------

/**
 * 喝水按「杯」录入，但**一杯是多少由用户自己定**：纸杯约 200ml、玻璃杯 250~300ml、
 * 保温杯 400~500ml、矿泉水瓶 500ml —— 写死一个值总有人对不上，于是"＋1 杯"记的其实是错的量。
 *
 * 约定：**ml 是唯一的存储单位**（DailyCheckin.waterMl），「杯」只是显示与快捷按钮的换算层。
 * 所以换杯子只影响换算与按钮，不会改动任何已记录的水量，也就不需要数据迁移。
 */
export const DEFAULT_CUP_ML = 250;

export const CUP_PRESETS = [150, 200, 250, 300, 400, 500];

export const CUP_MIN = 100;
export const CUP_MAX = 1000;

/** 归一化杯容量：非法值回落到默认，夹在 100~1000，取整到 10ml */
export function clampCupMl(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CUP_ML;
  return Math.round(Math.min(CUP_MAX, Math.max(CUP_MIN, n)) / 10) * 10;
}

export function mlToCups(ml: number, cupMl: number = DEFAULT_CUP_ML): number {
  return Math.round((ml / clampCupMl(cupMl)) * 10) / 10;
}

export function cupsToMl(cups: number, cupMl: number): number {
  return Math.max(0, Math.round(cups * clampCupMl(cupMl)));
}

/** 还差几杯：向上取整（杯数得是整数才好使），已喝够则为 0 */
export function cupsRemaining(remainingMl: number, cupMl: number): number {
  if (remainingMl <= 0) return 0;
  return Math.ceil(remainingMl / clampCupMl(cupMl));
}

// ---------- 进度 ----------

export type Progress = {
  current: number;
  target: number;
  /** 0~100，超过 100 会截断（进度环不该画出去） */
  pct: number;
  remaining: number;
  done: boolean;
};

export function progressOf(current: number, target: number): Progress {
  const safeTarget = target > 0 ? target : 1;
  return {
    current,
    target,
    pct: Math.min(100, Math.round((current / safeTarget) * 100)),
    remaining: Math.max(0, target - current),
    done: current >= target,
  };
}

/**
 * 喝水进度文案，例如「还差 301ml（约 2 杯）」。
 *
 * 为什么 ml 放前面：杯数向上取整，200ml 的杯子"2 杯"其实是 400ml，
 * 写成「还差 2 杯（约 301ml）」自己跟自己打架。ml 是实际要喝的量，杯只是直观参考。
 */
export function waterProgressText(progress: Progress, cupMl: number = DEFAULT_CUP_ML): string {
  if (progress.done) return "今天喝够啦 🎉";
  return `还差 ${progress.remaining} ml（约 ${cupsRemaining(progress.remaining, cupMl)} 杯）`;
}

/** 步数进度文案，例如「还差 1500 步（约 1.1km）」 */
export function stepsProgressText(progress: Progress): string {
  if (progress.done) return "今天走够啦 🎉";
  return `还差 ${progress.remaining} 步（约 ${stepsToKm(progress.remaining)}km）`;
}
