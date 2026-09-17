"use client";

import { useEffect, useState } from "react";
import { BACKFILL_DAYS, addDays, formatShort, todayISO } from "@/lib/date";
import { emitDataChanged, onDataChanged } from "@/lib/bus";
import { loadHealthProfile, loadWeights, removeWeight, saveWeight } from "@/lib/storage/health";
import {
  baselineForDate,
  deltaText,
  deltaVsDaysAgo,
  deltaVsPrevious,
  sortWeights,
} from "@/lib/weight";
import { WeightChart } from "./WeightChart";

/**
 * 体重卡。
 *
 * 两个刻意的设计：
 * 1) **日期上下文自己管**，不跟随健康页的 selectedDate ——
 *    否则"一边补录前天的喝水、一边把体重记到今天"会串。
 * 2) 起始值是「那天该有的值」，不是默认 60kg ——
 *    补录时若从 60 起步，用户得连点几十下才到自己的体重（见 baselineForDate 的兜底链）。
 *
 * ⚠️ 输入框用字符串 state（数字 state 会导致删不掉、留个 0）。
 */
export function WeightCard() {
  const today = todayISO();
  const profile = loadHealthProfile();

  const [all, setAll] = useState(() => loadWeights());
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState(() => String(baselineForDate(loadWeights(), today, profile?.weightKg ?? null)));
  const [msg, setMsg] = useState("");

  // 别处（如周报页/设置导入备份后）改了体重，这里要跟着刷新
  useEffect(() => onDataChanged(() => setAll(loadWeights())), []);

  const entries = sortWeights(all);
  const latest = entries.length ? entries[entries.length - 1] : null;
  const vsPrev = deltaVsPrevious(all);
  const vs7 = deltaVsDaysAgo(all, today, 7);

  function switchDate(next: string) {
    setDate(next);
    setDraft(String(baselineForDate(all, next, profile?.weightKg ?? null)));
  }

  function save() {
    const kg = Number(draft);
    const next = saveWeight(date, kg);
    if (!next) {
      setMsg("体重看起来不太对（合理范围 25~200kg），没有记录");
      return;
    }
    setAll(next);
    // 同页的周报/图表要看最新值
    emitDataChanged();
    setMsg(`已记录 ${formatShort(date)} ${(Math.round(kg * 10) / 10).toFixed(1)}kg`);
  }

  const dateOptions = Array.from({ length: BACKFILL_DAYS + 1 }, (_, i) => addDays(today, -i));

  return (
    <section className="yq-card" style={{ marginBottom: 14 }}>
      <div className="yq-section-title">
        <span>体重</span>
        {latest && <span className="yq-hint">最近 {formatShort(latest.date)}</span>}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <b className="yq-num" style={{ fontSize: 26 }}>
          {latest ? latest.weightKg.toFixed(1) : "—"}
        </b>
        <span className="yq-hint">kg</span>
        {vsPrev && (
          <span className="yq-hint" style={{ color: "var(--yq-ink-soft)" }}>
            比上次 {deltaText(vsPrev.diff)} kg
          </span>
        )}
        {vs7 && (
          <span className="yq-hint">
            近 7 天 {vs7.diff > 0 ? "+" : ""}
            {vs7.diff.toFixed(1)} kg
          </span>
        )}
      </div>

      <div style={{ margin: "6px -6px 0" }}>
        <WeightChart entries={entries} />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        <select
          className="yq-select"
          value={date}
          onChange={(e) => switchDate(e.target.value)}
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
          inputMode="decimal"
          step="0.1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ maxWidth: 110 }}
        />
        <button className="yq-btn yq-btn-sm yq-btn-primary" onClick={save}>
          记录
        </button>
        {all[date] && (
          <button
            className="yq-btn yq-btn-sm yq-btn-ghost"
            onClick={() => {
              setAll(removeWeight(date));
              emitDataChanged();
              setMsg(`已删除 ${formatShort(date)} 的记录`);
            }}
          >
            删除这天
          </button>
        )}
      </div>
      {msg && (
        <p className="yq-hint" style={{ marginTop: 8, color: "var(--yq-primary-ink)" }}>
          {msg}
        </p>
      )}
    </section>
  );
}
