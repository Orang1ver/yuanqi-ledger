"use client";

/**
 * 搜索并添加一份食物。
 *
 * 两步：先找食物，再定份量。刻意不合并成一步 —— 合并的话用户点错食物就直接落库了，
 * 而"点错一个"在这类应用里的代价是当天的数字全歪。
 */

import { useState } from "react";
import { foodsByCategory, searchFoods } from "@/lib/nutrition/library";
import { defaultPortionOptions } from "@/lib/nutrition/quickadd";
import { FOOD_CATEGORIES, categoryLabel } from "@/lib/nutrition/types";
import type { FoodCategory, FoodItem } from "@/lib/nutrition/types";
import { PortionPicker, type PortionValue } from "./PortionPicker";

export function FoodSearchDialog({
  onClose,
  onAdd,
  initialFood,
  ctaLabel = "记下这一份",
}: {
  onClose: () => void;
  onAdd: (food: FoodItem, portion: PortionValue) => void;
  /** 已指定食物时直接进入定份量那一步（「最近常吃」点进来就是这条路） */
  initialFood?: FoodItem;
  /** 按钮文案。菜单库拿它来「关联到这道菜」，动作不同、步骤一样 */
  ctaLabel?: string;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<FoodItem | null>(initialFood ?? null);
  const [portion, setPortion] = useState<PortionValue>(() => {
    const first = initialFood ? defaultPortionOptions(initialFood)[0] : undefined;
    return first ? { unitLabel: first.label, grams: first.grams } : { unitLabel: "克", grams: 100 };
  });
  const [category, setCategory] = useState<FoodCategory | null>(null);

  const results = q.trim() ? searchFoods(q, 20) : category ? foodsByCategory(category) : [];

  function choose(food: FoodItem) {
    const first = defaultPortionOptions(food)[0];
    setPicked(food);
    setPortion(first ? { unitLabel: first.label, grams: first.grams } : { unitLabel: "克", grams: 100 });
  }

  return (
    <div className="yq-scrim" onClick={onClose}>
      <div className="yq-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="yq-section-title">
          <span>{picked ? picked.name : "添加食物"}</span>
          <button className="yq-btn yq-btn-sm yq-btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>

        {picked ? (
          <>
            <p className="yq-hint" style={{ marginBottom: 10 }}>
              {categoryLabel(picked.category)} · 每 100{picked.unit} {picked.kcal} kcal
            </p>
            {/* key 让换食物时重置内部草稿，避免把上一种食物的克数带过来 */}
            <PortionPicker key={picked.id} food={picked} value={portion} onChange={setPortion} />
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                className="yq-btn yq-btn-primary"
                style={{ flex: 1 }}
                onClick={() => onAdd(picked, portion)}
              >
                {ctaLabel}
              </button>
              <button className="yq-btn" onClick={() => setPicked(null)}>
                换一个
              </button>
            </div>
          </>
        ) : (
          <>
            <input
              className="yq-input"
              placeholder="搜食物，比如「米饭」「奶茶」"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />

            {!q.trim() && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "12px 0" }}>
                {FOOD_CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    className="yq-chip"
                    data-on={category === c.key}
                    onClick={() => setCategory(category === c.key ? null : c.key)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}

            <div style={{ marginTop: 10 }}>
              {results.length === 0 ? (
                <p className="yq-empty">
                  {q.trim() ? "没搜到。换个说法试试，或者用「一句话记」直接说。" : "上面选个分类，或直接搜。"}
                </p>
              ) : (
                results.map((f) => (
                  <button
                    key={f.id}
                    className="yq-row"
                    style={{ width: "100%", background: "none", border: "none", borderBottom: "1px solid var(--yq-line)", cursor: "pointer", textAlign: "left" }}
                    onClick={() => choose(f)}
                  >
                    <span style={{ color: "var(--yq-ink)", fontSize: 15 }}>{f.name}</span>
                    <span className="yq-hint">
                      {categoryLabel(f.category)} · {f.kcal} kcal/100{f.unit}
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
