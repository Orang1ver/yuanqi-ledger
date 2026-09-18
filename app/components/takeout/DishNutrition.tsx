"use client";

/**
 * 一道菜单菜的营养估算（显示 + 关联）。
 *
 * 四条规矩，都写在界面上：
 * 1) **估出来的只给区间，不给单一数字。** 同名菜各家做法差一倍，写死一个数会让人
 *    拿它当账算。区间 + 百分比才是诚实的。
 * 2) **估不出来就直说"估不出来"**，并且当场给一条出路（关联一次就记住），
 *    而不是悄悄留空或者显示 0。
 * 3) **认出来的食材要摆出来。** 「按米线 200g + 鸡蛋 100g 估」摆在屏幕上，
 *    用户一眼能看出哪里不对 —— 只显示一个数字，他没得判断。
 * 4) **"估不出"要能一键解决。** 认出了「米线」却因为菜名剩下的字对不上而拒估时，
 *    把米线直接做成一个按钮 —— 点一下就进定份量那一步。
 *    之前只给一个「关联到库里的食物」，用户得自己在搜索框里重新打出菜名，
 *    等于把我们已经知道的事又让他做一遍，绝大多数人到这里就放弃了。
 */

import { useState } from "react";
import type { TakeoutDish } from "@/lib/types";
import { foodById } from "@/lib/nutrition/library";
import { describeEstimate, estimateDish } from "@/lib/nutrition/menu";
import type { FoodItem } from "@/lib/nutrition/types";
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
  /** 从"认出来的食材"点进来时预选好食物，跳过搜索这一步 */
  const [preset, setPreset] = useState<FoodItem | null>(null);
  const m = estimateDish(dish);

  function open(food?: FoodItem) {
    setPreset(food ?? null);
    setPicking(true);
  }

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
          <button className="yq-link-btn" onClick={() => open()}>
            不准？关联一下
          </button>
        </>
      ) : (
        <>
          <span>{m.basis}</span>
          {/* 认出来的食材直接做成按钮：点一下就到定份量那一步，不用再搜一次 */}
          {m.recognized.length > 0 && (
            <span>
              {m.recognized.map((ing) => (
                <button
                  key={ing.foodId}
                  className="yq-link-btn"
                  onClick={() => {
                    const food = foodById(ing.foodId);
                    if (food) open(food);
                  }}
                >
                  就是「{ing.foodName}」
                </button>
              ))}
            </span>
          )}
          <button className="yq-link-btn" onClick={() => open()}>
            关联到库里的食物
          </button>
        </>
      )}

      {picking && (
        <FoodSearchDialog
          ctaLabel="关联到这道菜"
          initialFood={preset ?? undefined}
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
