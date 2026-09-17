"use client";

import { useEffect, useState } from "react";
import { onDataChanged } from "@/lib/bus";
import { BADGES, calcCurrentStreak, nextBadge } from "@/lib/rewards";
import { EXERCISE_MILESTONES, exerciseStats } from "@/lib/exercise";
import { loadExercises, loadExerciseAwards, loadRewards } from "@/lib/storage/health";
import { todayISO } from "@/lib/date";

/**
 * 徽章墙。
 *
 * ⚠️ 两块**必须分开渲染**：
 * - 打卡徽章来自 `recipe.rewards.v1` 的 badges（按"喝水+步数达标"的连续天数发）
 * - 运动里程碑来自 `recipe.exerciseAwards.v1`（按累计次数/里程发）
 * 混在一起会把运动成就显示成"还差 N 天"这种驴唇不对马嘴的文案。
 */
export function BadgeWall() {
  const [rewards, setRewards] = useState(() => loadRewards());
  const [awards, setAwards] = useState(() => loadExerciseAwards());
  const [exercises, setExercises] = useState(() => loadExercises());

  // 同页的打卡卡达标后、运动卡记一笔后，徽章墙要立刻反映出来
  useEffect(() => {
    return onDataChanged(() => {
      setRewards(loadRewards());
      setAwards(loadExerciseAwards());
      setExercises(loadExercises());
    });
  }, []);

  const today = todayISO();
  const streak = calcCurrentStreak(rewards.days, today);
  const next = nextBadge(rewards.badges);
  const stats = exerciseStats(exercises);

  return (
    <section className="yq-card" style={{ marginBottom: 14 }}>
      <div className="yq-section-title">
        <span>成就</span>
        <span className="yq-hint">当前连续 {streak} 天</span>
      </div>

      <p className="yq-label" style={{ marginBottom: 8 }}>
        打卡徽章（{Object.keys(rewards.badges).length}/{BADGES.length}）
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
        {BADGES.map((b) => {
          const owned = !!rewards.badges[b.id];
          return (
            <span
              key={b.id}
              className="yq-chip yq-chip-static"
              style={{
                opacity: owned ? 1 : 0.42,
                background: owned ? "var(--yq-primary-soft)" : "var(--yq-surface-2)",
                borderColor: owned ? "var(--yq-primary)" : "var(--yq-line)",
              }}
              title={owned ? `${b.label} · ${rewards.badges[b.id]} 达成` : b.label}
            >
              {b.emoji} {b.label}
            </span>
          );
        })}
      </div>
      {next && (
        <p className="yq-hint">
          下一枚：{next.emoji} {next.label}，还差 {Math.max(0, next.days - streak)} 天
        </p>
      )}

      <hr style={{ border: 0, borderTop: "1px solid var(--yq-line)", margin: "16px 0" }} />

      <p className="yq-label" style={{ marginBottom: 8 }}>
        运动里程碑（{Object.keys(awards).length}/{EXERCISE_MILESTONES.length}）
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {EXERCISE_MILESTONES.map((m) => {
          const owned = !!awards[m.id];
          return (
            <span
              key={m.id}
              className="yq-chip yq-chip-static"
              style={{
                opacity: owned ? 1 : 0.42,
                background: owned ? "var(--yq-accent-soft)" : "var(--yq-surface-2)",
                borderColor: owned ? "var(--yq-accent)" : "var(--yq-line)",
              }}
              title={owned ? `${m.label} · ${awards[m.id]} 达成` : `${m.label} · ${m.progress(stats)}`}
            >
              {m.emoji} {m.label}
            </span>
          );
        })}
      </div>
      <p className="yq-hint" style={{ marginTop: 8 }}>
        累计 {stats.count} 次运动 · {stats.minutes} 分钟
        {stats.km > 0 ? ` · ${stats.km}km` : ""} · 活跃 {stats.activeDays} 天
      </p>
    </section>
  );
}
