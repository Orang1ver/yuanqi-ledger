"use client";

/**
 * 今日营养总览：热量环 + 三大营养素供能比 + 逐项对比条。
 *
 * ⚠️ 这个组件最重要的职责不是把数字画好看，而是**把不确定性画出来**：
 *  - 钠/纤维没有数据时，不画一根 0 的条，而是直接写「数据不足」并说明有多少条记录缺它。
 *    画 0 条会让用户以为"今天几乎没吃盐"，而事实是"我们不知道"。
 *  - 目标不是从健康档案推来的时候，明确标「参考值」。
 *
 * ⚠️ **逐项对比条只由 `compareToTargets` 驱动**（它按 `core.ts` 的 `TARGET_META` 逐项产出），
 * 所以「添加糖」那一行是**加进 TARGET_META 之后自动出现**的，这里一行渲染逻辑都不复制 ——
 * 抄第二份的话，将来改口径必然只改一处，两处就长得不一样了。
 *
 * 也因此，添加糖那句必须一直在的措辞（「**已记录的**添加糖……」）**不在这个文件里**，
 * 而在 `core.ts` 的 `coverageNote`：那是判据层，三个可选营养素的覆盖率口径都在那儿。
 * 谁要是觉得那行注释太长而删掉它，界面上就会出现「今天糖摄入 12g」这种没说清的话。
 */

import { compareToTargets, energyRatios } from "@/lib/nutrition/core";
import type { NutritionTargets, NutritionTotals, NutrientStatus } from "@/lib/nutrition/types";

const R = 48;
const C = 2 * Math.PI * R;

function verdictColor(v: NutrientStatus["verdict"]): string {
  if (v === "high") return "var(--yq-accent)";
  if (v === "low") return "var(--yq-info)";
  if (v === "ok") return "var(--yq-primary)";
  return "var(--yq-muted)";
}

function verdictMark(v: NutrientStatus["verdict"]): string {
  if (v === "high") return "超了";
  if (v === "low") return "还差";
  if (v === "ok") return "在范围内";
  return "数据不足";
}

function Row({ s }: { s: NutrientStatus }) {
  const isInt = s.unit === "kcal" || s.unit === "mg";
  const fmt = (n: number) => (isInt ? String(Math.round(n)) : n.toFixed(1));
  const width = s.verdict === "unknown" ? 0 : Math.min(100, Math.round(s.ratio * 100));

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--yq-ink)" }}>{s.label}</span>
        {s.verdict === "unknown" ? (
          <span className="yq-hint" style={{ color: "var(--yq-muted)" }}>数据不足</span>
        ) : (
          <span className="yq-num" style={{ fontSize: 13, color: verdictColor(s.verdict) }}>
            {fmt(s.intake)} / {fmt(s.target)} {s.unit}
          </span>
        )}
      </div>

      <div className="yq-bar" style={{ marginTop: 5 }}>
        <span style={{ width: `${width}%`, background: verdictColor(s.verdict) }} />
      </div>

      <p className="yq-hint" style={{ marginTop: 3 }}>
        {s.note ?? verdictMark(s.verdict)}
      </p>
    </div>
  );
}

export function NutritionOverview({
  totals,
  targets,
  targetsFromProfile,
}: {
  totals: NutritionTotals;
  targets: NutritionTargets;
  targetsFromProfile: boolean;
}) {
  const v = totals.values;
  const pct = targets.kcal > 0 ? v.kcal / targets.kcal : 0;
  const statuses = compareToTargets(totals, targets);
  const ratios = energyRatios(v);
  const over = pct > 1.1;

  const ringColor = over ? "var(--yq-accent)" : "var(--yq-primary)";

  return (
    <section className="yq-card" style={{ marginBottom: 14 }}>
      <div className="yq-section-title">
        <span>今天吃了多少</span>
        {targetsFromProfile ? (
          <span className="yq-badge yq-badge-primary">按你的档案</span>
        ) : (
          <span className="yq-badge yq-badge-info">参考值 · 还没填健康档案</span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="热量完成度">
          <circle cx="60" cy="60" r={R} fill="none" stroke="var(--yq-line)" strokeWidth="11" />
          <circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke={ringColor}
            strokeWidth="11"
            strokeLinecap="round"
            strokeDasharray={`${Math.min(1, pct) * C} ${C}`}
            transform="rotate(-90 60 60)"
          />
          <text
            x="60"
            y="55"
            textAnchor="middle"
            fontSize="26"
            fontWeight="600"
            fill="var(--yq-ink)"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {Math.round(v.kcal)}
          </text>
          <text x="60" y="74" textAnchor="middle" fontSize="11" fill="var(--yq-muted)">
            / {targets.kcal} kcal
          </text>
        </svg>

        <div style={{ minWidth: 190, flex: 1 }}>
          <p className="yq-hint" style={{ marginBottom: 8 }}>
            占今天目标的 <b style={{ color: ringColor }}>{Math.round(pct * 100)}%</b>
            {over ? "，已经超过了" : ""}
          </p>

          {/* 三大营养素供能比：比单看克数更容易看出结构问题 */}
          <p className="yq-label" style={{ marginBottom: 6 }}>三大营养素供能比</p>
          <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden" }}>
            {[
              { k: "蛋白", p: ratios.protein, c: "var(--yq-primary)" },
              { k: "脂肪", p: ratios.fat, c: "var(--yq-accent)" },
              { k: "碳水", p: ratios.carb, c: "var(--yq-info)" },
            ].map((seg) => (
              <span key={seg.k} style={{ width: `${seg.p}%`, background: seg.c }} />
            ))}
          </div>
          <p className="yq-hint" style={{ marginTop: 5 }}>
            蛋白 {Math.round(ratios.protein)}% · 脂肪 {Math.round(ratios.fat)}% · 碳水{" "}
            {Math.round(ratios.carb)}%（建议脂肪 20%~30%）
          </p>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        {statuses.map((s) => (
          <Row key={s.key} s={s} />
        ))}
      </div>

      {totals.entries === 0 && (
        <p className="yq-empty" style={{ paddingBottom: 0 }}>
          今天还没有记录。上面说一句「一包薯片，一杯奶茶」试试。
        </p>
      )}
    </section>
  );
}
