/**
 * 「久未备份」提醒。
 *
 * 为什么需要它：用户的数据**只在这台设备的 localStorage 里** —— 没有服务端、没有账号。
 * 清一次缓存、换台机器、误点一次「清空数据」，几年的记录就没了，
 * 而且**没法找回**。导出/导入能力早就写好了（见 backup.ts），缺的只是**没人提醒他去点**。
 *
 * 三个字段放在**同一个键**里，因为它们的含义不同、缺一不可：
 *  - `firstSeenAt`：第一次在这台设备上用本应用。它决定「从什么时候开始算」——
 *    没有它的话，今天刚装、还什么都没记的用户会立刻被提醒「你很久没备份了」。
 *  - `lastBackupAt`：上次**导出**备份的时间。从未导出过是 `null`，**不是 0**
 *    （「没有数据」≠「0」的同一个道理：界面上要区分「从没备份过」和「0 天前备份过」）。
 *  - `snoozedUntil`：用户点了「稍后再说」之后的静默期。
 *
 * ⚠️ 两条刻意的克制：
 *  1. **空库不提醒**。还没记过东西的人备份出来是个空文件，提醒他毫无意义，
 *     只会让「提醒」这件事在用户眼里贬值。
 *  2. **只认用户主动记的东西**。菜单库不算 —— 它有示例种子数据，
 *     新用户一进去就「有数据」了（见 `seedTakeoutMockIfEmpty`）。
 */

import { readJSON, writeJSON } from "./io";
import { KEYS } from "./keys";

/** 超过这么多天没备份就提醒 */
export const BACKUP_REMIND_AFTER_DAYS = 30;

/** 点「稍后再说」之后静默这么多天 */
export const BACKUP_SNOOZE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export type BackupReminderState = {
  firstSeenAt: string;
  lastBackupAt: string | null;
  snoozedUntil: string | null;
};

/**
 * 用户**主动**记进去的东西。
 *
 * ⚠️ 这里**故意不含** `takeoutMock`（菜单库有示例种子）、
 * `iosInstallHintDismissed` / `updateBannerDismissed`（一次性标记）、
 * `apikeys` / `prefs`（配置，不是"记录"）。
 * 判断的是「他有没有会心疼的东西可以丢」，不是「localStorage 里有没有字节」。
 */
const REAL_DATA_KEYS: readonly string[] = [
  KEYS.dietLog,
  KEYS.meals,
  KEYS.dailyCheckins,
  KEYS.healthProfile,
  KEYS.weights,
  KEYS.exercises,
];

function loadState(): BackupReminderState | null {
  const raw = readJSON<Partial<BackupReminderState> | null>(KEYS.backupReminder, null);
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.firstSeenAt !== "string") return null;
  return {
    firstSeenAt: raw.firstSeenAt,
    lastBackupAt: typeof raw.lastBackupAt === "string" ? raw.lastBackupAt : null,
    snoozedUntil: typeof raw.snoozedUntil === "string" ? raw.snoozedUntil : null,
  };
}

function saveState(state: BackupReminderState): void {
  writeJSON(KEYS.backupReminder, state);
}

/**
 * 读状态；**首次调用会把「第一次打开」记下来**（所以它有副作用，名字里带 ensure）。
 *
 * ⚠️ 调用点必须在 `useEffect` 里，不能进 `useState` 的惰性初始化 ——
 * 它依赖 localStorage，服务端读不到，放进去会造成 hydration 不一致
 * （同 `IOSInstallHint` 里那条注释）。
 *
 * 写不进去时（配额满 / 隐私模式）返回内存里的新值：本次判断照常，
 * 只是下次打开会重新开始计时 —— 宁可漏提醒，也不能因此崩。
 */
export function ensureBackupState(now: Date = new Date()): BackupReminderState {
  const cur = loadState();
  if (cur) return cur;
  const fresh: BackupReminderState = {
    firstSeenAt: now.toISOString(),
    lastBackupAt: null,
    snoozedUntil: null,
  };
  saveState(fresh);
  return fresh;
}

/** 只读，不做任何初始化。给「纯展示」用。 */
export function peekBackupState(): BackupReminderState | null {
  return loadState();
}

/** 记下「刚刚导出过一份备份」。导出成功后由 `downloadBackup` 调。 */
export function markBackedUp(now: Date = new Date()): void {
  const cur = ensureBackupState(now);
  // 顺手清掉静默期：既然刚备份了，就没有"稍后再说"可言了
  saveState({ ...cur, lastBackupAt: now.toISOString(), snoozedUntil: null });
}

/** 用户点了「稍后再说」：安静 `BACKUP_SNOOZE_DAYS` 天，不是永久关闭 */
export function snoozeBackupReminder(now: Date = new Date()): void {
  const cur = ensureBackupState(now);
  saveState({ ...cur, snoozedUntil: new Date(now.getTime() + BACKUP_SNOOZE_DAYS * DAY_MS).toISOString() });
}

/** 本地有没有「丢了会心疼」的东西。空库 / 只有种子数据时为 false。 */
export function hasSomethingToLose(): boolean {
  if (typeof window === "undefined") return false;
  for (const k of REAL_DATA_KEYS) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(k);
    } catch {
      // 隐私模式禁用存储：当作没有
      return false;
    }
    if (raw === null) continue;
    const t = raw.trim();
    // 空数组 / 空对象 / 字面 null 都算"还没记东西"
    if (t === "" || t === "[]" || t === "{}" || t === "null") continue;
    return true;
  }
  return false;
}

/**
 * 距「该备份的基准点」多少天。
 * 基准点 = 上次备份；从未备份过则是第一次打开的时间。
 */
export function daysSinceBackup(state: BackupReminderState, now: Date = new Date()): number {
  const base = Date.parse(state.lastBackupAt ?? state.firstSeenAt);
  if (!Number.isFinite(base)) return 0;
  return Math.max(0, Math.floor((now.getTime() - base) / DAY_MS));
}

/** 现在该不该提醒。三个条件都满足才算：有东西可丢、超期、不在静默期内。 */
export function shouldRemindBackup(now: Date = new Date()): boolean {
  const state = ensureBackupState(now);
  if (state.snoozedUntil) {
    const until = Date.parse(state.snoozedUntil);
    if (Number.isFinite(until) && until > now.getTime()) return false;
  }
  if (!hasSomethingToLose()) return false;
  return daysSinceBackup(state, now) >= BACKUP_REMIND_AFTER_DAYS;
}

/**
 * 给界面用的一句话状态。**只描述事实，不做判断** —— 该不该提醒是 `shouldRemindBackup` 的事。
 *
 * ⚠️「从没备份过」和「今天备份过」必须能分开说：两者算出来的天数可能都是 0，
 * 但含义完全相反（同「没有数据」≠「0」）。
 */
export function describeBackupStatus(now: Date = new Date()): string {
  const state = ensureBackupState(now);
  const days = daysSinceBackup(state, now);
  if (!state.lastBackupAt) {
    return days === 0 ? "还没有导出过备份" : `还没有导出过备份（这个账本已经用了 ${days} 天）`;
  }
  return days === 0 ? "上次备份：今天" : `上次备份：${days} 天前`;
}
