/**
 * 自做饭菜折算的单元测试（`lib/nutrition/recipe.ts`）。
 *
 * 重点覆盖四件事，每一件都对应一种**会静默给出错数**的方式：
 *   1. **配料折算** —— 值是 `nutritionOf` 逐条加出来的，不是另写的一套乘法
 *   2. **成品重量的影响** —— 同样配料，`yieldG` 一变每 100g 的数就该跟着变
 *      （这是这个功能最容易搞错的地方：400g 和 600g 做出来，热量差一半）
 *   3. **`missing` 传播** —— 配料查不到时**不许当它不存在**，必须把 foodId 报出去
 *   4. **`yieldG ≤ 0` 返回 null** —— 绝不拿 0 去除（除出来的 Infinity 会写进账本快照）
 *
 * 另外钉住"糖"这一项在相加时的行为（§2.2 的核心）：
 *   一个配料有糖、另一个没标 → 结果 = 有糖那个；两个都没标 → `undefined`，**不是 0**。
 *
 * 用 Node 自带的 `node:test` + `node:assert`，与其余测试同款（见 `core.test.ts` 的说明）。
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { nutritionOf } from "./core";
import { foodById } from "./library";
import { RECIPE_SOURCE, recipePer100, recipeToFoodItem, recipeTotals, totalPartsGrams } from "./recipe";
import type { FoodItem } from "./types";
import type { MyRecipe } from "../storage/myRecipes";

// ---------- 夹具 ----------

/** 一份只有基本三大的食物（钠/纤维/糖全都没有数据） */
const PLAIN: FoodItem = {
  id: "t-plain",
  name: "测试大白饭",
  category: "staple",
  unit: "g",
  kcal: 116,
  protein: 2.6,
  fat: 0.3,
  carb: 25.9,
  source: "测试夹具",
};

/** 一份带钠、不带糖的 */
const SALTY: FoodItem = {
  id: "t-salty",
  name: "测试咸酱",
  category: "seasoning",
  unit: "g",
  kcal: 60,
  protein: 3,
  fat: 0.1,
  carb: 10,
  sodium: 5000,
  source: "测试夹具",
};

/** 一份「拍照读来的」——带糖 */
const JAM: FoodItem = {
  id: "t-jam",
  name: "测试草莓酱",
  category: "snack",
  unit: "g",
  kcal: 250,
  protein: 0.4,
  fat: 0.1,
  carb: 60,
  sodium: 20,
  sugar: 48,
  source: "测试夹具（模拟拍照读到的标签）",
};

const ALL = [PLAIN, SALTY, JAM];
const byId = (id: string) => ALL.find((f) => f.id === id);

function recipe(over: Partial<MyRecipe> = {}): MyRecipe {
  return {
    id: "recipe-t1",
    name: "测试西红柿炒鸡蛋",
    yieldG: 400,
    parts: [
      { foodId: "t-plain", grams: 200 },
      { foodId: "t-salty", grams: 10 },
    ],
    createdAt: 1_760_000_000_000,
    ...over,
  };
}

// ---------- 配料折算 ----------

describe("自做饭菜 · 配料折算", () => {
  it("加权求和 = 逐条 nutritionOf 之后相加（就这一条来路）", () => {
    const r = recipe();
    const { values, missing } = recipeTotals(r, byId);

    // 手算一遍同一条公式：200g 饭 + 10g 酱
    const a = nutritionOf(PLAIN, 200);
    const b = nutritionOf(SALTY, 10);
    assert.equal(Math.round(values.kcal * 10) / 10, Math.round((a.kcal + b.kcal) * 10) / 10);
    assert.equal(Math.round(values.protein * 10) / 10, Math.round((a.protein + b.protein) * 10) / 10);
    assert.equal(Math.round(values.fat * 10) / 10, Math.round((a.fat + b.fat) * 10) / 10);
    assert.equal(Math.round(values.carb * 10) / 10, Math.round((a.carb + b.carb) * 10) / 10);
    assert.equal(Math.round(values.sodium ?? 0), 500); // 只有酱有钠：5000 × 0.1
    assert.deepEqual(missing, []);
  });

  it("totalPartsGrams 是配料总重 —— 成品重量的默认值", () => {
    assert.equal(totalPartsGrams(recipe()), 210);
    // 非法克数按 0 计，不抛错（用户正在输入时那一行可能是空串）
    assert.equal(
      totalPartsGrams({ parts: [{ foodId: "x", grams: Number.NaN }, { foodId: "y", grams: 50 }] }),
      50,
    );
  });

  it("⚠ 一个配料有糖、另一个没标 → 结果 = 有糖那个（没标的就是没加糖）", () => {
    const r = recipe({ parts: [{ foodId: "t-jam", grams: 100 }, { foodId: "t-plain", grams: 200 }] });
    const { values } = recipeTotals(r, byId);
    // 48g/100g × 100g = 48；白饭没标糖，按 0 计入 —— 这正是 addNutrition 那个 opt 的行为
    assert.equal(values.sugar, 48);
  });

  it("⚠ 两个都没标糖 → undefined，不是 0（没有数据 ≠ 糖是 0）", () => {
    const r = recipe({ parts: [{ foodId: "t-plain", grams: 200 }, { foodId: "t-salty", grams: 10 }] });
    const { values } = recipeTotals(r, byId);
    assert.equal(values.sugar, undefined);
    // 别的项不受影响
    assert.ok(values.kcal > 0);
  });
});

// ---------- 成品重量 ----------

describe("自做饭菜 · 成品重量决定每 100g", () => {
  it("同样配料，yieldG 从 400 改成 600，每 100g 热量降到三分之二", () => {
    const a = recipePer100(recipe({ yieldG: 400 }), byId);
    const b = recipePer100(recipe({ yieldG: 600 }), byId);
    assert.ok(a && b);
    assert.equal(Math.round((a.per100.kcal / b.per100.kcal) * 100) / 100, 1.5);
  });

  it("每 100g 的钠与糖跟着一起缩放（未知的仍然未知）", () => {
    const r = recipe({ yieldG: 200, parts: [{ foodId: "t-jam", grams: 100 }] });
    const p = recipePer100(r, byId);
    assert.ok(p);
    // 100g 草莓酱做成 200g 成品 → 每 100g 就是原值的一半
    assert.equal(Math.round(p.per100.kcal), 125);
    assert.equal(Math.round(p.per100.sugar ?? 0), 24);
    assert.equal(Math.round(p.per100.sodium ?? 0), 10);
  });

  it("配料里没标糖时，每 100g 的糖仍是 undefined（不许折成 0）", () => {
    const p = recipePer100(recipe(), byId);
    assert.ok(p);
    assert.equal(p.per100.sugar, undefined);
  });

  it("⚠ yieldG ≤ 0 / 非数字 → 返回 null，绝不拿它去除", () => {
    for (const bad of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(recipePer100(recipe({ yieldG: bad }), byId), null, `yieldG=${bad} 应当折不出来`);
    }
  });
});

// ---------- missing 传播 ----------

describe("自做饭菜 · 配料查不到要报出来", () => {
  it("查不到的 foodId 按 0 计，但必须出现在 missing 里", () => {
    const r = recipe({
      parts: [
        { foodId: "t-plain", grams: 200 },
        { foodId: "t-已删除", grams: 999 },
      ],
    });
    const { values, missing } = recipeTotals(r, byId);
    assert.deepEqual(missing, ["t-已删除"]);
    // 少了那一条，数值只算剩下那条 —— 但不能因为"还算得出来"就把缺口吞掉
    assert.equal(Math.round(values.kcal), 232);
  });

  it("missing 会一路传到 recipePer100 和 recipeToFoodItem 的调用方", () => {
    const r = recipe({ parts: [{ foodId: "t-不存在", grams: 100 }] });
    const p = recipePer100(r, byId);
    assert.ok(p);
    assert.deepEqual(p.missing, ["t-不存在"]);
    // 全是死引用时仍然"折得出"，但值为 0 且 missing 明摆着 —— 界面据此拒绝记账
    assert.equal(p.per100.kcal, 0);
  });
});

// ---------- 造记账用的 FoodItem ----------

describe("自做饭菜 · recipeToFoodItem", () => {
  it("id 用菜谱 id，source 写明是自做饭菜（不是抄来的）", () => {
    const f = recipeToFoodItem(recipe(), byId);
    assert.ok(f);
    assert.equal(f.id, "recipe-t1");
    assert.equal(f.name, "测试西红柿炒鸡蛋");
    assert.equal(f.unit, "g");
    assert.equal(f.source, RECIPE_SOURCE);
    assert.ok(/自做饭菜/.test(f.source));
  });

  it("每 100g 的数值与 recipePer100 一致（同一个数，不是两处各算一遍）", () => {
    const r = recipe();
    const f = recipeToFoodItem(r, byId);
    const p = recipePer100(r, byId);
    assert.ok(f && p);
    assert.equal(f.kcal, p.per100.kcal);
    assert.equal(f.protein, p.per100.protein);
    assert.equal(f.carb, p.per100.carb);
  });

  it("⚠ 没有糖数据时不写这个键（写 0 会被下游当成「标了 0」）", () => {
    const f = recipeToFoodItem(recipe(), byId);
    assert.ok(f);
    assert.equal(f.sugar, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(f, "sugar"), false);
  });

  it("有糖数据时带上，且按成品重量折算过", () => {
    const f = recipeToFoodItem(recipe({ yieldG: 400, parts: [{ foodId: "t-jam", grams: 100 }] }), byId);
    assert.ok(f);
    assert.equal(f.sugar, 12); // 48 × (100/400)
  });

  it("⚠ 成品重量非法 → null（调用方据此拒绝记账，而不是自己凑个数）", () => {
    assert.equal(recipeToFoodItem(recipe({ yieldG: 0 }), byId), null);
  });

  it("类按贡献热量最大的那样配料定（自己做的青菜不会被记成荤菜）", () => {
    // 库里真实的青菜 + 一勺糖：青菜贡献的热量占绝对多数
    const greens = foodById("qingcai") ?? foodById("xilanhua");
    const sugar = foodById("baitang");
    assert.ok(greens && sugar, "库里应当有青菜与白砂糖");
    const r: MyRecipe = {
      id: "recipe-t2",
      name: "测试清炒青菜",
      yieldG: 250,
      parts: [
        { foodId: greens.id, grams: 240 },
        { foodId: sugar.id, grams: 8 },
      ],
      createdAt: 0,
    };
    const lookup = (id: string) => (id === greens.id ? greens : id === sugar.id ? sugar : undefined);
    const f = recipeToFoodItem(r, lookup);
    assert.ok(f);
    assert.equal(f.category, "veg");
  });
});

// ---------- 落在真实数据上的一处核对 ----------

describe("自做饭菜 · 与内置库真实数据对得上", () => {
  it("一勺糖的克数来自份量表（8g），而它的糖值目前是空的 —— 这是已知缺口", () => {
    /*
     * ⚠️ 这条**不是在断言一个 bug 是好的**，而是把这个已知状态钉住，免得它悄悄变成另一件事：
     *
     * 「做菜加的糖」本该是添加糖的一个来源，但内置库里 **250 多条一条都没补糖**
     * （用户明确要求"不影响现有体系"，见交接文档 §0.2 决策 2 / §5），
     * 而白砂糖（`baitang`）也不例外。于是按 §2.2 的语义（没标 = 没加糖），
     * 一勺白砂糖**贡献的糖是 0**，尽管它的碳水是 99.9。
     *
     * 想让它算得出来只有两条路，都不该由实现擅自选：
     *   ① 给内置库补糖 —— 决策 2 明确不做；
     *   ② 用「碳水」推糖 —— §5 明确不做（纯糖可以推，但同一条判据套到米饭上就是假精确）。
     * 所以这里把现状钉住，报告里也把这条写成了待用户拍板的缺口。
     */
    const sugar = foodById("baitang");
    assert.ok(sugar);
    assert.equal(sugar.sugar, undefined, "内置库不该被回填糖值");
    const r: MyRecipe = {
      id: "recipe-t3",
      name: "测试一勺糖",
      yieldG: 8,
      parts: [{ foodId: "baitang", grams: 8 }],
      createdAt: 0,
    };
    const { values } = recipeTotals(r, (id) => (id === "baitang" ? sugar : undefined));
    assert.equal(values.sugar, undefined, "白砂糖没标糖 → 按当前语义就是不产生糖数据");
    assert.equal(Math.round(values.carb * 10) / 10, 8); // 99.9 × 0.08 ≈ 8g 碳水，这一项是准的
  });
});
