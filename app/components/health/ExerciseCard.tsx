"use client";

import { useEffect, useState } from "react";
import { BACKFILL_DAYS, addDays, formatShort, todayISO } from "@/lib/date";
import { emitDataChanged, onDataChanged } from "@/lib/bus";
import { addExercise, loadExerciseAwards, loadExercises, removeExercise, saveExerciseAwards } from "@/lib/storage/health";
import {
  EXERCISE_TYPES,
  exerciseEmoji,
  exerciseStats,
  nextMilestone,
  pendingMilestones,
} from "@/lib/exercise";
import type { ExerciseRecord, ExerciseType } from "@/lib/types";

/**
 * 运动记录卡。
 *
 * ⚠️ 里程碑存在 `recipe.exerciseAwards.v1`，与打卡徽章（`recipe.rewards.v1`）
 * 是**两套独立命名空间**。混用会让运动成就污染打卡徽章墙，显示成"还差 N 天"。
 *
 * ⚠️ 时长/距离输入用字符串 state（数字 state 会导致删不掉、留个 0）。
 */
export function ExerciseCard({ compact = false }: { compact?: boolean }) {
  const today = todayISO();
  const [list, setList] = useState<ExerciseRecord[]>(() => loadExercises());
  const [awards, setAwards] = useState(() => loadExerciseAwards());

  const [type, setType] = useState<ExerciseType>("散步");
  const [date, setDate] = useState(today);
  const [minutes, setMinutes] = useState("");
  const [km, setKm] = useState("");
  const [note, setNote] = useState("");

  const stats = exerciseStats(list);
  const next = nextMilestone(stats, awards);

  // 别人改了数据（导入备份 / 清空 / 另一个标签页）也要跟着刷，否则停在旧列表
  useEffect(
    () =>
      onDataChanged(() => {
        setList(loadExercises());
        setAwards(loadExerciseAwards());
      }),
    [],
  );

  function add() {
    const m = minutes.trim() === "" ? undefined : Number(minutes);
    const d = km.trim() === "" ? undefined : Number(km);
    if (m !== undefined && (!Number.isFinite(m) || m <= 0)) return;
    if (d !== undefined && (!Number.isFinite(d) || d <= 0)) return;
    if (m === undefined && d === undefined) return;

    const nextList = addExercise({ date, type, minutes: m, distanceKm: d, note: note.trim() || undefined });
    setList(nextList);
    setMinutes("");
    setKm("");
    setNote("");

    // 达成里程碑就记下来（一旦拿到永久保留）
    const s = exerciseStats(nextList);
    const got = pendingMilestones(s, awards);
    if (got.length) {
      const nextAwards = { ...awards };
      for (const g of got) nextAwards[g.id] = today;
      setAwards(nextAwards);
      saveExerciseAwards(nextAwards);
    }

    emitDataChanged();
  }

  function del(id: string) {
    setList(removeExercise(id));
    emitDataChanged();
  }

  const dateOptions = Array.from({ length: BACKFILL_DAYS + 1 }, (_, i) => addDays(today, -i));
  const shown = compact ? list.slice(0, 3) : list;

  return (
    <section className="yq-card" style={{ marginBottom: 14 }}>
      <div className="yq-section-title">
        <span>运动</span>
        <span className="yq-hint">
          累计 {stats.count} 次 · {stats.minutes} 分钟
          {stats.km > 0 ? ` · ${stats.km}km` : ""}
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {EXERCISE_TYPES.map((t) => (
          <button key={t.key} className="yq-chip" data-on={type === t.key} onClick={() => setType(t.key)}>
            {t.emoji} {t.key}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select
          className="yq-select"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ width: "auto", minHeight: 36, fontSize: 13 }}
        >
          {dateOptions.map((d) => (
            <option key={d} value={d}>
              {d === today ? "今天" : formatShort(d)}
            </option>
          ))}
        </select>
        <input
          className="yq-input"
          type="number"
          inputMode="numeric"
          placeholder="分钟"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          style={{ maxWidth: 100 }}
        />
        <input
          className="yq-input"
          type="number"
          inputMode="decimal"
          step="0.1"
          placeholder="公里"
          value={km}
          onChange={(e) => setKm(e.target.value)}
          style={{ maxWidth: 100 }}
        />
        <button className="yq-btn yq-btn-sm yq-btn-primary" onClick={add}>
          记一笔
        </button>
      </div>
      <input
        className="yq-input"
        placeholder="备注（可选）"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        style={{ marginTop: 8 }}
      />

      {next && (
        <p className="yq-hint" style={{ marginTop: 10 }}>
          下一个里程碑：{next.emoji} {next.label} —— {next.progress(stats)}
        </p>
      )}

      <div style={{ marginTop: 12 }}>
        {shown.length === 0 ? (
          <div className="yq-empty">还没有运动记录</div>
        ) : (
          shown.map((r) => (
            <div key={r.id} className="yq-row">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {exerciseEmoji(r.type)} {r.type}
                  {r.minutes ? ` · ${r.minutes} 分钟` : ""}
                  {r.distanceKm ? ` · ${r.distanceKm}km` : ""}
                </div>
                <div className="yq-hint">
                  {formatShort(r.date)}
                  {r.note ? ` · ${r.note}` : ""}
                </div>
              </div>
              <button className="yq-btn yq-btn-sm yq-btn-ghost" onClick={() => del(r.id)}>
                删除
              </button>
            </div>
          ))
        )}
        {compact && list.length > 3 && (
          <p className="yq-hint" style={{ paddingTop: 8 }}>
            还有 {list.length - 3} 条，去「健康」页看全部
          </p>
        )}
      </div>
    </section>
  );
}
