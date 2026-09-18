/**
 * 「帮我挑」单测。
 *
 * 这一组测试的**真正对象不是功能，是那条红线**：
 * 模型给什么都不能影响屏幕上的数字。所以每个用例都在试图让模型"越权"——
 * 让它编一道菜单里没有的菜、让它往理由里塞热量、让它在 JSON 里多带一个 kcal 字段，
 * 然后断言这些统统进不来。
 *
 * 顺带守住 prompt 本身的纪律：喂给模型的**缺口描述里不许有数字**。
 * 一旦那里出现「钠还差 1800mg」，模型就有材料可以复述，
 * 后面所有过滤都变成在擦屁股。
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { TakeoutDish } from "../types";
import { sumNutrition } from "../nutrition/core";
import { estimateDish } from "../nutrition/menu";
import { referenceTargets } from "../nutrition/targets";
import type { DietEntry, NutritionValues } from "../nutrition/types";
import {
  buildPickMessages,
  gapHints,
  parsePicks,
  pickableDishes,
  sanitizeReason,
  pickDishesForGaps,
  type PickCandidate,
} from "./recommend";

const targets = referenceTargets();

function dish(name: string, extra: Partial<TakeoutDish> = {}): TakeoutDish {
  return {
    id: `d-${name}`,
    restaurant: "测试店",
    name,
    category: "未分类",
    flavorTags: [],
    avoidConflicts: [],
    ...extra,
  };
}

function entry(name: string, n: Partial<NutritionValues> & { kcal: number }): DietEntry {
  return {
    id: `t-${name}`,
    date: "2026-09-18",
    time: "12:00",
    mealSlot: "午餐",
    name,
    amount: 1,
    unitLabel: "份",
    grams: 100,
    nutrition: { protein: 0, fat: 0, carb: 0, ...n } as NutritionValues,
    source: "db",
    createdAt: 1,
  };
}

/** 一顿重口午饭：钠超、热量足、蔬果没有 —— 保证缺口一定存在 */
const heavy = [entry("重口的一顿", { kcal: 1900, protein: 60, fat: 80, carb: 220, sodium: 4800, fiber: 3 })];

const MENU = [dish("番茄蛋汤"), dish("红烧肉"), dish("清炒时蔬")];

/** 一个假的 DeepSeek：把 content 当成模型回答原样返回，顺带把发出去的请求记下来 */
function fakeFetch(
  content: string,
  sink?: (call: { body: unknown; headers: Record<string, string> }) => void,
): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    sink?.({
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("帮我挑 · 候选池", () => {
  it("估不出成分的菜不进池子 —— 挑出来也说不清它是什么", () => {
    const pool = pickableDishes([...MENU, dish("神秘料理ABC")]);
    assert.deepEqual(
      pool.map((c) => c.name),
      ["番茄蛋汤", "红烧肉", "清炒时蔬"],
    );
  });

  it("与忌口冲突的菜不进池子 —— 忌口优先于一切", () => {
    const menu = [dish("番茄蛋汤"), dish("奶油蛋糕", { avoidConflicts: ["乳糖"] })];
    const pool = pickableDishes(menu, ["乳糖"]);
    assert.deepEqual(
      pool.map((c) => c.name),
      ["番茄蛋汤"],
    );
  });
});

describe("帮我挑 · 喂给模型的东西里不许有数字", () => {
  it("缺口描述一个数字都不含", () => {
    const hints = gapHints({ entries: heavy, totals: sumNutrition(heavy), targets });
    assert.ok(hints.length > 0, "这顿饭明明钠超了，应该给出缺口");
    for (const h of hints) {
      assert.doesNotMatch(h, /[0-9０-９]/, `缺口描述里出现了数字：${h}`);
      assert.doesNotMatch(h, /mg|kcal|克|毫升/i, `缺口描述里出现了单位：${h}`);
    }
  });

  it("prompt 里只有「偏了哪一项」，没有「还差多少」", () => {
    const candidates = pickableDishes(MENU);
    const messages = buildPickMessages({
      candidates,
      hints: gapHints({ entries: heavy, totals: sumNutrition(heavy), targets }),
      avoid: ["乳糖"],
    });
    const all = messages.map((m) => m.content).join("\n");

    // 菜名与忌口必须真的进去了，否则测的是个空 prompt
    assert.match(all, /番茄蛋汤/);
    assert.match(all, /乳糖/);
    // 营养数字与单位不许进去
    assert.doesNotMatch(all, /4800|1900|mg/i);
    assert.ok(!all.includes(String(targets.sodium)), "目标钠值不该出现在 prompt 里");
    // 禁数字这条规矩本身要在
    assert.match(all, /一个数字都不许出现/);
  });
});

describe("帮我挑 · 模型那句理由要去数字", () => {
  it("整句都在说数字 → 整句丢掉，不留半句残话", () => {
    assert.equal(sanitizeReason("热量只有 320kcal"), "");
    assert.equal(sanitizeReason("320kcal"), "");
  });

  it("中文数字带单位也认得出来，但只丢那一句，别的措辞留着", () => {
    assert.equal(sanitizeReason("大约三百克，很清淡"), "很清淡");
    assert.equal(sanitizeReason("大概两百大卡"), "");
  });

  it("只有带数字的那半句丢掉，有用的措辞留着", () => {
    assert.equal(sanitizeReason("今天蔬菜吃得少，大约 320kcal"), "今天蔬菜吃得少");
    assert.equal(sanitizeReason("清淡。热量 500 大卡。"), "清淡");
  });

  it("本来就没有数字 → 原样保留", () => {
    assert.equal(sanitizeReason("今天蔬菜吃得少，这道清淡"), "今天蔬菜吃得少，这道清淡");
  });

  it("不是字符串（模型乱给）→ 空串，不抛错", () => {
    assert.equal(sanitizeReason(undefined), "");
    assert.equal(sanitizeReason(12), "");
  });
});

describe("帮我挑 · 白名单说了算，不是模型说了算", () => {
  const candidates: PickCandidate[] = pickableDishes(MENU);

  it("序号越界 → 丢弃（模型编了一道菜单里没有的菜）", () => {
    const out = parsePicks({ picks: [{ index: 99, reason: "就它了" }] }, candidates);
    assert.deepEqual(out, []);
  });

  it("名字对不上 → 丢弃", () => {
    const out = parsePicks({ picks: [{ name: "菜单里没有的菜", reason: "就它了" }] }, candidates);
    assert.deepEqual(out, []);
  });

  it("名字对得上 → 收下（模型不听话回了菜名时的兜底）", () => {
    const out = parsePicks({ picks: [{ name: "红烧肉", reason: "顶饱" }] }, candidates);
    assert.equal(out.length, 1);
    assert.equal(out[0].dishId, "d-红烧肉");
  });

  it("同一道菜说两遍 → 只留一次；超出上限 → 截断", () => {
    const dup = parsePicks({ picks: [{ index: 1 }, { index: 1 }, { index: 2 }] }, candidates);
    assert.deepEqual(
      dup.map((p) => p.name),
      ["番茄蛋汤", "红烧肉"],
    );
    const capped = parsePicks({ picks: [{ index: 1 }, { index: 2 }, { index: 3 }] }, candidates, 2);
    assert.equal(capped.length, 2);
  });
});

describe("帮我挑 · 红线：数字只能来自本地", () => {
  it("模型塞进来的 kcal 不算数，热量一律由 estimateDish 现算", async () => {
    const expected = estimateDish(MENU[0]);
    const sent: { body: unknown; headers: Record<string, string> }[] = [];
    // 模型回答里故意多带一个 kcal 字段，理由里也硬写数字
    const picks = await pickDishesForGaps({
      apiKey: "sk-test",
      entries: heavy,
      totals: sumNutrition(heavy),
      targets,
      dishes: MENU,
      fetchImpl: fakeFetch(
        JSON.stringify({ picks: [{ index: 1, reason: "清淡，只有 320kcal", kcal: 99999 }] }),
        (call) => sent.push(call),
      ),
    });

    assert.equal(picks.length, 1);
    const p = picks[0];
    // 数字来自本地：与直接调用 estimateDish 的结果逐个字段相等
    assert.deepEqual(p.estimate, expected);
    // 模型那句里的数字被摘掉
    assert.equal(p.reason, "清淡");
    // 结果对象的字段是**穷举**的 —— 模型多带的那个 kcal 压根没有地方落
    assert.deepEqual(Object.keys(p).sort(), ["dishId", "estimate", "name", "reason", "restaurant"]);
    // 请求确实发出去了，且带着 Key 和模型名
    assert.equal(sent.length, 1);
    assert.equal(sent[0].headers.Authorization, "Bearer sk-test");
    assert.match(JSON.stringify(sent[0].body), /deepseek-chat/);
  });

  it("候选池为空时连请求都不发 —— 没得挑就别花钱", async () => {
    let called = 0;
    const picks = await pickDishesForGaps({
      apiKey: "sk-test",
      entries: heavy,
      totals: sumNutrition(heavy),
      targets,
      dishes: [dish("神秘料理ABC")],
      fetchImpl: (async () => {
        called += 1;
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
    });
    assert.deepEqual(picks, []);
    assert.equal(called, 0);
  });
});
