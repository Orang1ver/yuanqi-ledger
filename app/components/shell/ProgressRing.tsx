"use client";

import type { ReactNode } from "react";

/**
 * 圆环进度。
 *
 * 用 SVG 的 stroke-dasharray 画弧，比 conic-gradient 更好控制端点圆角与动画。
 * 圆角端点（strokeLinecap="round"）在有进度时才好看；进度为 0 时若也画圆角，
 * 会在 12 点方向留下一个小圆点，看起来像"已经有进度了"，所以 0% 时直接不画弧。
 */
export function ProgressRing({
  pct,
  size = 108,
  stroke = 10,
  color = "var(--yq-primary)",
  trackColor = "var(--yq-line)",
  children,
  ariaLabel,
}: {
  /** 0~100 */
  pct: number;
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
  children?: ReactNode;
  ariaLabel?: string;
}) {
  const safe = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = (safe / 100) * c;

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      style={{ position: "relative", width: size, height: size, flex: "0 0 auto" }}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
        {safe > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${c - filled}`}
            style={{ transition: "stroke-dasharray 0.45s ease" }}
          />
        )}
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          lineHeight: 1.25,
        }}
      >
        {children}
      </div>
    </div>
  );
}
