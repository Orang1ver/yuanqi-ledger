"use client";

/**
 * 搜索并添加一份食物。
 *
 * 两步：先找食物，再定份量。刻意不合并成一步 —— 合并的话用户点错食物就直接落库了，
 * 而"点错一个"在这类应用里的代价是当天的数字全歪。
 */

import { useState } from "react";
import { foodsByCategoryIn, searchAllFoods } from "@/lib/nutrition/lookup";
import { defaultPortionOptions } from "@/lib/nutrition/quickadd";
import { FOOD_CATEGORIES, categoryLabel } from "@/lib/nutrition/types";
import type { FoodCategory, FoodItem } from "@/lib/nutrition/types";
import { loadCustomFoods } from "@/lib/storage";
import { PortionPicker, type PortionValue } from "./PortionPicker";

export function FoodSearchDialog({
  onClose,
  onAdd,
  initialFood,
  initialQuery,
  extraFoods,
  ctaLabel = "记下这一份",
  onPhoto,
}: {
  onClose: () => void;
  onAdd: (food: FoodItem, portion: PortionValue) => void;
  /** 已指定食物时直接进入定份量那一步（「最近常吃」点进来就是这条路） */
  initialFood?: FoodItem;
  /** 预填搜索词。库里没匹配到的行点「自己搜一个」进来时，别让用户再打一遍 */
  initialQuery?: string;
  /**
   * 用户自己的食物（「我的食物库」）。
   * ⚠️ 不传就现取一次 —— 但传进来能让父组件把同一次读取复用给多处，
   * 避免每次渲染碰一遍 localStorage。
   */
  extraFoods?: readonly FoodItem[];
  /** 按钮文案。菜单库拿它来「关联到这道菜」，动作不同、步骤一样 */
  ctaLabel?: string;
  /** 有拍照能力时给个入口。不传就不显示（比如菜单库那条路用不到） */
  onPhoto?: (query: string) => void;
}) {
  const [q, setQ] = useState(initialQuery ?? "");
  const [picked, setPicked] = useState<FoodItem | null>(initialFood ?? null);
  const [portion, setPortion] = useState<PortionValue>(() => {
    const first = initialFood ? defaultPortionOptions(initialFood)[0] : undefined;
    return first ? { unitLabel: first.label, grams: first.grams } : { unitLabel: "克", grams: 100 };
  });
  const [category, setCategory] = useState<FoodCategory | null>(null);

  // 内置库 + 我的食物库合并检索。extra 为空时行为与改动前逐字一致。
  const extra = extraFoods ?? loadCustomFoods();
  const results = q.trim()
    ? searchAllFoods(q, extra, 20)
    : category
      ? foodsByCategoryIn(category, extra)
      : [];

  /** 这条是不是用户自己加的 —— 列表上标一下，用户才知道哪条是自己录的 */
  const isMine = (f: FoodItem) => f.id.startsWith("user-");

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
                <>
                  <p className="yq-empty">
                    {q.trim() ? "没搜到。换个说法试试，或者用「一句话记」直接说。" : "上面选个分类，或直接搜。"}
                  </p>
                  {q.trim() && onPhoto && (
                    <div style={{ marginTop: 8 }}>
                      <button className="yq-btn yq-btn-sm" onClick={() => onPhoto(q)}>
                        📷 对着包装拍一下，让 AI 读数值
                      </button>
                    </div>
                  )}
                </>
              ) : (
                results.map((f) => (
                  <button
                    key={f.id}
                    className="yq-row"
                    style={{ width: "100%", background: "none", border: "none", borderBottom: "1px solid var(--yq-line)", cursor: "pointer", textAlign: "left" }}
                    onClick={() => choose(f)}
                  >
                    <span style={{ color: "var(--yq-ink)", fontSize: 15 }}>
                      {f.name}
                      {isMine(f) && (
                        <span className="yq-badge yq-badge-info" style={{ marginLeft: 6 }}>我的</span>
                      )}
                    </span>
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
