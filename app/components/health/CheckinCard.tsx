"use client";

import { useEffect, useMemo, useState } from "react";
import { BACKFILL_DAYS, addDays, formatShort, todayISO } from "@/lib/date";
import { emitDataChanged, onDataChanged } from "@/lib/bus";
import { calcDailyTargets } from "@/lib/health";
import {
  clampSteps,
  cupsToMl,
  progressOf,
  STEP_PRESETS,
  stepsProgressText,
  waterProgressText,
} from "@/lib/steps";
import { loadPrefs } from "@/lib/prefs";
import { loadCheckin, loadHealthProfile, loadRewards, saveCheckin, saveRewards } from "@/lib/storage/health";
import { evaluateCheckin, hasCelebrated, settleCheckin, type Badge } from "@/lib/rewards";
import type { DailyCheckin, Mood } from "@/lib/types";
import { ProgressRing } from "../shell/ProgressRing";
import { RewardDialog } from "../shell/RewardDialog";

/**
 * 今日打卡卡：喝水 / 步数 / 睡眠 / 心情。
 *
 * 设计要点：
 * - **状态自管**：自己读档案、算目标、读写打卡，不依赖父组件的 state。
 *   父页面只负责摆位置 —— 这样这张卡才能被复用到别处，也不会把页面撑成巨型 useState 堆。
 * - 目标由健康档案推导；**没有档案时不判定达标、不发奖励**（否则目标是什么都说不清）。
 * - 补录窗口与体重卡共用同一个 BACKFILL_DAYS，否则用户会发现同一天在两张卡里补录范围不一样。
 * - 「今天」是可切换的日期上下文，切换后所有操作都作用在那个日期上。
 */
export function CheckinCard() {
  const today = todayISO();
  // 档案放 state 而不是每次渲染现读：一是稳定引用（useMemo 才有意义），
  // 二是别处保存了档案后，这里要能被通知刷新
  const [profile, setProfile] = useState(() => loadHealthProfile());
  const targets = useMemo(() => (profile ? calcDailyTargets(profile) : null), [profile]);

  const [date, setDate] = useState(today);
  const [checkin, setCheckin] = useState<DailyCheckin | null>(() => loadCheckin(today));
  const [cupMl, setCupMl] = useState(() => loadPrefs().cupMl);
  // ⚠️ 自定义水量/步数/睡眠都用字符串 state —— 数字 state 会导致删不掉、留个 0
  const [customWater, setCustomWater] = useState("");
  const [customSteps, setCustomSteps] = useState("");
  const [sleepDraft, setSleepDraft] = useState("");
  const [celebrate, setCelebrate] = useState<{ streak: number; badges: Badge[] } | null>(null);

  // 别处改了影响目标的东西（健康档案、我的杯子）后，这里要跟着变，
  // 否则保存完档案还按旧目标显示，用户会以为没生效
  useEffect(() => {
    return onDataChanged(() => {
      setProfile(loadHealthProfile());
      setCupMl(loadPrefs().cupMl);
    });
  }, []);

  const waterMl = checkin?.waterMl ?? 0;
  const steps = checkin?.steps ?? 0;
  const waterTarget = targets?.waterTarget ?? 2000;
  const stepsTarget = targets?.stepsTarget ?? 8000;
  const waterProgress = progressOf(waterMl, waterTarget);
  const stepsProgress = progressOf(steps, stepsTarget);

  /** 写入后重新结算：达标就记连续天数、发徽章、弹庆祝 */
  function commit(next: DailyCheckin) {
    setCheckin(next);
    // 同页的徽章墙要知道"今天达标了"
    emitDataChanged();
    if (!targets) return;
    const done = evaluateCheckin(next, targets);
    if (!done.allDone) return;
    const prev = loadRewards();
    if (hasCelebrated(prev, next.date)) return;
    const res = settleCheckin(prev, next.date);
    saveRewards(res.state);
    setCelebrate({ streak: res.streak, badges: res.newBadges });
  }

  function update(patch: Partial<Omit<DailyCheckin, "date">>) {
    commit(saveCheckin(date, patch));
  }

  function changeDate(next: string) {
    setDate(next);
    setCheckin(loadCheckin(next));
    setCustomWater("");
    setCustomSteps("");
    setSleepDraft(loadCheckin(next)?.sleepHours != null ? String(loadCheckin(next)?.sleepHours) : "");
  }

  const dateOptions = Array.from({ length: BACKFILL_DAYS + 1 }, (_, i) => addDays(today, -i));
  const isToday = date === today;

  return (
    <section className="yq-card" style={{ marginBottom: 14 }}>
      <div className="yq-section-title">
        <span>{isToday ? "今天" : formatShort(date)}</span>
        <DatePicker value={date} options={dateOptions} onChange={changeDate} />
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <ProgressRing
          pct={waterProgress.pct}
          color="var(--yq-primary)"
          ariaLabel={`喝水已完成 ${waterProgress.pct}%`}
        >
          <span style={{ fontSize: 20 }}>💧</span>
          <b className="yq-num" style={{ fontSize: 15 }}>
            {waterMl}
          </b>
          <span className="yq-hint" style={{ fontSize: 11 }}>
            / {waterTarget} ml
          </span>
        </ProgressRing>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, marginBottom: 8, color: "var(--yq-muted)" }}>
            {waterProgressText(waterProgress, cupMl)}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <button className="yq-btn yq-btn-sm yq-btn-primary" onClick={() => update({ waterMl: cupsToMl(1, cupMl) + waterMl })}>
              ＋1 杯（{cupMl}ml）
            </button>
            <button className="yq-btn yq-btn-sm" onClick={() => update({ waterMl: cupsToMl(0.5, cupMl) + waterMl })}>
              ＋半杯
            </button>
            <button
              className="yq-btn yq-btn-sm"
              disabled={waterMl <= 0}
              onClick={() => update({ waterMl: Math.max(0, waterMl - cupsToMl(1, cupMl)) })}
            >
              －1 杯
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input
              className="yq-input"
              type="number"
              inputMode="numeric"
              placeholder="其他毫升数"
              value={customWater}
              onChange={(e) => setCustomWater(e.target.value)}
              style={{ maxWidth: 128 }}
            />
            <button
              className="yq-btn yq-btn-sm"
              onClick={() => {
                const n = Math.round(Number(customWater));
                if (!Number.isFinite(n) || n <= 0) return;
                update({ waterMl: waterMl + n });
                setCustomWater("");
              }}
            >
              加上
            </button>
          </div>
        </div>
      </div>

      <hr style={{ border: 0, borderTop: "1px solid var(--yq-line)", margin: "16px 0" }} />

      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <ProgressRing
          pct={stepsProgress.pct}
          size={92}
          stroke={9}
          color="var(--yq-accent)"
          ariaLabel={`步数已完成 ${stepsProgress.pct}%`}
        >
          <span style={{ fontSize: 17 }}>🚶</span>
          <b className="yq-num" style={{ fontSize: 14 }}>
            {steps}
          </b>
          <span className="yq-hint" style={{ fontSize: 10 }}>
            / {stepsTarget}
          </span>
        </ProgressRing>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, marginBottom: 8, color: "var(--yq-muted)" }}>
            {stepsProgressText(stepsProgress)}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {STEP_PRESETS.map((n) => (
              <button key={n} className="yq-btn yq-btn-sm" onClick={() => update({ steps: clampSteps(steps + n) })}>
                ＋{n}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input
              className="yq-input"
              type="number"
              inputMode="numeric"
              placeholder="改成"
              value={customSteps}
              onChange={(e) => setCustomSteps(e.target.value)}
              style={{ maxWidth: 110 }}
            />
            <button
              className="yq-btn yq-btn-sm"
              onClick={() => {
                const n = Number(customSteps);
                if (!Number.isFinite(n) || n < 0) return;
                update({ steps: clampSteps(n) });
                setCustomSteps("");
              }}
            >
              设为
            </button>
          </div>
        </div>
      </div>

      <hr style={{ border: 0, borderTop: "1px solid var(--yq-line)", margin: "16px 0" }} />

      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="yq-label">睡眠</span>
          <input
            className="yq-input"
            type="number"
            inputMode="decimal"
            step="0.5"
            placeholder="小时"
            value={sleepDraft}
            onChange={(e) => setSleepDraft(e.target.value)}
            onBlur={() => {
              const n = Number(sleepDraft);
              if (sleepDraft.trim() === "" || !Number.isFinite(n) || n < 0 || n > 24) {
                update({ sleepHours: undefined });
                setSleepDraft("");
                return;
              }
              update({ sleepHours: n });
            }}
            style={{ maxWidth: 96 }}
          />
          <span className="yq-hint">小时</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="yq-label">状态</span>
          {(["好", "一般", "累"] as Mood[]).map((m) => (
            <button
              key={m}
              className="yq-chip"
              data-on={checkin?.mood === m}
              onClick={() => update({ mood: checkin?.mood === m ? undefined : m })}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {!targets && (
        <p className="yq-hint" style={{ marginTop: 12 }}>
          还没填健康档案，所以暂时没有喝水/步数目标，也不算达标。去「健康」页填一下就能看到进度。
        </p>
      )}

      {celebrate && (
        <RewardDialog
          streak={celebrate.streak}
          badges={celebrate.badges}
          onClose={() => setCelebrate(null)}
        />
      )}
    </section>
  );
}

/** 日期下拉：只允许在补录窗口内选择 */
function DatePicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const today = todayISO();
  return (
    <select
      className="yq-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: "auto", minHeight: 32, fontSize: 13, padding: "4px 8px" }}
    >
      {options.map((d) => (
        <option key={d} value={d}>
          {d === today ? "今天" : formatShort(d)}
        </option>
      ))}
    </select>
  );
}
