"use client";

import { useState } from "react";
import { emitDataChanged } from "@/lib/bus";
import {
  ACTIVITY_LEVELS,
  HEALTH_GOALS,
  calcDailyTargets,
  healthyWeightRange,
} from "@/lib/health";
import { loadHealthProfile, saveHealthProfile } from "@/lib/storage/health";
import type { ActivityLevel, HealthGoal, HealthProfile, Sex } from "@/lib/types";

/**
 * 健康档案表单。
 *
 * 这张表决定后面**一切**的基准：热量/喝水/步数目标、饮食建议、推荐口径。
 * 所以保存后要立刻把算出来的目标摊开给用户看 —— 否则用户不知道填了有什么用。
 *
 * ⚠️ 数值字段全部用字符串 state。用 value={number} + onChange(Number(v)||0)
 * 会让用户删不掉、永远留个 0（本项目踩过这个坑）。
 */
export function HealthProfileCard() {
  const [saved, setSaved] = useState<HealthProfile | null>(() => loadHealthProfile());

  const [sex, setSex] = useState<Sex>(saved?.sex ?? "女");
  const [age, setAge] = useState(saved ? String(saved.age) : "");
  const [heightCm, setHeightCm] = useState(saved ? String(saved.heightCm) : "");
  const [weightKg, setWeightKg] = useState(saved ? String(saved.weightKg) : "");
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>(saved?.activityLevel ?? "轻度活动");
  const [goal, setGoal] = useState<HealthGoal>(saved?.goal ?? "维持健康");
  const [allergies, setAllergies] = useState(saved?.allergies ?? "");
  const [conditions, setConditions] = useState(saved?.conditions ?? "");
  const [msg, setMsg] = useState("");

  function submit() {
    const a = Number(age);
    const h = Number(heightCm);
    const w = Number(weightKg);
    if (!Number.isFinite(a) || a < 10 || a > 100) return setMsg("年龄填 10~100 之间的数字");
    if (!Number.isFinite(h) || h < 100 || h > 230) return setMsg("身高填 100~230 cm 之间的数字");
    if (!Number.isFinite(w) || w < 25 || w > 200) return setMsg("体重填 25~200 kg 之间的数字");

    setSaved(
      saveHealthProfile({
        sex,
        age: Math.round(a),
        heightCm: Math.round(h),
        weightKg: Math.round(w * 10) / 10,
        activityLevel,
        goal,
        allergies,
        conditions,
      }),
    );
    setMsg("已保存");
    // 目标变了，同页的打卡卡/徽章墙要跟着刷新
    emitDataChanged();
  }

  const targets = saved ? calcDailyTargets(saved) : null;
  const range = saved ? healthyWeightRange(saved) : null;

  return (
    <section className="yq-card" style={{ marginBottom: 14 }}>
      <div className="yq-section-title">
        <span>健康档案</span>
        {saved && <span className="yq-badge yq-badge-primary">已填</span>}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <span className="yq-label">性别</span>
        {(["男", "女"] as Sex[]).map((s) => (
          <button key={s} className="yq-chip" data-on={sex === s} onClick={() => setSex(s)}>
            {s}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 10 }}>
        <Field label="年龄" unit="岁" value={age} onChange={setAge} />
        <Field label="身高" unit="cm" value={heightCm} onChange={setHeightCm} />
        <Field label="体重" unit="kg" value={weightKg} onChange={setWeightKg} step="0.1" />
      </div>

      <p className="yq-label" style={{ marginBottom: 6 }}>
        日常活动量
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {ACTIVITY_LEVELS.map((a) => (
          <button
            key={a.label}
            className="yq-chip"
            data-on={activityLevel === a.label}
            title={a.desc}
            onClick={() => setActivityLevel(a.label)}
          >
            {a.label}
          </button>
        ))}
      </div>

      <p className="yq-label" style={{ marginBottom: 6 }}>
        目标
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {HEALTH_GOALS.map((g) => (
          <button
            key={g.key}
            className="yq-chip"
            data-on={goal === g.key}
            title={g.desc}
            onClick={() => setGoal(g.key)}
          >
            {g.key}
          </button>
        ))}
      </div>

      <input
        className="yq-input"
        placeholder="忌口 / 过敏（如：不吃香菜、乳糖不耐）"
        value={allergies}
        onChange={(e) => setAllergies(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <input
        className="yq-input"
        placeholder="身体状况备注（如：肠胃不好、在吃药）"
        value={conditions}
        onChange={(e) => setConditions(e.target.value)}
        style={{ marginBottom: 10 }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="yq-btn yq-btn-primary" onClick={submit}>
          保存档案
        </button>
        {msg && <span className="yq-hint">{msg}</span>}
      </div>

      {targets && range && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: "1px solid var(--yq-line)",
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 10,
          }}
        >
          <Stat label="BMI" value={`${targets.bmi} ${targets.bmiLabel}`} />
          <Stat label="基础代谢" value={`${targets.bmr} kcal`} />
          <Stat label="每日热量参考" value={`${targets.calorieTarget} kcal`} />
          <Stat label="喝水目标" value={`${targets.waterTarget} ml`} />
          <Stat label="步数目标" value={`${targets.stepsTarget} 步`} />
          <Stat label="健康体重区间" value={`${range.min}~${range.max} kg`} />
        </div>
      )}

      <p className="yq-hint" style={{ marginTop: 10 }}>
        这些都是估算值，用途是给自己一个参照，不是医学诊断。身体有异常请找医生。
      </p>
    </section>
  );
}

function Field({
  label,
  unit,
  value,
  onChange,
  step,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <label style={{ display: "block" }}>
      <span className="yq-label">
        {label}（{unit}）
      </span>
      <input
        className="yq-input"
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ marginTop: 4 }}
      />
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="yq-label">{label}</div>
      <div className="yq-num" style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}
