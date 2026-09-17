"use client";

/**
 * 一道菜单菜的营养估算（显示 + 关联）。
 *
 * 三条规矩，都写在界面上：
 * 1) **估出来的只给区间，不给单一数字。** 同名菜各家做法差一倍，写死一个数会让人
 *    拿它当账算。区间 + 百分比才是诚实的。
 * 2) **估不出来就直说"估不出来"**，并且当场给一条出路（关联一次就记住），
 *    而不是悄悄留空或者显示 0。
 * 3) **认出来的食材要摆出来。** 「按米线 200g + 鸡蛋 100g 估」摆在屏幕上，
 *    用户一眼能看出哪里不对 —— 只显示一个数字，他没得判断。
 */

import { useState } from "react";
import type { TakeoutDish } from "@/lib/types";
import { describeEstimate, estimateDish } from "@/lib/nutrition/menu";
import { FoodSearchDialog } from "../diet/FoodSearchDialog";

export function DishNutrition({
  dish,
  onLink,
}: {
  dish: TakeoutDish;
  /** 关联 / 解除关联。克数由选份量那一步给出 */
  onLink: (patch: { foodId?: string; grams?: number }) => void;
}) {
  const [picking, setPicking] = useState(false);
  const m = estimateDish(dish);

  return (
    <div className="yq-hint" style={{ marginTop: 4, lineHeight: 1.5 }}>
      {m.kind === "linked" ? (
        <>
          <span style={{ color: "var(--yq-primary-ink)" }}>{describeEstimate(m)}</span>
          <span> · {m.basis}</span>
          <button className="yq-link-btn" onClick={() => onLink({ foodId: undefined, grams: undefined })}>
            解除关联
          </button>
        </>
      ) : m.kind === "guess" ? (
        <>
          <span style={{ color: "var(--yq-primary-ink)" }}>{describeEstimate(m)}</span>
          <span> · {m.basis}</span>
          <button className="yq-link-btn" onClick={() => setPicking(true)}>
            不准？关联一下
          </button>
        </>
      ) : (
        <>
          <span>{m.basis}</span>
          <button className="yq-link-btn" onClick={() => setPicking(true)}>
            关联到库里的食物
          </button>
        </>
      )}

      {picking && (
        <FoodSearchDialog
          ctaLabel="关联到这道菜"
          onClose={() => setPicking(false)}
          onAdd={(food, portion) => {
            onLink({ foodId: food.id, grams: portion.grams });
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}
