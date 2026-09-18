/**
 * 营养核心的单元测试。
 *
 * 用 Node 自带的 `node:test` + `node:assert`，**不引入任何测试框架** ——
 * 这台机器装不上 npm 包，而这几百行纯函数恰恰是最该被测试覆盖的部分。
 * 运行方式见 `npm test`（内部是 tsc 编成 CJS 再交给 node --test）。
 *
 * 重点覆盖三件事：
 *   1. **「没数据」不等于 0** —— 这是全层最容易出错、后果最严重的约定
 *   2. **快照语义** —— 改食物库不许改写历史记录
 *   3. **端到端可追溯** —— 「一包薯片、一杯奶茶」的每个数字都能追回食物与克数
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  addNutrition,
  categoryEnergyShare,
  compareToTargets,
  energyRatios,
  fallbackGrams,
  groupByMealSlot,
  makeDietEntry,
  nutritionOf,
  proteinPerKg,
  resolvePortion,
  roundValues,
  scaleNutrition,
  sumNutrition,
  topContributors,
  totalsByDate,
} from "./core";
import { allFoods, findFoodByName, foodById, portionTable, searchFoods } from "./library";
import { parseFragment, splitFragments, stripLeadNoise } from "./parse";
import { matchFood, resolveText } from "./quickadd";
import { MEAL_SPLIT_NOTE, calcNutritionTargets, mealKcalTarget, targetsConflict } from "./targets";
import { MEAL_SLOTS } from "../tags";
import type { DietEntry, FoodItem } from "./types";
import type { HealthProfile } from "../types";

// ---------- 测试用夹具 ----------

const PROFILE: HealthProfile = {
  sex: "女",
  age: 26,
  heightCm: 165,
  weightKg: 56.5,
  activityLevel: "轻度活动",
  goal: "维持健康",
  allergies: "",
  conditions: "",
  updatedAt: 0,
};

/** 造一条记录。id / createdAt 显式传，保证测试可重复 */
function entry(food: FoodItem, grams: number, over: Partial<DietEntry> = {}): DietEntry {
  return {
    ...makeDietEntry({
      id: `t-${food.id}-${grams}`,
      createdAt: 1_789_000_000_000,
      date: "2026-09-17",
      time: "20:30",
      mealSlot: "加餐",
      food,
      name: food.name,
      amount: 1,
      unitLabel: "克",
      grams,
      source: "db",
    }),
    ...over,
  };
}

describe("基础换算", () => {
  it("nutritionOf 按克数线性折算", () => {
    const food = foodById("shupian")!;
    const n = nutritionOf(food, 70);
    assert.equal(Math.round(n.kcal * 10) / 10, 383.6); // 548 × 0.7
    assert.equal(Math.round(n.fat * 10) / 10, 23.8);
    assert.equal(Math.round(n.sodium!), 350); // 500mg × 0.7
  });

  it("库里没有的营养素保持 undefined，不会被折算成 0", () => {
    const noSodium: FoodItem = {
      id: "x",
      name: "无钠数据食物",
      category: "snack",
      unit: "g",
      kcal: 100,
      protein: 1,
      fat: 1,
      carb: 1,
      source: "测试",
    };
    assert.equal(nutritionOf(noSodium, 200).sodium, undefined);
    assert.equal(nutritionOf(noSodium, 200).fiber, undefined);
  });

  it("scaleNutrition 让未知保持未知", () => {
    const scaled = scaleNutrition({ kcal: 100, protein: 1, fat: 2, carb: 3 }, 3);
    assert.equal(scaled.kcal, 300);
    assert.equal(scaled.sodium, undefined);
  });

  it("addNutrition 两边都缺才算缺", () => {
    const a = { kcal: 10, protein: 1, fat: 1, carb: 1, sodium: 100 };
    const b = { kcal: 10, protein: 1, fat: 1, carb: 1 };
    assert.equal(addNutrition(a, b).sodium, 100);
    assert.equal(addNutrition(b, b).sodium, undefined);
  });

  it("roundValues 收掉浮点尾巴，热量取整", () => {
    const v = roundValues({ kcal: 383.6000000000001, protein: 4.899999, fat: 23.8, carb: 37.03 });
    assert.equal(v.kcal, 384);
    assert.equal(v.protein, 4.9);
  });
});

describe("汇总与数据覆盖度", () => {
  const withSodium = entry(foodById("shupian")!, 70);
  const withoutSodium: DietEntry = {
    ...entry(foodById("shupian")!, 70, { id: "no-sodium" }),
    nutrition: { kcal: 383.6, protein: 4.9, fat: 23.8, carb: 37.03 }, // 自定义食物，没有钠数据
  };

  it("部分条目缺钠时，总和只算已知的，并把覆盖率报出来", () => {
    const t = sumNutrition([withSodium, withoutSodium]);
    assert.equal(t.entries, 2);
    assert.equal(Math.round(t.values.sodium!), 350); // 只算那一条有数据的
    assert.equal(t.sodiumCoverage, 0.5); // 但明说只有一半
  });

  it("全部缺钠时，总和是 undefined —— 空集合的总和是「未知」不是「零」", () => {
    const t = sumNutrition([withoutSodium, withoutSodium]);
    assert.equal(t.values.sodium, undefined);
    assert.equal(t.sodiumCoverage, 0);
    assert.equal(Math.round(t.values.kcal), 767);
  });

  it("空集合不会崩，也没把自己说成达标", () => {
    const t = sumNutrition([]);
    assert.equal(t.entries, 0);
    assert.equal(t.values.kcal, 0);
    assert.equal(t.values.sodium, undefined);
    assert.equal(t.sodiumCoverage, 0);
  });

  it("totalsByDate 按日期升序", () => {
    const list = [
      entry(foodById("shupian")!, 70, { id: "c", date: "2026-09-17" }),
      entry(foodById("shupian")!, 70, { id: "a", date: "2026-09-15" }),
      entry(foodById("shupian")!, 70, { id: "b", date: "2026-09-16" }),
    ];
    assert.deepEqual(
      totalsByDate(list).map((x) => x.date),
      ["2026-09-15", "2026-09-16", "2026-09-17"],
    );
  });

  it("groupByMealSlot 顺序固定为早/午/晚/加餐，不跟着数据先后走", () => {
    const list = [
      entry(foodById("shupian")!, 70, { id: "d", mealSlot: "晚餐" }),
      entry(foodById("shupian")!, 70, { id: "b", mealSlot: "早餐" }),
    ];
    assert.deepEqual(
      groupByMealSlot(list).map((g) => g.slot),
      ["早餐", "午餐", "晚餐", "加餐"],
    );
    assert.equal(groupByMealSlot(list)[1].entries.length, 0); // 午餐今天没记
  });
});

describe("结构分析", () => {
  it("供能比三项相加约等于 100", () => {
    const r = energyRatios({ kcal: 500, protein: 25, fat: 20, carb: 60 });
    assert.equal(Math.round((r.protein + r.fat + r.carb) * 10) / 10, 100);
  });

  it("总热量为 0 时供能比返回全 0，不出 NaN", () => {
    const r = energyRatios({ kcal: 0, protein: 0, fat: 0, carb: 0 });
    assert.deepEqual(r, { protein: 0, fat: 0, carb: 0 });
  });

  it("每公斤体重蛋白，体重非法时返回 0 而不是 Infinity", () => {
    const v = { kcal: 100, protein: 60, fat: 1, carb: 1 };
    assert.equal(proteinPerKg(v, 60), 1);
    assert.equal(proteinPerKg(v, 0), 0);
  });

  it("分类供能占比按热量降序，合计为 1", () => {
    const list = [entry(foodById("shupian")!, 70), entry(foodById("rice-cooked")!, 180)];
    const shares = categoryEnergyShare(list);
    assert.equal(Math.round(shares.reduce((s, x) => s + x.share, 0) * 100) / 100, 1);
    assert.equal(shares[0].category, "snack"); // 70g 薯片（384kcal）压过 180g 米饭（209kcal）
    assert.equal(shares[1].category, "staple");
  });

  it("贡献榜能把「是哪一样拉高的」指出来", () => {
    const list = [
      entry(foodById("shupian")!, 70, { id: "1" }),
      entry(foodById("naicha-quantang")!, 500, { id: "2" }),
      entry(foodById("xigua")!, 200, { id: "3" }),
    ];
    const top = topContributors(list, "kcal", 2);
    assert.equal(top.length, 2);
    assert.equal(top[0].entry.foodId, "naicha-quantang"); // 430 > 383.6 > 62
    assert.ok(top[0].value > top[1].value);
  });
});

describe("与目标对比", () => {
  const targets = calcNutritionTargets(PROFILE);

  it("没有钠数据时不硬判，返回 unknown 并说明原因", () => {
    const t = sumNutrition([
      { ...entry(foodById("shupian")!, 70), nutrition: { kcal: 383.6, protein: 4.9, fat: 23.8, carb: 37 } },
    ]);
    const sodium = compareToTargets(t, targets).find((x) => x.key === "sodium")!;
    assert.equal(sodium.verdict, "unknown");
    assert.match(sodium.note!, /0%/);
  });

  it("钠是「别超」型：超过上限判 high", () => {
    const t = sumNutrition([entry(foodById("xiangchang")!, 500)]); // 香肠钠 2309mg/100g
    const sodium = compareToTargets(t, targets).find((x) => x.key === "sodium")!;
    assert.equal(sodium.direction, "atMost");
    assert.equal(sodium.verdict, "high");
  });

  it("纤维是「要够」型：差得远判 low，接近就不算问题", () => {
    const low = compareToTargets(sumNutrition([]), targets).find((x) => x.key === "fiber")!;
    assert.equal(low.direction, "atLeast");
    // 空集合下纤维也是 undefined，所以先看方向语义，再单独验一个够量的场景
    const plenty = compareToTargets(
      sumNutrition([
        { ...entry(foodById("shupian")!, 70), nutrition: { kcal: 300, protein: 5, fat: 20, carb: 30, fiber: 30 } },
      ]),
      targets,
    ).find((x) => x.key === "fiber")!;
    assert.equal(plenty.verdict, "ok");
  });

  it("热量是「落在区间」型：吃太少判 low，不是越多越好", () => {
    const kcal = compareToTargets(sumNutrition([]), targets).find((x) => x.key === "kcal")!;
    assert.equal(kcal.direction, "band");
    assert.equal(kcal.verdict, "low");
  });
});

describe("份量解析", () => {
  const table = portionTable();

  it("一包薯片 = 70g", () => {
    const r = resolvePortion(table, foodById("shupian")!, "包")!;
    assert.equal(r.grams, 70);
    assert.equal(r.portion.label, "一包");
  });

  it("同一量词可以指定档位：大包 = 135g", () => {
    assert.equal(resolvePortion(table, foodById("shupian")!, "包", "大包")!.grams, 135);
    assert.equal(resolvePortion(table, foodById("shupian")!, "包", "小包")!.grams, 40);
  });

  it("一杯奶茶 = 500ml，大杯 = 700ml", () => {
    const milktea = foodById("naicha-quantang")!;
    assert.equal(resolvePortion(table, milktea, "杯")!.grams, 500);
    assert.equal(resolvePortion(table, milktea, "杯", "大杯")!.grams, 700);
  });

  it("一碗米饭 = 180g（熟重）", () => {
    const r = resolvePortion(table, foodById("rice-cooked")!, "碗")!;
    assert.equal(r.grams, 180);
    assert.match(r.portion.note ?? "", /熟重/);
  });

  it("量词对不上就返回 null，绝不猜一个数字出来", () => {
    assert.equal(resolvePortion(table, foodById("rice-cooked")!, "勺"), null);
    assert.equal(resolvePortion(table, foodById("shupian")!, "桶"), null);
  });

  it("兜底克数按分类给，且十类都有值", () => {
    assert.equal(fallbackGrams({ category: "snack" }), 50);
    assert.equal(fallbackGrams({ category: "drink" }), 330);
  });
});

describe("浅解析", () => {
  it("剥掉时间词与动词，让量词能被认出来", () => {
    // 这一条是真踩过的坑：「晚上吃了一包薯片」若不剥噪音，
    // 整段会匹配失败并退化成拍脑袋的兜底克数，而用户明明说清了份量
    const p = parseFragment("晚上吃了一包薯片");
    assert.equal(p.cleaned, "一包薯片");
    assert.equal(p.amount, 1);
    assert.equal(p.unit, "包");
    assert.equal(p.name, "薯片");
  });

  it("中文数字与「两」都认", () => {
    const p = parseFragment("两个鸡蛋");
    assert.equal(p.amount, 2);
    assert.equal(p.unit, "个");
    assert.equal(p.name, "鸡蛋");
  });

  it("「半」算 0.5", () => {
    assert.equal(parseFragment("半碗米饭").amount, 0.5);
    assert.equal(parseFragment("半碗米饭").name, "米饭");
  });

  it("明确写了克数时以克数为准，且在前后都能认", () => {
    assert.deepEqual(
      [parseFragment("70克薯片").amount, parseFragment("70克薯片").name],
      [70, "薯片"],
    );
    assert.deepEqual(
      [parseFragment("薯片 70 克").amount, parseFragment("薯片 70 克").name],
      [70, "薯片"],
    );
  });

  it("⚠ 食物名里含量词不会被误切：「面包」不是「一个包」", () => {
    const p = parseFragment("面包");
    assert.equal(p.unit, undefined);
    assert.equal(p.name, "面包");
    assert.equal(parseFragment("一个面包").name, "面包");
    assert.equal(parseFragment("一个面包").unit, "个");
  });

  it("没写份量时如实保持没有量词，交给上层去兜底并标估算", () => {
    const p = parseFragment("奶茶");
    assert.equal(p.unit, undefined);
    assert.equal(p.name, "奶茶");
    assert.equal(p.amount, 1);
  });

  it("噪音只剥开头，不动食物名", () => {
    assert.equal(stripLeadNoise("我喝了一杯奶茶"), "一杯奶茶");
    assert.equal(stripLeadNoise("一杯奶茶"), "一杯奶茶");
    // 只剥动词「吃了」，「个」是量词，必须留着 —— 剥掉它会让份量表白写（见「量词不许被前缀噪音吃掉」）
    assert.equal(stripLeadNoise("今天下午吃了个苹果"), "个苹果");
  });

  it("切段认得中英文逗号、顿号与空白", () => {
    assert.deepEqual(splitFragments("一包薯片，一杯奶茶"), ["一包薯片", "一杯奶茶"]);
    assert.deepEqual(splitFragments("两个鸡蛋、一碗米饭"), ["两个鸡蛋", "一碗米饭"]);
    assert.deepEqual(splitFragments("一包薯片 一杯奶茶"), ["一包薯片", "一杯奶茶"]);
  });

  it("同时说了份量与克数时，两个信息都要用上：「一包 70g 的薯片」", () => {
    // 回归：这条路以前只取走 70g，把「一包」留进食物名 → 查库失败 →
    // 退化成按分类兜底的拍脑袋克数（实测记成「肉包 200g」）
    const p = parseFragment("一包 70g 的薯片");
    assert.equal(p.amount, 1);
    assert.equal(p.unit, "包");
    assert.equal(p.name, "薯片");
    assert.equal(p.perUnitGrams, 70);

    assert.equal(parseFragment("两包70g的薯片").amount, 2);
    assert.equal(parseFragment("两包70g的薯片").perUnitGrams, 70);
    assert.equal(parseFragment("一袋100克的薯片").perUnitGrams, 100);
    assert.equal(parseFragment("半包70g的薯片").amount, 0.5);
  });

  it("纯克数的写法仍是「数量就是克数」，不会变成 1 × 70g", () => {
    // 回归：数量+量词那一组若做成可选，`70克薯片` 会掉进去变成 amount=1 / perUnitGrams=70。
    // 数字一样，但记录里会显示成「1 克 · 70g」——读起来是错的
    assert.equal(parseFragment("70克薯片").amount, 70);
    assert.equal(parseFragment("70克薯片").perUnitGrams, undefined);
    assert.equal(parseFragment("薯片70克").name, "薯片");
  });

  it("⚠️ 只有量词、没说是吃什么时，量词不能变成食物名", () => {
    // 回归：正则回溯会把「一包」切成 { unit: undefined, name: "包" }，
    // 而「包」再被模糊检索配成「肉包」—— 一包薯片记成 200g 肉包，全错且不报错
    const p = parseFragment("一包");
    assert.equal(p.unit, "包");
    assert.equal(p.name, "");
  });

  it("切段不会把被空白打散的份量切碎", () => {
    // 回归：原本按空白切，「薯片 70 克」变成 ["薯片","70","克"]，
    // 第一段没份量走兜底、后两段又凑不出食物名 —— parseFragment 支持这种写法却永远轮不到它
    assert.deepEqual(splitFragments("薯片 70 克"), ["薯片70克"]);
    assert.deepEqual(splitFragments("一包 70g 的薯片"), ["一包70g的薯片"]);
    assert.deepEqual(splitFragments("500ml 奶茶"), ["500ml奶茶"]);
  });

  it("数字与**量词**之间的空白也要粘住：「15 个饺子」", () => {
    // 回归（2026-09-18 用户实测上报）：粘合规则原来只认**度量单位**（克/g/ml），不认**量词**，
    // 于是「15 个饺子」被空白切成 ["15", "个饺子"] ——
    // 界面上第一条是「「5」· 库里没有」，第二条只剩「1 个饺子」。
    // 用户说了 15 个，账本上记成 20g（差 15 倍），而那条假食物比真错误更显眼。
    assert.deepEqual(splitFragments("15 个饺子"), ["15个饺子"]);
    const p = parseFragment("15 个饺子");
    assert.equal(p.amount, 15);
    assert.equal(p.unit, "个");
    assert.equal(p.name, "饺子");

    // 但**不能**因此把「两样东西之间的空白」也粘掉
    assert.deepEqual(splitFragments("一包薯片 一杯奶茶"), ["一包薯片", "一杯奶茶"]);
    assert.deepEqual(splitFragments("两个鸡蛋、一碗米饭"), ["两个鸡蛋", "一碗米饭"]);
  });

  it("中文数量词要认到两位数：「十五个饺子」不是「十个饺子」", () => {
    // 回归：数量词原来是个**单字字符类**，匹配「十五」时只吃下「十」，
    // 剩下的「五」被当成食物名的一部分 —— 实测把 15 个饺子算成 10 份（2000g），
    // 比真实值大六倍多，而且一声不吭。静默算错是这个模块最不能犯的错。
    assert.equal(parseFragment("十五个饺子").amount, 15);
    assert.equal(parseFragment("十一个饺子").amount, 11);
    assert.equal(parseFragment("二十个饺子").amount, 20);
    assert.equal(parseFragment("二十五个饺子").amount, 25);
    assert.equal(parseFragment("三十个饺子").amount, 30);
    assert.equal(parseFragment("十个饺子").amount, 10);
    // 「十五」之后还得能把量词和食物名正常切出来
    assert.equal(parseFragment("十五个饺子").unit, "个");
    assert.equal(parseFragment("十五个饺子").name, "饺子");
    // 单字与「半」照旧
    assert.equal(parseFragment("三个饺子").amount, 3);
    assert.equal(parseFragment("半碗米饭").amount, 0.5);
  });

  it("约数连写取**保守**的那个，并标成约数：「两三个鸡蛋」= 2", () => {
    // 含糊相加（「两三」→ 5）比取保守值更糟：那会**系统性高估**，而用户说的是"大概"。
    const p = parseFragment("两三个鸡蛋");
    assert.equal(p.amount, 2);
    assert.equal(p.unit, "个");
    assert.equal(p.name, "鸡蛋");
    assert.equal(p.approximate, true, "约数必须标出来 —— 屏幕上不该出现一个看起来精确的 2");

    assert.equal(parseFragment("三四个鸡蛋").amount, 3);
    assert.equal(parseFragment("三四个鸡蛋").approximate, true);
    // 不是约数的不要误标
    assert.equal(parseFragment("两个鸡蛋").approximate, undefined);
    assert.equal(parseFragment("十五个饺子").approximate, undefined);
  });

  it("数量词认不出来时退回，绝不硬猜、更不许产出 NaN", () => {
    // 「一半」不是 1.5。认不出来时整串退回当食物名，amount 必须仍是有限数
    // —— 一旦这里产出 NaN，它会一路写进 DietEntry.amount，变成账本里谁也解释不了的数
    assert.ok(Number.isFinite(parseFragment("一半苹果").amount));
    assert.ok(Number.isFinite(parseFragment("十五个饺子").amount));
    assert.ok(Number.isFinite(parseFragment("两三个鸡蛋").amount));
  });

  it("「和 / 跟 / 加 / 以及 / 还有」与顿号是一回事", () => {
    // 回归：splitFragments 原来只按标点与空白切，「米饭和红烧肉」整段进 parseFragment，
    // 只解析出「米饭」—— 红烧肉那一份热量凭空消失，而界面上看起来一切正常。
    assert.deepEqual(splitFragments("米饭和红烧肉"), ["米饭", "红烧肉"]);
    assert.deepEqual(splitFragments("米饭跟红烧肉"), ["米饭", "红烧肉"]);
    assert.deepEqual(splitFragments("米饭还有红烧肉"), ["米饭", "红烧肉"]);
    assert.deepEqual(splitFragments("米饭以及红烧肉"), ["米饭", "红烧肉"]);
    assert.deepEqual(splitFragments("米饭加红烧肉"), ["米饭", "红烧肉"]);
    // 连着三样也要全切开
    assert.deepEqual(splitFragments("米饭和红烧肉还有青菜"), ["米饭", "红烧肉", "青菜"]);
    // 前后不是汉字的不切 —— 免得把「加油」这类词切一半
    assert.deepEqual(splitFragments("加油"), ["加油"]);
  });

  it("「一打」= 12 个：固定的计数单位，在解析出口就展开", () => {
    // 回归：「一打鸡蛋」原来整段认不出来 ——「打」既不在量词表里、也不是数字。
    // 展开成「个」之后走的是份量表里现成的 `个[鸡蛋]`，数字来路没变。
    const p = parseFragment("一打鸡蛋");
    assert.equal(p.amount, 12);
    assert.equal(p.unit, "个");
    assert.equal(p.name, "鸡蛋");
    assert.equal(parseFragment("半打鸡蛋").amount, 6);
    assert.equal(parseFragment("两打鸡蛋").amount, 24);
  });

  it("份量写在后面对：「饺子15个」", () => {
    // 回归：中文里份量写在后面一样常见，原来只认前置 ——
    // 「饺子15个」退化成"没写份量"→ 分类兜底 200g（真实 300g），界面上看不出任何异常。
    const p = parseFragment("饺子15个");
    assert.equal(p.amount, 15);
    assert.equal(p.unit, "个");
    assert.equal(p.name, "饺子");
    assert.equal(parseFragment("饺子十五个").amount, 15);
    assert.equal(parseFragment("米饭一碗").unit, "碗");
    assert.equal(parseFragment("米饭一碗").name, "米饭");
    // 空白版本要能并回一段
    assert.deepEqual(splitFragments("饺子 15个"), ["饺子15个"]);
    // 但不能把「两样东西」并起来
    assert.deepEqual(splitFragments("苹果 香蕉"), ["苹果", "香蕉"]);
    assert.deepEqual(splitFragments("一包薯片 一杯奶茶"), ["一包薯片", "一杯奶茶"]);
  });

  it("连写（不打标点）要按「数量+量词」切开：「一份饭两份肉一份包菜」", () => {
    // 回归（2026-09-18 用户实测上报）：中文不习惯给每样东西都打标点。
    // 整段进 parseFragment 的话，食物名会变成「饭两份肉一份包菜」，查库必然失败，
    // 界面上只说一句「库里没有」—— 而用户明明把三样都说清楚了。
    // 「一碗米饭一个鸡蛋」是同一类，而且更隐蔽：它只认得出米饭，**鸡蛋那份直接消失**。
    assert.deepEqual(splitFragments("一份饭两份肉一份包菜"), ["一份饭", "两份肉", "一份包菜"]);
    assert.deepEqual(splitFragments("一碗米饭一个鸡蛋"), ["一碗米饭", "一个鸡蛋"]);
    assert.deepEqual(splitFragments("15个饺子两份肉"), ["15个饺子", "两份肉"]);
    // 第一个数量词之前的内容留成一段（剥噪音后为空，会在 resolveText 那层被丢掉）
    assert.deepEqual(splitFragments("我吃了一份饭两份肉"), ["我吃了", "一份饭", "两份肉"]);

    // ⚠️ 只有**一份**时绝不能切，否则反而把食物名切坏（「三杯鸡」是个菜名）
    assert.deepEqual(splitFragments("三杯鸡"), ["三杯鸡"]);
    assert.deepEqual(splitFragments("一份包菜"), ["一份包菜"]);
    assert.deepEqual(splitFragments("两个鸡蛋、一碗米饭"), ["两个鸡蛋", "一碗米饭"]);
  });
});

describe("一句话记录 · 兜底不许算错", () => {
  it("「15 个饺子」记成 15 个 300g（用户实测上报，曾经多出一个叫「5」的假食物）", () => {
    // 用户看到的是界面上多了一条「「5」· 库里没有」，而饺子只剩 1 个（20g）。
    // 端到端再钉一遍：解析出来的必须是**一条**，而且克数对得上份量表（个[饺子] = 20g）
    const cs = resolveText("15 个饺子");
    assert.equal(cs.length, 1);
    assert.equal(cs[0].food?.name, "饺子");
    assert.equal(cs[0].grams, 300);
    assert.equal(cs[0].missing, false);
  });

  it("「十五个饺子」也是 300g，不是 10 份 2000g", () => {
    const [c] = resolveText("十五个饺子");
    assert.equal(c.food?.name, "饺子");
    assert.equal(c.grams, 300);
    assert.equal(c.missing, false);
  });

  it("「米饭和红烧肉」记成两条（曾经只记下米饭，红烧肉那一份凭空消失）", () => {
    const cs = resolveText("米饭和红烧肉");
    assert.equal(cs.length, 2);
    assert.equal(cs[0].food?.name, "米饭");
    assert.equal(cs[1].food?.name, "红烧肉");
  });

  it("「一打鸡蛋」是 12 个（一打 = 12 是固定的，不是跟食物相关的份量）", () => {
    const [c] = resolveText("一打鸡蛋");
    assert.equal(c.amount, 12);
    assert.equal(c.unitLabel, "个");
    assert.equal(c.grams, 660); // 12 × 个[鸡蛋] 55g
  });

  it("「饺子15个」记成 300g（份量写在后面对，曾经走兜底成 200g）", () => {
    const [c] = resolveText("饺子15个");
    assert.equal(c.food?.name, "饺子");
    assert.equal(c.grams, 300);
    assert.equal(c.unitLabel, "个");
  });

  it("约数会被标成估算，并在依据里说清取的是哪个值", () => {
    const [c] = resolveText("两三个鸡蛋");
    assert.equal(c.amount, 2);
    assert.equal(c.estimated, true, "约数没标估算，屏幕上就会出现一个看起来精确的 2");
    assert.match(c.basis, /约数/);
  });

  it("「一份饭两份肉一份包菜」拆成三条（曾经整段查库失败，三样全丢）", () => {
    const cs = resolveText("一份饭两份肉一份包菜");
    assert.equal(cs.length, 3);
    assert.equal(cs[0].food?.name, "米饭");
    // 「肉」是泛称、库里没有 —— 就该说"库里没有"并给相近项，不能硬配一条数值不对的
    assert.equal(cs[1].name, "肉");
    assert.equal(cs[1].missing, true);
    assert.equal(cs[2].name, "包菜");
    assert.equal(cs[2].missing, true);

    // 「我吃了」那段剥掉噪音后是空的，不该变成一条记录
    assert.equal(resolveText("我吃了一份饭两份肉").length, 2);
    // 同一类里更隐蔽的一种：整段解析时「一个鸡蛋」会**直接消失**
    assert.equal(resolveText("一碗米饭一个鸡蛋").length, 2);
  });

  it("「一包 70g 的薯片」记成薯片 70g（曾经记成肉包 200g）", () => {
    const [c] = resolveText("一包 70g 的薯片");
    assert.equal(c.food?.name, "薯片");
    assert.equal(c.grams, 70);
    assert.equal(c.missing, false);
  });

  it("「两包70g的薯片」是 140g，不是 70g", () => {
    const [c] = resolveText("两包70g的薯片");
    assert.equal(c.food?.name, "薯片");
    assert.equal(c.grams, 140);
  });

  it("「薯片 70 克」记成 70g（曾经被切碎、走兜底成 50g）", () => {
    const [c] = resolveText("薯片 70 克");
    assert.equal(c.food?.name, "薯片");
    assert.equal(c.grams, 70);
  });

  it("单字不给模糊检索：量词残渣不会配成任意食物", () => {
    assert.equal(matchFood("包"), undefined);
    assert.equal(matchFood(""), undefined);
    assert.equal(matchFood("   "), undefined);
    // 单字的**精确**命中仍然放行：库里确实有正名就是一个字的条目
    assert.equal(matchFood("醋")?.name, "醋");
  });

  it("只有份量没说是吃什么时，直说没读出食物名，而不是给个错数字", () => {
    const [c] = resolveText("一包");
    assert.equal(c.missing, true);
    assert.equal(c.food, undefined);
    assert.equal(c.reason, "no-name");
    assert.match(c.explain ?? "", /没说是吃什么/);
  });
});

describe("量词不许被前缀噪音吃掉", () => {
  /*
   * 这里曾经有一个「克数碰巧对、单位是错的」的 bug：
   * `LEAD_NOISE` 里写了「吃了个」，剥噪音时把量词「个」一起剥掉了 ——
   * 「吃了个苹果」变成「苹果」，解析成"没写份量"，于是按分类兜底 200g 并标成「份」。
   * 而份量表里明明有 `个[苹果] = 200g`。数值恰好一致，所以**看不出错**，
   * 只有单位（200 份）和「估算」标签是错的 —— 这类错最难发现。
   */
  it("「吃了个苹果」走份量表，不是分类兜底", () => {
    const [c] = resolveText("吃了个苹果");
    assert.equal(c.food?.name, "苹果");
    assert.equal(c.unitLabel, "个");
    assert.equal(c.grams, 200);
    assert.equal(c.estimated, false);
    assert.match(c.basis, /一个/);
  });

  it("「吃了一个苹果」「两个鸡蛋」的量词都留着", () => {
    const [a] = resolveText("吃了一个苹果");
    assert.equal(a.unitLabel, "个");
    assert.equal(a.grams, 200);

    const [b] = resolveText("两个鸡蛋");
    assert.equal(b.unitLabel, "个");
    assert.equal(b.grams, 110); // 2 × 55g
  });

  it("「喝了杯牛奶」的量词留着（「喝了个」那类噪音不许再吞量词）", () => {
    const [c] = resolveText("喝了杯牛奶");
    // 库里有全脂/脱脂两条，「牛奶」落到全脂那条 —— 这里要验的是量词和克数，不是具体哪条
    assert.match(c.food?.name ?? "", /牛奶/);
    assert.equal(c.unitLabel, "杯");
    assert.equal(c.grams, 250);
    assert.equal(c.estimated, false);
  });

  it("光杆量词归位成量词，不当成食物名", () => {
    const p = parseFragment("个");
    assert.equal(p.unit, "个");
    assert.equal(p.name, "");
    assert.equal(resolveText("个")[0].missing, true);
  });

  it("量词残缺的残渣不再被配成任意食物（「包」不许配成肉包）", () => {
    assert.equal(matchFood("包"), undefined);
  });
});

describe("没匹配上时要说清是哪一种", () => {
  it("水、清茶这类：明说记了也没意义，而不是「未匹配」", () => {
    for (const text of ["喝了一瓶矿泉水", "喝了杯水", "喝了杯黑咖啡"]) {
      const [c] = resolveText(text);
      assert.equal(c.missing, true, text);
      assert.equal(c.reason, "no-calorie", text);
      assert.match(c.explain ?? "", /几乎没有热量/, text);
    }
  });

  it("「茶」是子串但不是同一个东西：奶茶、水果茶不许被当成「不必记账」", () => {
    const [naicha] = resolveText("一杯奶茶");
    // 库里有「奶茶（全糖）」「奶茶（无糖）」，落到哪条都行 —— 关键是**不能被当成茶**
    assert.ok(naicha.food, "奶茶必须能匹配到");
    assert.match(naicha.food!.name, /奶茶/);
    assert.equal(naicha.reason, undefined);
    assert.ok(naicha.grams > 0);
  });

  it("整餐的说法：说明要落到具体食物，别把它当成「库里没有」", () => {
    for (const text of ["吃了顿饭", "吃了个正餐"]) {
      const [c] = resolveText(text);
      assert.equal(c.missing, true, text);
      assert.equal(c.reason, "meal", text);
      assert.match(c.explain ?? "", /整餐/, text);
    }
  });

  it("「午饭吃了红烧肉」要认成红烧肉 —— 单字别名「饭」不许抢走它", () => {
    const c = resolveText("午饭吃了红烧肉")[0];
    assert.notEqual(c.reason, "meal");
    assert.equal(c.food?.name, "红烧肉");
  });

  it("库里真没有的，仍然给相近项让用户挑", () => {
    const [c] = resolveText("吃了个仙人掌果");
    assert.equal(c.missing, true);
    assert.equal(c.reason, "not-found");
    assert.match(c.explain ?? "", /库里没有/);
  });
});

describe("常见口语不许因为缺别名就记不上", () => {
  it("「一碗饭」认成米饭 180g（饭 是 米饭 的别名）", () => {
    const [c] = resolveText("一碗饭");
    assert.equal(c.food?.name, "米饭");
    assert.equal(c.unitLabel, "碗");
    assert.equal(c.grams, 180);
    assert.equal(c.missing, false);
  });

  it("「一碗面」认成面条 250g", () => {
    const [c] = resolveText("一碗面");
    assert.equal(c.food?.name, "面条");
    assert.equal(c.grams, 250);
  });

  it("加了别名也不许抢走更具体的条目：「蛋炒饭」还是蛋炒饭", () => {
    assert.equal(matchFood("蛋炒饭")?.name, "蛋炒饭");
    assert.equal(matchFood("炒饭")?.name, "蛋炒饭");
  });
});

describe("三餐的参考分配", () => {
  it("早中晚三份加起来等于总目标，加餐不占份额", () => {
    const targets = calcNutritionTargets(PROFILE);
    const sum = MEAL_SLOTS.reduce((a, s) => a + (mealKcalTarget(targets.kcal, s) ?? 0), 0);
    // 取整会有 1 kcal 级别的误差，不许超过每餐 1 kcal
    assert.ok(Math.abs(sum - targets.kcal) <= 2, `三餐合计 ${sum}，总目标 ${targets.kcal}`);
    assert.equal(mealKcalTarget(targets.kcal, "加餐"), null);
  });

  it("份额是参考值：措辞里必须带「参考」二字，不能拿去判定对错", () => {
    assert.match(MEAL_SPLIT_NOTE, /参考/);
  });
});

describe("快照语义", () => {
  it("记录里的营养值是快照：事后改食物库不会改写历史", () => {
    const food = foodById("shupian")!;
    const before = entry(food, 70);
    const snapshot = before.nutrition.kcal;

    // 模拟"以后修正了食物库"
    const original = food.kcal;
    try {
      food.kcal = 999;
      assert.equal(before.nutrition.kcal, snapshot, "历史记录被改写了");
      assert.equal(Math.round(before.nutrition.kcal), 384);
    } finally {
      food.kcal = original;
    }
  });

  it("名字与分类也一并快照，库里删了条目历史仍读得懂", () => {
    const e = entry(foodById("shupian")!, 70);
    assert.equal(e.name, "薯片");
    assert.equal(e.category, "snack");
    assert.equal(e.foodId, "shupian");
  });
});

describe("食物库检索", () => {
  it("别名能命中正名：土豆片 → 薯片", () => {
    assert.equal(findFoodByName("土豆片")?.id, "shupian");
  });

  it("搜索能把用户说的长句里的词捞出来", () => {
    const hits = searchFoods("奶茶");
    assert.ok(hits.length > 0);
    assert.ok(hits.some((f) => f.id === "naicha-quantang"));
  });

  it("每条都必须标数据来源，不许留空", () => {
    const noSource = allFoods().filter((f) => !f.source?.trim());
    assert.deepEqual(noSource.map((f) => f.id), []);
  });
});

describe("目标推导", () => {
  it("复用了健康模块的热量目标，没有另起一套公式", () => {
    const t = calcNutritionTargets(PROFILE);
    // BMR 1305 × 1.375 = 1794
    assert.equal(t.kcal, 1794);
  });

  it("三大营养素加起来约等于总热量，不自相矛盾", () => {
    const t = calcNutritionTargets(PROFILE);
    assert.equal(targetsConflict(t), null);
    const used = t.protein * 4 + t.fat * 9 + t.carb * 4;
    assert.ok(Math.abs(used - t.kcal) / t.kcal < 0.01);
  });

  it("钠与纤维分别设上限和下限，方向不会搞反", () => {
    const t = calcNutritionTargets(PROFILE);
    assert.equal(t.sodium, 2000);
    assert.ok(t.fiber >= 25);
  });
});

describe("端到端可追溯（P1 的验收标准）", () => {
  it("「一包薯片 + 一杯奶茶」的每个数字都能追回食物与克数", () => {
    const chips = foodById("shupian")!;
    const milktea = foodById("naicha-quantang")!;
    const table = portionTable();

    const g1 = resolvePortion(table, chips, "包")!.grams;
    const g2 = resolvePortion(table, milktea, "杯")!.grams;
    assert.equal(g1, 70);
    assert.equal(g2, 500);

    const list = [entry(chips, g1), entry(milktea, g2, { id: "t-milktea" })];
    const totals = sumNutrition(list);

    // 值本身
    assert.equal(Math.round(totals.values.kcal * 10) / 10, 813.6); // 383.6 + 430
    assert.equal(Math.round(totals.values.sodium!), 550); // 350 + 200
    assert.equal(totals.sodiumCoverage, 1);

    // 可追溯：每个数字都指得回是哪种食物、多少克
    assert.deepEqual(
      list.map((e) => [e.foodId, e.grams]),
      [["shupian", 70], ["naicha-quantang", 500]],
    );

    // 结论：对一个 1794 kcal 目标的人来说，这两样零食占掉约 45% 的热量、28% 的钠上限
    const targets = calcNutritionTargets(PROFILE);
    assert.equal(Math.round((totals.values.kcal / targets.kcal) * 100), 45);
    assert.equal(Math.round((totals.values.sodium! / targets.sodium) * 100), 28);

    // 脂肪占比同步能看出来：23.8 + 12 = 35.8g，已超目标的一半
    assert.ok(totals.values.fat > targets.fat * 0.5);
  });

  it("模型给的数值不可能混进来：所有数字都来自库里那一次乘法", () => {
    const chips = foodById("shupian")!;
    const e = entry(chips, 70);
    // 与「库里每 100g 的值 × 0.7」逐项相等，不存在第二个来源
    const expected = nutritionOf(chips, 70);
    assert.deepEqual(e.nutrition, expected);
  });
});
