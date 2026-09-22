/**
 * 饮食质量分与建议引擎的单元测试。
 *
 * 这两个模块是"给用户下结论"的地方，所以测试重点不是数值精度，而是**结论的边界**：
 *   - 数据不足的维度不许进分母（否则白送满分）
 *   - 今天还没吃完时不许说"营养不够"（否则是拿记录进度当饮食质量）
 *   - 没有真实偏差时不许硬凑建议
 *   - 归因必须指向真实的那一样食物
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { findIssues, gapSummary, describeGaps, topAdvice } from "./advice";
import { makeDietEntry, sumNutrition } from "./core";
import { describeScore, scoreDay, summarizeWeek } from "./score";
import { referenceTargets } from "./targets";
import type { DietEntry, FoodItem } from "./types";
import type { MealSlot } from "../tags";

// ---------- 夹具 ----------

const f = (
  id: string,
  name: string,
  category: FoodItem["category"],
  kcal: number,
  protein: number,
  fat: number,
  carb: number,
  sodium: number | undefined,
  fiber: number | undefined,
  /** 添加糖（每 100g）。**不传就是「没标」**，不是 0 —— 与钠/纤维同款的可选 */
  sugar: number | undefined = undefined,
): FoodItem => ({
  id,
  name,
  category,
  unit: "g",
  kcal,
  protein,
  fat,
  carb,
  sodium,
  fiber,
  // 「没标」就**不写这个键**（同 `recipeToFoodItem` / `FoodPhotoSheet` 的做法）——
  // 写 `sugar: undefined` 会让"这条标了糖、值就是 undefined"成为一个可能的状态
  ...(sugar === undefined ? {} : { sugar }),
  source: "测试夹具",
});

const RICE = f("t-rice", "测试米饭", "staple", 116, 2.6, 0.3, 25.9, 2, 0.3);
const GREENS = f("t-greens", "测试青菜", "veg", 25, 1.5, 0.3, 2.7, 300, 1.5);
const SALTY = f("t-salty", "测试咸菜", "veg", 30, 2, 0.3, 4, 3000, 1.5);
const CHICKEN = f("t-chicken", "测试鸡胸", "meat", 133, 19.4, 5, 2.5, 63, 0);
const APPLE = f("t-apple", "测试苹果", "fruit", 53, 0.2, 0.2, 13.5, 1, 1.2);
const CHIPS = f("t-chips", "测试薯片", "snack", 548, 6, 34, 53, 700, 3);
/** 钠与纤维都查不到 —— 用来验"数据不足"的分支 */
const MYSTERY = f("t-mystery", "测试未知菜", "veg", 40, 2, 0.3, 7, undefined, undefined);

const TARGETS = referenceTargets(2000); // kcal 2000 / 蛋白 75 / 钠 2000 / 纤维 25

let seq = 0;
function eat(food: FoodItem, grams: number, slot: MealSlot = "午餐"): DietEntry {
  seq += 1;
  return makeDietEntry({
    id: `e${seq}`,
    createdAt: 1_760_000_000_000 + seq,
    date: "2026-09-17",
    time: "12:00",
    mealSlot: slot,
    food,
    name: food.name,
    amount: grams,
    unitLabel: "克",
    grams,
    source: "db",
  });
}

function day(...items: [FoodItem, number][]): { entries: DietEntry[]; totals: ReturnType<typeof sumNutrition> } {
  const entries = items.map(([food, grams]) => eat(food, grams));
  return { entries, totals: sumNutrition(entries) };
}

// ---------- 质量分 ----------

describe("饮食质量分", () => {
  it("没有记录时是 0 分，且钠与纤维标为数据不足", () => {
    const totals = sumNutrition([]);
    const s = scoreDay({ entries: [], totals, targets: TARGETS });

    assert.equal(s.total, 0);
    assert.equal(s.dimensions.find((d) => d.key === "sodium")?.insufficient, true);
    assert.equal(s.dimensions.find((d) => d.key === "fiber")?.insufficient, true);
    // 数据不足的两维不进分母
    assert.equal(s.available, 100 - 20 - 15);
  });

  it("全库都查不到钠与纤维时，满分只有 65，且总分按 65 折算", () => {
    const { entries, totals } = day([MYSTERY, 200], [MYSTERY, 200]);
    const s = scoreDay({ entries, totals, targets: TARGETS });

    assert.equal(s.available, 65);
    assert.ok(s.total <= 100);
    assert.equal(s.sodiumCoverage, 0);
    // 关键：不能因为"查不到钠"就默认它合格而白送 20 分
    assert.equal(s.dimensions.find((d) => d.key === "sodium")?.got, 0);
  });

  it("钠吃到目标的 2 倍以上，钠这一维归零", () => {
    const { entries, totals } = day([CHIPS, 600]);
    const s = scoreDay({ entries, totals, targets: TARGETS });

    assert.ok((totals.values.sodium ?? 0) > TARGETS.sodium * 2);
    assert.equal(s.dimensions.find((d) => d.key === "sodium")?.got, 0);
  });

  it("蔬果供能占比够 15% 时，蔬果这一维满分", () => {
    const { entries, totals } = day([RICE, 300], [GREENS, 600], [APPLE, 200]);
    const s = scoreDay({ entries, totals, targets: TARGETS });

    assert.equal(s.dimensions.find((d) => d.key === "veg")?.got, 15);
  });

  it("describeScore 会说明哪些维度因数据不足被排除", () => {
    const { entries, totals } = day([MYSTERY, 200]);
    const text = describeScore(scoreDay({ entries, totals, targets: TARGETS }));

    assert.ok(text.includes("65"), text);
    assert.ok(text.includes("钠"), text);
    assert.ok(text.includes("数据不足"), text);
  });
});

/**
 * 「零食甜饮」这一维的**两条判定路径**。
 *
 * 它原来只有一条：按分类与名字猜（`isUltraish` + `SWEET_DRINK_HINTS`）。
 * 2026-09-22 起多了一条：**当天只要有一条记录标了糖**，就改按真糖的供能占比算。
 *
 * ⚠️ 这里钉的不是数值精度，而是三件事：
 *   1. **维度数、权重、key 一律没动** —— 它仍然是七维 100 分里的一维 15 分。
 *      为什么不新增第八维「添加糖」：那会和这一维**双重扣分**（一罐可乐被罚两次），
 *      还要把 100 分重新分配 —— 那正是用户明确说的"影响现有体系"。
 *   2. **两条路的 `note` 必须把口径写出来** —— 不然用户只会看见分数莫名跳了一下。
 *   3. **数据变准，判据就该跟着变准** —— 同一批食物、同样的热量，补上糖数据后
 *      分数从 9.8 掉到 0 是**有意**的，不是抖动。
 */
describe("饮食质量分 · 零食甜饮的两条路径（代理 / 真糖）", () => {
  /** 一份「标签上印了糖」的甜饮：每 100g 糖 10g */
  const SODA_SUGAR = f("t-soda-sugar", "测试可乐", "drink", 40, 0, 0, 10, 5, 0, 10);
  /** 同样的东西，但**标签上没印糖那一行** —— 只有这一个差别 */
  const SODA_PLAIN = f("t-soda-plain", "测试可乐", "drink", 40, 0, 0, 10, 5, 0);

  const ultraOf = (food: FoodItem) => {
    const { entries, totals } = day([RICE, 300], [food, 200]);
    return { totals, dim: scoreDay({ entries, totals, targets: TARGETS }).dimensions.find((d) => d.key === "ultra")! };
  };

  it("没有糖数据 → 退回代理，并在 note 里说清这一跑是猜的", () => {
    const { totals, dim } = ultraOf(SODA_PLAIN);
    assert.equal(totals.values.sugar, undefined, "一条都没标糖时总和必须是未知");
    assert.deepEqual(
      [dim.key, dim.max],
      ["ultra", 15],
      "维度数、权重不许因为糖这条线而变",
    );
    assert.match(dim.note!, /还没有糖数据/, dim.note);
    // 代理按「含糖饮料」罚了一部分分（不是满分，也不是 0）
    assert.ok(dim.got > 0 && dim.got < 15, `代理分应落在中间，实得 ${dim.got}`);
  });

  it("有糖数据 → 按真糖供能占比算，note 换成糖的口径", () => {
    const { totals, dim } = ultraOf(SODA_SUGAR);
    assert.equal(totals.values.sugar, 20); // 10g/100g × 200g
    assert.deepEqual([dim.key, dim.max], ["ultra", 15]);
    assert.match(dim.note!, /添加糖占今天热量的/, dim.note);
    // 这份"可乐"的糖供能 80/428 ≈ 19%，已越过 15% 那条归零线
    assert.equal(dim.got, 0, "糖供能 19% 该归零 —— 真数据这条路比代理更严，这是有意的");
  });

  it("同一条饮料，只差标签上有没有印糖，分数就不同（数据变准，判据跟着变准）", () => {
    const plain = ultraOf(SODA_PLAIN).dim;
    const withSugar = ultraOf(SODA_SUGAR).dim;
    assert.notEqual(plain.note, withSugar.note, "口径变了却没写在 note 里，用户只会看到分数莫名一跳");
    assert.notEqual(plain.got, withSugar.got);
    assert.equal(plain.max, withSugar.max);
  });

  it("糖供能在 5% 以内 → 这一维满分；糖不会因为「有数据」就一律扣分", () => {
    const { entries, totals } = day([RICE, 300], [GREENS, 200], [SODA_SUGAR, 50]);
    const dim = scoreDay({ entries, totals, targets: TARGETS }).dimensions.find((d) => d.key === "ultra")!;
    // 糖 5g → 20 kcal，占 418 kcal 的 4.8%，在"最好不超过 5%"以内
    assert.equal(totals.values.sugar, 5);
    assert.equal(dim.got, 15);
    assert.match(dim.note!, /5%/, dim.note);
  });

  it("⚠ 不许新增第八维「添加糖」—— 维度数、总权重一个不动", () => {
    const { entries, totals } = day([RICE, 300], [SODA_SUGAR, 200]);
    const s = scoreDay({ entries, totals, targets: TARGETS });
    assert.equal(s.dimensions.length, 7);
    assert.equal(s.dimensions.reduce((a, d) => a + d.max, 0), 100);
    assert.equal(
      s.dimensions.find((d) => d.key === "sugar"),
      undefined,
      "糖的数据必须是**升级既有维度**，不是新开一维（否则一罐可乐被罚两次）",
    );
  });
});

// ---------- 建议 ----------

describe("饮食建议 · 只报真实偏差", () => {
  it("没有记录时不给任何建议", () => {
    assert.deepEqual(findIssues({ entries: [], totals: sumNutrition([]), targets: TARGETS }), []);
  });

  it("钠超标时给出钠的建议，并点名主要来源", () => {
    // 422kcal（远不到目标）、但钠 3006mg；咸菜贡献了其中八成
    const { entries, totals } = day([RICE, 300], [SALTY, 80], [GREENS, 200]);
    const issues = findIssues({ entries, totals, targets: TARGETS });

    assert.equal(issues.length, 1, `只该有钠这一条，实际：${issues.map((i) => i.key).join(",")}`);
    const [first] = issues;
    assert.equal(first.key, "sodium");
    assert.ok(first.fact.includes("3006"), first.fact);
    assert.ok(first.fact.includes("150%"), first.fact);
    assert.ok(first.fact.includes("测试咸菜"), first.fact);
    assert.ok(first.swap?.includes("测试咸菜"), first.swap);
    assert.equal(topAdvice(issues)?.key, "sodium");
  });

  it("今天热量还没到目标的 60% 时，不说「纤维/蛋白/蔬果不足」", () => {
    // 398kcal 的一顿：纤维与蛋白按目标算都远远不够，但用户还没吃晚饭
    const { entries, totals } = day([RICE, 300], [GREENS, 200]);
    assert.ok(totals.values.kcal < TARGETS.kcal * 0.6);

    const issues = findIssues({ entries, totals, targets: TARGETS });
    for (const key of ["fiber", "protein", "veg"]) {
      assert.ok(!issues.some((i) => i.key === key), `不该报 ${key}，实际：${issues.map((i) => i.key).join(",")}`);
    }
  });

  it("吃够热量后再判不足：纤维与供能比会报，钠没超就不报钠", () => {
    const { entries, totals } = day([RICE, 600], [CHICKEN, 200], [GREENS, 400], [APPLE, 300]);
    assert.ok(totals.values.kcal >= TARGETS.kcal * 0.6);
    assert.ok((totals.values.sodium ?? 0) < TARGETS.sodium);

    const issues = findIssues({ entries, totals, targets: TARGETS });
    assert.ok(!issues.some((i) => i.key === "sodium"), "钠没超就不该出现钠的建议");
    assert.ok(issues.some((i) => i.key === "fiber"), "纤维确实不够，应该报");
  });

  it("零食占一半热量时，优先说零食而不是纤维", () => {
    const { entries, totals } = day([RICE, 300], [CHIPS, 135]);
    const issues = findIssues({ entries, totals, targets: TARGETS });

    assert.equal(topAdvice(issues)?.key, "ultra");
    assert.ok(issues.some((i) => i.key === "ultra"));
  });

  it("纤维数据缺失时不报「纤维不足」—— 那是没数据，不是没吃", () => {
    // 用 MYSTERY 把热量撑够（纤维字段为 undefined）
    const { entries, totals } = day([MYSTERY, 1000], [MYSTERY, 2000], [MYSTERY, 2000]);
    assert.equal(totals.values.fiber, undefined);
    assert.ok(totals.values.kcal >= TARGETS.kcal * 0.6);

    const issues = findIssues({ entries, totals, targets: TARGETS });
    assert.ok(!issues.some((i) => i.key === "fiber"));
  });
});

describe("饮食建议 · 缺口描述", () => {
  it("钠作为上限项，超了余量是负的", () => {
    const { totals } = day([RICE, 300], [SALTY, 80], [GREENS, 200]);
    const sodium = describeGaps({ totals, targets: TARGETS }).find((g) => g.key === "sodium");

    assert.ok(sodium);
    assert.ok(sodium.remaining < 0, `余量应为负，实际 ${sodium.remaining}`);
    assert.equal(sodium.direction, "atMost");
  });

  it("gapSummary 跳过数据不足的项，不把「未知」说成「还有余量」", () => {
    const { totals } = day([MYSTERY, 300]);
    assert.equal(totals.values.sodium, undefined);

    const text = gapSummary({ totals, targets: TARGETS });
    assert.ok(!text.includes("钠"), `不该提钠，实际：${text}`);
    assert.ok(text.includes("热量"), text);
  });

  it("一条记录都没有时明确说无法判断，而不是编一个缺口", () => {
    const text = gapSummary({ totals: sumNutrition([]), targets: TARGETS });
    assert.ok(text.includes("无法判断"), text);
  });
});

describe("一周饮食质量 · 没记录的那天不是 0 分", () => {
  let wseq = 0;
  /** 某一天吃了一种食物，算出那天的分 */
  function dayOn(date: string, food: FoodItem, grams: number) {
    wseq += 1;
    const e = makeDietEntry({
      id: `w${wseq}`,
      createdAt: 1_760_000_000_000 + wseq,
      date,
      time: "12:00",
      mealSlot: "午餐" as MealSlot,
      food,
      name: food.name,
      amount: grams,
      unitLabel: "克",
      grams,
      source: "db",
    });
    return { date, score: scoreDay({ entries: [e], totals: sumNutrition([e]), targets: TARGETS }) };
  }

  it("一周只记了两天，平均就按两天算 —— 不按 7 天摊", () => {
    const s = summarizeWeek({
      days: [
        dayOn("2026-09-14", RICE, 500),
        { date: "2026-09-15", score: null },
        { date: "2026-09-16", score: null },
        dayOn("2026-09-17", GREENS, 400),
      ],
    });
    assert.equal(s.scoredDays, 2, "只该有 2 天参与");
    assert.equal(s.days.length, 4, "逐日仍要完整返回");
    assert.equal(s.days[1].score, null, "没记录的那天必须是 null，不能是 0");
    assert.ok(s.average !== null);
  });

  it("一天都算不出来时平均是 null，不是 0", () => {
    const s = summarizeWeek({ days: [{ date: "2026-09-14", score: null }] });
    assert.equal(s.average, null, "算不出来就要说算不出来");
    assert.equal(s.scoredDays, 0);
    assert.equal(s.delta, null);
    assert.equal(s.best, null);
  });

  it("available 为 0 的那天不参与平均", () => {
    // 一小口东西几乎撑不起任何一个维度，这种天的分数没有意义
    const one = dayOn("2026-09-14", GREENS, 5);
    const s = summarizeWeek({ days: [one] });
    if (one.score.available === 0) {
      assert.equal(s.average, null, "available 为 0 的天不能当 0 分算进平均");
      assert.equal(s.scoredDays, 0);
    } else {
      assert.equal(s.scoredDays, 1);
      assert.ok(s.average !== null);
    }
  });

  it("与上周比较用的是传进来的上周平均；没有就返回 null", () => {
    const days = [dayOn("2026-09-14", RICE, 500)];
    assert.equal(summarizeWeek({ days, previousAverage: null }).delta, null);
    assert.equal(summarizeWeek({ days }).delta, null);
    const withPrev = summarizeWeek({ days, previousAverage: 50 });
    assert.ok(withPrev.delta !== null);
    assert.equal(withPrev.delta, (withPrev.average ?? 0) - 50);
  });

  it("逐日数组要能把「哪天没记录」和「哪天记了」区分开", () => {
    const s = summarizeWeek({
      days: [
        dayOn("2026-09-14", RICE, 500),
        { date: "2026-09-15", score: null },
        dayOn("2026-09-16", RICE, 400),
      ],
    });
    assert.equal(s.days[1].score, null);
    assert.notEqual(s.days[0].score, null);
    assert.ok((s.best?.score ?? 0) >= (s.worst?.score ?? 0), "最好不该比最差还低");
    const scoredDates = s.days.filter((d) => d.score !== null).map((d) => d.date);
    assert.ok(scoredDates.includes(s.best?.date ?? ""), "最好那天必须是真有分的一天");
  });
});
