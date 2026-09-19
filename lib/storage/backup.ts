/**
 * 备份导出 / 导入。
 *
 * 这一层的存在意义只有一个：**用户的数据不能丢**。
 * 数据全在浏览器 localStorage 里，清缓存、换手机、换域名都会带走它，
 * 所以这里既是"搬家工具"，也是唯一的兜底。
 *
 * ⚠️ 两条不能改的行为：
 * 1) 导出靠 `recipe.` 前缀扫描 —— 新增键必须带这个前缀，否则导不出去。
 * 2) `BACKUP_GROUPS` 是**子串硬编码**映射，新增键要补一行，否则导入预览看不到它。
 *    也正因如此，键名不得与既有键产生子串重叠（见 keys.ts 的注释）。
 *    ⚠️ 例外：**应用元数据**（`backupReminder` / `iosInstallHintDismissed` /
 *    `updateBannerDismissed`）与**快照**（`takeoutUndo` / `importUndo`）都不补 ——
 *    它们不是"用户记录"，在预览里列出来只会让那一行变长，帮不上任何判断。
 *
 * ⚠️ 第三条（2026-09-19 补）：**「整份覆盖」是唯一不可逆的操作**，所以它必须存快照。
 *    这条路上原来有个洞：覆盖导入只靠一个嵌套的 `window.confirm` 确认，
 *    **没有快照、没有撤销** —— 误点一次数据就没了。现在写之前先 `pushImportUndo`。
 */

import { APP_PREFIX, appKeys, readJSON, writeJSON } from "./io";
import { KEYS } from "./keys";
import { markBackedUp } from "./backupReminder";

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
  /*
   * 标记「刚备份过」放在**这里**而不是调用点：
   * 只要有人导出了备份就该记上。挂到 UI 层的话，将来多一个导出入口就会漏记，
   * 而漏记的后果是「明明备份过却一直被提醒」—— 用户会开始无视这个提醒。
   */
  markBackedUp();
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

  /*
   * 覆盖之前先存快照 —— 这是「整份替换」唯一的安全网。
   * 放在**写任何东西之前**：写一半再存，快照里就是半新半旧的混合数据。
   *
   * 若快照写不进去（配额满），`peekImportUndo()` 会读不到，界面上那个
   * 「撤销这次导入」就不会出现 —— 行为是对的：**不能承诺一个做不到的撤销**。
   * 但也不因此拦住导入本身（用户可能就是想覆盖，配额满不该让他卡死）。
   */
  if (mode === "overwrite") pushImportUndo(mode);

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

// ---------- 「整份覆盖」的撤销 ----------

export type ImportUndo = {
  /** 快照是什么时候建的 */
  at: string;
  mode: ImportMode;
  /** 导入**之前**的全部本地数据 */
  data: Record<string, string>;
};

/**
 * 把当前数据存成一份快照。
 *
 * ⚠️ 快照**不把自己存进去** —— 否则会自我嵌套，而且每撤一次就多套一层。
 */
export function pushImportUndo(mode: ImportMode = "overwrite"): void {
  if (typeof window === "undefined") return;
  const data: Record<string, string> = {};
  for (const k of appKeys()) {
    if (k === KEYS.importUndo) continue;
    const v = localStorage.getItem(k);
    if (v !== null) data[k] = v;
  }
  const snap: ImportUndo = { at: new Date().toISOString(), mode, data };
  writeJSON(KEYS.importUndo, snap);
}

/** 有没有可撤销的快照。界面据此决定要不要显示「撤销这次导入」 */
export function peekImportUndo(): ImportUndo | null {
  const raw = readJSON<ImportUndo | null>(KEYS.importUndo, null);
  if (!raw || typeof raw !== "object" || !raw.data || typeof raw.data !== "object") return null;
  if (typeof raw.at !== "string") return null;
  return { at: raw.at, mode: raw.mode === "merge" ? "merge" : "overwrite", data: raw.data };
}

/**
 * 把数据恢复回快照那一刻，并**消费掉快照**（只能撤一次）。
 *
 * ⚠️ 先清空当前数据再写回，而不是直接把快照里的键覆盖上去：
 * 导入之后才出现的键不在快照里，不清掉就会留下来 ——
 * 那等于"撤销"之后还留着上一次导入的残留，比不撤更让人困惑。
 *
 * 返回恢复的键数；没有快照时返回 0（调用方据此说"没有可撤销的了"）。
 */
export function undoImport(): number {
  const snap = peekImportUndo();
  if (!snap || typeof window === "undefined") return 0;
  for (const k of appKeys()) {
    if (k === KEYS.importUndo) continue;
    localStorage.removeItem(k);
  }
  let n = 0;
  for (const [k, v] of Object.entries(snap.data)) {
    try {
      localStorage.setItem(k, v);
      n++;
    } catch {
      // 配额满：能恢复多少算多少，但不能因此抛出去把界面打崩
    }
  }
  localStorage.removeItem(KEYS.importUndo);
  return n;
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
const BACKUP_GROUPS: { label: string; match: string; counting: "items" | "single" }[] = [
  /*
   * `counting` 是必须显式写的，不能靠猜：
   * `dailyCheckins` 那种"按日期索引的对象"键数就是天数，说「2 条」是对的；
   * 而 `healthProfile` 是**一份**档案（{height, weight,...}），
   * 拿字段数当条数会说成「健康档案 2 条」—— 那是误导。
   */
  { label: "健康档案", match: "healthProfile", counting: "single" },
  { label: "打卡记录", match: "dailyCheckins", counting: "items" },
  { label: "打卡奖励", match: "rewards", counting: "items" },
  { label: "偏好设置", match: "prefs", counting: "single" },
  { label: "体重记录", match: "weights", counting: "items" },
  { label: "运动记录", match: "exercise", counting: "items" },
  { label: "饮食记录", match: "mealRecords", counting: "items" },
  { label: "饮食日记", match: "dietLog", counting: "items" },
  { label: "我的食物库", match: "customFoods", counting: "items" },
  { label: "菜单库", match: "takeoutMock", counting: "items" },
  { label: "AI Key", match: "apikeys", counting: "single" },
  { label: "饮食偏好笔记", match: "userProfile", counting: "single" },
  { label: "常用食材", match: "ingredients", counting: "items" },
  { label: "每周分析", match: "weeklyInsight", counting: "items" },
];

/**
 * 导入预览的**结构化**结果。
 *
 * 为什么不是一个字符串：界面要把它渲染成一张表（每类几项 + 两个后果明确的按钮），
 * 而拼好的中文串没法再拆开。原来那个 `describeBackup` 就只够拼一句 `window.confirm` 的文案 ——
 * 而那正是这次要换掉的东西。
 */
export type BackupDetail =
  | {
      ok: true;
      /** 备份的导出时间；老备份可能没有 */
      exportedAt: string | null;
      /** 备份里是否含 AI Key（分享给别人时要注意） */
      includesApiKey: boolean;
      /** 是不是来自更早的版本（`app` 字段对不上） */
      legacy: boolean;
      /** 可恢复的键总数 */
      total: number;
      /** 按内容分类的条数 */
      groups: { label: string; count: number }[];
    }
  | { ok: false; reason: string };

/** 一个键里装了几"条"：数组看长度、对象看键数、其它算 1 条 */
function countOf(raw: string): number {
  try {
    const v: unknown = JSON.parse(raw);
    if (Array.isArray(v)) return v.length;
    if (v && typeof v === "object") return Object.keys(v as object).length;
  } catch {
    /* 坏值也算一项，不能因为解析不了就当它不存在 */
  }
  return 1;
}

/** 一个分组里装了几"条" */
function countGroup(hit: [string, string][], counting: "items" | "single"): number {
  if (counting === "single") return hit.length;
  return hit.reduce((n, [, v]) => n + countOf(v), 0);
}

export function describeBackupDetail(text: string): BackupDetail {
  let parsed: Backup;
  try {
    parsed = JSON.parse(text) as Backup;
  } catch {
    return { ok: false, reason: "这段内容不是有效的备份 JSON" };
  }
  if (!parsed || typeof parsed !== "object" || !parsed.data || typeof parsed.data !== "object") {
    return { ok: false, reason: "备份格式不对，缺少 data 字段" };
  }

  // 与 importBackup 用同一套过滤规则 —— 预览里数出来的条数，必须就是导入会写进去的条数
  const entries = Object.entries(parsed.data).filter(
    ([k, v]) => k.startsWith(APP_PREFIX) && typeof v === "string",
  );
  if (entries.length === 0) return { ok: false, reason: "备份里没有可恢复的数据" };

  const groups: { label: string; count: number }[] = [];
  for (const g of BACKUP_GROUPS) {
    const hit = entries.filter(([k]) => k.includes(g.match));
    if (!hit.length) continue;
    groups.push({ label: g.label, count: countGroup(hit, g.counting) });
  }

  return {
    ok: true,
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : null,
    // 以实际内容为准：`includesApiKey` 是导出时写的标记，老备份可能没有这个字段
    includesApiKey: parsed.includesApiKey === true || entries.some(([k]) => k.includes("apikeys")),
    legacy: parsed.app !== BACKUP_APP_NAME,
    total: entries.length,
    groups,
  };
}

/**
 * 备份里的数据是否来自更早的版本 —— 现在由 `describeBackupDetail` 的 `legacy` 字段给出。
 * （原来这里有个 `looksLikeLegacyBackup`，改了预览面板之后没有调用点了，删掉。）
 */
