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
 * 3. **库里没匹配到的行不静默丢弃**，而是让用户从相近项里挑一个。丢掉的话，
 *    用户以为记上了，实际少了一条。
 */

import { useState } from "react";
import { emitDataChanged } from "@/lib/bus";
import { nowHM } from "@/lib/date";
import { fallbackGrams, nutritionOf } from "@/lib/nutrition/core";
import { foodById } from "@/lib/nutrition/library";
import { defaultPortionOptions, resolveText } from "@/lib/nutrition/quickadd";
import type { QuickCandidate } from "@/lib/nutrition/quickadd";
import { categoryLabel } from "@/lib/nutrition/types";
import type { FoodItem } from "@/lib/nutrition/types";
import { frequentFoods, recordDietEntry } from "@/lib/storage";
import { FoodSearchDialog } from "./FoodSearchDialog";
import type { PortionValue } from "./PortionPicker";

type Row = {
  c: QuickCandidate;
  food?: FoodItem;
  /** 字符串 state：数字 state 会导致删不掉、永远留个 0 */
  gramsText: string;
  unitLabel: string;
  removed: boolean;
};

function toRows(candidates: QuickCandidate[]): Row[] {
  return candidates.map((c) => ({
    c,
    food: c.food,
    gramsText: c.grams > 0 ? String(Math.round(c.grams)) : "",
    unitLabel: c.unitLabel,
    removed: false,
  }));
}

function gramsOf(r: Row): number {
  const n = Number(r.gramsText);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const EXAMPLE = "晚上吃了一包薯片，一杯奶茶";

export function QuickAddCard({ date }: { date: string }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState("");
  const [picker, setPicker] = useState<{ food?: FoodItem } | null>(null);

  const frequent = frequentFoods(6)
    .map((f) => foodById(f.foodId))
    .filter((f): f is FoodItem => !!f);

  const ready = (rows ?? []).filter((r) => !r.removed && r.food && gramsOf(r) > 0);
  const previewKcal = ready.reduce((a, r) => a + nutritionOf(r.food as FoodItem, gramsOf(r)).kcal, 0);

  function parse() {
    if (!text.trim()) return;
    const cs = resolveText(text);
    if (!cs.length) {
      setMsg("没读出食物。试试「一包薯片，一杯奶茶」这种写法。");
      setRows(null);
      return;
    }
    setRows(toRows(cs));
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
    for (const r of ready) {
      recordDietEntry({
        date,
        time,
        food: r.food,
        name: (r.food as FoodItem).name,
        amount: r.c.amount,
        unitLabel: r.unitLabel,
        grams: gramsOf(r),
        source: "db",
      });
    }
    emitDataChanged();
    setMsg(`已记下 ${ready.length} 条`);
    setRows(null);
    setText("");
  }

  /** 搜索/最近常吃进来的：份量已经明确，直接落库 */
  function addOne(food: FoodItem, portion: PortionValue) {
    recordDietEntry({
      date,
      time: nowHM(),
      food,
      name: food.name,
      amount: 1,
      unitLabel: portion.unitLabel,
      grams: portion.grams,
      source: "db",
    });
    emitDataChanged();
    setPicker(null);
    setMsg(`已记下「${food.name}」`);
  }

  return (
    <section className="yq-card" style={{ marginBottom: 14 }}>
      <div className="yq-section-title">
        <span>记一笔</span>
        <button className="yq-btn yq-btn-sm" onClick={() => setPicker({})}>
          搜索添加
        </button>
      </div>

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

          {rows.map((r, i) => (
            <div
              key={`${r.c.raw}-${i}`}
              style={{
                borderTop: "1px solid var(--yq-line)",
                padding: "10px 0",
                opacity: r.removed ? 0.45 : 1,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                <b style={{ fontSize: 14, color: "var(--yq-ink)" }}>
                  {r.food ? r.food.name : `未匹配：「${r.c.name}」`}
                </b>
                <button
                  className="yq-btn yq-btn-sm yq-btn-ghost"
                  onClick={() => update(i, { removed: !r.removed })}
                >
                  {r.removed ? "恢复" : "移除"}
                </button>
              </div>

              <p className="yq-hint" style={{ marginTop: 2 }}>
                {r.c.raw !== r.c.cleaned ? `「${r.c.raw}」→「${r.c.cleaned}」· ` : ""}
                {r.c.basis}
                {r.c.estimated && r.food ? " ⚠ 估算" : ""}
              </p>

              {r.food ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                    <input
                      className="yq-input"
                      type="number"
                      inputMode="decimal"
                      value={r.gramsText}
                      onChange={(e) => update(i, { gramsText: e.target.value })}
                      style={{ maxWidth: 96, minHeight: 36, fontSize: 14 }}
                    />
                    <span className="yq-hint">
                      {r.unitLabel} ·{" "}
                      {gramsOf(r) > 0
                        ? `${Math.round(nutritionOf(r.food, gramsOf(r)).kcal)} kcal`
                        : "填个克数"}
                    </span>
                  </div>
                  <p className="yq-hint" style={{ marginTop: 2 }}>
                    {categoryLabel(r.food.category)} · 数值来源：{r.food.source}
                  </p>
                </>
              ) : (
                <>
                  <p className="yq-hint" style={{ marginTop: 4 }}>
                    库里没有这一条。从下面挑一个，或者用「搜索添加」自己找：
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                    {r.c.alternatives.length === 0 && (
                      <span className="yq-hint">没有相近的条目</span>
                    )}
                    {r.c.alternatives.map((f) => (
                      <button key={f.id} className="yq-chip" onClick={() => adopt(i, f)}>
                        {f.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}

          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button className="yq-btn yq-btn-sm yq-btn-primary" onClick={saveAll} disabled={!ready.length}>
              记下这 {ready.length} 条
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
          onClose={() => setPicker(null)}
          onAdd={addOne}
        />
      )}
    </section>
  );
}
