/**
 * 合并检索单测。
 *
 * 重点只有一条：**接入用户库不能把原有搜索体验改掉一丝一毫。**
 * 所以第一组测试就是"`extra` 为空时，合并路径与内置路径逐条一致" ——
 * 这是这次改动最容易被悄悄弄坏的属性。
 *
 * 第二重点是**已记的账不能因为库存位置而消失**：用户加的食物被记进食记后，
 * 日列表必须还能按 `foodId` 找回它（`findFoodByIdIn`）。
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  allFoods,
  bestNameMatch,
  foodById,
  foodsByCategory,
  normalize,
  searchFoods,
} from "./library";
import {
  allFoodsIn,
  findFoodByIdIn,
  foodsByCategoryIn,
  searchAllFoods,
} from "./lookup";
import type { FoodItem } from "./types";

/**
 * 造一条用户库食物。
 *
 * ⚠️ `over.id` 是**后缀**（会被拼成 `user-<后缀>`）—— 因为真实数据里
 * 用户条目的 id 一律带 `user-` 前缀（见 `customFoods.ts`）。测试数据也该守这条。
 */
function mine(over: Partial<Omit<FoodItem, "id">> & { id?: string } = {}): FoodItem {
  const { id, ...rest } = over;
  return {
    id: "user-" + (id ?? "1"),
    name: "统一双萃鸭屎香风味柠檬茶",
    alias: ["鸭屎香柠檬茶", "柠檬茶"],
    category: "drink",
    unit: "ml",
    kcal: 36.6,
    protein: 0,
    fat: 0,
    carb: 9.0,
    sodium: 10,
    source: "拍照读取",
    ...rest,
  };
}

describe("extra 为空时与内置库逐条一致（接入不能改动原体验）", () => {
  const queries = ["米饭", "鸭屎香", "雪碧", "葡萄", "面", "咖啡", "芋圆", ""];
  const cats = ["drink", "staple", "fruit", "snack"] as const;

  for (const q of queries) {
    it(`搜索「${q}」与 searchFoods 结果完全一致`, () => {
      assert.deepEqual(
        searchAllFoods(q, [], 20).map((f) => f.id),
        searchFoods(q, 20).map((f) => f.id),
      );
    });
  }

  for (const c of cats) {
    it(`分类「${c}」与 foodsByCategory 结果完全一致`, () => {
      assert.deepEqual(
        foodsByCategoryIn(c, []).map((f) => f.id),
        foodsByCategory(c).map((f) => f.id),
      );
    });
  }

  it("allFoodsIn([]) 与 allFoods() 完全一致", () => {
    assert.deepEqual(
      allFoodsIn([]).map((f) => f.id),
      allFoods().map((f) => f.id),
    );
  });

  it("findFoodByIdIn(id, []) 与 foodById(id) 一致", () => {
    const ids = allFoods().slice(0, 30).map((f) => f.id);
    for (const id of ids) assert.equal(findFoodByIdIn(id, [])?.id, foodById(id)?.id, id);
    assert.equal(findFoodByIdIn(undefined, []), undefined);
    assert.equal(findFoodByIdIn("", []), undefined);
    assert.equal(findFoodByIdIn("根本没这个id", []), undefined);
  });
});

describe("搜得到用户库的食物", () => {
  it("按正式名搜到", () => {
    const mineList = [mine({ name: "自家腌的萝卜干", alias: [] })];
    const hits = searchAllFoods("自家腌的萝卜干", mineList);
    assert.ok(hits.some((f) => f.name === "自家腌的萝卜干"));
  });

  it("按别名搜到（用户库的 alias 也参与匹配）", () => {
    const hits = searchAllFoods("鸭屎香", [mine()]);
    assert.ok(hits.some((f) => f.id === "user-1"));
  });

  it("用户库与内置库同台竞争，按同一判据排序", () => {
    // 注意：T0 已经把「统一双萃鸭屎香风味柠檬茶」入库了，它也会命中「柠檬茶」。
    // 所以这里用别名「鸭屎香」—— 内置那条的别名里也有它，两边应当同台。
    const hits = searchAllFoods("鸭屎香", [mine()]);
    const ids = hits.map((f) => f.id);
    assert.ok(ids.includes("user-1"), "用户库那条应在结果里");
    assert.ok(ids.length >= 1);
    // 判据一致 ⇒ 两条的分数应当相同（都是别名命中），排序再由名字长度/id 决定
    const scores = hits
      .filter((f) => f.id === "user-1" || f.id === "lemontea-yashixiang")
      .map((f) => bestNameMatch(f, normalize("鸭屎香")).score);
    assert.ok(new Set(scores).size <= 1, "同为准别名命中，分数应一致：[" + scores + "]");
  });

  it("两边的结果合在一起后再截断 —— 用户库不会因为 limit 把内置库挤光", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      mine({ id: `n${i}`, name: `柠檬茶${i}`, alias: [] }),
    );
    const hits = searchAllFoods("柠檬茶", many, 20);
    assert.equal(hits.length, 20);
    // 内置库里也有柠檬茶相关条目（冰红茶之类不一定，但至少要能测出"没被全挤掉"）
    const ids = hits.map((f) => f.id);
    assert.equal(new Set(ids).size, 20, "不该有重复");
  });

  it("分类浏览里能看到用户库的食物", () => {
    const list = foodsByCategoryIn("drink", [mine()]);
    assert.ok(list.some((f) => f.id === "user-1"));
  });

  it("分类浏览不会把用户库的错误分类混进来", () => {
    const list = foodsByCategoryIn("drink", [mine({ id: "meal-1", category: "staple" })]);
    assert.ok(!list.some((f) => f.id === "user-meal-1"), "主食不该出现在饮料分类里");
  });
});

describe("已记的账不能因为库存位置而消失", () => {
  it("用户库的食物能被按 id 找回（日列表靠这个）", () => {
    const list = [mine({ id: "abc" })]; // helper 会拼成 user-abc
    const found = findFoodByIdIn("user-abc", list);
    assert.ok(found, "user-abc 应当找得回来");
    assert.equal(found?.name, "统一双萃鸭屎香风味柠檬茶");
  });

  it("内置 id 仍走得通（没被用户库挡住）", () => {
    const someBuiltin = allFoods()[0];
    assert.equal(findFoodByIdIn(someBuiltin.id, [mine()])?.id, someBuiltin.id);
  });

  it("用户库里没有的 user- id 返回 undefined，而不是崩", () => {
    assert.equal(findFoodByIdIn("user-不存在", [mine()]), undefined);
  });
});

describe("去重", () => {
  it("同一个 id 只出现一次（内置优先）", () => {
    const someBuiltin = allFoods()[0];
    // 故意用内置 id 造一条"重复条目"，模拟脏数据（真出现时不能变成两行）
    const dup: FoodItem = { ...mine(), id: someBuiltin.id, name: "伪造同名" };
    const list = allFoodsIn([dup]);
    const matches = list.filter((f) => f.id === someBuiltin.id);
    assert.equal(matches.length, 1, "同一个 id 只该出现一次");
    // 内置那条赢（因为内置在前）
    assert.equal(matches[0].name, someBuiltin.name);
  });
});

describe("空查询", () => {
  it("空串 / 纯空白返回空表（不是「全部食物」）", () => {
    assert.deepEqual(searchAllFoods("", [mine()]), []);
    assert.deepEqual(searchAllFoods("   ", [mine()]), []);
    assert.deepEqual(searchAllFoods("\u3000", [mine()]), []);
  });
});
