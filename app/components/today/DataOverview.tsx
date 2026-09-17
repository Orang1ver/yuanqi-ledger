"use client";

import { useMemo, useState } from "react";
import { todayISO } from "@/lib/date";
import { loadApiKeys, loadPrefs } from "@/lib/prefs";
import { KEYS } from "@/lib/storage/keys";
import { appKeys, readJSON } from "@/lib/storage/io";

/**
 * 数据总览。
 *
 * 存在的理由有两个，都很实在：
 * 1) **迁移期的自检工具** —— 从更早的版本切过来时，用户一眼就能看出
 *    健康档案、体重、运动、菜单库、打卡是不是都在。数据没跟过来会立刻发现，
 *    而不是过几天想记一笔时才发现丢了。
 * 2) 它把"数据在你自己浏览器里"这件事摆到明面上 —— 用户才知道为什么要定期导出备份。
 */
export function DataOverview() {
  const today = todayISO();
  const [open, setOpen] = useState(false);

  const rows = useMemo(() => {
    const checkins = readJSON<Record<string, unknown>>(KEYS.dailyCheckins, {});
    const weights = readJSON<Record<string, unknown>>(KEYS.weights, {});
    const meals = readJSON<unknown[]>(KEYS.meals, []);
    const exercises = readJSON<unknown[]>(KEYS.exercises, []);
    const takeout = readJSON<unknown[]>(KEYS.takeoutMock, []);
    const ingredients = readJSON<unknown[]>(KEYS.ingredients, []);
    const rewards = readJSON<{ days?: Record<string, unknown>; badges?: Record<string, unknown> }>(KEYS.rewards, {});
    const profile = readJSON<unknown>(KEYS.healthProfile, null);
    const prefs = loadPrefs();
    const key = loadApiKeys().deepseekKey;

    return [
      { label: "健康档案", value: profile ? "已填写" : "未填写", ok: !!profile },
      { label: "打卡记录", value: `${Object.keys(checkins).length} 天`, ok: Object.keys(checkins).length > 0 },
      { label: "体重记录", value: `${Object.keys(weights).length} 条`, ok: Object.keys(weights).length > 0 },
      { label: "运动记录", value: `${exercises.length} 条`, ok: exercises.length > 0 },
      { label: "饮食记录", value: `${meals.length} 条`, ok: meals.length > 0 },
      { label: "菜单库", value: `${takeout.length} 道菜`, ok: takeout.length > 0 },
      { label: "常用食材", value: `${ingredients.length} 项`, ok: ingredients.length > 0 },
      {
        label: "打卡奖励",
        value: `${Object.keys(rewards.days ?? {}).length} 天达标 · ${Object.keys(rewards.badges ?? {}).length} 枚徽章`,
        ok: Object.keys(rewards.badges ?? {}).length > 0,
      },
      { label: "AI Key", value: key ? "已配置" : "未配置", ok: !!key },
      { label: "我的杯子", value: `${prefs.cupMl} ml`, ok: true },
    ];
  }, []);

  const totalKeys = typeof window === "undefined" ? 0 : appKeys().length;

  return (
    <section className="yq-card yq-card-flat" style={{ marginBottom: 14 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          width: "100%",
          alignItems: "center",
          justifyContent: "space-between",
          background: "none",
          border: 0,
          padding: 0,
          cursor: "pointer",
          color: "var(--yq-ink)",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600 }}>数据总览</span>
        <span className="yq-hint">{open ? "收起" : `${totalKeys} 项已存 · 展开`}</span>
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          {rows.map((r) => (
            <div key={r.label} className="yq-row">
              <span className="yq-hint" style={{ color: "var(--yq-ink-soft)" }}>
                {r.label}
              </span>
              <span
                className="yq-num"
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: r.ok ? "var(--yq-primary-ink)" : "var(--yq-muted)",
                }}
              >
                {r.value}
              </span>
            </div>
          ))}
          <p className="yq-hint" style={{ marginTop: 10 }}>
            这些都是 {today} 时刻、存在你这台设备浏览器里的本地数据。
            换手机或清缓存前，记得在「设置 → 数据备份」里导出一份。
          </p>
        </div>
      )}
    </section>
  );
}
