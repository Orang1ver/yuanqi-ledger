/**
 * 首页推荐单测。
 *
 * 重点全在**它什么时候不吭声**：没记录不推、达标了不推、算不出成分的菜不进池子。
 * 一个"总在推荐"的功能，推的东西很快就会被无视 —— 那才是真的没用。
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { sumNutrition } from "./core";
import { suggestForGaps } from "./recommend";
import { referenceTargets } from "./targets";
import type { DietEntry, NutritionValues } from "./types";

const targets = referenceTargets();

function entry(name: string, n: Partial<NutritionValues> & { kcal: number }, category = "staple"): DietEntry {
  return {
    id: `t-${name}`,
    date: "2026-09-18",
    time: "12:00",
    mealSlot: "午餐",
    name,
    category: category as DietEntry["category"],
    amount: 1,
    unitLabel: "份",
    grams: 100,
    nutrition: { protein: 0, fat: 0, carb: 0, ...n } as NutritionValues,
    source: "db",
    createdAt: 1,
  };
}

describe("推荐 · 什么时候不推", () => {
  it("一条记录都没有时不推 —— 算不出缺口", () => {
    const out = suggestForGaps({ totals: sumNutrition([]), targets });
    assert.deepEqual(out, []);
  });

  it("各项都达标时不推 —— 把达标的今天说成「还缺」是另一种焦虑", () => {
    // 热量/蛋白/纤维/钠全部踩在目标上
    const e: DietEntry[] = [
      entry("凑数", {
        kcal: targets.kcal,
        protein: targets.protein,
        fat: 60,
        carb: 250,
        sodium: targets.sodium * 0.5,
        fiber: targets.fiber,
      }),
    ];
    const out = suggestForGaps({ totals: sumNutrition(e), targets });
    assert.deepEqual(out, [], "不该硬凑建议，实际给的是：" + out.map((s) => s.label).join("/"));
  });
});

describe("推荐 · 推的东西要对得上缺口", () => {
  it("钠超标时，推出来的第一条理由要说钠，而不是随便夸一句", () => {
    const e = [entry("重口的一顿", { kcal: 1600, protein: 60, fat: 70, carb: 180, sodium: 4200, fiber: 4 })];
    const out = suggestForGaps({ totals: sumNutrition(e), targets, limit: 3 });
    assert.ok(out.length > 0, "钠超了两倍应该有话说");
    assert.equal(out[0].gapKey, "sodium", "应对着钠来说，实际：" + out[0].gapKey);
    assert.ok(out[0].reason.includes("钠"), "理由里要出现「钠」：" + out[0].reason);
  });

  it("纤维差得多时，推出来的要真的带纤维，并且说清能补多少", () => {
    const e = [
      entry("白米饭加鸡胸", { kcal: 1500, protein: 90, fat: 50, carb: 170, sodium: 1200, fiber: 1 }),
    ];
    const out = suggestForGaps({ totals: sumNutrition(e), targets, limit: 5 });
    const fiberLead = out.find((s) => s.gapKey === "fiber");
    assert.ok(fiberLead, "纤维差这么多却没有一条对着纤维说：" + out.map((s) => `${s.label}→${s.gapKey}`).join("/"));
    assert.ok(/补上约 [\d.]+g/.test(fiberLead.reason), "理由里要有具体数字：" + fiberLead.reason);
  });

  it("每一条都要能说出对上的是哪一项", () => {
    const e = [entry("炸物拼盘", { kcal: 2100, protein: 40, fat: 120, carb: 200, sodium: 3800, fiber: 2 }, "snack")];
    const out = suggestForGaps({ totals: sumNutrition(e), targets, limit: 3 });
    for (const s of out) {
      assert.ok(s.gapKey.length > 0);
      assert.ok(s.gapLabel.length > 0);
      assert.ok(s.reason.length > 0);
      assert.ok(s.score > 0);
    }
  });
});

describe("推荐 · 忌口优先于分数", () => {
  it("菜单里命中忌口的菜一律不进推荐池", () => {
    const e = [entry("重口的一顿", { kcal: 1600, protein: 60, fat: 70, carb: 180, sodium: 4200, fiber: 4 })];
    const totals = sumNutrition(e);
    const dish = {
      id: "d1",
      restaurant: "某店",
      name: "清炒时蔬",
      category: "小炒热菜",
      flavorTags: [],
      avoidConflicts: ["不吃辣"],
    };
    // limit 开到比候选总数还大 → 只要进了池子就一定出现在结果里，
    // 这样断言的是「在不在池子里」，不受打分高低影响（打分高低另有测试管）
    //
    // 注意断言必须带上 from==="menu"：食物库里**也**有一条叫「清炒时蔬」，
    // 只看名字的话，菜单那条被正确剔除了，食物库那条照样让断言命中 —— 测了个寂寞。
    const isMenuDish = (s: { from: string; label: string }) => s.from === "menu" && s.label === "清炒时蔬";

    const withAvoid = suggestForGaps({ totals, targets, menuDishes: [dish], avoid: ["不吃辣"], limit: 500 });
    assert.ok(!withAvoid.some(isMenuDish), "命中忌口的菜单条目不该进池子");

    const withoutAvoid = suggestForGaps({ totals, targets, menuDishes: [dish], avoid: [], limit: 500 });
    assert.ok(withoutAvoid.some(isMenuDish), "不忌口时它应该进池子");
  });
});

describe("推荐 · 算不出成分的菜不进池子", () => {
  it("估不出来就不参与打分 —— 算不出它补什么，就没法说它对上缺口", () => {
    const e = [entry("重口的一顿", { kcal: 1600, protein: 60, fat: 70, carb: 180, sodium: 4200, fiber: 4 })];
    const dish = {
      id: "d2",
      restaurant: "某店",
      name: "本店秘制小食",
      category: "西式快餐",
      flavorTags: [],
      avoidConflicts: [],
    };
    const out = suggestForGaps({ totals: sumNutrition(e), targets, menuDishes: [dish], limit: 500 });
    assert.ok(!out.some((s) => s.label === "本店秘制小食"));
  });

  it("菜单来源的估算带上区间，不假装是个准数", () => {
    const e = [entry("重口的一顿", { kcal: 1600, protein: 60, fat: 70, carb: 180, sodium: 4200, fiber: 4 })];
    const dish = {
      id: "d3",
      restaurant: "某店",
      name: "清炒时蔬",
      category: "小炒热菜",
      flavorTags: [],
      avoidConflicts: [],
    };
    const out = suggestForGaps({ totals: sumNutrition(e), targets, menuDishes: [dish], limit: 500 });
    const hit = out.find((s) => s.from === "menu");
    assert.ok(hit, "菜单里的清炒时蔬应该进池子");
    assert.ok(hit.loKcal < hit.hiKcal, "菜单来源必须带区间");
  });
});
