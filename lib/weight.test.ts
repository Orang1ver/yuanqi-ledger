/**
 * 体重的周均与「距健康区间」单测。
 *
 * 盯的还是老问题：**「没有记录」不是 0**，以及**不下"好坏"结论**（只给方位）。
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { averageWeightOf, progressToHealthyRange } from "./weight";
import type { WeightEntry } from "./types";

const w = (date: string, weightKg: number): WeightEntry => ({ date, weightKg, at: 1 });

describe("体重周均 · 没记录不等于 0", () => {
  it("一条都没有 → null，不是 0", () => {
    assert.equal(averageWeightOf([]), null);
  });

  it("几次就按几次平均，不按 7 天摊", () => {
    assert.equal(averageWeightOf([w("2026-09-14", 60), w("2026-09-16", 61)]), 60.5);
  });

  it("只有一次就是那个值", () => {
    assert.equal(averageWeightOf([w("2026-09-14", 58.4)]), 58.4);
  });
});

describe("距健康体重区间 · 只说方位，不判好坏", () => {
  const range = { min: 50, max: 65 };

  it("恰好落在边界上算「在里面」", () => {
    for (const kg of [50, 65]) {
      const p = progressToHealthyRange(kg, range);
      assert.equal(p.inRange, true, `${kg} 应该算在区间里`);
      assert.equal(p.distanceKg, 0);
      assert.equal(p.direction, "keep");
    }
  });

  it("超上沿 → 往「减」的方向，距离是超出多少", () => {
    const p = progressToHealthyRange(70, range);
    assert.equal(p.inRange, false);
    assert.equal(p.distanceKg, 5);
    assert.equal(p.direction, "lose");
  });

  it("低于下沿 → 往「增」的方向", () => {
    const p = progressToHealthyRange(46.5, range);
    assert.equal(p.inRange, false);
    assert.equal(p.distanceKg, 3.5);
    assert.equal(p.direction, "gain");
  });

  it("区间原样带回来，界面不必再算一遍", () => {
    assert.deepEqual(progressToHealthyRange(60, range).range, range);
  });
});
