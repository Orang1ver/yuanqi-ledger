"use client";

/**
 * 首页的「今天还该吃点啥」。
 *
 * 与饮食页的建议卡不是一回事：那张卡说「今天哪一项偏了」，
 * 这张卡说「下一口吃什么能补回来」，输入是**今日缺口 + 用户自己的菜单库**。
 *
 * 两条推荐路径，刻意并存：
 *
 * 1) **本地纯函数**（`suggestForGaps`）—— 零成本、可离线、数字可审计。它永远在，
 *    是这条功能的底：没 Key、没网、模型抽风，用户看到的都还是它。
 * 2) **模型挑**（`pickDishesForGaps`）—— 多出来的只有"从**你自己的菜单**里挑"和
 *    "说一句人话理由"。**它一个营养数字都不产生**：屏幕上的热量仍然由本地的
 *    `estimateDish` 现算（见 lib/ai/recommend.ts 头部）。
 *
 * 四条刻意的做法：
 * 1) **没记过东西就不推。** 一条饮食记录都没有时算不出缺口，推出来的东西
 *    与用户今天的实际情况无关。此时显示"先去记一笔"，而不是装作知道。
 * 2) **都达标了也不推。** 返回空数组就显示"今天不用特意补"——
 *    把一个已经达标的今天说成"还缺"，是把达标变成新的焦虑。
 * 3) **说清算不出来多少。** 菜单库里估不出成分的菜压根没进推荐池，
 *    不说的话用户会以为整库都被用上了。
 * 4) **没填 Key 就不显示这个按钮。** 一个点了只会报错的按钮，比没有按钮更烦人。
 */

import { useEffect, useMemo, useState } from "react";
import { onDataChanged } from "@/lib/bus";
import { todayISO } from "@/lib/date";
import { loadApiKeys } from "@/lib/prefs";
import { loadHealthProfile } from "@/lib/storage/health";
import { loadTakeoutDishes } from "@/lib/storage/takeout";
import { avoidLabelsFromText } from "@/lib/tags";
import type { TakeoutDish } from "@/lib/types";
import { pickDishesForGaps, pickableDishes, type AiPick } from "@/lib/ai/recommend";
import { estimateDish } from "@/lib/nutrition/menu";
import { suggestForGaps, type Suggestion } from "@/lib/nutrition/recommend";
import { PAGE_LABELS } from "@/lib/copy";
import { useDayNutrition } from "../diet/useDayNutrition";

/** 「帮我挑」这一小块自己的状态。放卡里，不往页面上提（见 AGENTS.md 地雷 7） */
type AiState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; picks: AiPick[] }
  | { kind: "error"; message: string };

export function WhatToEatCard() {
  const today = todayISO();
  const { entries, totals, targets, targetsFromProfile } = useDayNutrition(today);
  const [dishes, setDishes] = useState<TakeoutDish[]>(() => loadTakeoutDishes());
  const [hasKey, setHasKey] = useState(() => !!loadApiKeys().deepseekKey?.trim());
  const [ai, setAi] = useState<AiState>({ kind: "idle" });

  // 菜单库在别的页面被改动过（加菜 / 关联食物）时，这张卡要跟着更新；
  // Key 同理 —— 用户刚在设置里粘完 Key，回到首页就该能点，而不是等刷新。
  useEffect(
    () =>
      onDataChanged(() => {
        setDishes(loadTakeoutDishes());
        setHasKey(!!loadApiKeys().deepseekKey?.trim());
      }),
    [],
  );

  const profile = loadHealthProfile();
  // 判据在 lib/tags.ts —— 「今天吃什么」那张卡用的是同一个函数，
  // 两处各写一份的话，同一个人会在两张卡上得到两套忌口口径
  const avoid = useMemo(() => avoidLabelsFromText(profile?.allergies), [profile?.allergies]);

  const suggestions: Suggestion[] = useMemo(
    () => suggestForGaps({ totals, targets, menuDishes: dishes, avoid, limit: 3 }),
    [totals, targets, dishes, avoid],
  );

  /** 菜单库里估不出成分的条数 —— 它们没进推荐池，得让用户知道 */
  const blindCount = useMemo(
    () => dishes.filter((d) => estimateDish(d).kind === "none").length,
    [dishes],
  );

  /** 能交给模型挑的菜（估得出成分 + 不撞忌口）。空了就没得挑，按钮也不该在 */
  const candidates = useMemo(() => pickableDishes(dishes, avoid), [dishes, avoid]);

  // 有缺口、有菜可挑、还填了 Key —— 三个都满足才给按钮。
  // 缺任何一个，点下去都只会得到一句"挑不出来"，那还不如不出现。
  const canPick = hasKey && candidates.length > 0 && suggestions.length > 0;

  async function pick() {
    const key = loadApiKeys().deepseekKey?.trim();
    if (!key) {
      setAi({ kind: "error", message: "还没填 DeepSeek Key，去「设置 → AI 接口 Key」填一个。" });
      return;
    }
    setAi({ kind: "loading" });
    try {
      const picks = await pickDishesForGaps({
        apiKey: key,
        entries,
        totals,
        targets,
        dishes,
        avoid,
        limit: 3,
      });
      setAi(
        picks.length
          ? { kind: "done", picks }
          : { kind: "error", message: "这次没挑出合适的（模型给的菜都不在你的菜单里），先用下面的本地推荐。" },
      );
    } catch (e) {
      // 失败不是终点：本地推荐永远在下面顶着，所以这里只说一句为什么，不做弹窗
      const why = e instanceof Error ? e.message : String(e);
      setAi({ kind: "error", message: `${why} 先看下面的本地推荐。` });
    }
  }

  const aiPicks = ai.kind === "done" ? ai.picks : null;

  return (
    <section className="yq-card" style={{ marginBottom: 14 }}>
      <div className="yq-section-title">
        <span>今天还该吃点啥</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!targetsFromProfile && <span className="yq-hint">目标按参考日算</span>}
          {canPick &&
            (aiPicks ? (
              <button className="yq-btn yq-btn-sm yq-btn-ghost" onClick={() => void pick()}>
                换一批
              </button>
            ) : (
              <button
                className="yq-btn yq-btn-sm yq-btn-primary"
                onClick={() => void pick()}
                disabled={ai.kind === "loading"}
              >
                {ai.kind === "loading" ? "正在挑…" : "✨ 帮我挑"}
              </button>
            ))}
        </span>
      </div>

      {totals.entries === 0 ? (
        <p className="yq-empty" style={{ paddingBottom: 0 }}>
          今天还没有饮食记录 —— 先去「饮食」页记一笔，这里才知道你缺什么。
        </p>
      ) : aiPicks ? (
        <>
          {aiPicks.map((p) => (
            <div key={p.dishId} className="yq-row" style={{ alignItems: "flex-start", gap: 10 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {p.name}
                  <span className="yq-tag" style={{ marginLeft: 6 }}>
                    {p.restaurant}
                  </span>
                </div>
                {p.reason && (
                  <div className="yq-hint" style={{ lineHeight: 1.5 }}>
                    {p.reason}
                  </div>
                )}
              </div>
              <span className="yq-num" style={{ flex: "0 0 auto", color: "var(--yq-muted)" }}>
                {kcalText(p.estimate)}
              </span>
            </div>
          ))}
          <p className="yq-hint" style={{ marginTop: 10 }}>
            这几道是从你的菜单库里挑的；热量仍是本地按食物库估的区间，不是模型说的。
          </p>
        </>
      ) : suggestions.length === 0 ? (
        <p className="yq-empty" style={{ paddingBottom: 0 }}>
          今天该够的都够了，不用特意补。
        </p>
      ) : (
        suggestions.map((s) => (
          <div key={`${s.from}-${s.label}`} className="yq-row" style={{ alignItems: "flex-start", gap: 10 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {s.label}
                <span className="yq-tag" style={{ marginLeft: 6 }}>
                  {s.gapLabel}
                </span>
              </div>
              <div className="yq-hint" style={{ lineHeight: 1.5 }}>
                {s.reason}
              </div>
            </div>
            <span className="yq-num" style={{ flex: "0 0 auto", color: "var(--yq-muted)" }}>
              {s.from === "menu" && s.loKcal !== s.hiKcal ? `${s.loKcal}~${s.hiKcal}` : s.kcal} kcal
            </span>
          </div>
        ))
      )}

      {ai.kind === "error" && (
        <p className="yq-hint" style={{ marginTop: 10, color: "var(--yq-danger)" }}>
          {ai.message}
        </p>
      )}

      {dishes.length === 0 ? (
        <p className="yq-hint" style={{ marginTop: 10 }}>
          菜单库还是空的 —— 把常点的店录进「{PAGE_LABELS.takeout}」，推荐会更贴你自己的口味。
        </p>
      ) : blindCount > 0 ? (
        <p className="yq-hint" style={{ marginTop: 10 }}>
          菜单库里还有 {blindCount} 道菜算不出成分，没参与上面的推荐 ——
          去「{PAGE_LABELS.takeout}」给它们关联一下食物就行。
        </p>
      ) : null}

      {!hasKey && dishes.length > 0 && (
        <p className="yq-hint" style={{ marginTop: 10 }}>
          想让它从你的菜单里挑几道？去「设置 → AI 接口 Key」填一个 DeepSeek Key，入口就会出现。
        </p>
      )}
    </section>
  );
}

/**
 * 菜单来源的估算是个**区间**，就给区间；用户关联过食物的给单值。
 * 类型上就没有 `none` 这一支（见 lib/ai/recommend.ts 的 EstimatedDish）——
 * 候选池压根不收估不出来的菜，所以这里不会出现「估不出来 kcal」那种输出。
 */
function kcalText(m: AiPick["estimate"]): string {
  if (m.kind === "guess") return `${m.loKcal}~${m.hiKcal} kcal`;
  return `${Math.round(m.nutrition.kcal)} kcal`;
}
