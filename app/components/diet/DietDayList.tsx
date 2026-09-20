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
 *
 * 2026-09-19 补的两件（都是第 3 条的延伸）：
 * - **档位可改**：这条记录如果落在一个多档食物上（饺子有大中小），
 *   当场把它按的是哪一档写出来，并给一排 chips 让你直接换。原来只能删了重记。
 * - **「这个数不对？」**：每条旁边一个入口，把自己的疑问写一句 ——
 *   有 Key 就让模型试着解释，解释不了才整理出一段能贴到 GitHub 的反馈文本。
 *   ⚠️ 用户说的「不对」往往是**份量**不对，而不是数值错 —— 所以档位和这个入口放在一起。
 */

import { emitDataChanged } from "@/lib/bus";
import { groupByMealSlot } from "@/lib/nutrition/core";
import { findFoodByIdIn } from "@/lib/nutrition/lookup";
import { MEAL_SPLIT_NOTE, mealKcalTarget } from "@/lib/nutrition/targets";
import { portionHitOf, tierOfEntry } from "@/lib/nutrition/tiers";
import type { DietEntry, NutritionTargets } from "@/lib/nutrition/types";
import { deleteDietEntry, editDietEntry, loadCustomFoods } from "@/lib/storage";
import { EntryFeedback } from "./EntryFeedback";
import { PortionChips } from "./PortionChips";

export function DietDayList({
  entries,
  targets,
}: {
  entries: DietEntry[];
  targets: NutritionTargets;
}) {
  // 用户自己的食物库。读一次给整棵子树用 —— 别在 map 里反复碰 localStorage。
  // 这个是**运行时数据**（可能为空），所以取不到不会影响老记录。
  const customFoods = loadCustomFoods();

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
              g.entries.map((e) => {
                const tier = tierOfEntry(e);
                const hit = portionHitOf(e);
                // ⚠️ 用合并检索：已记的账里可能是**用户自己加的食物**（id 带 user-），
                // 只听内置库的话，那些记录在这一行会变成"库里没有"—— 明明就在他自己的库里。
                const food = findFoodByIdIn(e.foodId, customFoods);
                // 每条档位的克数 = 总克数 ÷ 数量。PortionChips 的 grams 是**每单位**的口径。
                const perUnit = e.amount > 0 ? e.grams / e.amount : e.grams;

                return (
                  <div
                    key={e.id}
                    style={{ borderTop: "1px solid var(--yq-line)", paddingTop: 9, paddingBottom: 9 }}
                  >
                    <div className="yq-row" style={{ paddingTop: 0, paddingBottom: 0 }}>
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

                    {tier && (
                      /* 只有在真有歧义（这个量词下不止一档）时才多画这一行 */
                      <div style={{ marginTop: 7 }} data-yq="entry-tier">
                        <p className="yq-hint" style={{ marginBottom: 4 }}>
                          按「{tier.label}」算的 —— 这个量词下有 {tier.total} 档，点一下就能换
                        </p>
                        <PortionChips
                          options={tier.options}
                          currentGrams={perUnit}
                          onPick={(o) => {
                            // 只改克数，数量与量词不动；营养快照由 editDietEntry 重算
                            editDietEntry(e.id, {
                              grams: Math.round(o.grams * e.amount * 10) / 10,
                            });
                            emitDataChanged();
                          }}
                        />
                      </div>
                    )}

                    <div style={{ marginTop: 7 }}>
                      <EntryFeedback
                        ctx={{
                          foodName: e.name,
                          portion: `${e.amount} ${e.unitLabel}`,
                          grams: e.grams,
                          kcal: e.nutrition.kcal,
                          sodium: e.nutrition.sodium,
                          ruleLabel: hit?.portion.label ?? e.unitLabel,
                          ruleGrams: hit?.grams ?? perUnit,
                          ruleNote: hit?.portion.note,
                          source: food?.source ?? "（这条食物在库里已经查不到）",
                          tier: tier
                            ? {
                                label: tier.label,
                                total: tier.total,
                                options: tier.options.map((o) => o.label),
                              }
                            : undefined,
                        }}
                      />
                    </div>
                  </div>
                );
              })
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
