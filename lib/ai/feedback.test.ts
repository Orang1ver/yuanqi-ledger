/**
 * 「这个数不对？」的 AI 归因层单测。
 *
 * 重点只有一条：**模型的话不能直接信。**
 * 它可能判「能解释」却不给解释、可能建议一个根本不存在的档位 ——
 * 这两种都会在界面上变成一个**点了没反应**的东西，比不回答更让人困惑。
 *
 * ⚠️ 这里**不测联网**：`parseVerdict` 是纯函数，喂它各种坏输入就行。
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { buildIssueText, describeContext, parseVerdict, type FeedbackContext } from "./feedback";

const CTX: FeedbackContext = {
  foodName: "饺子",
  portion: "15 个",
  grams: 300,
  kcal: 720,
  sodium: 1860,
  ruleLabel: "中",
  ruleGrams: 20,
  source: "通用成分值（煮）",
  tier: { label: "中", total: 3, options: ["小", "中", "大"] },
};

describe("把这一笔摊平给模型看", () => {
  it("事实都在，而且**不含健康档案**（脱敏从类型上就定死）", () => {
    const s = describeContext(CTX);
    assert.match(s, /饺子/);
    assert.match(s, /15 个/);
    assert.match(s, /「中」= 20g/);
    assert.match(s, /通用成分值/);
    assert.match(s, /3 档/);
    // 这几个词一个都不该出现 —— 它们属于别的记录或档案
    for (const leak of ["身高", "体重", "BMI", "今天的其它", "打卡"]) {
      assert.doesNotMatch(s, new RegExp(leak), `不该出现「${leak}」`);
    }
  });

  it("规则没写口径时如实说，而不是留空让人以为是写了", () => {
    const s = describeContext({ ...CTX, ruleNote: undefined });
    assert.match(s, /没写口径/);
  });
});

describe("校验模型返回的东西", () => {
  it("能解释时用它的解释", () => {
    const v = parseVerdict({ verdict: "explained", explanation: "按中号算的" }, CTX, "太咸了");
    assert.equal(v.verdict, "explained");
    assert.equal(v.explanation, "按中号算的");
  });

  it("⚠ 建议的档位必须在**真实存在的档位**里 —— 否则丢掉", () => {
    // 模型编一个「超大」出来：界面上会多出一个点了没反应的按钮
    const bad = parseVerdict(
      { verdict: "explained", explanation: "大概是特大份", suggestTier: "超大" },
      CTX,
      "不对",
    );
    assert.equal(bad.verdict, "explained");
    assert.equal(bad.suggestTier, undefined, "白名单之外的档位必须被丢掉");

    const good = parseVerdict(
      { verdict: "explained", explanation: "大概是特大份", suggestTier: "大" },
      CTX,
      "不对",
    );
    // 先断言 verdict 再读 suggestTier —— 联合类型要先收窄，
    // 而 `assert.equal` 带 asserts 签名，正好顺手把类型也收窄了
    assert.equal(good.verdict, "explained");
    assert.equal(good.suggestTier, "大");
  });

  it("没有档位可建议时，任何 suggestTier 都丢掉", () => {
    const v = parseVerdict(
      { verdict: "explained", explanation: "x", suggestTier: "大" },
      { ...CTX, tier: undefined },
      "不对",
    );
    assert.equal(v.verdict, "explained");
    assert.equal(v.suggestTier, undefined);
  });

  it("⚠ 判了 explained 却没给解释 → 退回 unexplained，而不是白屏", () => {
    const v = parseVerdict({ verdict: "explained" }, CTX, "太咸了");
    assert.equal(v.verdict, "unexplained");
    assert.ok(v.verdict === "unexplained" && v.issueText.includes("太咸了"));
  });

  it("完全读不出来（null / 空对象）也退成 unexplained，并把用户的疑问带上", () => {
    for (const raw of [null, {}, { verdict: "???" }]) {
      const v = parseVerdict(raw, CTX, "15 个饺子不该这么多钠");
      assert.equal(v.verdict, "unexplained");
      assert.ok(v.verdict === "unexplained" && v.issueText.includes("15 个饺子"));
    }
  });

  it("模型自己给的 issueText 会被采用", () => {
    const v = parseVerdict(
      { verdict: "unexplained", explanation: "解释不了", issueText: "钠的来源没有出处" },
      CTX,
      "不对",
    );
    assert.ok(v.verdict === "unexplained" && v.issueText === "钠的来源没有出处");
  });
});

describe("拼给开发者看的文本", () => {
  it("事实、用户的疑问、模型的分析都在，并给出投递地址", () => {
    const s = buildIssueText(CTX, "15 个饺子不该这么多钠", "钠的来源没有出处");
    assert.match(s, /饺子/);
    assert.match(s, /15 个饺子不该这么多钠/);
    assert.match(s, /钠的来源没有出处/);
    assert.match(s, /github\.com\/Orang1ver\/yuanqi-ledger\/issues/);
  });
});
