/** 微信步数协议。日期固定按北京时间解释，避免海外手机把午夜记录归到前一天。 */
export type WeRunDay = { date: string; steps: number };
export type WeRunSnapshot = { days: WeRunDay[]; syncedAt: number };

export const WERUN_API_URL = process.env.NEXT_PUBLIC_WERUN_API_URL || "";
export const WERUN_MINIPROGRAM_NAME = process.env.NEXT_PUBLIC_WERUN_MINIPROGRAM_NAME || "元气账本步数助手";
export const WERUN_TOKEN_PATTERN = /^YQW1\.[a-f0-9]{64}\.[a-f0-9]{64}$/;

export function parseWeRunSnapshot(value: unknown): WeRunSnapshot {
  if (!value || typeof value !== "object") throw new Error("步数数据格式不正确");
  const { days, syncedAt } = value as Record<string, unknown>;
  if (!Number.isSafeInteger(syncedAt) || (syncedAt as number) <= 0 || !Array.isArray(days) || days.length > 31) {
    throw new Error("步数数据格式不正确");
  }
  const seen = new Set<string>();
  const parsed = days.map((row: unknown) => {
    if (!row || typeof row !== "object") throw new Error("步数数据格式不正确");
    const { date, steps } = row as Record<string, unknown>;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date
      || !Number.isSafeInteger(steps) || (steps as number) < 0 || (steps as number) > 100000
      || seen.has(date)) throw new Error("步数数据格式不正确");
    seen.add(date);
    return { date, steps: steps as number };
  });
  return { days: parsed.sort((a, b) => a.date.localeCompare(b.date)), syncedAt: syncedAt as number };
}

export async function readWeRun(token: string, signal?: AbortSignal): Promise<WeRunSnapshot> {
  if (!WERUN_TOKEN_PATTERN.test(token)) throw new Error("请粘贴小程序复制的完整连接码");
  const url = new URL(WERUN_API_URL);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("步数服务地址配置不正确");
  const response = await fetch(url, {
    method: "GET", headers: { Authorization: `Bearer ${token}` },
    cache: "no-store", credentials: "omit", redirect: "error", signal,
  });
  if (response.status === 401) throw new Error("连接码已失效，请在小程序重新生成并连接");
  if (response.status === 404) throw new Error("还没有微信步数，请先在小程序点击同步");
  if (response.status === 429) throw new Error("操作较频繁，请稍后再试");
  if (!response.ok) throw new Error("暂时无法读取微信步数，请稍后重试");
  return parseWeRunSnapshot(await response.json());
}
