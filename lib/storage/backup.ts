/**
 * 备份导出 / 导入。
 *
 * 这一层的存在意义只有一个：**用户的数据不能丢**。
 * 数据全在浏览器 localStorage 里，清缓存、换手机、换域名都会带走它，
 * 所以这里既是"搬家工具"，也是唯一的兜底。
 *
 * ⚠️ 两条不能改的行为：
 * 1) 导出靠 `recipe.` 前缀扫描 —— 新增键必须带这个前缀，否则导不出去。
 * 2) `describeBackup` 是**子串硬编码**映射，新增键要补一行，否则导入预览看不到它。
 *    也正因如此，键名不得与既有键产生子串重叠（见 keys.ts 的注释）。
 */

import { APP_PREFIX, appKeys } from "./io";
import { KEYS } from "./keys";

export type Backup = {
  app: string;
  version: number;
  exportedAt: string;
  /** 是否包含 AI 接口 Key（分享给别人时要注意） */
  includesApiKey: boolean;
  data: Record<string, string>;
};

export const BACKUP_APP_NAME = "元气账本";

/** 把全部本地数据导出成可读 JSON */
export function exportBackup(includeApiKey: boolean): Backup {
  const data: Record<string, string> = {};
  if (typeof window !== "undefined") {
    for (const k of appKeys()) {
      if (!includeApiKey && k === KEYS.apikeys) continue;
      const v = localStorage.getItem(k);
      if (v !== null) data[k] = v;
    }
  }
  return {
    app: BACKUP_APP_NAME,
    version: 1,
    exportedAt: new Date().toISOString(),
    includesApiKey: includeApiKey,
    data,
  };
}

export function backupToText(includeApiKey: boolean): string {
  return JSON.stringify(exportBackup(includeApiKey), null, 2);
}

function stamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** 触发浏览器下载一个 .json 备份文件 */
export function downloadBackup(includeApiKey: boolean): void {
  const blob = new Blob([backupToText(includeApiKey)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `元气账本-备份-${stamp()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export type ImportMode = "merge" | "overwrite";

export type ImportResult = {
  /** 实际写入（或覆盖）的键数 */
  keys: number;
  /** merge 模式下因为本地已有而跳过的键数 */
  skipped: number;
};

/**
 * 从备份文本恢复数据。
 *
 * - `merge`（默认）：**只写本地不存在的键**，绝不覆盖正在用的记录。
 *   用途是"把我的配置发给家人"——不该把人家的打卡记录冲掉。
 * - `overwrite`：整份替换。**换设备 / 换域名迁移时必须用这个**，
 *   否则用户在浏览器里随便点过一下新站，本地就生成了默认值，
 *   merge 会认为"已存在 → 跳过"，看起来像"备份没导进去"。
 */
export function importBackup(text: string, mode: ImportMode = "merge"): ImportResult {
  let parsed: Backup;
  try {
    parsed = JSON.parse(text) as Backup;
  } catch {
    throw new Error("这段内容不是有效的备份 JSON");
  }
  if (!parsed || typeof parsed !== "object" || !parsed.data || typeof parsed.data !== "object") {
    throw new Error("备份格式不对，缺少 data 字段");
  }

  const entries = Object.entries(parsed.data).filter(
    ([k, v]) => k.startsWith(APP_PREFIX) && typeof v === "string",
  );
  if (entries.length === 0) throw new Error("备份里没有可恢复的数据");

  let keys = 0;
  let skipped = 0;
  for (const [k, v] of entries) {
    if (mode === "merge" && localStorage.getItem(k) !== null) {
      skipped++;
      continue;
    }
    localStorage.setItem(k, v);
    keys++;
  }
  return { keys, skipped };
}

/** 清空本应用的全部本地数据（危险操作，调用方必须二次确认） */
export function clearAllData(): number {
  if (typeof window === "undefined") return 0;
  const keys = appKeys();
  keys.forEach((k) => localStorage.removeItem(k));
  return keys.length;
}

/**
 * 备份里有哪些内容，用于导入前预览。
 *
 * ⚠️ 子串匹配是刻意的：备份可能来自更早的版本，键名集合未必与现在一致。
 * 但这个特性也意味着**新增键时必须在这里补一行**，否则用户看不到它被识别到。
 */
export function describeBackup(text: string): string {
  let keys: string[] = [];
  try {
    keys = Object.keys((JSON.parse(text) as Backup).data || {});
  } catch {
    return "无法解析的备份内容";
  }
  const has = (s: string) => keys.some((k) => k.includes(s));
  const parts: string[] = [];
  if (has("healthProfile")) parts.push("健康档案");
  if (has("dailyCheckins")) parts.push("打卡记录");
  if (has("rewards")) parts.push("打卡奖励");
  if (has("prefs")) parts.push("偏好设置");
  if (has("weights")) parts.push("体重记录");
  if (has("exercise")) parts.push("运动记录");
  if (has("mealRecords")) parts.push("饮食记录");
  if (has("dietLog")) parts.push("饮食日记");
  if (has("takeoutMock")) parts.push("菜单库");
  if (has("apikeys")) parts.push("AI Key");
  if (has("userProfile")) parts.push("饮食偏好笔记");
  if (has("ingredients")) parts.push("常用食材");
  if (has("weeklyInsight")) parts.push("每周分析");
  return parts.length ? parts.join("、") : `${keys.length} 项数据`;
}

/** 备份里的数据是否来自更早的版本——用于给用户一句说明，而不是让他猜 */
export function looksLikeLegacyBackup(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as Backup;
    return !!parsed && parsed.app !== BACKUP_APP_NAME;
  } catch {
    return false;
  }
}
