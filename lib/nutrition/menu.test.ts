/**
 * 菜单库估菜单测。
 *
 * 重点不在「估得准不准」（那要人工参照集），而在**它会不会编**：
 * 拆不干净时必须拒绝、糖度必须认对、数字必须来自 `nutritionOf` 那一次乘法。
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { nutritionOf } from "./core";
import { foodById } from "./library";
import { describeEstimate, estimateDish, splitDishIngredients, sumEstimates } from "./menu";

describe("菜单库 · 拆菜名里的食材", () => {
  it("一份米线能拆出两样食材，而不是只认到最长的那样", () => {
    const ings = splitDishIngredients("番茄鸡蛋米线");
    const names = ings.map((i) => i.foodName);
    assert.ok(names.includes("米线"), "没拆出米线：" + names.join("/"));
    assert.ok(names.includes("鸡蛋（煮）"), "没拆出鸡蛋：" + names.join("/"));
  });

  it("括注不参与匹配，但糖度限定语要认", () => {
    const ings = splitDishIngredients("珍珠奶茶（三分糖）");
    assert.equal(ings.length, 1);
    assert.equal(
      ings[0].foodName,
      "奶茶（半糖）",
      "「三分糖」应该落到半糖那档，落到全糖会高估三成以上，实际：" + ings[0].foodName,
    );
  });

  it("认不出来的食材不会硬凑一个上来", () => {
    assert.deepEqual(splitDishIngredients("本店秘制小食"), []);
  });
});

describe("菜单库 · 估算的诚实边界", () => {
  it("主名完全对上时才给窄区间", () => {
    const m = estimateDish({ name: "清炒时蔬" });
    assert.equal(m.kind, "guess");
    if (m.kind !== "guess") return;
    assert.equal(m.how, "exact");
    assert.equal(m.spread, 0.15);
  });

  it("命中别名不算 exact —— 名字对不上，配方多半也对不上", () => {
    const m = estimateDish({ name: "珍珠奶茶（三分糖）" });
    assert.equal(m.kind, "guess");
    if (m.kind !== "guess") return;
    assert.equal(m.how, "loose");
    assert.equal(m.spread, 0.35);
  });

  it("菜名大半没认出来时**拒绝估算** —— 给个够不着的区间比不估更糟", () => {
    // 「黄焖鸡米饭」只能命中「米饭」，算出来两百出头，而真实的是六百多。
    const m = estimateDish({ name: "黄焖鸡米饭（微辣）" });
    assert.equal(m.kind, "none", "这种情况必须拒绝，实际给出了：" + describeEstimate(m));
    assert.ok(m.basis.includes("米饭"), "拒绝时也该说清认出了什么：" + m.basis);
  });

  it("完全对不上时给 none，不编数字", () => {
    const m = estimateDish({ name: "店里自创的招牌乱炖" });
    assert.equal(m.kind, "none");
    if (m.kind === "none") assert.deepEqual(m.recognized, []);
  });

  it("拒绝估算时，把已经认出来的食材交出来 —— 界面靠它做一键关联", () => {
    // 「砂锅米线」认得出「米线」，只是菜名剩下的字对不上，于是拒估。
    // 以前界面只给一句"关联一下"，用户得自己在搜索框里重打一遍；
    // 现在要把米线直接摆成按钮，点一下就进定份量那一步。
    for (const [name, expected] of [
      ["砂锅米线", "米线"],
      ["黄焖鸡米饭（微辣）", "米饭"],
    ] as const) {
      const m = estimateDish({ name });
      assert.equal(m.kind, "none", `${name} 不该给出数字`);
      if (m.kind !== "none") continue;
      assert.ok(
        m.recognized.some((i) => i.foodName === expected),
        `${name} 应认出「${expected}」，实际：${m.recognized.map((i) => i.foodName).join("、") || "（空）"}`,
      );
      // ⚠️ 认出来的这批**不参与任何数字**：它只是线索，不是估算依据。
      // 类型上就没有 kcal —— 这里用一次赋值把这条约束钉在类型检查里
      for (const ing of m.recognized) {
        assert.equal(typeof ing.grams, "number");
        assert.ok(!("nutrition" in ing), "线索里不该带营养值");
      }
    }
  });

  it("库里没有、又没关联 → 每一档都必须能说出理由", () => {
    for (const name of ["本店秘制小食", "牛肉拉面（小碗）", "蒸饺"]) {
      const m = estimateDish({ name });
      assert.equal(m.kind, "none", `${name} 不该给出数字`);
      assert.ok(m.basis.length > 0);
    }
  });
});

describe("菜单库 · 数字只能来自一次乘法", () => {
  it("手动关联走的是 nutritionOf，与饮食记录同源", () => {
    const m = estimateDish({ name: "随便什么菜", foodId: "rice-cooked", grams: 180 });
    assert.equal(m.kind, "linked");
    if (m.kind !== "linked") return;
    const food = foodById("rice-cooked");
    assert.ok(food);
    assert.deepEqual(m.nutrition, nutritionOf(food, 180));
  });

  it("关联的 id 不存在时回落到菜名匹配，不抛错", () => {
    const m = estimateDish({ name: "清炒时蔬", foodId: "no-such-food" });
    assert.equal(m.kind, "guess");
  });

  it("没给克数就用分类兜底克数", () => {
    const m = estimateDish({ name: "米饭", foodId: "rice-cooked" });
    assert.equal(m.kind, "linked");
    if (m.kind !== "linked") return;
    assert.ok(m.grams > 0);
    assert.equal(m.nutrition.kcal, nutritionOf(foodById("rice-cooked")!, m.grams).kcal);
  });

  it("区间必须是整数，且中点落在区间里", () => {
    for (const name of ["清炒时蔬", "甜玉米棒", "番茄鸡蛋米线"]) {
      const m = estimateDish({ name });
      assert.equal(m.kind, "guess", name + " 应该估得出来");
      if (m.kind !== "guess") continue;
      assert.ok(Number.isInteger(m.loKcal), `${name} 下沿不是整数`);
      assert.ok(Number.isInteger(m.hiKcal), `${name} 上沿不是整数`);
      assert.ok(m.loKcal < m.kcal && m.kcal < m.hiKcal, `${name} 区间没包住中点`);
    }
  });
});

describe("菜单库 · 汇总", () => {
  it("估不出来的菜单独计数，绝不当成 0 混进总数", () => {
    const list = [estimateDish({ name: "清炒时蔬" }), estimateDish({ name: "本店秘制小食" })];
    const s = sumEstimates(list);
    assert.equal(s.known, 1);
    assert.equal(s.unknown, 1);
    assert.ok(s.loKcal > 0 && s.hiKcal > s.loKcal);
  });

  it("一条都估不出来时总量是 0，但 unknown 会说出来", () => {
    const s = sumEstimates([estimateDish({ name: "本店秘制小食" })]);
    assert.equal(s.known, 0);
    assert.equal(s.unknown, 1);
    assert.equal(s.loKcal, 0);
  });
});

describe("菜单库 · 区间文案", () => {
  it("估算给区间 + 百分比，不给单一数字", () => {
    const m = estimateDish({ name: "清炒时蔬" });
    const text = describeEstimate(m);
    assert.ok(text.includes("~"), "文案里应该有区间： " + text);
    assert.ok(text.includes("±"), "文案里应该标出可信度： " + text);
  });

  it("关联过的标成已关联，与估算区分开", () => {
    const m = estimateDish({ name: "米饭", foodId: "rice-cooked", grams: 180 });
    assert.ok(describeEstimate(m).includes("已关联"));
  });
});
