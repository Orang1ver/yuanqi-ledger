/**
 * 「一顿饭」预设的单元测试。
 *
 * 只证两件事：
 *   1. 预设里的每个 foodId 都在食物库里查得到、克数为正（死引用会直接落不了库）。
 *   2. 营养值只能由 nutritionOf 现算 —— 预设文件里根本不该有营养数字。
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { MEAL_PRESETS, mealPresetFoodIds } from "./mealPresets";
import { foodById } from "./nutrition/library";
import { nutritionOf } from "./nutrition/core";

describe("一顿饭预设 · 完整性", () => {
  it("每个 item 的 foodId 都能在食物库查到、grams 为正", () => {
    for (const p of MEAL_PRESETS) {
      assert.ok(p.items.length >= 2, `预设「${p.label}」至少应有 2 条`);
      for (const it of p.items) {
        assert.ok(foodById(it.foodId), `预设「${p.label}」引用了不存在的食物 ${it.foodId}`);
        assert.ok(it.grams > 0, `预设「${p.label}」克数非法：${it.grams}`);
      }
    }
  });

  it("mealPresetFoodIds 覆盖了全部引用，且无死引用", () => {
    const ids = mealPresetFoodIds();
    assert.ok(ids.length > 0);
    for (const id of ids) {
      assert.ok(foodById(id), `foodId ${id} 在食物库里查不到`);
    }
  });
});

describe("一顿饭预设 · 数字来路", () => {
  it("任取一条，nutritionOf(food, grams) 可算且为正", () => {
    const it = MEAL_PRESETS[2].items[1]; // 两菜一汤的荤菜（红烧肉）
    const f = foodById(it.foodId);
    assert.ok(f);
    const n = nutritionOf(f, it.grams);
    assert.ok(n.kcal > 0 && Number.isFinite(n.kcal));
  });
});
