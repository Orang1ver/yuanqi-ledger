"use client";

/**
 * 我的菜谱 —— 配方编辑器 + 菜谱列表（纯本地功能，与有没有填 AI Key 无关）。
 *
 * 交互：列表 → 新建/编辑 → 搜配料、改克数 → 实时看合计 → 保存；列表里点「做这道菜」进记账。
 *
 * 刻意的设计：
 *
 * 1. **配料一律从食物库里搜，不许手打克数以外的任何营养值。**
 *    配方里存的只有 `{ foodId, grams }`，数值全靠 `recipeTotals` 现算 ——
 *    这样"数字只有一条来路"这条红线在编辑器里也守得住。
 *
 * 2. **克数是字符串 state**（AGENTS 地雷 5）。数字 state 会导致删不掉、永远留个 0，
 *    而"0 克"和"还没填"是两回事。
 *
 * 3. **成品重量默认 = 配料总重，但用户一改就不再自动跟。**
 *    用一个 `yieldTouched` 记住"他动过没有"，而不是把默认值写进 state ——
 *    写进 state 的话，用户改完配料克数，成品重量就不跟着变了，而他又说不清为什么。
 *    旁边那句固定的话必须一直在：**改它，整道菜的每 100g 数值都会变**
 *    （同样配料做出来 400g 和 600g，热量差一半），这是最容易踩错的一处。
 *
 * 4. **「＋ 一勺糖」的 8g 不硬编码。** 它来自 `data/foodPortions.json` 里
 *    `勺[糖, 白砂糖, 白糖, 冰糖] = 8g` 那条既有规则，走 `resolvePortion` 取 ——
 *    AGENTS 地雷 29 的判据只能有一份：勺 = 多少克这件事，份量表已经说了，
 *    在这里再写一遍的话，哪天份量表改了这里会静默不动。
 */

import { useState } from "react";
import { resolvePortion } from "@/lib/nutrition/core";
import { portionTable } from "@/lib/nutrition/library";
import { findFoodByIdIn, searchAllFoods } from "@/lib/nutrition/lookup";
import { defaultPortionOptions } from "@/lib/nutrition/quickadd";
import { recipePer100, recipeTotals, totalPartsGrams } from "@/lib/nutrition/recipe";
import type { FoodItem, NutritionValues } from "@/lib/nutrition/types";
import {
  MY_RECIPES_LIMIT,
  MyRecipeStorageError,
  addMyRecipe,
  loadCustomFoods,
  loadMyRecipes,
  removeMyRecipe,
  updateMyRecipe,
} from "@/lib/storage";
import type { MyRecipe } from "@/lib/storage";
import type { MealSlot } from "@/lib/tags";
import { PortionChips } from "./PortionChips";
import { RecipeCookSheet } from "./RecipeCookSheet";

/** 「＋ 一勺糖」加的是库里的白砂糖。克数由份量表给，见文件头第 4 条 */
const SUGAR_FOOD_ID = "baitang";

type PartDraft = { foodId: string; name: string; gramsText: string };

type Editor = {
  /** 编辑既有菜谱时带 id；新建时没有 */
  id?: string;
  name: string;
  note: string;
  /** 成品重量。字符串 state（地雷 5） */
  yieldText: string;
  /** 用户有没有手动改过成品重量 —— 没改就跟着配料总重走 */
  yieldTouched: boolean;
  parts: PartDraft[];
};

function emptyEditor(): Editor {
  return { name: "", note: "", yieldText: "", yieldTouched: false, parts: [] };
}

/** 字符串 → 数字。空串 / 非数 → `undefined`（**不是 0**） */
function textToNum(t: string): number | undefined {
  const s = t.trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** 草稿里的克数。非法值按 0 计**只用于预览**（用户正在输入时不该炸），保存前会拦 */
function draftNum(t: string): number {
  return textToNum(t) ?? 0;
}

function fmt(v: number | undefined, unit: string): string {
  if (v === undefined) return "无数据";
  const n = unit === "mg" ? Math.round(v) : Math.round(v * 10) / 10;
  return `${n} ${unit}`;
}

/** 一行营养合计。**没数据的项要显式写「无数据」**，不许画成 0 */
function NutrientLine({ label, v }: { label: string; v: NutritionValues }) {
  return (
    <p className="yq-hint" style={{ marginTop: 2 }}>
      {label}：{Math.round(v.kcal)} kcal · 蛋白 {fmt(v.protein, "g")} · 脂肪 {fmt(v.fat, "g")} ·
      碳水 {fmt(v.carb, "g")} · 钠 {fmt(v.sodium, "mg")} · 添加糖 {fmt(v.sugar, "g")}
    </p>
  );
}

export function RecipeSheet({
  date,
  slot,
  onClose,
  onMsg,
}: {
  date: string;
  slot: MealSlot;
  onClose: () => void;
  /** 记好账之后回一句给调用方显示 */
  onMsg: (msg: string) => void;
}) {
  const customFoods = loadCustomFoods();
  const byId = (id: string) => findFoodByIdIn(id, customFoods);

  const [recipes, setRecipes] = useState<MyRecipe[]>(() => loadMyRecipes());
  const [editor, setEditor] = useState<Editor | null>(null);
  const [query, setQuery] = useState("");
  const [err, setErr] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  /** 正在做哪道菜（打开记账面板） */
  const [cooking, setCooking] = useState<MyRecipe | null>(null);

  const results = query.trim() ? searchAllFoods(query, customFoods, 8) : [];

  // ---------- 草稿 → 数值（实时） ----------

  const parts = editor ? editor.parts.map((p) => ({ foodId: p.foodId, grams: draftNum(p.gramsText) })) : [];
  /** 配料总重 —— 成品重量的默认值 */
  const autoYield = totalPartsGrams({ parts });
  const yieldG = editor ? (editor.yieldTouched ? draftNum(editor.yieldText) : autoYield) : 0;
  const draftRecipe: MyRecipe = {
    id: editor?.id ?? "recipe-preview",
    name: editor?.name || "（还没起名字）",
    yieldG,
    parts,
    createdAt: 0,
  };
  const totals = editor ? recipeTotals(draftRecipe, byId) : null;
  const per = editor ? recipePer100(draftRecipe, byId) : null;
  /** 配料里查不到的那几个（用户库里那条被删了） */
  const missing = totals?.missing ?? [];

  // ---------- 编辑器动作 ----------

  function update(patch: Partial<Editor>) {
    setEditor((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function addPart(food: FoodItem, grams?: number) {
    setEditor((prev) =>
      prev
        ? {
            ...prev,
            parts: [
              ...prev.parts,
              {
                foodId: food.id,
                name: food.name,
                // 档位查不到就留空，让用户自己填 —— **不猜一个克数**（留空会被保存前的校验拦住）
                gramsText: grams === undefined ? "" : String(Math.round(grams * 10) / 10),
              },
            ],
          }
        : prev,
    );
    setQuery("");
  }

  /**
   * 加一勺某样调料。
   * ⚠️ 克数走 `resolvePortion`，**不硬编码 8** —— 份量表里没有这条就不加，
   * 宁可什么都不做，也不给一个"看起来对"的克数。
   */
  function addSpoon(foodId: string) {
    const food = byId(foodId);
    if (!food) return;
    const hit = resolvePortion(portionTable(), food, "勺");
    if (!hit) {
      setErr(`份量表里没有「一勺${food.name}」这条规则，先手动搜它加进来。`);
      return;
    }
    addPart(food, hit.grams);
  }

  function save() {
    if (!editor) return;
    const name = editor.name.trim();
    if (!name) {
      setErr("给这道菜起个名字，不然以后认不出来。");
      return;
    }
    if (!editor.parts.length) {
      setErr("至少要加一样配料。");
      return;
    }
    if (missing.length) {
      setErr(`有 ${missing.length} 个配料失效了，请重新选。`);
      return;
    }
    const grams = editor.parts.map((p) => draftNum(p.gramsText));
    if (grams.some((g) => !(g > 0))) {
      setErr("每样配料的克数都要大于 0。");
      return;
    }
    const y = editor.yieldTouched ? textToNum(editor.yieldText) : autoYield;
    if (!(y && y > 0)) {
      setErr("成品重量要大于 0 —— 折算每 100g 要用它做除数。");
      return;
    }

    const payload = {
      name,
      yieldG: y,
      parts: editor.parts.map((p) => ({ foodId: p.foodId, grams: draftNum(p.gramsText) })),
      ...(editor.note.trim() ? { note: editor.note.trim() } : {}),
    };

    try {
      const next = editor.id
        ? updateMyRecipe(editor.id, payload)
        : addMyRecipe(payload).list;
      setRecipes(next);
      setEditor(null);
      setErr("");
    } catch (e) {
      setErr(e instanceof MyRecipeStorageError || e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="yq-scrim" onClick={onClose}>
      <div className="yq-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="yq-section-title">
          <span>🍳 我的菜谱</span>
          <button className="yq-btn yq-btn-sm yq-btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>

        {editor ? (
          <>
            {/* ---------- 配方编辑器 ---------- */}
            <label className="yq-label">菜名</label>
            <input
              className="yq-input"
              value={editor.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="比如「西红柿炒鸡蛋」"
              style={{ marginBottom: 10 }}
            />

            <label className="yq-label">配料</label>
            <input
              className="yq-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜一样加一样，比如「鸡蛋」「西红柿」"
              style={{ marginBottom: 6 }}
            />
            {results.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {results.map((f) => (
                  <button
                    key={f.id}
                    className="yq-chip"
                    onClick={() => {
                      // 默认份量取这个食物的第一个档位（一个鸡蛋 55g 这种），
                      // 查不到档位就给 0 克，让用户自己填 —— 不猜一个克数
                      const opt = defaultPortionOptions(f)[0];
                      addPart(f, opt ? opt.grams : 0);
                    }}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              <button className="yq-btn yq-btn-sm yq-btn-ghost" onClick={() => addSpoon(SUGAR_FOOD_ID)}>
                ＋ 一勺糖
              </button>
              <span className="yq-hint" style={{ alignSelf: "center" }}>
                一勺糖的克数来自份量表，不是这里写死的
              </span>
            </div>

            {!editor.parts.length ? (
              <p className="yq-empty">还没有配料。上面搜一样加一样。</p>
            ) : (
              editor.parts.map((p, i) => {
                const food = byId(p.foodId);
                const opts = food ? defaultPortionOptions(food) : [];
                return (
                  <div
                    key={`${p.foodId}-${i}`}
                    style={{ borderTop: "1px solid var(--yq-line)", padding: "10px 0" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                      <b style={{ fontSize: 14, color: "var(--yq-ink)" }}>
                        {food ? food.name : `${p.name}（这份食物已被删掉）`}
                      </b>
                      <button
                        className="yq-btn yq-btn-sm yq-btn-ghost"
                        onClick={() =>
                          update({ parts: editor.parts.filter((_, j) => j !== i) })
                        }
                      >
                        移除
                      </button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                      <input
                        className="yq-input"
                        inputMode="decimal"
                        aria-label="克数"
                        value={p.gramsText}
                        onChange={(e) =>
                          update({
                            parts: editor.parts.map((q, j) =>
                              j === i ? { ...q, gramsText: e.target.value } : q,
                            ),
                          })
                        }
                        style={{ maxWidth: 96, minHeight: 36, fontSize: 14 }}
                      />
                      <span className="yq-hint">克（下锅前的量）</span>
                    </div>
                    {opts.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        <PortionChips
                          options={opts}
                          currentGrams={draftNum(p.gramsText)}
                          onPick={(o) =>
                            update({
                              parts: editor.parts.map((q, j) =>
                                j === i ? { ...q, gramsText: String(o.grams) } : q,
                              ),
                            })
                          }
                        />
                      </div>
                    )}
                    {food && (
                      <p className="yq-hint" style={{ marginTop: 2 }}>
                        数值来源：{food.source}
                      </p>
                    )}
                  </div>
                );
              })
            )}

            {/* ---------- 成品重量 ---------- */}
            <label className="yq-label" style={{ marginTop: 10 }}>成品重量</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <input
                className="yq-input"
                inputMode="decimal"
                value={editor.yieldTouched ? editor.yieldText : String(autoYield)}
                onChange={(e) => update({ yieldText: e.target.value, yieldTouched: true })}
                style={{ maxWidth: 110, minHeight: 36 }}
              />
              <span className="yq-hint">克</span>
              {editor.yieldTouched && (
                <button
                  className="yq-btn yq-btn-sm yq-btn-ghost"
                  onClick={() => update({ yieldTouched: false, yieldText: "" })}
                >
                  改回按配料总重
                </button>
              )}
            </div>
            <p className="yq-hint" style={{ marginTop: 4 }}>
              默认等于配料总重。<strong>改它，整道菜的每 100g 数值都会变</strong> ——
              同样配料做出来 400g 和 600g，热量差一半。
            </p>

            {/* ---------- 实时合计 ---------- */}
            <div className="yq-card-flat" style={{ marginTop: 10, padding: 10 }}>
              <p className="yq-label" style={{ marginBottom: 4 }}>实时合计</p>
              {totals && <NutrientLine label={`配料共（下锅前，${Math.round(autoYield)} g）`} v={totals.values} />}
              {per ? (
                <NutrientLine label="每 100g 成品" v={per.per100} />
              ) : (
                <p className="yq-hint" style={{ color: "var(--yq-danger)" }}>
                  成品重量要大于 0 才能折算每 100g。
                </p>
              )}
              {missing.length > 0 && (
                <p className="yq-hint" style={{ color: "var(--yq-danger)" }}>
                  有 {missing.length} 个配料失效了，请重新选：{missing.join("、")}
                </p>
              )}
            </div>

            <label className="yq-label" style={{ marginTop: 10 }}>备注（可留空）</label>
            <input
              className="yq-input"
              value={editor.note}
              onChange={(e) => update({ note: e.target.value })}
              placeholder="比如「汤别喝光」「这次的糖减半」"
              style={{ marginBottom: 10 }}
            />

            {err && <p className="yq-hint" style={{ color: "var(--yq-danger)" }}>{err}</p>}

            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button className="yq-btn yq-btn-primary" style={{ flex: 1 }} onClick={save}>
                保存到我的菜谱
              </button>
              <button className="yq-btn" onClick={() => { setEditor(null); setErr(""); }}>
                取消
              </button>
            </div>
          </>
        ) : (
          <>
            {/* ---------- 菜谱列表 ---------- */}
            <p className="yq-hint" style={{ marginBottom: 10 }}>
              自己做的菜：按配料存成配方，下次直接记。存在本机、不联网、不花 Key。
            </p>

            {!recipes.length ? (
              <p className="yq-empty">还没有菜谱。点下面的「新建菜谱」，先把常做的那道菜存下来。</p>
            ) : (
              recipes.map((r) => {
                const p = recipePer100(r, byId);
                const ms = recipeTotals(r, byId).missing;
                return (
                  <div
                    key={r.id}
                    style={{ borderTop: "1px solid var(--yq-line)", padding: "10px 0" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                      <b style={{ fontSize: 14, color: "var(--yq-ink)" }}>{r.name}</b>
                      <span className="yq-hint">{r.parts.length} 样配料 · 成品 {r.yieldG} g</span>
                    </div>
                    <p className="yq-hint" style={{ marginTop: 2 }}>
                      {p ? `每 100g 约 ${Math.round(p.per100.kcal)} kcal` : "折算不出每 100g（成品重量不对劲）"}
                      {r.note ? ` · ${r.note}` : ""}
                    </p>
                    {ms.length > 0 && (
                      <p className="yq-hint" style={{ color: "var(--yq-danger)" }}>
                        有 {ms.length} 个配料失效了，请重新选
                      </p>
                    )}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                      <button
                        className="yq-btn yq-btn-sm yq-btn-primary"
                        onClick={() => setCooking(r)}
                        disabled={ms.length > 0 || !p}
                      >
                        做这道菜
                      </button>
                      <button
                        className="yq-btn yq-btn-sm yq-btn-ghost"
                        onClick={() => {
                          setErr("");
                          setEditor({
                            id: r.id,
                            name: r.name,
                            note: r.note ?? "",
                            yieldText: String(r.yieldG),
                            yieldTouched: true,
                            parts: r.parts.map((q) => ({
                              foodId: q.foodId,
                              name: byId(q.foodId)?.name ?? q.foodId,
                              gramsText: String(q.grams),
                            })),
                          });
                        }}
                      >
                        改配方
                      </button>
                      {deleteId === r.id ? (
                        <button
                          className="yq-btn yq-btn-sm yq-btn-danger"
                          onClick={() => {
                            setRecipes(removeMyRecipe(r.id));
                            setDeleteId(null);
                          }}
                        >
                          确认删除
                        </button>
                      ) : (
                        <button
                          className="yq-btn yq-btn-sm yq-btn-ghost"
                          onClick={() => setDeleteId(r.id)}
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button
                className="yq-btn yq-btn-primary"
                onClick={() => {
                  setErr("");
                  setEditor(emptyEditor());
                }}
              >
                新建菜谱
              </button>
              <span className="yq-hint">
                最多 {MY_RECIPES_LIMIT} 份
              </span>
            </div>
            {err && <p className="yq-hint" style={{ color: "var(--yq-danger)", marginTop: 8 }}>{err}</p>}
          </>
        )}
      </div>

      {cooking && (
        <RecipeCookSheet
          recipe={cooking}
          date={date}
          slot={slot}
          onClose={() => setCooking(null)}
          onDone={(msg) => {
            setCooking(null);
            onMsg(msg);
            onClose();
          }}
        />
      )}
    </div>
  );
}
