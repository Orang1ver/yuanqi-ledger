/**
 * 「这条记录当时用的是哪一档」的单测。
 *
 * 这里压的是**反推的正确性**，因为它是界面上那句「按「大」算的」的唯一依据 ——
 * 反推错了，界面会理直气壮地说一个错的档位，而用户看着那排 chips 就会以为自己当时是这么选的。
 *
 * 尤其要钉住「反推不出来时返回 null」：宁可不多画那一行，也不能编一个默认档出来。
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { portionHitOf, tierOfEntry } from "./tiers";
import type { DietEntry } from "./types";

function entry(over: Partial<DietEntry>): DietEntry {
  return {
    id: "t1",
    date: "2026-09-19",
    time: "12:00",
    mealSlot: "午餐",
    foodId: "dumpling-pork",
    name: "饺子",
    amount: 2,
    unitLabel: "个",
    grams: 60,
    nutrition: { kcal: 144, protein: 4.8, fat: 6, carb: 16.8 },
    source: "db",
    createdAt: 1,
    ...over,
  };
}

describe("从克数反推份量档位", () => {
  it("两个饺子共 60g → 反推出「大」（每个 30g）", () => {
    const t = tierOfEntry(entry({}));
    assert.notEqual(t, null);
    assert.equal(t!.label, "大");
    assert.equal(t!.total, 3);
  });

  it("两个饺子共 40g → 「中」（每个 20g）", () => {
    assert.equal(tierOfEntry(entry({ grams: 40 }))?.label, "中");
  });

  it("两个饺子共 30g → 「小」（每个 15g）", () => {
    assert.equal(tierOfEntry(entry({ grams: 30 }))?.label, "小");
  });

  it("一碗米饭 180g → 「一碗」", () => {
    const t = tierOfEntry(
      entry({ foodId: "rice-cooked", name: "米饭", amount: 1, unitLabel: "碗", grams: 180 }),
    );
    assert.equal(t?.label, "一碗");
  });

  it("⚠ 只有一档时返回 null —— 没有歧义就不该在界面上多画一行", () => {
    // 炒米粉的「份」只有一档
    const t = tierOfEntry(
      entry({ foodId: "chao-mifen", name: "炒米粉", amount: 1, unitLabel: "份", grams: 310 }),
    );
    assert.equal(t, null);
  });

  it("⚠ 克数对不上任何一档时返回 null —— 绝不猜一个默认档", () => {
    // 每个 18.5g：离「中」20g 差 1.5、离「小」15g 差 3.5，都超出容差
    assert.equal(tierOfEntry(entry({ grams: 37 })), null);
  });

  it("⚠ 用户手输的自定义食物（没有 foodId）→ null", () => {
    assert.equal(tierOfEntry(entry({ foodId: undefined })), null);
  });

  it("查不到食物 / 量词对不上规则 → null，而不是崩", () => {
    assert.equal(tierOfEntry(entry({ foodId: "根本没有这个 id" })), null);
    assert.equal(tierOfEntry(entry({ unitLabel: "勺" })), null);
  });

  it("portionHitOf 只要有规则就给 —— 质疑入口对每条记录都要能说清「按什么折算的」", () => {
    // 炒米粉只有一档，tierOfEntry 会给 null，但 portionHitOf 仍然要说得出规则
    const e = entry({ foodId: "chao-mifen", name: "炒米粉", amount: 1, unitLabel: "份", grams: 310 });
    assert.equal(tierOfEntry(e), null);
    const hit = portionHitOf(e);
    assert.notEqual(hit, null);
    assert.equal(hit!.grams, 310);
  });
});
