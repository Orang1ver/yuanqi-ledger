"use client";

import { useEffect, useState } from "react";
import { downloadBackup } from "@/lib/storage/backup";
import {
  daysSinceBackup,
  ensureBackupState,
  shouldRemindBackup,
  snoozeBackupReminder,
} from "@/lib/storage/backupReminder";

/**
 * 「久未备份」横幅。
 *
 * 为什么需要它：数据**只在这台设备的 localStorage 里** —— 没有服务端、没有账号。
 * 清一次缓存、换台机器、误点一次「清空数据」，全都找不回来。
 * 导出能力早就写好了（设置页），但**用户不会主动去点一个他没理由点的按钮** ——
 * 所以得有人在他面前提一句，而且只在他真的该备份的时候提。
 *
 * 三条刻意的克制（判断逻辑都在 `lib/storage/backupReminder.ts`，那边有单测压边界）：
 *  1. **空库不出现**。刚装好、什么都没记的人，备份出来是个空文件，提醒他只会让提醒贬值。
 *  2. **「稍后」是安静 7 天，不是永久关闭**。永久关闭等于这个功能不存在 ——
 *     而它是唯一能防止数据不可逆丢失的机制。
 *  3. **导出按钮不含 AI Key**（与设置页的默认勾选一致，更安全）。
 *     要连 Key 一起导出，去设置页勾选。
 */
export function BackupReminderBanner() {
  const [days, setDays] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    /*
     * 只能在 effect 里判断：要读 localStorage，服务端读不到。
     * 放进 useState 的惰性初始化会造成 hydration 不一致（同 IOSInstallHint 里那条注释）。
     * 初始值保持 null，判断通过才 setState —— 这是"读一次外部环境"，不是派生状态。
     */
    if (!shouldRemindBackup()) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDays(daysSinceBackup(ensureBackupState()));
  }, []);

  if (days === null) return null;

  return (
    <div
      /*
       * 稳定的定位钩子：冒烟测试用它找横幅。**不要靠按钮文案去定位** ——
       * 设置页里也有一个「导出备份」，将来任何地方再出现「稍后」，
       * 基于文本子串的断言就会被别处的文案救活（地雷 24）。
       */
      data-yq="backup-reminder"
      style={{
        background: "var(--yq-accent-soft)",
        color: "var(--yq-accent-ink)",
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <span style={{ flex: 1 }}>
        你的记录只存在这台设备上。已经 <b>{days} 天</b>没导出备份了 —— 清一次缓存就全没了。
      </span>
      <button
        className="yq-btn yq-btn-sm yq-btn-primary"
        onClick={() => {
          // downloadBackup 内部会记下"刚备份过"，横幅下次打开就不会再出现
          downloadBackup(false);
          setDays(null);
        }}
      >
        导出备份
      </button>
      <button
        className="yq-btn yq-btn-sm yq-btn-ghost"
        style={{ color: "var(--yq-accent-ink)" }}
        title="7 天后再提醒"
        onClick={() => {
          snoozeBackupReminder();
          setDays(null);
        }}
      >
        稍后
      </button>
    </div>
  );
}
