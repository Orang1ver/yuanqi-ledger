"use client";

/**
 * 当天记了些什么，按餐次分组。
 *
 * 两个刻意的选择：
 * 1. **顺序固定为早/午/晚/加餐**，不按记录的先后。用户补录时顺序会乱，
 *    固定顺序才扫得清「今天到底吃了几顿」。
 * 2. 每条都带**折算依据**（多少克、按什么折算的）。这是可追溯性的最后一环：
 *    数字在下达的时候就该能被质疑，而不是等到发现结论不对再回头查。
 */

import { emitDataChanged } from "@/lib/bus";
import { groupByMealSlot } from "@/lib/nutrition/core";
import type { DietEntry } from "@/lib/nutrition/types";
import { deleteDietEntry } from "@/lib/storage";

const SLOT_LABEL: Record<string, string> = {
  早餐: "早餐",
  午餐: "午餐",
  晚餐: "晚餐",
  加餐: "加餐",
};

export function DietDayList({ entries }: { entries: DietEntry[] }) {
  if (!entries.length) {
    return (
      <section className="yq-card" style={{ marginBottom: 14 }}>
        <div className="yq-section-title">
          <span>当天的记录</span>
        </div>
        <p className="yq-empty" style={{ paddingBottom: 0 }}>还没有记录。</p>
      </section>
    );
  }

  const groups = groupByMealSlot(entries);

  return (
    <section className="yq-card" style={{ marginBottom: 14 }}>
      <div className="yq-section-title">
        <span>当天的记录</span>
        <span className="yq-hint">{entries.length} 条</span>
      </div>

      {groups.map((g) => {
        if (!g.entries.length) return null;
        return (
          <div key={g.slot} style={{ marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="yq-label">{SLOT_LABEL[g.slot] ?? g.slot}</span>
              <span className="yq-num yq-hint">{Math.round(g.totals.values.kcal)} kcal</span>
            </div>

            {g.entries.map((e) => (
              <div className="yq-row" key={e.id}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: "var(--yq-ink)" }}>
                    {e.name}
                    <span className="yq-hint" style={{ marginLeft: 6 }}>
                      {e.amount} {e.unitLabel} · {Math.round(e.grams)}g
                    </span>
                  </div>
                  <p className="yq-hint" style={{ marginTop: 1 }}>
                    {e.time} · {Math.round(e.nutrition.kcal)} kcal · 蛋白{" "}
                    {e.nutrition.protein.toFixed(1)}g · 脂肪 {e.nutrition.fat.toFixed(1)}g · 碳水{" "}
                    {e.nutrition.carb.toFixed(1)}g
                    {e.nutrition.sodium === undefined ? " · 钠 无数据" : ` · 钠 ${Math.round(e.nutrition.sodium)}mg`}
                  </p>
                </div>
                <button
                  className="yq-btn yq-btn-sm yq-btn-ghost"
                  onClick={() => {
                    deleteDietEntry(e.id);
                    emitDataChanged();
                  }}
                >
                  删
                </button>
              </div>
            ))}
          </div>
        );
      })}

      <p className="yq-hint" style={{ marginTop: 6 }}>
        记录里的营养值是<b>当时</b>算出来的快照：以后修正食物库，也不会改写你过去的账。
      </p>
    </section>
  );
}
