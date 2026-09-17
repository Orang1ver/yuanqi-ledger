"use client";

/**
 * 今天最该改的一件事。
 *
 * **只给一条。** 列一堆指标（钠高了、纤维低了、蛋白不够、供能比偏了）
 * 的结果是用户一条都不会改 —— 那是报告，不是建议。
 * 所以这里只取规则引擎排在最前的那一条，并附一个具体替换方案。
 *
 * 另外：当天没有任何真实偏差时，就老实说"没什么要改的"，
 * 不为了显得有用而硬凑一条（判断逻辑在 `lib/nutrition/advice.ts`）。
 */

import { findIssues, topAdvice } from "@/lib/nutrition/advice";
import type { DietEntry, NutritionTargets, NutritionTotals } from "@/lib/nutrition/types";

export function AdviceCard({
  entries,
  totals,
  targets,
}: {
  entries: DietEntry[];
  totals: NutritionTotals;
  targets: NutritionTargets;
}) {
  const issues = findIssues({ entries, totals, targets });
  const advice = topAdvice(issues);

  return (
    <section className="yq-card" style={{ marginBottom: 14 }}>
      <div className="yq-section-title">
        <span>今天可以改一件事</span>
      </div>

      {!entries.length ? (
        <p className="yq-hint">还没有记录，先把吃过的记上，这里才会有话说。</p>
      ) : !advice ? (
        <p className="yq-hint">
          今天的记录里没看出明显偏离的地方，保持就行。别忘了记全，才能看出趋势。
        </p>
      ) : (
        <>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--yq-ink)" }}>
            <span className="yq-badge yq-badge-accent" style={{ marginRight: 6 }}>
              {advice.label}
            </span>
            {advice.fact}
          </p>

          <div
            style={{
              marginTop: 10,
              padding: "10px 12px",
              borderRadius: "var(--yq-r-md)",
              background: "var(--yq-accent-soft)",
            }}
          >
            <p className="yq-label" style={{ marginBottom: 4, color: "var(--yq-accent-ink)" }}>
              可以这么做
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--yq-accent-ink)" }}>
              {advice.action}
            </p>
            {advice.swap && (
              <p style={{ fontSize: 13, lineHeight: 1.6, marginTop: 6, color: "var(--yq-accent-ink)" }}>
                替换方案：{advice.swap}
              </p>
            )}
          </div>
        </>
      )}

      <p className="yq-hint" style={{ marginTop: 10 }}>
        只做记录与参考，不构成任何医疗建议。数值是估算，别把它当成测量结果。
      </p>
    </section>
  );
}
