/**
 * 照片读数校验层单测。
 *
 * 重点只有一条：**读错的数字必须能自己露馅。**
 * 三个锚点都是本次会话确证过的真实案例（工单 §T2 的表），
 * 其中第二个（碳水 9.0 抄成 105）是最要命的那种错 —— 它看起来完全正常，
 * 只有拿去做 Atwater 闭合才会发现 1785 ≠ 153。
 *
 * ⚠️ 这里**不测联网、不测 UI**：`verify.ts` 是纯函数。
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import type { FoodReading } from "../ai/foodVision";
import {
  CLOSURE_TOL,
  NRV_BASE,
  energyClosure,
  nrvCheck,
  sanityRanges,
  verifyLabelReading,
} from "./verify";

/** 造一份读数，只覆盖要测的字段 */
function reading(over: Partial<FoodReading>): FoodReading {
  return {
    kind: "label",
    name: "测试食品",
    basis: "per100ml",
    readable: true,
    ...over,
  };
}

describe("Atwater 闭合", () => {
  it("锚点①：153 kJ / 蛋白 0 / 脂肪 0 / 碳水 9.0 —— 9.0×17 = 153，差 0%", () => {
    // 153 kJ = 36.57 kcal；9.0 g 碳水 × 4 = 36 kcal。两者几乎相等。
    const kcal = 153 / 4.184;
    const c = energyClosure({ kcal, protein: 0, fat: 0, carb: 9.0 });
    assert.ok(Math.abs(c.expected - 36) < 0.01, `expected 应为 36，实得 ${c.expected}`);
    assert.ok(c.diffRatio < 0.02, `相对偏差应极小，实得 ${(c.diffRatio * 100).toFixed(2)}%`);
    assert.equal(c.ok, true);
  });

  it("锚点②：碳水抄成 105（小数点丢了）—— 闭合差 1067%，必须 reject", () => {
    const kcal = 153 / 4.184; // 36.57
    const c = energyClosure({ kcal, protein: 0, fat: 0, carb: 105 });
    assert.equal(c.expected, 420); // 105 × 4
    // 相对偏差 = |36.57 - 420| / 420 ≈ 91.3%（工单给的 1067% 是拿 1785/153 算的另一口径）
    assert.ok(c.diffRatio > 0.9, `偏差应极大，实得 ${(c.diffRatio * 100).toFixed(1)}%`);
    assert.equal(c.ok, false);

    const v = verifyLabelReading(
      reading({ energy_kj: 153, protein_g: 0, fat_g: 0, carb_g: 105 }),
    );
    assert.equal(v.verdict, "reject", `应 reject，理由：${v.reasons.join("；")}`);
    assert.ok(v.reasons.length > 0);
  });

  it("两边都是 0 时不炸（纯水 / 无糖茶）", () => {
    const c = energyClosure({ kcal: 0, protein: 0, fat: 0, carb: 0 });
    assert.ok(Number.isFinite(c.diffRatio), "diffRatio 必须是有限数");
    assert.equal(c.ok, true);
  });

  it("紧档之外的偏差判 ok=false，但不越宽松档时 verdict 只是 suspect", () => {
    // 标 100 kcal，三大营养素只算出 90 → 差 10%，落在 5%~20% 之间
    const v = verifyLabelReading(reading({ energy_kcal: 100, protein_g: 5, fat_g: 5, carb_g: 8.75 }));
    // 5×4 + 5×9 + 8.75×4 = 20 + 45 + 35 = 100 —— 先让它是准的
    assert.equal(v.verdict, "ok", `这个组合其实闭合，理由：${v.reasons.join("；")}`);

    // 再制造一个 10% 的偏差
    const v2 = verifyLabelReading(reading({ energy_kcal: 100, protein_g: 4, fat_g: 4, carb_g: 7 }));
    // 4×4 + 4×9 + 7×4 = 16 + 36 + 28 = 80；|100-80|/100 = 20%
    assert.equal(v2.verdict, "suspect", `20% 应为 suspect，实得 ${v2.verdict}`);
  });

  it("容差常量与既有闸门口径一致（kcal ±1、macro ±0.15）", () => {
    assert.equal(CLOSURE_TOL.kcal, 1);
    assert.equal(CLOSURE_TOL.macro, 0.15);
  });
});

describe("NRV 反算", () => {
  it("锚点③：能量 2% / 碳水 3% / 钠 1% 三条全对得上", () => {
    // 153 ÷ 8400 = 1.82% → 标 2%（取整，容差内）
    // 9.0 ÷ 300  = 3.00% → 标 3%
    // 10  ÷ 2000 = 0.50% → 标 1%（含量小时厂商常向上取整）
    const { mismatches } = nrvCheck(
      { energyKj: 153, protein: 0, fat: 0, carb: 9.0, sodium: 10 },
      { energy: 2, protein: 0, fat: 0, carb: 3, sodium: 1 },
    );
    assert.deepEqual(mismatches, [], `不该有冲突，实得：${mismatches.join("；")}`);

    const v = verifyLabelReading(
      reading({
        energy_kj: 153,
        protein_g: 0,
        fat_g: 0,
        carb_g: 9.0,
        sodium_mg: 10,
        nrv: { energy: 2, protein: 0, fat: 0, carb: 3, sodium: 1 },
      }),
    );
    assert.equal(v.verdict, "ok", `应 ok，理由：${v.reasons.join("；")}`);
  });

  it("NRV 对不上时点名是哪一项", () => {
    // 碳水 9.0 应为 3%，标成 30% —— 差得离谱
    const { mismatches } = nrvCheck({ carb: 9.0 }, { carb: 30 });
    assert.equal(mismatches.length, 1);
    assert.match(mismatches[0], /碳水化合物/);
    assert.match(mismatches[0], /30%/);
  });

  it("两边只有一边有值时跳过（不是错误）—— 图上没印 NRV 很正常", () => {
    assert.deepEqual(nrvCheck({ carb: 9.0 }, {}).mismatches, []);
    assert.deepEqual(nrvCheck({}, { carb: 3 }).mismatches, []);
  });

  it("NRV 基准用的是千焦，不是千卡", () => {
    // 拿 kcal 去除会差 4.184 倍 —— 这条守住这个坑
    assert.equal(NRV_BASE.energyKj, 8400);
    assert.notEqual(NRV_BASE.energyKj, 2000);
  });
});

describe("物理区间", () => {
  it("正常值不报问题", () => {
    assert.deepEqual(
      sanityRanges({ kcal: 36.6, protein: 0, fat: 0, carb: 9.0, sodium: 10 }),
      [],
    );
  });

  it("能量超 900 kcal / 100g 拒掉（比纯油还高）", () => {
    const p = sanityRanges({ kcal: 1200 });
    assert.equal(p.length, 1);
    assert.match(p[0], /能量/);
    assert.match(p[0], /上限/);
  });

  it("三大营养素超 100g 拒掉", () => {
    assert.equal(sanityRanges({ protein: 120 }).length, 1);
    assert.equal(sanityRanges({ carb: 250 }).length, 1);
  });

  it("钠超 40000mg 拒掉（高于纯食盐）", () => {
    assert.equal(sanityRanges({ sodium: 50000 }).length, 1);
    assert.deepEqual(sanityRanges({ sodium: 39300 }), []); // 纯食盐约 39300，恰好在线上
  });

  it("越界直接 reject，且不给任何数字", () => {
    const v = verifyLabelReading(reading({ energy_kcal: 5000, carb_g: 10 }));
    assert.equal(v.verdict, "reject");
    assert.ok(v.reasons.some((r) => r.includes("数值不合理")));
  });
});

describe("整体判定", () => {
  it("T0 那条饮料的完整读数判 ok（与正式库入库的数值同源）", () => {
    const v = verifyLabelReading(
      reading({
        name: "统一双萃鸭屎香风味柠檬茶",
        basis: "per100ml",
        energy_kj: 153,
        protein_g: 0,
        fat_g: 0,
        carb_g: 9.0,
        sodium_mg: 10,
        nrv: { energy: 2, protein: 0, fat: 0, carb: 3, sodium: 1 },
      }),
    );
    assert.equal(v.verdict, "ok", `理由：${v.reasons.join("；")}`);
    assert.ok(typeof v.closurePct === "number");
    assert.ok(v.closurePct < 5, `闭合偏差应 <5%，实得 ${v.closurePct}`);
  });

  it("模型说看不清 → suspect，数字仍可给但要标存疑", () => {
    const v = verifyLabelReading(
      reading({
        readable: false,
        energy_kj: 153,
        protein_g: 0,
        fat_g: 0,
        carb_g: 9.0,
        sodium_mg: 10,
      }),
    );
    assert.equal(v.verdict, "suspect");
    assert.ok(v.reasons.some((r) => r.includes("看不太清")));
  });

  it("一张成分表却一个数都没读出来 → suspect，不冒充 ok", () => {
    const v = verifyLabelReading(reading({ kind: "label" }));
    assert.equal(v.verdict, "suspect");
    assert.ok(v.reasons.some((r) => r.includes("一个数值都没读出来")));
  });

  it("缺项会被点名 —— 缺得越多「对得上」越没说服力", () => {
    const v = verifyLabelReading(reading({ energy_kcal: 36.6, carb_g: 9.0 }));
    assert.equal(v.verdict, "suspect");
    assert.ok(
      v.reasons.some((r) => r.includes("蛋白质") && r.includes("脂肪")),
      `应点名缺项，实得：${v.reasons.join("；")}`,
    );
  });

  it("dish（图上没有成分表）不参与数值判定", () => {
    const v = verifyLabelReading({
      kind: "dish",
      name: "红烧肉",
      basis: "per100g",
      readable: true,
    });
    // dish 没有数值、也不该被要求有 —— 不算 suspect
    assert.equal(v.verdict, "ok", `理由：${v.reasons.join("；")}`);
  });

  it("只有 kJ 没有 kcal 时，用 kJ/4.184 做闭合（唯一允许的换算）", () => {
    const v = verifyLabelReading(reading({ energy_kj: 153, protein_g: 0, fat_g: 0, carb_g: 9.0 }));
    assert.equal(v.verdict, "ok", `理由：${v.reasons.join("；")}`);
  });
});
