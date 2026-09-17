/**
 * 饮食日记数据层的单元测试。
 *
 * 数据层依赖 localStorage，所以这里先挂一个内存替身。
 * 之所以能在模块顶层挂：`lib/storage/io.ts` 判的是**调用时**有没有 window
 * （不是加载时），因此只要在测试体跑起来之前挂上就够 —— 不像
 * `scripts/check-data-continuity.ts` 那样必须用动态 import 绕开提升。
 *
 * 重点覆盖的是几条**会静默出错**的约定：
 *   1. 改克数必须重算营养快照（否则记录写着 200g、营养值却是 100g 的）
 *   2. 「库里查不到钠」存进去仍是 `undefined`，不是 0
 *   3. 早期记录缺 time / mealSlot 时要能兜住
 */

import { strict as assert } from "node:assert";
import { beforeEach, describe, it } from "node:test";

class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
  /** 直接塞原始 JSON，用来模拟"更早版本写下的记录" */
  raw(k: string, v: unknown) {
    this.m.set(k, JSON.stringify(v));
  }
}

const storage = new MemoryStorage();
(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { localStorage: unknown }).localStorage = storage;

import { KEYS } from "./keys";
import {
  deleteDietEntry,
  editDietEntry,
  entriesOn,
  frequentFoods,
  loadDietEntries,
  recordCustomEntry,
  recordDietEntry,
} from "./diet";
import { nutritionOf, sumNutrition } from "../nutrition/core";
import { foodById } from "../nutrition/library";
import type { DietEntry, FoodItem } from "../nutrition/types";

// ---------- 夹具 ----------

/** 有完整数据的食物 */
const CHIPS: FoodItem = {
  id: "test-chips",
  name: "测试薯片",
  category: "snack",
  unit: "g",
  kcal: 548,
  protein: 6,
  fat: 34,
  carb: 53,
  sodium: 700,
  fiber: 3,
  source: "测试夹具",
};

/** 钠与纤维都查不到的食物 —— 用来验"没数据 ≠ 0" */
const MYSTERY: FoodItem = {
  id: "test-mystery",
  name: "测试未知菜",
  category: "veg",
  unit: "g",
  kcal: 40,
  protein: 2,
  fat: 0.3,
  carb: 7,
  source: "测试夹具",
};

const AT = 1_760_000_000_000;

function seed(entry: unknown): void {
  storage.raw(KEYS.dietLog, [entry]);
}

beforeEach(() => {
  storage.clear();
});

// ---------- 覆盖 ----------

describe("饮食日记 · 写入与快照", () => {
  it("记一条后能读回来，营养值等于 nutritionOf 的一次乘法", () => {
    const e = recordDietEntry({
      date: "2026-09-17",
      time: "21:30",
      food: CHIPS,
      name: CHIPS.name,
      amount: 1,
      unitLabel: "一包",
      grams: 70,
      source: "db",
    });

    const back = loadDietEntries();
    assert.equal(back.length, 1);
    assert.equal(back[0].id, e.id);
    assert.deepEqual(back[0].nutrition, nutritionOf(CHIPS, 70));
    // 冗余字段也要存下来：库改了、条目删了，历史记录仍读得懂
    assert.equal(back[0].name, "测试薯片");
    assert.equal(back[0].category, "snack");
    assert.equal(back[0].foodId, "test-chips");
  });

  it("克数改了，营养快照跟着重算 —— 不许出现「200g 配 100g 的营养值」", () => {
    const e = recordDietEntry({
      date: "2026-09-17",
      time: "12:00",
      food: CHIPS,
      name: CHIPS.name,
      amount: 1,
      unitLabel: "一份",
      grams: 50,
      source: "db",
    });
    const before = e.nutrition.kcal;

    const after = editDietEntry(e.id, { grams: 100, amount: 2 });

    assert.ok(after);
    assert.equal(after.grams, 100);
    assert.deepEqual(after.nutrition, nutritionOf(CHIPS, 100));
    // 翻倍：不是"保持原样"，也不是"随手加一点"
    assert.equal(Math.round(after.nutrition.kcal), Math.round(before * 2));
  });

  it("自定义食物改克数按比例缩放，且 sodium 保持 undefined", () => {
    const e = recordCustomEntry({
      date: "2026-09-17",
      time: "12:00",
      name: "楼下小炒",
      grams: 200,
      per100: { kcal: 180, protein: 9, fat: 11, carb: 12 },
    });
    assert.equal(e.source, "custom");
    assert.equal(e.nutrition.sodium, undefined);

    const after = editDietEntry(e.id, { grams: 300 });
    assert.ok(after);
    assert.equal(after.nutrition.kcal, 540);
    // 未知 × 1.5 仍然是未知，不能变成 0
    assert.equal(after.nutrition.sodium, undefined);
  });

  it("库里查不到钠的食物，记录里也是 undefined，不是 0", () => {
    recordDietEntry({
      date: "2026-09-17",
      time: "12:00",
      food: MYSTERY,
      name: MYSTERY.name,
      amount: 1,
      unitLabel: "一份",
      grams: 200,
      source: "db",
    });
    const e = loadDietEntries()[0];
    assert.equal(e.nutrition.sodium, undefined);
    assert.equal(e.nutrition.fiber, undefined);

    // 汇总时覆盖率必须说得出"这条没有钠数据"，而不是安静地按 0 加进去
    const totals = sumNutrition([e]);
    assert.equal(totals.sodiumCoverage, 0);
    assert.equal(totals.values.sodium, undefined);
  });
});

describe("饮食日记 · 早期记录兼容", () => {
  it("缺 time 与 mealSlot 时按餐次补近似值", () => {
    seed({
      id: "old-1",
      date: "2026-09-16",
      mealSlot: "午餐",
      name: "米饭",
      amount: 1,
      unitLabel: "碗",
      grams: 200,
      nutrition: { kcal: 232, protein: 5.2, fat: 0.6, carb: 51.6 },
      source: "db",
      createdAt: AT,
    });

    const e = loadDietEntries()[0];
    assert.equal(e.time, "12:00");
    assert.equal(e.mealSlot, "午餐");
  });

  it("缺 mealSlot 但有 time 时，由 time 推出餐次", () => {
    seed({
      id: "old-2",
      date: "2026-09-16",
      time: "19:40",
      name: "面条",
      amount: 1,
      unitLabel: "碗",
      grams: 300,
      nutrition: { kcal: 400, protein: 12, fat: 5, carb: 74 },
      source: "db",
      createdAt: AT,
    });

    assert.equal(loadDietEntries()[0].mealSlot, "晚餐");
  });
});

describe("饮食日记 · 读取与排序", () => {
  function add(date: string, time: string, name: string, foodId?: string) {
    return recordDietEntry({
      date,
      time,
      food: foodId ? CHIPS : undefined,
      name,
      amount: 1,
      unitLabel: "份",
      grams: 100,
      source: "db",
    });
  }

  it("列表按日期倒序，同一天内按时间升序", () => {
    add("2026-09-15", "12:00", "旧的");
    add("2026-09-17", "21:00", "今天晚");
    add("2026-09-17", "08:00", "今天早");

    const all = loadDietEntries().map((e) => e.name);
    assert.deepEqual(all, ["今天早", "今天晚", "旧的"]);
  });

  it("entriesOn 只给那一天，且按时间升序", () => {
    add("2026-09-15", "12:00", "旧的");
    add("2026-09-17", "21:00", "今天晚");
    add("2026-09-17", "08:00", "今天早");

    const today = entriesOn("2026-09-17").map((e) => e.name);
    assert.deepEqual(today, ["今天早", "今天晚"]);
  });

  it("删掉后读不到", () => {
    const e = add("2026-09-17", "08:00", "今天早");
    assert.equal(deleteDietEntry(e.id).length, 0);
    assert.equal(loadDietEntries().length, 0);
  });

  it("frequentFoods 按出现次数降序，只手输的自定义食物不计入", () => {
    recordDietEntry({ date: "2026-09-17", time: "08:00", food: CHIPS, name: "测试薯片", amount: 1, unitLabel: "包", grams: 70, source: "db" });
    recordDietEntry({ date: "2026-09-16", time: "08:00", food: CHIPS, name: "测试薯片", amount: 1, unitLabel: "包", grams: 70, source: "db" });
    recordCustomEntry({ date: "2026-09-15", time: "08:00", name: "小炒", grams: 200, per100: { kcal: 180, protein: 9, fat: 11, carb: 12 } });

    const top = frequentFoods();
    assert.equal(top.length, 1);
    assert.equal(top[0].foodId, "test-chips");
    assert.equal(top[0].count, 2);
  });
});

describe("饮食日记 · 与真实食物库接线", () => {
  it("用库里真实的薯片记账，数字与库一致", () => {
    const chips = foodById("shupian");
    assert.ok(chips, "库里应该有 id 为 shupian 的薯片");

    const e = recordDietEntry({
      date: "2026-09-17",
      time: "21:00",
      food: chips,
      name: chips.name,
      amount: 1,
      unitLabel: "一包",
      grams: 70,
      source: "db",
    });

    // 浮点乘法会有尾巴，比的是"是不是同一次乘法算出来的"，不是字面相等
    assert.ok(
      Math.abs(e.nutrition.kcal - chips.kcal * 0.7) < 1e-9,
      `实际 ${e.nutrition.kcal}，应为 ${chips.kcal * 0.7}`,
    );
    assert.equal(e.category, "snack");
  });
});

describe("饮食日记 · 归一化不改变已有字段", () => {
  it("正常情况下读出来与写进去一致（除了排序）", () => {
    const e: DietEntry = {
      id: "x1",
      date: "2026-09-17",
      time: "08:30",
      mealSlot: "早餐",
      name: "豆浆",
      amount: 1,
      unitLabel: "杯",
      grams: 300,
      nutrition: { kcal: 90, protein: 6, fat: 3, carb: 9, sodium: 30 },
      source: "db",
      createdAt: AT,
    };
    seed(e);
    assert.deepEqual(loadDietEntries()[0], e);
  });
});
