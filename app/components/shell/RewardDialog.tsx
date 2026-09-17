"use client";

import { useEffect } from "react";
import confetti from "canvas-confetti";
import type { Badge } from "@/lib/rewards";

/**
 * 达标庆祝。
 *
 * 只在"今天首次达标"时弹一次 —— 判断放在调用方（CheckinCard 用 rewards 里的 celebrated 去重），
 * 否则用户每加一杯水就弹一次，很快就烦了。
 *
 * 尊重 prefers-reduced-motion：动画敏感的用户只看到文字，不放彩带。
 */
export function RewardDialog({
  streak,
  badges,
  onClose,
}: {
  streak: number;
  badges: Badge[];
  onClose: () => void;
}) {
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    confetti({
      particleCount: 70,
      spread: 68,
      origin: { y: 0.7 },
      colors: ["#2E7D62", "#5FBB95", "#D98329", "#F0C48A", "#F7F5EF"],
    });
  }, []);

  return (
    <div className="yq-scrim" onClick={onClose}>
      <div className="yq-sheet" onClick={(e) => e.stopPropagation()} style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, lineHeight: 1.2 }}>🎉</div>
        <h2 style={{ fontSize: 19, fontWeight: 700, marginTop: 6 }}>今天两个目标都达成了</h2>
        <p className="yq-hint" style={{ marginTop: 6 }}>
          喝水 ✅ 步数 ✅ —— 连续第 <b className="yq-num">{streak}</b> 天
        </p>

        {badges.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p className="yq-label" style={{ marginBottom: 8 }}>
              新徽章
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
              {badges.map((b) => (
                <span key={b.id} className="yq-badge yq-badge-accent" style={{ fontSize: 13, padding: "6px 12px" }}>
                  {b.emoji} {b.label}
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          <button className="yq-btn yq-btn-primary" onClick={onClose} style={{ width: "100%" }}>
            继续
          </button>
        </div>
      </div>
    </div>
  );
}
