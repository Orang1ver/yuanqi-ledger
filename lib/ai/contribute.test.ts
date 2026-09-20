/**
 * 「申请进正式库」文本层的单测。
 *
 * 重点只有一条：**申请内容不能夹带任何个人数据。**
 * 这份文本会进公开仓库，一旦漏了饮食记录 / Key / 照片，
 * 就是一次不可撤回的隐私事故 —— 所以这里逐词检查不该出现的东西。
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  URL_LIMITS,
  buildFoodRequest,
  githubIssueUrl,
  limitFor,
  mailtoUrl,
  urlTooLong,
} from "./contribute";
import type { FoodItem } from "../nutrition/types";

const FOOD: FoodItem = {
  id: "user-1",
  name: "统一双萃鸭屎香风味柠檬茶",
  alias: ["鸭屎香柠檬茶", "柠檬茶"],
  category: "drink",
  unit: "ml",
  kcal: 36.6,
  protein: 0,
  fat: 0,
  carb: 9.0,
  sodium: 10,
  source: "包装营养成分表（拍照读取，已过闭合校验）",
};

describe("申请文本", () => {
  it("模板字段齐全（少一个开发者就要来回问一轮）", () => {
    const req = buildFoodRequest(FOOD, {
      appVersion: "1.3.3",
      verdict: "算术闭合通过（0.4%）· NRV 核对通过",
      energyKj: 153,
      portion: "一瓶 500ml",
      note: "换包装了",
    });
    assert.match(req, /【食物入库申请】/);
    assert.match(req, /食物名：统一双萃鸭屎香风味柠檬茶/);
    assert.match(req, /别名：鸭屎香柠檬茶、柠檬茶/);
    assert.match(req, /分类：drink/);
    assert.match(req, /单位：ml/);
    assert.match(req, /热量 36\.6 kcal（原始标示 153 kJ）/);
    assert.match(req, /蛋白 0 g/);
    assert.match(req, /碳水 9 g/);
    assert.match(req, /钠 10 mg/);
    assert.match(req, /数值来源：包装营养成分表拍照读取/);
    assert.match(req, /算术闭合通过/);
    assert.match(req, /常见份量：一瓶 500ml/);
    assert.match(req, /换包装了/);
    assert.match(req, /app 版本：1\.3\.3/);
  });

  it("⚠️ 不含任何个人数据（这份文本会进公开仓库）", () => {
    const req = buildFoodRequest(FOOD, { appVersion: "1.3.3" });
    for (const leak of [
      "身高",
      "体重",
      "BMI",
      "早餐",
      "午餐",
      "晚餐",
      "今天吃了",
      "sk-",
      "Key",
      "data:image",
      "年龄",
    ]) {
      assert.doesNotMatch(req, new RegExp(leak), `不该出现「${leak}」`);
    }
  });

  it("钠没数据时写「无数据」，不写成 0（地雷 11）", () => {
    const req = buildFoodRequest({ ...FOOD, sodium: undefined }, { appVersion: "1.3.3" });
    assert.match(req, /钠（无数据）/);
    assert.doesNotMatch(req, /钠 0 mg/);
  });

  it("AI 估算的来源如实写出来，不含糊", () => {
    const req = buildFoodRequest(
      { ...FOOD, source: "AI 估算（仅凭外观推测，不可核对）" },
      { appVersion: "1.3.3" },
    );
    assert.match(req, /数值来源：AI 估算（仅凭外观推测，不可核对）/);
  });

  it("没填的可选项留空，而不是省略（留空本身是信息）", () => {
    const req = buildFoodRequest(FOOD, { appVersion: "1.3.3" });
    assert.match(req, /常见份量：（未填）/);
    assert.match(req, /备注：（无）/);
    assert.match(req, /校验结果：（未做校验）/);
  });
});

describe("URL 生成", () => {
  it("GitHub Issue 链接预填标题与正文", () => {
    const req = buildFoodRequest(FOOD, { appVersion: "1.3.3" });
    const url = githubIssueUrl(req);
    assert.ok(url.startsWith("https://github.com/Orang1ver/yuanqi-ledger/issues/new?"));
    assert.match(url, /title=/);
    assert.match(url, /body=/);
    // 必须编码，否则换行会把 URL 截断
    assert.doesNotMatch(url, /\n/);
    assert.match(url, /%0A/);
  });

  it("邮件链接带上收件人与主题，且它只是草稿（不会自动发）", () => {
    const req = buildFoodRequest(FOOD, { appVersion: "1.3.3" });
    const url = mailtoUrl(req, "1843842330@qq.com");
    assert.ok(url.startsWith("mailto:1843842330@qq.com?"));
    assert.match(url, /subject=/);
    assert.match(url, /body=/);
    assert.doesNotMatch(url, /\n/);
  });

  it("超限判定取「渠道上限」与「浏览器上限」的较小者", () => {
    assert.equal(urlTooLong("a".repeat(100), 2000), false);
    assert.equal(urlTooLong("a".repeat(2001), 2000), true);
    // ⚠️ GitHub 自己的容忍度比浏览器高，但 URL 终究要过浏览器这关 ——
    // 所以实际判定必须取小的那个，否则会放过一个必然被截断的链接。
    assert.ok(URL_LIMITS.github > URL_LIMITS.browser, "前提：GitHub 本身更宽松");
    assert.equal(limitFor("github"), URL_LIMITS.browser, "实际该用浏览器的上限");
    assert.equal(limitFor("mailto"), URL_LIMITS.mailto, "mailto 更紧，就该用它自己的");
  });

  it("正常长度的一条申请不会超限", () => {
    const req = buildFoodRequest(FOOD, { appVersion: "1.3.3", portion: "一瓶 500ml" });
    assert.equal(urlTooLong(githubIssueUrl(req), limitFor("github")), false);
    assert.equal(urlTooLong(mailtoUrl(req, "1843842330@qq.com"), limitFor("mailto")), false);
  });
});
