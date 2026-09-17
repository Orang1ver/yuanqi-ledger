"use client";

/**
 * 首页的「今天还该吃点啥」。
 *
 * 与饮食页的建议卡不是一回事：那张卡说「今天哪一项偏了」，
 * 这张卡说「下一口吃什么能补回来」，输入是**今日缺口 + 用户自己的菜单库**。
 *
 * 三条刻意的做法：
 * 1) **没记过东西就不推。** 一条饮食记录都没有时算不出缺口，推出来的东西
 *    与用户今天的实际情况无关。此时显示"先去记一笔"，而不是装作知道。
 * 2) **都达标了也不推。** 返回空数组就显示"今天不用特意补"——
 *    把一个已经达标的今天说成"还缺"，是把达标变成新的焦虑。
 * 3) **说清算不出来多少。** 菜单库里估不出成分的菜压根没进推荐池，
 *    不说的话用户会以为整库都被用上了。
 */

import { useEffect, useMemo, useState } from "react";
import { onDataChanged } from "@/lib/bus";
import { todayISO } from "@/lib/date";
import { loadHealthProfile } from "@/lib/storage/health";
import { loadTakeoutDishes } from "@/lib/storage/takeout";
import { AVOID_TAGS } from "@/lib/tags";
import type { TakeoutDish } from "@/lib/types";
import { estimateDish } from "@/lib/nutrition/menu";
import { suggestForGaps, type Suggestion } from "@/lib/nutrition/recommend";
import { useDayNutrition } from "../diet/useDayNutrition";

/**
 * 结构化忌口只有「菜自己带的 avoidConflicts」，
 * 健康档案里的忌口是一段自由文本（「乳糖不耐」这种）。
 * 所以这里只认**逐字命中**的标签，不做同义词猜测 ——
 * 猜错了的后果是"该避的没避"，比不避更糟。
 */
function verbatimAvoidLabels(text: string | undefined): string[] {
  if (!text) return [];
  return AVOID_TAGS.map((t) => t.label).filter((label) => text.includes(label));
}

export function WhatToEatCard() {
  const today = todayISO();
  const { totals, targets, targetsFromProfile } = useDayNutrition(today);
  const [dishes, setDishes] = useState<TakeoutDish[]>(() => loadTakeoutDishes());

  // 菜单库在别的页面被改动过（加菜 / 关联食物）时，这张卡要跟着更新
  useEffect(() => onDataChanged(() => setDishes(loadTakeoutDishes())), []);

  const profile = loadHealthProfile();
  const avoid = verbatimAvoidLabels(profile?.allergies);

  const suggestions: Suggestion[] = useMemo(
    () => suggestForGaps({ totals, targets, menuDishes: dishes, avoid, limit: 3 }),
    [totals, targets, dishes, avoid],
  );

  /** 菜单库里估不出成分的条数 —— 它们没进推荐池，得让用户知道 */
  const blindCount = useMemo(
    () => dishes.filter((d) => estimateDish(d).kind === "none").length,
    [dishes],
  );

  return (
    <section className="yq-card" style={{ marginBottom: 14 }}>
      <div className="yq-section-title">
        <span>今天还该吃点啥</span>
        {!targetsFromProfile && <span className="yq-hint">目标按参考日算</span>}
      </div>

      {totals.entries === 0 ? (
        <p className="yq-empty" style={{ paddingBottom: 0 }}>
          今天还没有饮食记录 —— 先去「饮食」页记一笔，这里才知道你缺什么。
        </p>
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

      {dishes.length === 0 ? (
        <p className="yq-hint" style={{ marginTop: 10 }}>
          菜单库还是空的 —— 把常点的店录进「菜单」，推荐会更贴你自己的口味。
        </p>
      ) : blindCount > 0 ? (
        <p className="yq-hint" style={{ marginTop: 10 }}>
          菜单库里还有 {blindCount} 道菜算不出成分，没参与上面的推荐 ——
          去「菜单」给它们关联一下食物就行。
        </p>
      ) : null}
    </section>
  );
}
