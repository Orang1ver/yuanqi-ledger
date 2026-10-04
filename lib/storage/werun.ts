import { KEYS } from "./keys";
import { readJSON, removeKey, writeJSON } from "./io";
import { parseWeRunSnapshot, WERUN_API_URL, WERUN_TOKEN_PATTERN, type WeRunSnapshot } from "../werun";
import { loadAllCheckins } from "./health";
import type { DailyCheckin } from "../types";

export function loadWeRunToken(): string {
  const value = readJSON<unknown>(KEYS.werunConnection, null);
  if (!value || typeof value !== "object") return "";
  const { apiUrl, token } = value as Record<string, unknown>;
  // 更换服务端时绝不把旧凭证发给新地址。
  return apiUrl === WERUN_API_URL && typeof token === "string" && WERUN_TOKEN_PATTERN.test(token) ? token : "";
}

export function saveWeRunToken(token: string): void {
  if (!WERUN_TOKEN_PATTERN.test(token)) throw new Error("连接码格式不正确");
  writeJSON(KEYS.werunConnection, { apiUrl: WERUN_API_URL, token });
  if (loadWeRunToken() !== token) throw new Error("无法保存连接，请检查设备存储空间");
}

export function forgetWeRunToken(): void {
  removeKey(KEYS.werunConnection);
}

export type WeRunPreviewDay = { date: string; steps: number; previousSteps: number | null };

/** 缺失记录显示「未记录」，与确实记录的 0 步区分。预览不写本地数据。 */
export function previewWeRunSteps(snapshot: WeRunSnapshot): WeRunPreviewDay[] {
  const { days } = parseWeRunSnapshot(snapshot);
  const all = loadAllCheckins();
  return days.map((day) => ({ ...day, previousSteps: all[day.date]?.steps ?? null }));
}

/** 整批先校验、再读取最新记录，只改返回日期的步数，一次写入避免半途覆盖。 */
export function applyWeRunSteps(snapshot: WeRunSnapshot): DailyCheckin[] {
  const { days } = parseWeRunSnapshot(snapshot);
  if (!days.length) return [];
  if (typeof window === "undefined") throw new Error("请在账本页面同步步数");
  const all = loadAllCheckins();
  const updatedAt = Date.now();
  const updated = days.map(({ date, steps }) => {
    const prev = all[date];
    const next: DailyCheckin = { ...prev, date, steps, waterMl: prev?.waterMl ?? 0, updatedAt };
    all[date] = next;
    return next;
  });
  // localStorage.setItem 单次写入是原子的；配额满时不报告虚假的同步成功。
  try { localStorage.setItem(KEYS.dailyCheckins, JSON.stringify(all)); }
  catch { throw new Error("无法保存步数，请检查设备存储空间后重试"); }
  return updated;
}
