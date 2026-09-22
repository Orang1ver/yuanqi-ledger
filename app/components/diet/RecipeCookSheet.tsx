"use client";

/**
 * 「做这道菜」—— 记账时选展开方式（用户明确要"两者都要"）。
 *
 * 两条路的区别**不是口味，是数值口径**，所以这里必须把差别写清楚，
 * 不然用户会以为这只是两种记录习惯：
 *
 * | | 展开成多条 | 合成一条 |
 * |---|---|---|
 * | 落库 | 每样配料一条 `DietEntry` | 一条 `DietEntry` |
 * | 数值 | 每条 = `nutritionOf(配料, 克数)` | `recipeToFoodItem` 的每 100g × 你吃的克数 |
 * | 克数 | **下锅前**的配料克数 | 你填的**成品**克数 |
 * | 分类 | 每样配料自己的类（供能占比更准） | 折算出的一个类 |
 *
 * ⚠️ 两条路都**只走 `nutritionOf`**（展开那条由 `recordDietEntries` 内部调 `makeDietEntry`，
 * 合成那条的 `FoodItem` 由 `recipeToFoodItem` 造、其值也是 `nutritionOf` + `addNutrition` 算的）。
 * 这里一行乘法都不写 —— 界面上塞不进数字，这条链才守得住。
 *
 * ⚠️ 合成那条的 `source` 用 `"custom"`（它不在内置库里），**不是 `"ai"`**：
 * `"ai"` 是"模型估算"的专用标记，当日汇总靠它说清"哪几条是猜的"，
 * 一件自己做的菜被标成"猜的"是错的。
 */

import { useState } from "react";
import { emitDataChanged } from "@/lib/bus";
import { nowHM } from "@/lib/date";
import { findFoodByIdIn } from "@/lib/nutrition/lookup";
import { recipeTotals, recipeToFoodItem } from "@/lib/nutrition/recipe";
import { loadCustomFoods, recordDietEntries, recordDietEntry } from "@/lib/storage";
import type { MyRecipe } from "@/lib/storage";
import type { MealSlot } from "@/lib/tags";

/** 字符串 → 数字。空串 / 非数 → `undefined`（**不是 0**） */
function textToNum(t: string): number | undefined {
  const s = t.trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function RecipeCookSheet({
  recipe,
  date,
  slot,
  onClose,
  onDone,
}: {
  recipe: MyRecipe;
  date: string;
  slot: MealSlot;
  onClose: () => void;
  /** 记好之后告诉调用方（用来提示、收起面板） */
  onDone: (msg: string) => void;
}) {
  const customFoods = loadCustomFoods();
  const byId = (id: string) => findFoodByIdIn(id, customFoods);

  /** 我吃了多少克（按**成品**重量）。字符串 state（地雷 5） */
  const [gramsText, setGramsText] = useState("");
  const [err, setErr] = useState("");

  const { missing } = recipeTotals(recipe, byId);
  const food = recipeToFoodItem(recipe, byId);
  /** 折不出数来就不许记账 —— 两条路都别走 */
  const blocked = missing.length > 0 || !food;

  function expand() {
    // ⚠️ 一次读写落多条（`recordDietEntries`），不要循环单条写 ——
    // 每条都 load + write 全量，十条配料就是十次整库读写。
    const inputs = recipe.parts.map((p) => {
      const f = byId(p.foodId) as NonNullable<ReturnType<typeof byId>>;
      return {
        date,
        time: nowHM(),
        mealSlot: slot,
        food: f,
        name: f.name,
        amount: 1,
        unitLabel: "克",
        grams: p.grams,
        source: "db" as const,
        // 每条都带**同一个** dishId（值就是菜谱 id）——
        // 它的注释写的是"这条记录来自哪道菜"，自做饭菜正是这个语义，
        // 所以复用这个字段，不为自做饭菜新开一个。
        dishId: recipe.id,
      };
    });
    recordDietEntries(inputs);
    emitDataChanged();
    onDone(`已按配料展开记下 ${inputs.length} 条「${recipe.name}」→ ${slot}`);
  }

  function combined() {
    if (!food) return;
    const grams = textToNum(gramsText);
    if (!(grams && grams > 0)) {
      setErr("填一下你吃了多少克（按「成品」重量算，不是配料重量）。");
      return;
    }
    recordDietEntry({
      date,
      time: nowHM(),
      mealSlot: slot,
      food,
      name: recipe.name,
      amount: 1,
      unitLabel: "克",
      grams,
      source: "custom",
      dishId: recipe.id,
    });
    emitDataChanged();
    onDone(`已把「${recipe.name}」记成一条（${Math.round(grams)} 克）→ ${slot}`);
  }

  const per = food ? `每 100g 约 ${Math.round(food.kcal)} kcal` : "";

  return (
    <div className="yq-scrim" onClick={onClose}>
      <div className="yq-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="yq-section-title">
          <span>🍳 做「{recipe.name}」</span>
          <button className="yq-btn yq-btn-sm yq-btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>

        {blocked ? (
          <>
            <p className="yq-empty">
              {missing.length > 0
                ? `有 ${missing.length} 个配料失效了，请重新选。`
                : "这道菜的成品重量要大于 0 才能折算 —— 先去把配方改一下。"}
            </p>
            <p className="yq-hint">
              配料查不到时<strong>不折算数字</strong>：少一样主料照样「算得出」一个数，而那个数会写进账本。
              宁可让你去修，也不给你一个看起来正常的错数。
            </p>
          </>
        ) : (
          <>
            <p className="yq-hint" style={{ marginBottom: 10 }}>
              这道菜每 100g 成品 {per}
              {food?.sugar === undefined ? "" : ` · 其中添加糖 ${food.sugar} g`}。
              成品重量 {recipe.yieldG} g。记到 <strong>{slot}</strong>。
            </p>

            {/* ---------- 路一：展开成多条 ---------- */}
            <div className="yq-card-flat" style={{ marginBottom: 10, padding: 10 }}>
              <p className="yq-label" style={{ marginBottom: 4 }}>展开成多条</p>
              <p className="yq-hint" style={{ marginBottom: 8 }}>
                每样配料各记一条，用<strong>下锅前</strong>的克数。好处是每样都带着自己真实的分类，
                当天的「蔬果占比」这类统计不会被一道菜糊成一类。
              </p>
              <button className="yq-btn yq-btn-primary" onClick={expand}>
                展开记 {recipe.parts.length} 条
              </button>
            </div>

            {/* ---------- 路二：合成一条 ---------- */}
            <div className="yq-card-flat" style={{ padding: 10 }}>
              <p className="yq-label" style={{ marginBottom: 4 }}>合成一条</p>
              <p className="yq-hint" style={{ marginBottom: 8 }}>
                整道菜按成品重量折算成「每 100g」，再乘以你吃的克数。好处是账本上就是一道菜，
                不是一堆原料。<strong>克数要按成品算</strong>（同样配料做出来 400g 和 600g，
                你要填的数不一样）。
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <input
                  className="yq-input"
                  inputMode="decimal"
                  aria-label="我吃了多少克"
                  value={gramsText}
                  placeholder="我吃了多少克"
                  onChange={(e) => setGramsText(e.target.value)}
                  style={{ maxWidth: 130, minHeight: 36 }}
                />
                <button
                  type="button"
                  className="yq-chip"
                  onClick={() => setGramsText(String(recipe.yieldG))}
                >
                  整份 · {recipe.yieldG}g
                </button>
                <button className="yq-btn yq-btn-primary" onClick={combined}>
                  合成一条记下
                </button>
              </div>
            </div>

            {err && (
              <p className="yq-hint" style={{ color: "var(--yq-danger)", marginTop: 8 }}>{err}</p>
            )}

            <p className="yq-hint" style={{ marginTop: 10 }}>
              两条路都允许，同一天先后用也没关系 —— 不去重，因为记几次是你的选择。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
