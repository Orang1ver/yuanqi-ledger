/**
 * 「今天吃什么」的单元测试。
 *
 * 重点覆盖四件事，都是"错了也看不出来"的那类：
 *   1. **确定性** —— 同输入同输出。挑选是随机的，所以"能不能复现"必须由测试钉住，
 *      否则它哪天变成"每次渲染换一道"都没人发现。
 *   2. **忌口是硬过滤** —— 枚举一批 roll，冲突的菜一次都不许出现。
 *      这条错了的后果是"该避的没避"，而界面上看不出任何异常。
 *   3. **软降权不是硬排除** —— 最近吃过的要被压下去，但候选只剩它们时必须照样推得出，
 *      否则「换一个」会变成死路。
 *   4. **估不出热量的菜照样能被选中** —— 这正是这个功能与「帮我挑」的区别。
 *      所以这里先用 `estimateDish` 断言那条 fixture 真的是 `kind: "none"`，
 *      免得哪天食物库扩充让它悄悄变得"估得出来"，这条断言就空转了。
 *
 * 用 Node 自带的 `node:test` + `node:assert`，与其它测试文件同一套（不引测试框架）。
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { pickDishForToday } from "./pickDish";
import { estimateDish } from "./menu";
import { daysBetween } from "../date";
import type { TakeoutDish } from "../types";

function dish(id: string, name: string, extra: Partial<TakeoutDish> = {}): TakeoutDish {
  return {
    id,
    restaurant: "测试店",
    name,
    category: "测试",
    flavorTags: [],
    avoidConflicts: [],
    ...extra,
  };
}

/** 固定的一组菜：两道能估出来、一道长套餐名估不出来 */
const MENU: TakeoutDish[] = [
  dish("d1", "番茄蛋汤"),
  dish("d2", "红烧肉"),
  dish("d3", "箐筵荷叶烤鸡五香烤鸡整只"),
];

const TODAY = "2026-09-19";

describe("pickDishForToday：确定性", () => {
  it("同样的输入（含 roll）必然同一道菜", () => {
    const a = pickDishForToday({ dishes: MENU, today: TODAY, roll: 0.42 });
    const b = pickDishForToday({ dishes: MENU, today: TODAY, roll: 0.42 });
    assert.equal(a.kind, "picked");
    assert.equal(b.kind, "picked");
    assert.equal(
      a.kind === "picked" ? a.pick.dish.id : "",
      b.kind === "picked" ? b.pick.dish.id : "",
    );
  });

  it("换 roll 能得到别的菜（候选 ≥2 时）", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const r = pickDishForToday({ dishes: MENU, today: TODAY, roll: i / 40 });
      if (r.kind === "picked") seen.add(r.pick.dish.id);
    }
    // 40 个不同的 roll 全撞同一道菜，等于"换一个"是坏的
    assert.ok(seen.size >= 2, `40 个 roll 只挑出了 ${seen.size} 道菜`);
  });
});

describe("pickDishForToday：忌口是硬过滤", () => {
  it("枚举 200 个 roll，冲突的菜一次都不出现", () => {
    const menu = [
      dish("ok1", "番茄蛋汤"),
      dish("bad", "香菜牛肉", { avoidConflicts: ["不吃香菜"] }),
      dish("ok2", "红烧肉"),
    ];
    for (let i = 0; i < 200; i += 1) {
      const r = pickDishForToday({
        dishes: menu,
        today: TODAY,
        avoid: ["不吃香菜"],
        roll: i / 200,
      });
      assert.equal(r.kind, "picked");
      if (r.kind === "picked") {
        assert.notEqual(r.pick.dish.id, "bad", `第 ${i} 个 roll 推出了忌口的菜`);
      }
    }
  });

  it("全被忌口排除时说清是「被忌口排掉」而不是「库是空的」", () => {
    const menu = [dish("bad", "香菜牛肉", { avoidConflicts: ["不吃香菜"] })];
    const r = pickDishForToday({ dishes: menu, today: TODAY, avoid: ["不吃香菜"], roll: 0.5 });
    assert.equal(r.kind, "all-filtered");
    if (r.kind === "all-filtered") {
      assert.equal(r.total, 1);
      assert.equal(r.byAvoid, 1);
      assert.equal(r.byNarrow, 0);
    }
  });

  it("库是空的与全被排除是两种结果", () => {
    assert.equal(pickDishForToday({ dishes: [], today: TODAY, roll: 0.5 }).kind, "empty-menu");
  });
});

describe("pickDishForToday：收窄", () => {
  it("按品类收窄只看这一类", () => {
    const menu = [
      dish("a", "拌面", { category: "粉面米线" }),
      dish("b", "汉堡", { category: "汉堡炸鸡" }),
    ];
    for (let i = 0; i < 30; i += 1) {
      const r = pickDishForToday({
        dishes: menu,
        today: TODAY,
        category: "汉堡炸鸡",
        roll: i / 30,
      });
      assert.equal(r.kind, "picked");
      if (r.kind === "picked") {
        assert.equal(r.pick.dish.id, "b");
        assert.equal(r.pick.narrowed, true);
      }
    }
  });

  it("按商家收窄只看这家", () => {
    const menu = [
      dish("a", "拌面", { restaurant: "沙县小吃" }),
      dish("b", "汉堡", { restaurant: "肯德基" }),
    ];
    const r = pickDishForToday({
      dishes: menu,
      today: TODAY,
      restaurant: "肯德基",
      roll: 0.1,
    });
    assert.equal(r.kind === "picked" ? r.pick.dish.id : "", "b");
  });

  it("收窄后一道不剩时，报的是收窄造成的", () => {
    const menu = [dish("a", "拌面", { category: "粉面米线" })];
    const r = pickDishForToday({ dishes: menu, today: TODAY, category: "不存在的品类", roll: 0.5 });
    assert.equal(r.kind, "all-filtered");
    if (r.kind === "all-filtered") {
      assert.equal(r.byAvoid, 0);
      assert.equal(r.byNarrow, 1);
    }
  });
});

describe("pickDishForToday：最近吃过的降权是软的", () => {
  it("刚吃过 2 天的输给从没吃过的（枚举一批 roll）", () => {
    const menu = [dish("recent", "红烧肉"), dish("fresh", "番茄蛋汤")];
    const lastEaten = new Map([["recent", "2026-09-17"]]); // 2 天前
    let freshWins = 0;
    for (let i = 0; i < 100; i += 1) {
      const r = pickDishForToday({ dishes: menu, today: TODAY, lastEaten, roll: i / 100 });
      if (r.kind === "picked" && r.pick.dish.id === "fresh") freshWins += 1;
    }
    // 从没吃过那道的分数区间是 0.5~1.5，刚吃过的是 0.075~0.225 —— 不可能被翻过来
    assert.equal(freshWins, 100, `只有 ${freshWins}/100 次推了没吃过的那道`);
  });

  it("20 天前吃过的不再被压 —— 它能赢（证明是软降权不是硬排除）", () => {
    const menu = [dish("old", "红烧肉"), dish("fresh", "番茄蛋汤")];
    const lastEaten = new Map([["old", "2026-08-30"]]); // 20 天前
    let oldWins = 0;
    for (let i = 0; i < 100; i += 1) {
      const r = pickDishForToday({ dishes: menu, today: TODAY, lastEaten, roll: i / 100 });
      if (r.kind === "picked" && r.pick.dish.id === "old") oldWins += 1;
    }
    assert.ok(oldWins > 0, "20 天前吃过的菜一次都没赢过 —— 降权变成了硬排除");
  });

  it("只有刚吃过的那道可挑时，照样推得出来", () => {
    const menu = [dish("only", "红烧肉")];
    const lastEaten = new Map([["only", TODAY]]);
    const r = pickDishForToday({ dishes: menu, today: TODAY, lastEaten, roll: 0.5 });
    assert.equal(r.kind === "picked" ? r.pick.dish.id : "", "only");
  });

  it("日期坏掉时退回「从没吃过」，而不是让这道菜永远排最后", () => {
    const menu = [dish("only", "红烧肉")];
    const lastEaten = new Map([["only", "不是日期"]]);
    const r = pickDishForToday({ dishes: menu, today: TODAY, lastEaten, roll: 0.5 });
    assert.equal(r.kind, "picked");
    if (r.kind === "picked") assert.equal(r.pick.lastEatenDays, null);
  });
});

describe("pickDishForToday：理由", () => {
  it("从没点过就说没点过", () => {
    const r = pickDishForToday({ dishes: [dish("a", "红烧肉")], today: TODAY, roll: 0.5 });
    assert.equal(r.kind === "picked" ? r.pick.reason : "", "你菜单里还没点过这道");
  });

  it("很久没吃说清多少天前", () => {
    const lastEaten = new Map([["a", "2026-09-01"]]); // 18 天前
    const r = pickDishForToday({
      dishes: [dish("a", "红烧肉")],
      today: TODAY,
      lastEaten,
      roll: 0.5,
    });
    assert.equal(r.kind === "picked" ? r.pick.reason : "", "你上次点它是 18 天前");
  });

  it("常点的说点过几次", () => {
    const lastEaten = new Map([["a", "2026-09-18"]]); // 1 天前（不触发"多少天前"那档）
    const eatenCount = new Map([["a", 3]]);
    const r = pickDishForToday({
      dishes: [dish("a", "红烧肉")],
      today: TODAY,
      lastEaten,
      eatenCount,
      roll: 0.5,
    });
    assert.equal(r.kind === "picked" ? r.pick.reason : "", "你点过 3 次，是常点的");
  });

  it("收窄过就在理由里说明", () => {
    const r = pickDishForToday({
      dishes: [dish("a", "拌面", { category: "粉面米线" })],
      today: TODAY,
      category: "粉面米线",
      roll: 0.5,
    });
    assert.match(r.kind === "picked" ? r.pick.reason : "", /在「粉面米线」里挑的/);
  });
});

describe("pickDishForToday：换一个不许走进死路", () => {
  it("把已出过的排完就放宽，并如实报 relaxed", () => {
    const menu = [dish("a", "红烧肉"), dish("b", "番茄蛋汤")];
    const r = pickDishForToday({
      dishes: menu,
      today: TODAY,
      exclude: ["a", "b"],
      roll: 0.5,
    });
    assert.equal(r.kind, "picked");
    if (r.kind === "picked") assert.equal(r.pick.relaxed, true);
  });

  it("还有没出过的就不放宽", () => {
    const menu = [dish("a", "红烧肉"), dish("b", "番茄蛋汤")];
    const r = pickDishForToday({ dishes: menu, today: TODAY, exclude: ["a"], roll: 0.5 });
    assert.equal(r.kind, "picked");
    if (r.kind === "picked") {
      assert.equal(r.pick.dish.id, "b");
      assert.equal(r.pick.relaxed, false);
      assert.equal(r.pick.poolSize, 1);
    }
  });
});

describe("pickDishForToday：估不出热量的菜照样能被选中", () => {
  it("长套餐名（estimateDish 判 none）可以被推出来，而且它本来就是 none", () => {
    const long = dish("long", "箐筵荷叶烤鸡五香烤鸡整只");
    // 先钉住前置：这条 fixture 必须真的是"估不出来"，否则下面那条断言等于没测
    assert.equal(
      estimateDish(long).kind,
      "none",
      "这条 fixture 现在能估出热量了 —— 请换一条真正的长套餐名，别让这条测试空转",
    );

    const menu = [dish("a", "番茄蛋汤"), long];
    let hit = 0;
    for (let i = 0; i < 100; i += 1) {
      const r = pickDishForToday({ dishes: menu, today: TODAY, roll: i / 100 });
      if (r.kind === "picked" && r.pick.dish.id === "long") hit += 1;
    }
    assert.ok(hit > 0, "估不出热量的菜一次都没被选中 —— 推荐池把它排除了");
  });
});

describe("daysBetween", () => {
  it("跨月与跨年都对", () => {
    assert.equal(daysBetween("2026-09-17", "2026-09-19"), 2);
    assert.equal(daysBetween("2026-08-31", "2026-09-01"), 1);
    assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1);
    assert.equal(daysBetween("2026-09-19", "2026-09-19"), 0);
    assert.equal(daysBetween("2026-09-19", "2026-09-17"), -2);
  });

  it("跨夏令时那天也是整天，而不是 0.958 天取整成 0", () => {
    // 这些日期本身不受时区影响（Date.parse 按 UTC 解析），
    // 但用本地时间构造的实现在有夏令时的机器上会算错 —— 这条测试就是钉住那个实现方式
    assert.equal(daysBetween("2026-03-07", "2026-03-09"), 2);
    assert.equal(daysBetween("2026-10-31", "2026-11-02"), 2);
  });

  it("坏输入返回 NaN（调用方自己处理，不许静默当 0）", () => {
    assert.ok(Number.isNaN(daysBetween("不是日期", "2026-09-19")));
  });
});
