"use client";

import type { ReactNode } from "react";

/**
 * 圆环进度。
 *
 * 用 SVG 的 stroke-dasharray 画弧，比 conic-gradient 更好控制端点圆角与动画。
 * 圆角端点（strokeLinecap="round"）在有进度时才好看；进度为 0 时若也画圆角，
 * 会在 12 点方向留下一个小圆点，看起来像"已经有进度了"。
 *
 * ⚠️ **两条踩过的路，改这个文件前必读：**
 *
 * 1. **不能用 `strokeDasharray` 做过渡动画。** 它要同时改虚线与间隔两段，
 *    浏览器只能对它做逐值插值，中间态是两个值各自跳变 —— 看起来一顿一顿的。
 *    改成经典的 dashoffset 写法：`strokeDasharray` 恒等于周长，只把
 *    `strokeDashoffset` 从「周长」（空）推到「周长 − 已填充」（满），插值就是平滑的。
 *
 * 2. **进度为 0 时那根弧线不能"不渲染"。** 之前写的是 `{safe > 0 && <circle/>}`，
 *    于是 0% 时元素根本不存在；用户第一次点击记录 → 进度 0 → 25%，
 *    这根 circle 是**首次挂载**，而 CSS transition 不会在元素挂载时播放
 *    （它一出现就已经是最终值）—— 表现为「第一次点没动画，第二次之后才有」。
 *    所以：弧线**始终挂载**，靠 `strokeLinecap` 在 0% 时切成 butt 来避免那个小圆点。
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
  /** 已填充的弧长；offset = 周长 − 已填充（0 表示整圈，周长表示空） */
  const offset = c * (1 - safe / 100);

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      style={{ position: "relative", width: size, height: size, flex: "0 0 auto" }}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap={safe > 0 ? "round" : "butt"}
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.45s ease" }}
        />
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
