/**
 * 我的杯子 + 界面主题。
 *
 * 为什么不塞进 HealthProfile：
 * 1) 喝水卡在**还没填健康档案**时也要能用，杯子是"我怎么喝"的偏好，
 *    不该被档案表单的必填校验绑架；
 * 2) 不动 HealthProfile 的结构，saveHealthProfile 的调用点就不用逐个补字段
 *    —— 漏一个字段就会把老用户的值写成 undefined。
 */

import { clampCupMl, DEFAULT_CUP_ML } from "./steps";
import { KEYS } from "./storage/keys";
import { readJSON, writeJSON } from "./storage/io";

export type ThemeChoice = "system" | "light" | "dark";

export type AppPrefs = {
  /** 我的杯子容量（ml）。喝水按「杯」录入时用它换算；存储永远是 ml */
  cupMl: number;
  /** 老数据里没有这个字段 → 跟随系统 */
  theme: ThemeChoice;
};

export const DEFAULT_PREFS: AppPrefs = { cupMl: DEFAULT_CUP_ML, theme: "system" };

function normalizeTheme(v: unknown): ThemeChoice {
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

/** 读偏好：读不到 / 坏数据 / 越界值都归一成合法值，绝不返回 NaN */
export function loadPrefs(): AppPrefs {
  const parsed = readJSON<Partial<AppPrefs> | null>(KEYS.prefs, null);
  return {
    cupMl: clampCupMl(parsed?.cupMl ?? DEFAULT_CUP_ML),
    theme: normalizeTheme(parsed?.theme),
  };
}

/** 合并写回，返回归一化后的完整偏好（调用方直接拿去 setState） */
export function savePrefs(patch: Partial<AppPrefs>): AppPrefs {
  const next: AppPrefs = {
    cupMl: clampCupMl(patch.cupMl ?? loadPrefs().cupMl),
    theme: normalizeTheme(patch.theme ?? loadPrefs().theme),
  };
  writeJSON(KEYS.prefs, next);
  return next;
}

export function loadApiKeys(): { deepseekKey?: string } {
  return readJSON<{ deepseekKey?: string }>(KEYS.apikeys, {});
}

export function saveApiKeys(keys: { deepseekKey?: string }): void {
  writeJSON(KEYS.apikeys, keys);
}

/**
 * 可以「关掉就不再显示」的那几个键。
 *
 * ⚠️ 用 union 而不是 `StorageKey`：这些键存的是布尔，
 * 而别的键（饮食记录、健康档案）**绝不能**被当成开关写坏。
 * 新增一个一次性提示时，把它的键加到这里。
 */
export type DismissibleKey =
  | typeof KEYS.iosInstallHintDismissed
  | typeof KEYS.androidInstallHintDismissed
  | typeof KEYS.updateBannerDismissed;

/** 一次性提示的关闭状态（安装提示 / 更新横幅） */
export function loadDismissed(key: DismissibleKey): boolean {
  return readJSON<boolean>(key, false);
}

export function dismiss(key: DismissibleKey): void {
  writeJSON(key, true);
}
