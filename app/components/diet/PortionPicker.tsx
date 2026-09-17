"use client";

/**
 * 份量选择器。
 *
 * 设计要点：**用户永远不需要上秤。** 界面上先给「一碗 180g」「一包 70g」这类
 * 人话档位（来自 `data/foodPortions.json`），克数输入只是兜底的微调手段。
 *
 * 同时把折算后的热量实时显示出来 —— 用的就是落库时那一次 `nutritionOf` 乘法，
 * 所以「看到的数」和「存下的数」不可能不一致。
 *
 * ⚠️ 克数输入用**字符串 state**：用数字 state 会导致删不掉、永远留个 0。
 */

import { useState } from "react";
import { nutritionOf } from "@/lib/nutrition/core";
import { defaultPortionOptions } from "@/lib/nutrition/quickadd";
import type { FoodItem } from "@/lib/nutrition/types";

export type PortionValue = { unitLabel: string; grams: number };

export function PortionPicker({
  food,
  value,
  onChange,
}: {
  food: FoodItem;
  value: PortionValue;
  onChange: (v: PortionValue) => void;
}) {
  const [draft, setDraft] = useState(String(Math.round(value.grams)));

  const options = defaultPortionOptions(food).slice(0, 8);
  const preview = nutritionOf(food, value.grams);

  function pick(unit: string, label: string, grams: number) {
    setDraft(String(grams));
    onChange({ unitLabel: label, grams });
  }

  function typeGrams(text: string) {
    setDraft(text);
    const n = Number(text);
    if (Number.isFinite(n) && n > 0) onChange({ unitLabel: "克", grams: n });
  }

  return (
    <div>
      {options.length > 0 ? (
        <>
          <p className="yq-label" style={{ marginBottom: 6 }}>常见的份量</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {options.map((o) => {
              const on = o.label === value.unitLabel && o.grams === value.grams;
              return (
                <button
                  key={`${o.unit}-${o.label}-${o.grams}`}
                  type="button"
                  className="yq-chip"
                  data-on={on}
                  onClick={() => pick(o.unit, o.label, o.grams)}
                >
                  {o.label} · {o.grams}g
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <p className="yq-hint" style={{ marginBottom: 12 }}>
          这份食物还没有预设份量，直接填克数就行。
        </p>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="yq-label">克数</span>
        <input
          className="yq-input"
          type="number"
          inputMode="decimal"
          value={draft}
          onChange={(e) => typeGrams(e.target.value)}
          style={{ maxWidth: 110 }}
        />
        <span className="yq-hint">{food.unit === "ml" ? "毫升" : "克"}</span>
      </div>

      <p className="yq-hint" style={{ marginTop: 10, color: "var(--yq-primary-ink)" }}>
        这一份约 {Math.round(preview.kcal)} kcal · 蛋白 {preview.protein.toFixed(1)}g · 脂肪{" "}
        {preview.fat.toFixed(1)}g · 碳水 {preview.carb.toFixed(1)}g
        {preview.sodium === undefined ? " · 钠 无数据" : ` · 钠 ${Math.round(preview.sodium)}mg`}
      </p>
      <p className="yq-hint" style={{ marginTop: 4 }}>
        数值来源：{food.source}
      </p>
    </div>
  );
}
