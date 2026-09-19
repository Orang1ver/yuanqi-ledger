"use client";

/**
 * 拍照记食物 —— 拍一张包装上的营养成分表（或一盘菜），让模型读出数值，
 * 校验后存进「我的食物库」并立刻记一笔。
 *
 * 交互分四步，每一步都让用户有机会否决机器：
 *   选图 → 压缩 → 识别中 → **结果确认**（可逐字段改）→ 存库并记账
 *
 * 刻意的设计：
 *
 * 1. **结果页不是"识别完成，已保存"，而是把读到的原始表摆出来让用户核对。**
 *    模型是转录员，转录就会抄错（小数点丢一个、把 NRV 列抄进含量列）。
 *    直接存下去等于把它的错抄进用户的账本，而账本是用来做判断的。
 *
 * 2. **校验结论要显示出来，但不能替代用户核对。**
 *    `verify.ts` 只能拦住"自相矛盾"（四个数一致地抄错它拦不住），
 *    所以界面说的是"与标示值一致"，不是"数字正确"。
 *
 * 3. **估算要吼出来。** 用户明确要求强调估算的不严谨性 ——
 *    模型没看到营养成分表、只能凭外观猜时，误差可能大到没有意义
 *    （餐馆的油量、份量都看不出来）。这种情况页面顶部挂一条醒目警告，
 *    `source` 也写成"AI 估算"，并且记账的 source 记成 `"ai"`，
 *    这样当日汇总能说清"其中 N 条是估算的"。
 *
 * 4. **数字框用字符串 state**（AGENTS 地雷 5）。用数字 state 会导致
 *    删不掉、永远留个 0 —— 而"0 克脂肪"和"没读到脂肪"是两回事（地雷 11）。
 *
 * 5. **落库只走 `recordDietEntry({ food })`。** 营养值由 `nutritionOf` 算，
 *    这条链是唯一一次乘法（"数字只有一条来路"红线）。
 *    ⚠️ **不走 `recordCustomEntry`** —— 那个内部自己算 `per100 * k`，
 *    会把食物按"临时自定义"存，既进不了「我的食物库」也丢了份量规则。
 */

import { useState } from "react";
import { emitDataChanged } from "@/lib/bus";
import { nowHM } from "@/lib/date";
import { nutritionOf } from "@/lib/nutrition/core";
import { fileToDataUrl, ImageDecodeError } from "@/lib/ai/imageInput";
import { readFoodPhoto, type FoodReading } from "@/lib/ai/foodVision";
import { verifyLabelReading, type VerifyResult } from "@/lib/nutrition/verify";
import { FOOD_CATEGORIES, categoryLabel } from "@/lib/nutrition/types";
import type { FoodCategory, FoodItem } from "@/lib/nutrition/types";
import { loadApiKeys } from "@/lib/prefs";
import { addCustomFood, CustomFoodStorageError, recordDietEntry } from "@/lib/storage";
import type { MealSlot } from "@/lib/tags";

type Stage = "idle" | "compressing" | "reading" | "done" | "error";

/** 数字输入框草稿。全部是**字符串**（地雷 5），空串表示"没读到" */
type NumDraft = {
  kcal: string;
  protein: string;
  fat: string;
  carb: string;
  sodium: string;
};

function numToText(v: number | undefined): string {
  return v === undefined ? "" : String(v);
}

/** 字符串 → 数字。空串 / 非数 → `undefined`（**不是 0** —— 「没数据」和「0」是两回事） */
function textToNum(t: string): number | undefined {
  const s = t.trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** 把读数铺成草稿：能读到的都填上 */
function draftFrom(r: FoodReading): NumDraft {
  const kcal = r.energy_kcal ?? (r.energy_kj === undefined ? undefined : r.energy_kj / 4.184);
  return {
    kcal: kcal === undefined ? "" : String(Math.round(kcal * 10) / 10),
    protein: numToText(r.protein_g),
    fat: numToText(r.fat_g),
    carb: numToText(r.carb_g),
    sodium: numToText(r.sodium_mg),
  };
}

/** 校验结论怎么说人话 */
function verdictLine(v: VerifyResult): { text: string; cls: string } {
  if (v.verdict === "ok") return { text: "✓ 各项数字能互相对上", cls: "yq-badge-primary" };
  if (v.verdict === "suspect") return { text: "⚠ 存疑，建议核对", cls: "yq-badge-accent" };
  return { text: "✕ 数字对不上，别用", cls: "yq-badge-danger" };
}

export function FoodPhotoSheet({
  date,
  slot,
  hintName,
  onClose,
  onSaved,
}: {
  date: string;
  slot: MealSlot;
  /** 从「库里没有」那一行点进来时带上的名字，帮模型找焦点 */
  hintName?: string;
  onClose: () => void;
  /** 存好之后告诉调用方（用来刷列表、提示） */
  onSaved?: (food: FoodItem) => void;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [err, setErr] = useState("");
  const [reading, setReading] = useState<FoodReading | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);

  // 用户可改的字段。名字 / 别名 / 分类 / 单位 / 五个数值全是草稿态。
  const [name, setName] = useState(hintName ?? "");
  const [aliases, setAliases] = useState("");
  const [category, setCategory] = useState<FoodCategory>("snack");
  const [unit, setUnit] = useState<"g" | "ml">("g");
  const [nums, setNums] = useState<NumDraft>({
    kcal: "",
    protein: "",
    fat: "",
    carb: "",
    sodium: "",
  });
  /** 这一次吃掉的量。字符串 state（地雷 5） */
  const [gramsText, setGramsText] = useState("100");

  const hasKey = Boolean(loadApiKeys().deepseekKey?.trim());

  /** 读到的数值全是空的 → 只能当估算处理（模型没看到成分表） */
  const anyNumber = [nums.kcal, nums.protein, nums.fat, nums.carb, nums.sodium].some(
    (t) => t.trim() !== "",
  );
  const isEstimate = stage === "done" && (!anyNumber || reading?.kind === "dish");
  const rejected = verify?.verdict === "reject";

  async function pick(file: File) {
    setErr("");
    setStage("compressing");
    try {
      const dataUrl = await fileToDataUrl(file);
      setStage("reading");
      const key = loadApiKeys().deepseekKey?.trim();
      if (!key) throw new Error("没填 DeepSeek Key。到「设置 → AI 接口 Key」里粘贴一个。");

      const r = await readFoodPhoto({ apiKey: key, imageDataUrl: dataUrl, hintName });
      const v = verifyLabelReading(r);

      setReading(r);
      setVerify(v);
      setName((prev) => prev || r.name);
      // 成分表多半是包装食品 → 先猜"零食"；没有成分表（dish）就是一道菜 → 先猜"荤菜"。
      // 两个都只是初值，用户在上面的分类里随手能改。
      setCategory(r.kind === "label" ? "snack" : "meat");
      setUnit(r.basis === "per100ml" ? "ml" : "g");
      setNums(draftFrom(r));
      setStage("done");
    } catch (e) {
      setErr(e instanceof ImageDecodeError || e instanceof Error ? e.message : String(e));
      setStage("error");
    }
  }

  function save() {
    const kcal = textToNum(nums.kcal);
    if (!name.trim()) {
      setErr("得给这东西起个名字，不然以后找不回来。");
      return;
    }
    if (kcal === undefined) {
      setErr("热量是必填的 —— 没有它这条记不进账。");
      return;
    }

    // ⚠️ 只走 recordDietEntry({ food })，营养值由 nutritionOf 算。
    //    这里不做任何 per100 * k 的乘法 —— 那是红线。
    const food: Omit<FoodItem, "id"> = {
      name: name.trim(),
      alias: aliases
        .split(/[,，、\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      category,
      unit,
      kcal,
      protein: textToNum(nums.protein) ?? 0,
      fat: textToNum(nums.fat) ?? 0,
      carb: textToNum(nums.carb) ?? 0,
      // 「没读到」保持 undefined，不补 0（地雷 11）
      ...(textToNum(nums.sodium) === undefined ? {} : { sodium: textToNum(nums.sodium) }),
      source: isEstimate
        ? "AI 估算（仅凭外观推测，不可核对）"
        : "包装营养成分表（拍照读取，已过闭合校验）",
    };

    try {
      const { added, duplicate } = addCustomFood(food);
      if (duplicate) {
        setErr(`「${duplicate.name}」已经在你的食物库里了。要不要换个名字，或者先去设置里改那条？`);
        return;
      }
      const grams = Math.max(1, textToNum(gramsText) ?? 100);
      recordDietEntry({
        date,
        time: nowHM(),
        mealSlot: slot,
        food: added,
        name: added.name,
        amount: 1,
        unitLabel: unit === "ml" ? "毫升" : "克",
        grams,
        // 包装读取记 "custom"；AI 估算记 "ai" —— 当日汇总靠这个说清"哪几条是猜的"
        source: isEstimate ? "ai" : "custom",
      });
      emitDataChanged();
      onSaved?.(added);
      onClose();
    } catch (e) {
      setErr(e instanceof CustomFoodStorageError || e instanceof Error ? e.message : String(e));
    }
  }

  const previewFood: FoodItem | null =
    textToNum(nums.kcal) === undefined
      ? null
      : ({
          id: "preview",
          name: name || "预览",
          category,
          unit,
          kcal: textToNum(nums.kcal) as number,
          protein: textToNum(nums.protein) ?? 0,
          fat: textToNum(nums.fat) ?? 0,
          carb: textToNum(nums.carb) ?? 0,
          sodium: textToNum(nums.sodium),
          source: "预览",
        } as FoodItem);
  const previewKcal =
    previewFood && textToNum(gramsText)
      ? Math.round(nutritionOf(previewFood, textToNum(gramsText) as number).kcal)
      : null;

  return (
    <div className="yq-scrim" onClick={onClose}>
      <div className="yq-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="yq-section-title">
          <span>📷 拍照记食物</span>
          <button className="yq-btn yq-btn-sm yq-btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>

        {!hasKey ? (
          <p className="yq-empty">
            这个功能要联网认图，得先填一个 DeepSeek Key。到「设置 → AI 接口 Key」里粘贴一个再回来。
          </p>
        ) : stage === "idle" ? (
          <>
            <p className="yq-hint" style={{ marginBottom: 10 }}>
              对着<strong>包装上的营养成分表</strong>拍一张，读出上面的数字。
              没有成分表也行 —— 但那样只能估算，误差会很大。
            </p>
            <label className="yq-btn yq-btn-primary" style={{ display: "inline-block" }}>
              选一张照片
              <input
                type="file"
                accept="image/*"
                // capture 让手机直接开相机；桌面端忽略它、走选文件
                capture="environment"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void pick(f);
                }}
              />
            </label>
            <p className="yq-hint" style={{ marginTop: 10 }}>
              照片会上传到 DeepSeek 读一次，读完即弃，本机不留原图。
            </p>
          </>
        ) : stage === "compressing" || stage === "reading" ? (
          <p className="yq-hint">
            {stage === "compressing" ? "正在压缩照片…" : "正在读上面的数字，可能要十几秒…"}
          </p>
        ) : stage === "error" ? (
          <>
            <p className="yq-empty">{err}</p>
            <button className="yq-btn yq-btn-primary" onClick={() => setStage("idle")}>
              重拍一张
            </button>
          </>
        ) : (
          <>
            {/* ---------- 估算警告：用户明确要求吼出来 ---------- */}
            {isEstimate && (
              <div
                className="yq-card-flat"
                style={{
                  borderLeft: "3px solid var(--yq-accent)",
                  marginBottom: 12,
                  paddingLeft: 10,
                }}
              >
                <p style={{ color: "var(--yq-accent-ink)", fontWeight: 600, marginBottom: 4 }}>
                  这是估算，不是标示值。
                </p>
                <p className="yq-hint" style={{ color: "var(--yq-accent-ink)" }}>
                  仅凭外观推测，误差可能很大（餐馆菜品的油量、份量都看不出来），
                  <strong>不要当成精确值</strong>。
                </p>
              </div>
            )}

            {/* ---------- 校验结论 ---------- */}
            {verify && !rejected && (
              <p style={{ marginBottom: 10 }}>
                <span className={`yq-badge ${verdictLine(verify).cls}`}>
                  {verdictLine(verify).text}
                </span>
                {verify.closurePct !== undefined && (
                  <span className="yq-hint" style={{ marginLeft: 6 }}>
                    三大营养素与热量差 {verify.closurePct.toFixed(0)}%
                  </span>
                )}
              </p>
            )}
            {verify && verify.reasons.length > 0 && (
              <ul className="yq-hint" style={{ margin: "0 0 10px 18px", padding: 0 }}>
                {verify.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}

            {/* ---------- reject：不给数字，只让重拍 ---------- */}
            {rejected ? (
              <>
                <p className="yq-empty" style={{ marginBottom: 10 }}>
                  这张图上的数字互相对不上，八成是没拍清。换一张（对着成分表、别反光、别歪着）再试。
                </p>
                <button className="yq-btn yq-btn-primary" onClick={() => setStage("idle")}>
                  重拍一张
                </button>
              </>
            ) : (
              <>
                {/* ---------- 逐字段可改 ---------- */}
                <label className="yq-label">名称</label>
                <input
                  className="yq-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="比如「统一双萃鸭屎香风味柠檬茶」"
                  style={{ marginBottom: 10 }}
                />

                <label className="yq-label">别名（逗号分隔，可留空）</label>
                <input
                  className="yq-input"
                  value={aliases}
                  onChange={(e) => setAliases(e.target.value)}
                  placeholder="比如「鸭屎香柠檬茶，柠檬茶」"
                  style={{ marginBottom: 10 }}
                />

                <label className="yq-label">分类</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  {FOOD_CATEGORIES.map((c) => (
                    <button
                      key={c.key}
                      className="yq-chip"
                      data-on={category === c.key}
                      onClick={() => setCategory(c.key)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>

                <label className="yq-label">单位（数值是按每 100g 还是每 100ml 记的）</label>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  {(["g", "ml"] as const).map((u) => (
                    <button key={u} className="yq-chip" data-on={unit === u} onClick={() => setUnit(u)}>
                      {u === "g" ? "每 100 克" : "每 100 毫升"}
                    </button>
                  ))}
                </div>

                <label className="yq-label">每 100{unit} 的数值</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                  {(
                    [
                      ["kcal", "热量 kcal", true],
                      ["protein", "蛋白质 g", false],
                      ["fat", "脂肪 g", false],
                      ["carb", "碳水 g", false],
                      ["sodium", "钠 mg", false],
                    ] as const
                  ).map(([key, label, required]) => (
                    <div key={key} style={{ display: "flex", flexDirection: "column", minWidth: 96 }}>
                      <span className="yq-hint">
                        {label}
                        {required ? " *" : ""}
                      </span>
                      <input
                        className="yq-input"
                        inputMode="decimal"
                        value={nums[key]}
                        placeholder={required ? "必填" : "留空=没数据"}
                        onChange={(e) => setNums((p) => ({ ...p, [key]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
                <p className="yq-hint" style={{ marginBottom: 12 }}>
                  读不到的项<strong>留空</strong>就行 —— 留空表示「没有这个数据」，和填 0 不是一回事。
                </p>

                <label className="yq-label">这次吃了多少</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <input
                    className="yq-input"
                    inputMode="decimal"
                    value={gramsText}
                    onChange={(e) => setGramsText(e.target.value)}
                    style={{ maxWidth: 110 }}
                  />
                  <span className="yq-hint">{unit === "ml" ? "毫升" : "克"}</span>
                  {previewKcal !== null && (
                    <span className="yq-hint" style={{ color: "var(--yq-primary-ink)" }}>
                      ≈ {previewKcal} kcal
                    </span>
                  )}
                </div>

                {err && <p className="yq-hint" style={{ color: "var(--yq-danger)" }}>{err}</p>}

                <div style={{ display: "flex", gap: 8 }}>
                  <button className="yq-btn yq-btn-primary" style={{ flex: 1 }} onClick={save}>
                    存进我的食物库，并记一笔
                  </button>
                  <button className="yq-btn" onClick={() => setStage("idle")}>
                    重拍
                  </button>
                </div>
                {reading && (
                  <p className="yq-hint" style={{ marginTop: 10 }}>
                    分类按{categoryLabel(category)}记。存进「我的食物库」以后，搜名字就能找到它。
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
