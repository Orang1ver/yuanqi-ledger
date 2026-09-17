"use client";

import { useState } from "react";
import { DayPanels } from "../components/diet/DayPanels";
import { QuickAddCard } from "../components/diet/QuickAddCard";
import { BottomNav, PageHeader } from "../components/shell/BottomNav";
import { SettingsButton } from "../components/shell/SettingsButton";
import { BACKFILL_DAYS, addDays, formatShort, todayISO } from "@/lib/date";

/**
 * 饮食账本。
 *
 * ⚠️ 这里**刻意持有唯一一个 state：选中日期**。
 * 硬规矩是「页面不放业务 state」，但日期不属于任何一张卡：汇总、建议、记录列表
 * 三张卡必须看同一天，各自持有会立刻出现「记到 17 号、汇总看 18 号」这种错。
 * 它不是业务数据，是这一屏的**视图上下文**，所以放在这一层是合适的 ——
 * 除此之外页面一行状态都不该有。
 *
 * 日期变化靠 `key={date}` 让分析卡整块重挂载，而不是在 effect 里同步状态。
 */
export default function DietPage() {
  const today = todayISO();
  const [date, setDate] = useState(today);

  const dateOptions = Array.from({ length: BACKFILL_DAYS + 1 }, (_, i) => addDays(today, -i));

  return (
    <>
      <main className="yq-shell" style={{ flex: 1, paddingBottom: 20 }}>
        <PageHeader
          title="饮食账本"
          subtitle={date === today ? "今天" : `${formatShort(date)}（补录）`}
          action={
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select
                className="yq-select"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{ width: "auto", minHeight: 34, fontSize: 13 }}
              >
                {dateOptions.map((d) => (
                  <option key={d} value={d}>
                    {d === today ? "今天" : formatShort(d)}
                  </option>
                ))}
              </select>
              <SettingsButton />
            </div>
          }
        />

        <QuickAddCard date={date} />

        <DayPanels key={date} date={date} />
      </main>
      <BottomNav />
    </>
  );
}
