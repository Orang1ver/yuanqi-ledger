/**
 * 「久未备份」提醒的单元测试。
 *
 * 这个功能的风险几乎全在**误报**：提醒一个刚装好、还没记过东西的人去备份，
 * 或者在用户明明备份过之后还接着提醒 —— 来两次，这个提醒就被永远无视了，
 * 而它恰恰是**唯一**能防止数据不可逆丢失的机制。
 *
 * 所以这里重点压边界（空库 / 从没备份 / 刚备份 / 静默期 / 时间倒流），
 * 而不是正常路径。时间一律由参数传入，不依赖真实时钟。
 */

import { strict as assert } from "node:assert";
import { beforeEach, describe, it } from "node:test";

class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
  /** 直接塞一个 JSON 值，模拟"某个领域已经写过数据了" */
  raw(k: string, v: unknown) {
    this.m.set(k, JSON.stringify(v));
  }
}

const storage = new MemoryStorage();
(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { localStorage: unknown }).localStorage = storage;

import { KEYS } from "./keys";
import {
  BACKUP_REMIND_AFTER_DAYS,
  BACKUP_SNOOZE_DAYS,
  daysSinceBackup,
  ensureBackupState,
  hasSomethingToLose,
  markBackedUp,
  peekBackupState,
  shouldRemindBackup,
  snoozeBackupReminder,
} from "./backupReminder";

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-01-01T09:00:00.000Z");
const at = (days: number) => new Date(T0.getTime() + days * DAY);

beforeEach(() => storage.clear());

describe("备份提醒的状态", () => {
  it("第一次读就把「第一次打开」记下来；「从没备份」是 null 不是 0", () => {
    const s = ensureBackupState(T0);
    assert.equal(s.firstSeenAt, T0.toISOString());
    assert.equal(s.lastBackupAt, null);
    assert.equal(s.snoozedUntil, null);
  });

  it("再次读取不会刷新 firstSeenAt —— 否则永远等不到 30 天", () => {
    ensureBackupState(T0);
    const later = ensureBackupState(at(5));
    assert.equal(later.firstSeenAt, T0.toISOString());
  });

  it("peek 只读、不做初始化", () => {
    assert.equal(peekBackupState(), null);
    ensureBackupState(T0);
    assert.notEqual(peekBackupState(), null);
  });

  it("数据被改坏时重新计时，而不是抛异常", () => {
    storage.setItem(KEYS.backupReminder, "{不是 JSON");
    assert.equal(ensureBackupState(T0).firstSeenAt, T0.toISOString());
  });

  it("缺 firstSeenAt 的残值视为没有（不能拿半截状态去算天数）", () => {
    storage.setItem(KEYS.backupReminder, JSON.stringify({ lastBackupAt: T0.toISOString() }));
    assert.equal(ensureBackupState(at(3)).firstSeenAt, at(3).toISOString());
  });
});

describe("距上次备份多少天", () => {
  it("从没备份时以「第一次打开」为基准", () => {
    const s = ensureBackupState(T0);
    assert.equal(daysSinceBackup(s, T0), 0);
    assert.equal(daysSinceBackup(s, at(29)), 29);
  });

  it("备份过就改以备份时间为基准 —— 不是第一次打开", () => {
    storage.raw(KEYS.dietLog, [{ id: "e1" }]);
    ensureBackupState(T0);
    markBackedUp(at(10));
    const s = ensureBackupState(at(10));
    assert.equal(daysSinceBackup(s, at(10)), 0);
    assert.equal(daysSinceBackup(s, at(12)), 2);
  });

  it("时间倒流（用户改了系统时间）不返回负数", () => {
    const s = ensureBackupState(T0);
    assert.equal(daysSinceBackup(s, new Date(T0.getTime() - 5 * DAY)), 0);
  });
});

describe("有没有「丢了会心疼」的东西", () => {
  it("空库没有", () => {
    assert.equal(hasSomethingToLose(), false);
  });

  it("⚠ 只有菜单库种子数据不算 —— 新用户一进去就已经有示例菜了", () => {
    storage.raw(KEYS.takeoutMock, [{ id: "x" }]);
    storage.setItem(KEYS.takeoutSeeded, "true");
    assert.equal(hasSomethingToLose(), false);
  });

  it("配置类（AI Key / 偏好 / 一次性标记）也不算", () => {
    storage.setItem(KEYS.apikeys, '{"deepseekKey":"sk-x"}');
    storage.setItem(KEYS.prefs, '{"cupMl":300}');
    storage.setItem(KEYS.iosInstallHintDismissed, "true");
    storage.setItem(KEYS.updateBannerDismissed, "true");
    assert.equal(hasSomethingToLose(), false);
  });

  it("记过东西就算", () => {
    storage.raw(KEYS.dietLog, [{ id: "e1" }]);
    assert.equal(hasSomethingToLose(), true);
  });

  it("空数组 / 空对象 / 字面 null 都算「还没记」", () => {
    storage.setItem(KEYS.dietLog, "[]");
    storage.setItem(KEYS.meals, "{}");
    storage.setItem(KEYS.weights, "null");
    assert.equal(hasSomethingToLose(), false);
  });
});

describe("该不该提醒", () => {
  it("刚装好、什么都没记 → 不提醒", () => {
    assert.equal(shouldRemindBackup(T0), false);
  });

  it("⚠ 空库放一年也不提醒 —— 提醒一个没东西可丢的人只会让提醒贬值", () => {
    ensureBackupState(T0);
    assert.equal(shouldRemindBackup(at(365)), false);
  });

  it("有数据但还没到 30 天 → 不提醒", () => {
    storage.raw(KEYS.dietLog, [{ id: "e1" }]);
    ensureBackupState(T0);
    assert.equal(shouldRemindBackup(at(BACKUP_REMIND_AFTER_DAYS - 1)), false);
  });

  it("有数据且满 30 天 → 提醒", () => {
    storage.raw(KEYS.dietLog, [{ id: "e1" }]);
    ensureBackupState(T0);
    assert.equal(shouldRemindBackup(at(BACKUP_REMIND_AFTER_DAYS)), true);
  });

  it("刚备份过 → 不提醒，并从备份那天重新计时", () => {
    storage.raw(KEYS.dietLog, [{ id: "e1" }]);
    ensureBackupState(T0);
    assert.equal(shouldRemindBackup(at(31)), true);
    markBackedUp(at(31));
    assert.equal(shouldRemindBackup(at(31)), false);
    assert.equal(shouldRemindBackup(at(31 + BACKUP_REMIND_AFTER_DAYS)), true);
  });

  it("「稍后再说」只安静 7 天，不是永久关闭", () => {
    storage.raw(KEYS.dietLog, [{ id: "e1" }]);
    ensureBackupState(T0);
    snoozeBackupReminder(at(31));
    assert.equal(shouldRemindBackup(at(31)), false);
    assert.equal(shouldRemindBackup(at(31 + BACKUP_SNOOZE_DAYS - 1)), false);
    assert.equal(shouldRemindBackup(at(31 + BACKUP_SNOOZE_DAYS)), true);
  });

  it("备份会顺手清掉静默期 —— 刚备份完不该还挂着「稍后再说」", () => {
    storage.raw(KEYS.dietLog, [{ id: "e1" }]);
    ensureBackupState(T0);
    snoozeBackupReminder(at(31));
    assert.notEqual(peekBackupState()!.snoozedUntil, null);
    markBackedUp(at(32));
    assert.equal(peekBackupState()!.snoozedUntil, null);
  });

  it("从没备份过时，界面能区分「从没备份」和「0 天前备份过」", () => {
    storage.raw(KEYS.dietLog, [{ id: "e1" }]);
    const before = ensureBackupState(T0);
    assert.equal(before.lastBackupAt, null);
    markBackedUp(T0);
    const after = ensureBackupState(T0);
    assert.equal(after.lastBackupAt, T0.toISOString());
    // 两者算出来的天数可能相同，但语义不同 —— 界面文案要分开
    assert.equal(daysSinceBackup(before, T0), daysSinceBackup(after, T0));
  });
});
