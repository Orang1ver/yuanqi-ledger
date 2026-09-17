/**
 * localStorage 读写原语。
 *
 * 三条约定：
 * 1) 所有键统一带 `recipe.` 前缀。这不是怀旧 —— 用户的历史数据就存在这些键下，
 *    改前缀等于数据全部丢失。备份的「全量导出」也靠这个前缀扫描。
 * 2) 读永远不抛异常：读不到、JSON 坏了、被手动改坏了，一律回落到 fallback。
 *    宁可显示空，也不能白屏。
 * 3) SSR 期间没有 window，直接返回 fallback。
 */

export const APP_PREFIX = "recipe.";

export function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 配额满 / 隐私模式禁用存储：静默失败，不打断用户操作
  }
}

export function removeKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* 同上 */
  }
}

/** 当前本地存储里所有属于本应用的键 */
export function appKeys(): string[] {
  if (typeof window === "undefined") return [];
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(APP_PREFIX)) out.push(k);
  }
  return out;
}
