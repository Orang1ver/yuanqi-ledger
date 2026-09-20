"use client";

/**
 * 一句话记账。
 *
 * 交互分三步，每一步都让用户有机会否决机器：
 *   说一句 → 看解析结果（每条都带折算依据）→ 确认落库
 *
 * 刻意的设计：
 * 1. **解析结果不是直接落库，而是先摆出来。** 中文口语的歧义太多
 *    （「一杯奶茶」是多大杯？「一份」是多少克？），直接存下去等于把机器的猜测
 *    当成事实写进用户的账本。这里把依据摊开，用户扫一眼就知道对不对。
 * 2. **估算项显式标注。** 没写份量时按分类兜底，界面上会写「估算」——
 *    不标的话，用户会以为 50g 是查出来的。
 * 3. **库里没匹配到的行不静默丢弃**，而且要说清**是哪一种没匹配上**：
 *    不需要记（水）／说得太笼统（一顿饭）／库里真没有，三件事的出路完全不同，
 *    糊成一句「未匹配」用户只能自己猜。
 * 4. **先选餐次再记。** 餐次以前是从当前时间推的，补录时几乎必错 ——
 *    半夜补记中午那顿会被算成「加餐」，而当天的三餐结构正是这个页面要说的事。
 */

import { useState } from "react";
import { emitDataChanged } from "@/lib/bus";
import { mealSlotFromTime, nowHM } from "@/lib/date";
import { MEAL_PRESETS } from "@/lib/mealPresets";
import type { MealPreset } from "@/lib/mealPresets";
import { fallbackGrams, nutritionOf } from "@/lib/nutrition/core";
import { bestNameMatch } from "@/lib/nutrition/library";
import { findFoodByIdIn } from "@/lib/nutrition/lookup";
import { defaultPortionOptions, resolveText } from "@/lib/nutrition/quickadd";
import type { MissingReason, QuickCandidate } from "@/lib/nutrition/quickadd";
import { categoryLabel } from "@/lib/nutrition/types";
import type { FoodItem } from "@/lib/nutrition/types";
import { MEAL_SLOTS } from "@/lib/tags";
import type { MealSlot } from "@/lib/tags";
import {
  frequentFoods,
  loadCustomFoods,
  recordDietEntries,
  recordDietEntry,
} from "@/lib/storage";
import { loadApiKeys } from "@/lib/prefs";
import { FoodPhotoSheet } from "./FoodPhotoSheet";
import { FoodSearchDialog } from "./FoodSearchDialog";
import { PortionChips } from "./PortionChips";
import type { PortionValue } from "./PortionPicker";

type Row = {
  c: QuickCandidate;
  food?: FoodItem;
  /** 字符串 state：数字 state 会导致删不掉、永远留个 0 */
  gramsText: string;
  unitLabel: string;
  removed: boolean;
};

/** 没匹配上的行挂什么标签。五种原因对应五种出路，标签就该不一样 */
const MISSING_BADGE: Record<MissingReason, { text: string; cls: string }> = {
  "no-name": { text: "缺个名字", cls: "yq-badge-info" },
  meal: { text: "要具体点", cls: "yq-badge-info" },
  generic: { text: "太笼统", cls: "yq-badge-info" },
  "no-calorie": { text: "不必记账", cls: "yq-badge-primary" },
  "not-found": { text: "库里没有", cls: "yq-badge-accent" },
};

/**
 * 解析结果 → 可编辑的行。
 *
 * ⚠️ **`not-found` 的行在这里会被"捞"一次**：`quickadd.ts` 的 `matchFood` 只认内置库
 * （把用户库接进去会牵动 parse/quickadd 的核心判据，风险大收益小 —— 取舍见交接文档）。
 * 所以折中：解析报「库里没有」之后，**在 UI 层拿用户库再匹配一次**，
 * 命中就直接变成可用行。这样用户说「一杯鸭屎香柠檬茶」也能被认出来。
 *
 * 用的是与解析器**同一个** `bestNameMatch`（地牢 29：判据只能有一份）。
 */
function toRows(candidates: QuickCandidate[], extra: readonly FoodItem[]): Row[] {
  return candidates.map((c) => {
    let food = c.food;
    let reason = c.reason;

    if (!food && reason === "not-found" && extra.length > 0) {
      // 拿解析出的名字（没名字就用清洗后的原句）去用户库里找
      const probe = c.name || c.cleaned;
      let best: { food: FoodItem; score: number } | null = null;
      for (const f of extra) {
        const s = bestNameMatch(f, probe).score;
        if (s > 0 && (!best || s > best.score)) best = { food: f, score: s };
      }
      if (best) {
        food = best.food;
        // 认出来了，但份量仍然按原来的兜底逻辑走 —— 这一步只解决"是哪一种食物"，
        // 不解决"吃了多少"（那个仍由用户确认）。
        reason = undefined;
      }
    }

    return {
      c: { ...c, food, reason, missing: !food },
      food,
      gramsText: c.grams > 0 ? String(Math.round(c.grams)) : "",
      unitLabel: c.unitLabel,
      removed: false,
    };
  });
}

function gramsOf(r: Row): number {
  const n = Number(r.gramsText);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 原句里被剥掉的那一截（「晚上吃了」）。
 * 摆出来是为了让用户看得见机器做了什么 —— 只说「解析成功」是没法验证的。
 */
function strippedPrefix(raw: string, cleaned: string): string {
  if (raw.length <= cleaned.length || !raw.endsWith(cleaned)) return "";
  return raw.slice(0, raw.length - cleaned.length);
}

/**
 * 当前克数折回「几个 / 几包」。
 * ⚠️ 由当前克数**反算**，不是把解析时的数量原样写上 —— 用户改了克数，
 * 这个数要跟着变，否则屏幕上会同时出现「300 克」和「1 个」这种自相矛盾。
 */
function portionCount(r: Row): string | null {
  const per = r.c.amount > 0 ? r.c.grams / r.c.amount : 0;
  if (!(per > 0) || r.unitLabel === "克" || r.unitLabel === "份") return null;
  const n = gramsOf(r) / per;
  if (!(n > 0)) return null;
  return `≈ ${Number.isInteger(n) ? n : Math.round(n * 10) / 10} ${r.unitLabel}`;
}

const EXAMPLE = "晚上吃了一包薯片，一杯奶茶";

export function QuickAddCard({ date }: { date: string }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState("");
  const [picker, setPicker] = useState<{ food?: FoodItem; query?: string } | null>(null);
  /** 记到哪一餐。默认按现在的钟点猜，用户随时可以改 —— 补录时这个默认值基本是错的 */
  const [slot, setSlot] = useState<MealSlot>(() => mealSlotFromTime(nowHM()));
  /** 「一顿饭」预设面板是否展开 */
  const [presetOpen, setPresetOpen] = useState(false);
  /** 打开拍照识别面板时的预填名字 */
  const [photoFor, setPhotoFor] = useState<string | null>(null);

  // 用户自己的食物库。读一次给整棵子树用。
  const customFoods = loadCustomFoods();

  /**
   * 有没有配 Key。没配就**不显示拍照入口** ——
   * 照 `WhatToEatCard` 的既有做法：宁可看不到按钮，也不要让用户点了才发现用不了。
   */
  const hasPhotoKey = Boolean(loadApiKeys().deepseekKey?.trim());

  // ⚠️ 必须走合并检索：用户自己加的食物也会出现在「最近常吃」里，
  // 只用内置库的话那一行会**静默消失**（点了没反应的空白，最难查的那种 bug）。
  const frequent = frequentFoods(6)
    .map((f) => findFoodByIdIn(f.foodId, customFoods))
    .filter((f): f is FoodItem => !!f);

  const ready = (rows ?? []).filter((r) => !r.removed && r.food && gramsOf(r) > 0);
  const previewKcal = ready.reduce((a, r) => a + nutritionOf(r.food as FoodItem, gramsOf(r)).kcal, 0);

  /** 把一顿饭预设展开成和文本解析相同的 Row[]，从而复用整套预览 / 删改 / 保存 UI */
  function rowsFromPreset(p: MealPreset): Row[] {
    return p.items.map((it) => {
      const food = findFoodByIdIn(it.foodId, customFoods);
      return {
        c: {
          raw: "",
          cleaned: "",
          amount: 1,
          unitLabel: "克",
          name: food?.name ?? it.foodId,
          grams: it.grams,
          basis: `预设「${p.label}」`,
          estimated: false,
          missing: !food,
          reason: food ? undefined : ("not-found" as const),
          alternatives: [],
        },
        food,
        gramsText: String(it.grams),
        unitLabel: "克",
        removed: false,
      };
    });
  }

  function parse() {
    if (!text.trim()) return;
    const cs = resolveText(text);
    if (!cs.length) {
      setMsg("没读出食物。试试「一包薯片，一杯奶茶」这种写法。");
      setRows(null);
      return;
    }
    setRows(toRows(cs, customFoods));
    setMsg("");
  }

  function update(i: number, patch: Partial<Row>) {
    setRows((prev) => (prev ? prev.map((r, j) => (j === i ? { ...r, ...patch } : r)) : prev));
  }

  /** 没匹配上的行：用户从相近项里挑一个，顺便按默认份量折算一次 */
  function adopt(i: number, food: FoodItem) {
    const opt = defaultPortionOptions(food)[0];
    const per = opt ? opt.grams : fallbackGrams(food);
    const scale = rows?.[i]?.c.amount ?? 1;
    update(i, { food, gramsText: String(Math.round(per * scale)), unitLabel: opt?.label ?? "份" });
  }

  function saveAll() {
    if (!ready.length) return;
    const time = nowHM();
    recordDietEntries(
      ready.map((r) => ({
        date,
        time,
        mealSlot: slot,
        food: r.food,
        name: (r.food as FoodItem).name,
        amount: r.c.amount,
        unitLabel: r.unitLabel,
        grams: gramsOf(r),
        source: "db" as const,
      })),
    );
    emitDataChanged();
    setMsg(`已记下 ${ready.length} 条 → ${slot}`);
    setRows(null);
    setText("");
  }

  /** 搜索/最近常吃进来的：份量已经明确，直接落库 */
  function addOne(food: FoodItem, portion: PortionValue) {
    recordDietEntry({
      date,
      time: nowHM(),
      mealSlot: slot,
      food,
      name: food.name,
      amount: 1,
      unitLabel: portion.unitLabel,
      grams: portion.grams,
      source: "db",
    });
    emitDataChanged();
    setPicker(null);
    setMsg(`已记下「${food.name}」→ ${slot}`);
  }

  return (
    <section className="yq-card" style={{ marginBottom: 14 }}>
      <div className="yq-section-title">
        <span>记一笔</span>
        <button className="yq-btn yq-btn-sm" onClick={() => setPicker({})}>
          搜索添加
        </button>
        <button className="yq-btn yq-btn-sm" onClick={() => setPresetOpen((v) => !v)}>
          一顿饭
        </button>
      </div>

      {/* 先定这是哪一餐：页面下面就是按三餐摆的，记错餐次会让整个结构对不上 */}
      <div
        role="group"
        aria-label="记到哪一餐"
        style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 8 }}
      >
        <span className="yq-label" style={{ marginBottom: 0 }}>记到</span>
        {MEAL_SLOTS.map((s) => (
          <button
            key={s}
            className="yq-chip"
            data-on={slot === s}
            aria-pressed={slot === s}
            onClick={() => setSlot(s)}
          >
            {s}
          </button>
        ))}
        <span className="yq-hint">默认按现在的时间猜，可以改</span>
      </div>

      {presetOpen && (
        <div
          role="group"
          aria-label="一顿饭搭配"
          style={{ marginBottom: 10 }}
        >
          <p className="yq-label" style={{ marginBottom: 6 }}>选一餐搭配（点一下就展开成多条，可逐条删 / 改克数）</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {MEAL_PRESETS.map((p) => (
              <button
                key={p.key}
                className="yq-chip"
                onClick={() => {
                  setRows(rowsFromPreset(p));
                  setPresetOpen(false);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <textarea
        className="yq-textarea"
        style={{ minHeight: 62 }}
        placeholder={`说一句就行，比如「${EXAMPLE}」`}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button className="yq-btn yq-btn-sm yq-btn-primary" onClick={parse} disabled={!text.trim()}>
          看看算成什么
        </button>
        {text.trim() && (
          <button className="yq-btn yq-btn-sm yq-btn-ghost" onClick={() => setText("")}>
            清空
          </button>
        )}
      </div>

      {frequent.length > 0 && !rows && (
        <div style={{ marginTop: 14 }}>
          <p className="yq-label" style={{ marginBottom: 6 }}>最近常吃</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {frequent.map((f) => (
              <button key={f.id} className="yq-chip" onClick={() => setPicker({ food: f })}>
                {f.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {rows && (
        <div style={{ marginTop: 14 }}>
          <p className="yq-label" style={{ marginBottom: 6 }}>
            解析结果（数字对不上就改克数）
          </p>

          {rows.map((r, i) => {
            const prefix = strippedPrefix(r.c.raw, r.c.cleaned);
            const count = r.food ? portionCount(r) : null;
            const badge = r.c.reason ? MISSING_BADGE[r.c.reason] : null;
            return (
              <div
                key={`${r.c.raw}-${i}`}
                style={{
                  borderTop: "1px solid var(--yq-line)",
                  padding: "10px 0",
                  opacity: r.removed ? 0.45 : 1,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                    <b style={{ fontSize: 14, color: "var(--yq-ink)" }}>
                      {r.food ? r.food.name : `「${r.c.name || r.c.raw}」`}
                    </b>
                    {badge && <span className={`yq-badge ${badge.cls}`}>{badge.text}</span>}
                  </span>
                  <button
                    className="yq-btn yq-btn-sm yq-btn-ghost"
                    onClick={() => update(i, { removed: !r.removed })}
                  >
                    {r.removed ? "恢复" : "移除"}
                  </button>
                </div>

                {r.food ? (
                  <>
                    <p className="yq-hint" style={{ marginTop: 2 }}>
                      {prefix ? `剥掉「${prefix}」· ` : ""}
                      {r.c.basis}
                      {r.c.estimated ? " ⚠ 估算" : ""}
                    </p>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                      <input
                        className="yq-input"
                        type="number"
                        inputMode="decimal"
                        aria-label="克数"
                        value={r.gramsText}
                        onChange={(e) => update(i, { gramsText: e.target.value })}
                        style={{ maxWidth: 96, minHeight: 36, fontSize: 14 }}
                      />
                      {/* ⚠️ 这个框里装的是**克数**，单位就只能写「克」。
                          以前这里写的是 unitLabel（「份」「包」），于是「吃了个苹果」
                          在界面上显示成「200 份」—— 数字是对的，读出来是另一个意思。 */}
                      <span className="yq-hint">
                        克{count ? ` ${count}` : ""} ·{" "}
                        {gramsOf(r) > 0
                          ? `${Math.round(nutritionOf(r.food, gramsOf(r)).kcal)} kcal`
                          : "填个克数"}
                      </span>
                    </div>
                    {/* 份量档位：点一下就把克数改成「大包 135g」这种常见量。
                        ⚠️ 只改**克数**、不动 `unitLabel` —— 它是解析出来的量词（「包」），
                        而 `portionCount` 要靠它把当前克数反算成「≈ N 个」；
                        把它换成档位标签（「大包」）会让反算变成「≈ 1.9 大包」这种读数。 */}
                    {defaultPortionOptions(r.food).length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        <PortionChips
                          options={defaultPortionOptions(r.food)}
                          currentGrams={gramsOf(r)}
                          onPick={(o) => update(i, { gramsText: String(o.grams) })}
                        />
                      </div>
                    )}
                    <p className="yq-hint" style={{ marginTop: 2 }}>
                      {categoryLabel(r.food.category)} · 数值来源：{r.food.source}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="yq-hint" style={{ marginTop: 4 }}>
                      {r.c.explain}
                    </p>
                    {r.c.alternatives.length > 0 && (
                      <>
                        <p className="yq-hint" style={{ marginTop: 6 }}>相近的：</p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {r.c.alternatives.map((f) => (
                            <button key={f.id} className="yq-chip" onClick={() => adopt(i, f)}>
                              {f.name}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        className="yq-btn yq-btn-sm yq-btn-ghost"
                        onClick={() => setPicker({ query: r.c.name || r.c.cleaned })}
                      >
                        自己搜一个
                      </button>
                      {hasPhotoKey && (
                        <button
                          className="yq-btn yq-btn-sm yq-btn-ghost"
                          onClick={() => setPhotoFor(r.c.name || r.c.cleaned || "")}
                        >
                          📷 拍照让 AI 读一下
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}

          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button className="yq-btn yq-btn-sm yq-btn-primary" onClick={saveAll} disabled={!ready.length}>
              记到{slot}· {ready.length} 条
            </button>
            <span className="yq-hint">合计约 {Math.round(previewKcal)} kcal</span>
            <button className="yq-btn yq-btn-sm yq-btn-ghost" onClick={() => setRows(null)}>
              算了
            </button>
          </div>
        </div>
      )}

      {msg && (
        <p className="yq-hint" style={{ marginTop: 10, color: "var(--yq-primary-ink)" }}>
          {msg}
        </p>
      )}

      {picker && (
        <FoodSearchDialog
          initialFood={picker.food}
          initialQuery={picker.query}
          extraFoods={customFoods}
          onClose={() => setPicker(null)}
          onAdd={addOne}
          onPhoto={
            hasPhotoKey
              ? (q) => {
                  setPicker(null);
                  setPhotoFor(q);
                }
              : undefined
          }
        />
      )}

      {photoFor !== null && (
        <FoodPhotoSheet
          date={date}
          slot={slot}
          hintName={photoFor || undefined}
          onClose={() => setPhotoFor(null)}
          onSaved={(f) => setMsg(`已存进「我的食物库」并记一笔：${f.name} → ${slot}`)}
        />
      )}
    </section>
  );
}
