"use client";

import type { WeightEntry } from "@/lib/types";
import { weightRange } from "@/lib/weight";

/**
 * 体重趋势折线（纯 SVG，无图表库）。
 *
 * 为什么不用图表库：这点数据量不值得多引一个依赖，且 SVG 能直接用主题变量上色。
 * 坐标：x 按记录的序号均匀排布（不是按日期比例）—— 体重不是每天都记，
 * 按日期比例画会把点挤成一堆、看不出趋势。
 */
export function WeightChart({ entries, height = 132 }: { entries: WeightEntry[]; height?: number }) {
  if (entries.length < 2) {
    return <div className="yq-empty">记满 2 天就能看到趋势了</div>;
  }

  const W = 520;
  const H = height;
  const padX = 14;
  const padY = 16;
  const { min, max } = weightRange(entries);
  const span = max - min || 1;

  const x = (i: number) => padX + (i * (W - padX * 2)) / (entries.length - 1);
  const y = (kg: number) => padY + ((max - kg) / span) * (H - padY * 2);

  const line = entries.map((e, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(e.weightKg).toFixed(1)}`).join(" ");
  const area = `${line} L${x(entries.length - 1).toFixed(1)},${H - padY} L${x(0).toFixed(1)},${H - padY} Z`;
  const last = entries[entries.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="体重趋势">
      <defs>
        <linearGradient id="yq-wfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--yq-primary)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--yq-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* 上下两条参考线，让曲线有个坐标感 */}
      <line x1={padX} y1={padY} x2={W - padX} y2={padY} stroke="var(--yq-line)" strokeWidth="1" />
      <line x1={padX} y1={H - padY} x2={W - padX} y2={H - padY} stroke="var(--yq-line)" strokeWidth="1" />

      <path d={area} fill="url(#yq-wfill)" />
      <path d={line} fill="none" stroke="var(--yq-primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

      {entries.map((e, i) => (
        <circle
          key={e.date}
          cx={x(i)}
          cy={y(e.weightKg)}
          r={i === entries.length - 1 ? 4.5 : 3}
          fill={i === entries.length - 1 ? "var(--yq-primary)" : "var(--yq-surface)"}
          stroke="var(--yq-primary)"
          strokeWidth="2"
        />
      ))}

      <text x={padX} y={padY - 5} fontSize="10" fill="var(--yq-muted)">
        {max.toFixed(1)}
      </text>
      <text x={padX} y={H - padY + 12} fontSize="10" fill="var(--yq-muted)">
        {min.toFixed(1)}
      </text>
      <text x={W - padX} y={y(last.weightKg) - 9} fontSize="11" fill="var(--yq-primary-ink)" textAnchor="end">
        {last.weightKg.toFixed(1)}kg
      </text>
    </svg>
  );
}
