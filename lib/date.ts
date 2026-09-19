/**
 * 日期工具。
 *
 * 全项目统一用「本地日期的 ISO 字符串」当日期主键（"2026-09-17"），
 * 不用时间戳 —— 这样每日打卡、体重、饮食都天然以「天」为单位聚合，
 * 且不受时区与夏令时影响。
 */

/** 补零到两位 */
const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/** 把 "2026-09-17" 拆成数字年月日 */
function partsOf(dateISO: string): [number, number, number] {
  const [y, m, d] = dateISO.split("-").map(Number);
  return [y, m, d];
}

/** Date -> "2026-09-17"（按本地时区，不走 toISOString，避免跨时区偏一天） */
export function formatDateISO(d: Date): string {
  return [d.getFullYear(), pad2(d.getMonth() + 1), pad2(d.getDate())].join("-");
}

export function todayISO(): string {
  return formatDateISO(new Date());
}

/** 取当前的本地时刻，格式 "HH:mm"。记录用不到秒级精度，所以不补秒。 */
export function nowHM(): string {
  const now = new Date();
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

/**
 * 在日期字符串上加减天数。
 *
 * 交给 Date 的构造函数去处理进位：`new Date(2026, 11, 31 + 1)` 会自然变成次年 1 月 1 日，
 * 比手写跨月跨年跨闰年的判断可靠得多。
 */
export function addDays(dateISO: string, days: number): string {
  const [y, m, d] = partsOf(dateISO);
  return formatDateISO(new Date(y, m - 1, d + days));
}

/**
 * 两个日期相距几天（`to` 在 `from` 之后为正）。
 *
 * ⚠️ 刻意**不用 `addDays` 那种本地时间构造**：这里要的是"相隔几天"这个纯数字，
 * 而本地时间在夏令时切换那天只有 23 小时或 25 小时 —— 按本地午夜相减会算出 0.958 天，
 * 取整之后就成了差一天。`"2026-09-17"` 被 `Date.parse` 当成 **UTC 午夜**，
 * 两端同一个基准，跨夏令时也恒等于整数天。
 *
 * 无法解析时返回 `NaN` —— 调用方必须自己处理，不要拿 NaN 去比大小（它会一路静默为 false）。
 */
export function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(fromISO);
  const to = Date.parse(toISO);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return NaN;
  return Math.round((to - from) / 86_400_000);
}

/** 某天所在周的周一 */
export function weekStartOf(dateISO: string): string {
  const [y, m, d] = partsOf(dateISO);
  const dow = new Date(y, m - 1, d).getDay(); // 0 = 周日
  const back = dow === 0 ? 6 : dow - 1;
  return formatDateISO(new Date(y, m - 1, d - back));
}

/** 给定周一日期，返回该周 7 天 */
export function weekDates(weekStartISO: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStartISO, i));
}

export function formatWeekRange(weekStartISO: string): string {
  return `${weekStartISO} ~ ${addDays(weekStartISO, 6)}`;
}

/**
 * 补录窗口：最多往前补多少天。
 * 打卡与体重共用同一个常量 —— 否则用户会发现同一天在打卡卡补得了、在体重卡补不了。
 */
export const BACKFILL_DAYS = 30;

/** 七天的中文名。数组下标即 weekdayIndex 的返回值。 */
export const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/** 周几（0=周一 … 6=周日），用于在 7 根柱子上标星期 */
export function weekdayIndex(dateISO: string): number {
  const [y, m, d] = partsOf(dateISO);
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 ? 6 : dow - 1;
}

/** "9月17日" 这种短展示 */
export function formatShort(dateISO: string): string {
  const [, m, d] = dateISO.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

/**
 * 餐次时间窗，单位是「当天第几分钟」，左闭右开。
 * 缝隙（比如 10:30~14:00 之外的时段）落到「加餐」。
 */
const SLOT_WINDOWS: { from: number; to: number; slot: "早餐" | "午餐" | "晚餐" }[] = [
  { from: 5 * 60, to: 10 * 60 + 30, slot: "早餐" },
  { from: 10 * 60 + 30, to: 14 * 60, slot: "午餐" },
  { from: 17 * 60 + 30, to: 21 * 60 + 30, slot: "晚餐" },
];

/**
 * 由具体时间推导语义餐次。
 * 只用于 AI 语境与标签展示 —— **不作为 UI 分组依据**（用户可能 15 点吃正餐）。
 */
export function mealSlotFromTime(time: string): "早餐" | "午餐" | "晚餐" | "加餐" {
  const [h = 0, min = 0] = time.split(":").map(Number);
  const at = h * 60 + min;
  const hit = SLOT_WINDOWS.find((w) => at >= w.from && at < w.to);
  return hit ? hit.slot : "加餐";
}

/** 早期数据只有固定餐次没有 time，给个近似时间好排序 */
export function approxTimeForSlot(slot?: string): string {
  switch (slot) {
    case "早餐":
      return "08:00";
    case "午餐":
      return "12:00";
    case "晚餐":
      return "19:00";
    case "加餐":
      return "15:00";
    default:
      return "15:00";
  }
}
