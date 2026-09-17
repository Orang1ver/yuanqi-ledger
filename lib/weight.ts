/**
 * 体重记录的计算辅助：排序、与上次/若干天前的差值、图表区间。
 * 只做纯计算，不碰存储，方便单独推演。
 */

import type { WeightEntry } from "./types";
import { addDays } from "./date";

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 按日期升序 */
export function sortWeights(all: Record<string, WeightEntry>): WeightEntry[] {
  return Object.values(all).sort((a, b) => a.date.localeCompare(b.date));
}

export function latestWeight(all: Record<string, WeightEntry>): WeightEntry | null {
  const list = sortWeights(all);
  return list.length ? list[list.length - 1] : null;
}

export function entryOn(all: Record<string, WeightEntry>, dateISO: string): WeightEntry | null {
  return all[dateISO] ?? null;
}

/** 严格早于该日期的最近一条 */
export function latestBefore(all: Record<string, WeightEntry>, dateISO: string): WeightEntry | null {
  const list = sortWeights(all).filter((e) => e.date < dateISO);
  return list.length ? list[list.length - 1] : null;
}

/**
 * 记录某天时的起始草稿值：
 * 该日已有 → 用已记的值；否则用更早的最近一条；再否则用最新一条；
 * 再否则用健康档案里的体重；最后兜底 60。
 *
 * 为什么要这串兜底：补录时若从 60kg 起步，用户得连点几十下才到自己的体重。
 */
export function baselineForDate(
  all: Record<string, WeightEntry>,
  dateISO: string,
  fallbackWeight: number | null,
): number {
  return round1(
    entryOn(all, dateISO)?.weightKg ??
      latestBefore(all, dateISO)?.weightKg ??
      latestWeight(all)?.weightKg ??
      fallbackWeight ??
      60,
  );
}

export type Delta = {
  /** 正为增重，负为减重 */
  diff: number;
  from: WeightEntry;
};

export function deltaVsPrevious(all: Record<string, WeightEntry>): Delta | null {
  const list = sortWeights(all);
  if (list.length < 2) return null;
  const cur = list[list.length - 1];
  const prev = list[list.length - 2];
  return { diff: round1(cur.weightKg - prev.weightKg), from: prev };
}

/** 与「若干天前最近的一条」相比，用于「近 7 天变化」 */
export function deltaVsDaysAgo(
  all: Record<string, WeightEntry>,
  todayISOStr: string,
  days: number,
): Delta | null {
  const cutoff = addDays(todayISOStr, -days);
  const list = sortWeights(all).filter((e) => e.date <= cutoff);
  if (list.length === 0) return null;
  const base = list[list.length - 1];
  const latest = latestWeight(all);
  if (!latest || latest.date === base.date) return null;
  return { diff: round1(latest.weightKg - base.weightKg), from: base };
}

/** 图表数值区间：上下各留 10% 余量，避免曲线贴着边框 */
export function weightRange(entries: WeightEntry[]): { min: number; max: number } {
  if (entries.length === 0) return { min: 0, max: 1 };
  const values = entries.map((e) => e.weightKg);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (lo === hi) return { min: round1(lo - 1), max: round1(hi + 1) };
  const pad = (hi - lo) * 0.1;
  return { min: round1(lo - pad), max: round1(hi + pad) };
}

/** 差值文案，如 "↑0.3" / "↓0.2" / "持平" */
export function deltaText(diff: number): string {
  if (Math.abs(diff) < 0.05) return "持平";
  return diff > 0 ? `↑${Math.abs(diff).toFixed(1)}` : `↓${Math.abs(diff).toFixed(1)}`;
}

/**
 * 差值配色。
 * ⚠️ 这里用「减重=顺色（主色青绿）、增重=警示色（暖橙）」而不是红涨绿跌 ——
 * 体重的"好方向"取决于用户目标，所以只区分方向、不判好坏，
 * 颜色语义是「离目标远了/近了」，由调用方按 goal 决定怎么解释。
 */
export function deltaColor(diff: number): string {
  if (Math.abs(diff) < 0.05) return "var(--yq-muted)";
  return diff > 0 ? "var(--yq-accent-ink)" : "var(--yq-info-ink)";
}
