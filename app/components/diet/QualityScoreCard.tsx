"use client";

/**
 * 饮食质量分。
 *
 * 分数的价值全在**可解释**：旁边必须能说清它是哪几维、每维拿了多少、哪一维没算进来。
 * 做不到这一点的话，这就是个凭感觉编出来的数字，而这个项目里最不能要的就是那个。
 *
 * 所以这里把七个维度全部列出来（不是只给一个总分），
 * 并且把「数据不足、未计入」的维度单独用灰字标出来 —— 用户看到的 82 分，
 * 是"在已有数据上"的 82 分。
 */

import { describeScore, scoreDay } from "@/lib/nutrition/score";
import type { DietEntry, NutritionTargets, NutritionTotals } from "@/lib/nutrition/types";

function barColor(ratio: number, insufficient?: boolean): string {
  if (insufficient) return "var(--yq-muted)";
  if (ratio >= 0.8) return "var(--yq-primary)";
  if (ratio >= 0.5) return "var(--yq-info)";
  return "var(--yq-accent)";
}

export function QualityScoreCard({
  entries,
  totals,
  targets,
}: {
  entries: DietEntry[];
  totals: NutritionTotals;
  targets: NutritionTargets;
}) {
  const score = scoreDay({ entries, totals, targets });

  return (
    <section className="yq-card" style={{ marginBottom: 14 }}>
      <div className="yq-section-title">
        <span>今天的饮食质量</span>
        <span className="yq-hint">{describeScore(score)}</span>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <b className="yq-num" style={{ fontSize: 34, color: "var(--yq-ink)" }}>
          {entries.length ? score.total : "—"}
        </b>
        <span className="yq-hint">/ 100</span>
      </div>

      <div style={{ marginTop: 12 }}>
        {score.dimensions.map((d) => (
          <div key={d.key} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
              <span style={{ fontSize: 13, color: d.insufficient ? "var(--yq-muted)" : "var(--yq-ink)" }}>
                {d.label}
              </span>
              <span className="yq-num yq-hint">
                {d.insufficient ? "未计入" : `${Math.round(d.got)} / ${d.max}`}
              </span>
            </div>
            <div className="yq-bar" style={{ marginTop: 4, height: 6 }}>
              <span
                style={{
                  width: d.insufficient ? "0%" : `${Math.round(Math.min(1, d.ratio) * 100)}%`,
                  background: barColor(d.ratio, d.insufficient),
                }}
              />
            </div>
            {d.note && (
              <p className="yq-hint" style={{ marginTop: 2, fontSize: 11 }}>
                {d.note}
              </p>
            )}
          </div>
        ))}
      </div>

      <p className="yq-hint" style={{ marginTop: 8 }}>
        分数只反映记录到的内容。吃过的没记全，分数会偏低 —— 它衡量的是记录，不是人格。
      </p>
    </section>
  );
}
