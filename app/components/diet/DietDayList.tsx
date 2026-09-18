"use client";

/**
 * 早中晚餐 —— 这一天吃进去的东西的骨架。
 *
 * 这是饮食页的**主结构**，不是附属清单：一天摄入多少是**结果**，
 * 三餐各自吃了什么才是**原因**，能改的也是后者。所以四餐并列摆开，
 * 每餐给出本餐热量与参考占比，条目挂在各自餐次下。
 *
 * 三个刻意的选择：
 * 1. **顺序固定为早/午/晚/加餐**，不按记录的先后。补录时顺序会乱，固定顺序才扫得清「今天吃了几顿」。
 * 2. **每餐的参考热量一定写「参考」。** 真实作息里有人不吃早饭、有人晚饭才是主餐 ——
 *    把 25/40/35 当成标准去判定对错，是一种没有根据的指责。
 * 3. 每条都带**折算依据**（多少克、按什么折算的）。这是可追溯性的最后一环：
 *    数字在下达的时候就该能被质疑，而不是等到发现结论不对再回头查。
 */

import { emitDataChanged } from "@/lib/bus";
import { groupByMealSlot } from "@/lib/nutrition/core";
import { MEAL_SPLIT_NOTE, mealKcalTarget } from "@/lib/nutrition/targets";
import type { DietEntry, NutritionTargets } from "@/lib/nutrition/types";
import { deleteDietEntry } from "@/lib/storage";

export function DietDayList({
  entries,
  targets,
}: {
  entries: DietEntry[];
  targets: NutritionTargets;
}) {
  const groups = groupByMealSlot(entries);
  const dayKcal = Math.round(groups.reduce((a, g) => a + g.totals.values.kcal, 0));
  const dayPct = targets.kcal > 0 ? Math.round((dayKcal / targets.kcal) * 100) : 0;

  return (
    <section className="yq-card" style={{ marginBottom: 14 }}>
      <div className="yq-section-title">
        <span>早中晚餐</span>
        <span className="yq-num yq-hint">
          {dayKcal} / {targets.kcal} kcal · {dayPct}%
        </span>
      </div>

      {entries.length === 0 && (
        <p className="yq-hint" style={{ marginBottom: 4 }}>
          今天还没记。上面选好餐次，说一句「一包薯片，一杯奶茶」就行。
        </p>
      )}

      {groups.map((g, gi) => {
        const ref = mealKcalTarget(targets.kcal, g.slot);
        const kcal = Math.round(g.totals.values.kcal);
        const over = ref ? kcal > ref * 1.1 : false;
        const width = ref ? Math.min(100, Math.round((kcal / ref) * 100)) : 0;

        return (
          <div
            key={g.slot}
            role="group"
            aria-label={`${g.slot}的记录`}
            style={gi === 0 ? { marginTop: 6 } : { borderTop: "1px solid var(--yq-line)", marginTop: 12, paddingTop: 10 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <span className="yq-label" style={{ marginBottom: 0 }}>{g.slot}</span>
              <span className="yq-num yq-hint" style={over ? { color: "var(--yq-accent)" } : undefined}>
                {kcal} kcal{ref ? ` / 参考 ${ref}` : ""}
              </span>
            </div>

            {/* 加餐不占份额，所以没有参考值 —— 也就不画比例条，免得凭空定一个"该吃多少" */}
            {ref !== null && (
              <div className="yq-bar" style={{ marginTop: 5 }}>
                <span style={{ width: `${width}%`, background: over ? "var(--yq-accent)" : "var(--yq-primary)" }} />
              </div>
            )}

            {g.entries.length === 0 ? (
              // 整天都没记时上面已经说过一次了，这里不再四行重复
              entries.length > 0 ? <p className="yq-hint" style={{ marginTop: 5 }}>这一餐还没记</p> : null
            ) : (
              g.entries.map((e) => (
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
              ))
            )}
          </div>
        );
      })}

      <p className="yq-hint" style={{ marginTop: 10 }}>
        {MEAL_SPLIT_NOTE}
      </p>
      <p className="yq-hint" style={{ marginTop: 4 }}>
        记录里的营养值是<b>当时</b>算出来的快照：以后修正食物库，也不会改写你过去的账。
      </p>
    </section>
  );
}
