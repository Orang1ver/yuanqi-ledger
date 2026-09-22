/**
 * 数据延续自检 —— 把"早期版本结构"的数据喂进新版的数据层，看能不能读出来。
 *
 * 为什么需要它：
 * 换新版最大的风险不是界面，而是**用户几年的记录读不出来**。
 * 键名一致只是必要条件；字段名、嵌套结构、类型都得对得上。
 * 这个脚本调用的是 `lib/storage/*` 里的**真实读写函数**（不是复制一遍逻辑），
 * 所以它验证的正是产品实际会跑的那段代码。
 *
 * 用法：
 *   npm run check:data
 *
 * 为什么不能直接 `node --experimental-strip-types` 跑：
 * Node 原生 TS 剥离不做模块解析，`import { KEYS } from "./keys"` 这种
 * 无扩展名相对导入（打包器能解析、Node 不能）会直接 ERR_MODULE_NOT_FOUND。
 * 所以走 `scripts/run-ts.mjs`：先用项目自带的 tsc 编成 CommonJS
 * （CJS 的 require 会自动补 .js 后缀），再用 node 执行。见 tsconfig.continuity.json。
 *
 * 退出码 0 = 全部读得出来；1 = 有数据读不到，不能发版。
 */

import { strict as assert } from "node:assert";

// 早期版本样本数据的**唯一来源**：自检脚本与浏览器冒烟测试共用这一份，
// 免得两边各写一套、日子久了互相漂移。结构逐字照抄早期版本真实落库的形态。
import legacy from "./fixtures/legacy-v1.json";

// 类型是**编译期**的东西，`import type` 会被完全擦掉，
// 所以它不影响下面"先挂 window 替身、再动态 import 数据层"的顺序。
import type { DietEntry } from "../lib/nutrition/types";

// ---------- 造一个最小可用的浏览器环境 ----------

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
  dump() {
    return Object.fromEntries(this.m);
  }
}

const storage = new MemoryStorage();
(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { localStorage: unknown }).localStorage = storage;

// ---------- 把早期版本样本灌进"浏览器" ----------

for (const [k, v] of Object.entries(legacy)) storage.setItem(k, JSON.stringify(v));

// 自证这个关卡真的会拦人：
//   Windows:  set YQ_SELFTEST=1 && npm run check:data
//   bash:     YQ_SELFTEST=1 npm run check:data
// 故意抠掉健康档案，脚本必须报错并退出码 1 —— 否则"全绿"就只能说明断言写松了。
if (process.env.YQ_SELFTEST === "1") {
  storage.removeItem("recipe.healthProfile.v1");
  console.log("[自证模式] 已故意删除健康档案，预期下面会出现 ✗ 且退出码 1");
}

// ---------- 断言收集器 ----------

const results: { name: string; ok: boolean; got: string }[] = [];

function check(name: string, fn: () => string) {
  try {
    results.push({ name, ok: true, got: fn() });
  } catch (e) {
    results.push({ name, ok: false, got: e instanceof Error ? e.message : String(e) });
  }
}

// ---------- 跑新版数据层的真实函数 ----------
//
// 用「函数内动态导入」而不是顶层静态导入，有两个原因：
// 1) 静态导入会被提升到模块体之前执行，那时 window/localStorage 替身还没挂上；
// 2) 顶层 await 在 CommonJS 产物里不合法（本脚本编成 CJS 才能在 Node 跑）。

async function main() {
  const health = await import("../lib/storage/health");
  const meals = await import("../lib/storage/meals");
  const takeout = await import("../lib/storage/takeout");
  const diet = await import("../lib/storage/diet");
  const { KEYS } = await import("../lib/storage/keys");
  const { loadPrefs } = await import("../lib/prefs");
  const { normalizeRewards, calcCurrentStreak } = await import("../lib/rewards");
  const { calcDailyTargets } = await import("../lib/health");
  const { sortWeights, deltaVsPrevious } = await import("../lib/weight");
  const { exerciseStats, pendingMilestones } = await import("../lib/exercise");
  const { readinessOfWeek } = await import("../lib/weekly");
  // 糖（添加糖）那两条检查要用：纯计算 + 内置库取一条食物
  const { nutritionOf, sumNutrition } = await import("../lib/nutrition/core");
  const { foodById } = await import("../lib/nutrition/library");

  check("健康档案", () => {
    const p = health.loadHealthProfile();
    assert.ok(p, "读不到健康档案");
    assert.equal(p.heightCm, 165);
    assert.equal(p.weightKg, 56.5);
    assert.equal(p.allergies, "乳糖不耐");
    return `${p.sex} ${p.age}岁 ${p.heightCm}cm ${p.weightKg}kg / ${p.activityLevel} / ${p.goal}`;
  });

  check("由档案算出的目标", () => {
    const p = health.loadHealthProfile();
    assert.ok(p);
    const t = calcDailyTargets(p);
    assert.ok(t.bmr > 1000 && t.bmr < 2000, "BMR 不合理：" + t.bmr);
    assert.ok(t.waterTarget >= 1500, "喝水目标不合理");
    return `BMR ${t.bmr} / TDEE ${t.tdee} / 热量 ${t.calorieTarget} / 水 ${t.waterTarget}ml / 步 ${t.stepsTarget} / BMI ${t.bmi} ${t.bmiLabel}`;
  });

  check("每日打卡", () => {
    const c = health.loadCheckin("2026-09-15");
    assert.ok(c, "读不到 9-15 的打卡");
    assert.equal(c.waterMl, 1800);
    assert.equal(c.sleepHours, 7.5);
    assert.equal(c.mood, "好");
    const c2 = health.loadCheckin("2026-09-16");
    assert.ok(c2);
    assert.equal(c2.sleepHours, undefined, "没填睡眠不该被写成 0");
    return `9-15 水${c.waterMl} 步${c.steps} 睡${c.sleepHours} 心情${c.mood}；9-16 水${c2.waterMl} 步${c2.steps}`;
  });

  check("本周打卡窗口", () => {
    const list = health.getCheckinsInWeek("2026-09-14");
    assert.equal(list.length, 2);
    const recent = health.getRecentCheckins(7, "2026-09-17");
    assert.equal(recent.length, 2);
    return `本周 ${list.length} 天，近 7 天 ${recent.length} 天`;
  });

  check("体重记录与差值", () => {
    const all = health.loadWeights();
    const list = sortWeights(all);
    assert.equal(list.length, 2);
    const d = deltaVsPrevious(all);
    assert.ok(d);
    assert.equal(d.diff, -0.8);
    return `${list.map((e) => `${e.date} ${e.weightKg}kg`).join(" → ")}（较上次 ${d.diff}）`;
  });

  check("运动记录与统计", () => {
    const list = health.loadExercises();
    assert.equal(list.length, 2);
    const s = exerciseStats(list);
    assert.equal(s.count, 2);
    assert.equal(s.minutes, 75);
    assert.equal(s.km, 4.2);
    const awards = health.loadExerciseAwards();
    const pending = pendingMilestones(s, awards);
    return `${s.count} 次 / ${s.minutes} 分钟 / ${s.km}km / 活跃 ${s.activeDays} 天；已有里程碑 ${Object.keys(awards).length} 个；待授 ${pending.length} 个`;
  });

  check("打卡奖励与连续天数", () => {
    const r = health.loadRewards();
    const norm = normalizeRewards(r);
    assert.equal(Object.keys(norm.days).length, 2);
    assert.equal(norm.badges["streak-3"], "2026-09-17");
    const streak = calcCurrentStreak(norm.days, "2026-09-17");
    assert.equal(streak, 2, "连续天数应为 2，实际 " + streak);
    return `${Object.keys(norm.days).length} 天达标 / ${Object.keys(norm.badges).length} 枚徽章 / 当前连续 ${streak} 天`;
  });

  check("菜单库", () => {
    const d = takeout.loadTakeoutDishes();
    assert.equal(d.length, 1);
    assert.equal(d[0].restaurant, "沙县小吃");
    const seeded = storage.getItem("recipe.takeoutSeeded.v1");
    assert.equal(seeded, "true");
    return `${d.length} 道菜：${d[0].restaurant}·${d[0].name}`;
  });

  check("菜单库播种不会覆盖已有数据", () => {
    takeout.seedTakeoutMockIfEmpty();
    const after = takeout.loadTakeoutDishes();
    assert.equal(after.length, 1, "播种把用户的菜单库覆盖了！");
    return `播种后仍是 ${after.length} 道菜（未被示例数据覆盖）`;
  });

  check("饮食记录（兼容早期无 time 的数据）", () => {
    const list = meals.loadMealRecords();
    assert.equal(list.length, 1);
    assert.equal(list[0].mealSlot, "晚餐");
    assert.equal(list[0].time, "19:00", "无 time 的老记录应被补成 19:00，实际 " + list[0].time);
    return `${list.length} 条，老记录 mealSlot=${list[0].mealSlot} 已补 time=${list[0].time}`;
  });

  check("饮食日记（早期版本没有这个键）", () => {
    // 这条测的是**最真实的升级路径**：饮食日记是新加的键，早期版本从没写过它，
    // 所以老用户第一次进来时 localStorage 里根本没有 `recipe.dietLog.v1`。
    // 「读出空表」和「读出 0」在界面上是两回事 —— 前者显示空状态，后者会显示"今天 0 kcal"。
    assert.equal(
      Object.prototype.hasOwnProperty.call(legacy, "recipe.dietLog.v1"),
      false,
      "样本数据里不该有这个键：有的话这条断言就测不到真实的升级路径了",
    );
    assert.equal(diet.loadDietEntries().length, 0, "键不存在时该读出空表，而不是抛错");
    assert.equal(diet.entriesOn("2026-09-17").length, 0);
    assert.equal(diet.entriesBetween("2026-09-01", "2026-09-30").length, 0);
    assert.equal(diet.frequentFoods().length, 0);
    return "键不存在 → 读出空表（升级用户首次进入就是这种情况）";
  });

  check("饮食日记 · 老记录没有 dishId（1.2.0 新增的可选字段）", () => {
    /*
     * `DietEntry.dishId` 是 1.2.0 加的：菜单库的一道菜记进饮食日记时带上它，
     * 「今天吃什么」才能知道"最近吃过哪几道"。
     *
     * ⚠️ 这条断言守的是**加法式改动**的那条底线：老记录一条都没有这个字段，
     * 而那是**正常且永久**的状态 —— 不许因为缺它就跳过记录，更不许顺手回填。
     * 另外它还钉住一个很容易写错的地方：**没有这个字段的记录不算"吃过"**。
     * 要是哪天把它当成吃过（比如用"库里有记录"当条件），全库的菜会一夜之间变成
     * "最近刚吃过"，推荐当场失效 —— 而界面上完全看不出异常。
     */
    const now = "2026-09-17T12:00:00.000Z";
    const old: DietEntry[] = [
      {
        id: "old-1",
        date: "2026-09-17",
        time: "12:00",
        mealSlot: "午餐",
        foodId: "rice-cooked",
        name: "米饭",
        category: "staple",
        amount: 1,
        unitLabel: "碗",
        grams: 250,
        nutrition: { kcal: 290, protein: 6.5, fat: 0.8, carb: 63.8 },
        source: "db",
        createdAt: Date.parse(now),
      },
    ];
    localStorage.setItem(KEYS.dietLog, JSON.stringify(old));
    const back = diet.loadDietEntries();
    assert.equal(back.length, 1, "缺 dishId 的老记录必须照样读得出来");
    assert.equal(back[0].dishId, undefined);

    const { last, count } = diet.lastEatenByDish();
    assert.equal(last.size, 0, "没有 dishId 的记录不该被算成「吃过某道菜」");
    assert.equal(count.size, 0);

    // 带 dishId 的新记录才算 —— 同一份数据里两种混着也要分得清
    localStorage.setItem(
      KEYS.dietLog,
      JSON.stringify([...old, { ...old[0], id: "new-1", dishId: "dish-9" }]),
    );
    const mixed = diet.lastEatenByDish();
    assert.equal(mixed.last.get("dish-9"), "2026-09-17");
    assert.equal(mixed.count.get("dish-9"), 1, "同一天同一道菜只算一次（拆食材会落多条）");
    assert.equal(mixed.last.size, 1, "只有带 dishId 的那一条进统计");
    return "缺 dishId 的老记录读得出、也不算吃过；带 dishId 的才进「最近吃过」";
  });

  check("饮食日记 · 老记录没有 sugar（新增的可选营养素字段）", () => {
    /*
     * `NutritionValues.sugar`（添加糖）是随自做饭菜一起加的。它与 `dishId` 同一性质：
     * **老记录一条都没有这个字段，而那是正常且永久的状态** —— 不许因为缺它就跳过记录，
     * 更不许顺手回填 0。
     *
     * ⚠️ 这里钉的是那条最容易被"顺手改掉"的边界：**没有糖数据 ≠ 糖是 0**。
     * 一旦有人把缺失当 0 求和，「今天添加糖 3g」这种话就会在数据全无的一天说出来 ——
     * 那正是这个模块最反对的假精确。
     */
    const old: DietEntry[] = [
      {
        id: "old-sugar-1",
        date: "2026-09-17",
        time: "12:00",
        mealSlot: "午餐",
        foodId: "rice-cooked",
        name: "米饭",
        category: "staple",
        amount: 1,
        unitLabel: "碗",
        grams: 250,
        nutrition: { kcal: 290, protein: 6.5, fat: 0.8, carb: 63.8 },
        source: "db",
        createdAt: Date.parse("2026-09-17T12:00:00.000Z"),
      },
    ];
    localStorage.setItem(KEYS.dietLog, JSON.stringify(old));
    const back = diet.loadDietEntries();
    assert.equal(back.length, 1, "缺 sugar 的老记录必须照样读得出来");
    assert.equal(back[0].nutrition.sugar, undefined, "不许给老记录补一个糖值");

    // 一条糖数据都没有 → 总量是 undefined，**不是 0**
    const none = sumNutrition(back);
    assert.equal(none.values.sugar, undefined);
    assert.equal(none.sugarCoverage, 0);

    // 混着来：有糖的那条进总和，没标的按 0 计（"没标 = 没加糖"，见 core.ts 的 addNutrition）
    const mixed = sumNutrition([
      ...back,
      { ...back[0], id: "new-sugar-1", nutrition: { ...back[0].nutrition, sugar: 12 } },
    ]);
    assert.equal(mixed.values.sugar, 12);
    assert.equal(mixed.sugarCoverage, 0.5);
    return "缺 sugar 的老记录读得出、也不被补 0；一条都没有时总量是 undefined 而不是 0";
  });

  check("老 FoodItem 没有 sugar · 折算时不报错、也不当 0", () => {
    // 内置库**刻意一条糖都没补**（糖只来自拍照识别与做菜加的糖两个入口），
    // 所以"取一个内置食物、算它的糖"这条路必须安静地给出 undefined。
    const chips = foodById("shupian");
    assert.ok(chips, "读不到 shupian");
    assert.equal(chips.sugar, undefined, "内置库不该被回填糖值");

    const n = nutritionOf(chips, 70);
    assert.equal(n.sugar, undefined, "不该把缺失折成 0");
    assert.ok(n.kcal > 0, "其它项的折算不受影响");

    // 带了糖的（拍照读来的）照常折算 —— 这条路由 T4 产生
    const shot = { ...chips, sugar: 9 };
    assert.equal(Math.round((nutritionOf(shot, 70).sugar ?? 0) * 10) / 10, 6.3);
    return "老 FoodItem 缺 sugar → undefined（不是 0）；带糖的按克数折算正常";
  });

  check("常用食材 / 偏好笔记 / 周分析", () => {
    assert.equal(meals.loadCommonIngredients().length, 1);
    assert.equal(meals.loadUserProfile()?.content, "不爱吃香菜");
    assert.ok(meals.loadWeeklyInsight("2026-09-14"));
    return `食材 1 项；笔记「${meals.loadUserProfile()?.content}」；周分析已缓存`;
  });

  check("偏好（我的杯子）", () => {
    const p = loadPrefs();
    assert.equal(p.cupMl, 300);
    assert.equal(p.theme, "system");
    return `杯子 ${p.cupMl}ml，主题 ${p.theme}`;
  });

  check("周维度达标率", () => {
    const p = health.loadHealthProfile();
    assert.ok(p, "读不到健康档案，算不出达标率");
    const t = calcDailyTargets(p);
    const r = readinessOfWeek(health.getCheckinsInWeek("2026-09-14"), t);
    assert.equal(r.totalDays, 2);
    return `${r.totalDays} 天有记录，喝水达标 ${r.waterDays} 天，步数达标 ${r.stepsDays} 天，两项都达标 ${r.bothDays} 天`;
  });

  // 「一顿饭」预设引用的食物 id 必须都真实存在 —— 预设里一旦出现死引用，
  // 用户点下去就是一条落不下来的记录，这个坑要在这里拦掉。
  // （`foodById` 在 main 开头已经导入过了，这里不再导一次 —— 重复声明会编译不过。）
  const { MEAL_PRESETS, mealPresetFoodIds } = await import("../lib/mealPresets");

  // 自证这个关卡也会拦人：把第一个预设的第一个食物 id 改成库里不存在的，
  // 「一顿饭预设完整性」必须报 ✗（配合上面的健康档案破坏一起自证整条闸门不是摆设）。
  if (process.env.YQ_SELFTEST === "1") {
    (MEAL_PRESETS[0].items[0] as { foodId: string }).foodId = "yq-selftest-missing";
    console.log("[自证模式] 已故意破坏一个预设食物 id，预期「一顿饭预设完整性」报 ✗");
  }

  check("一顿饭预设完整性", () => {
    let bad = 0;
    for (const p of MEAL_PRESETS) {
      if (p.items.length < 2) {
        console.error(`✗ 预设「${p.label}」不足 2 条`);
        bad++;
      }
      for (const it of p.items) {
        if (!foodById(it.foodId)) {
          console.error(`✗ 预设「${p.label}」引用了不存在的食物 ${it.foodId}`);
          bad++;
        }
        if (!(it.grams > 0)) {
          console.error(`✗ 预设「${p.label}」克数非法：${it.grams}`);
          bad++;
        }
      }
    }
    assert.equal(bad, 0, `一顿饭预设有 ${bad} 处问题`);
    const total = MEAL_PRESETS.reduce((s, p) => s + p.items.length, 0);
    return `${MEAL_PRESETS.length} 个预设 / ${total} 条食材 / ${mealPresetFoodIds().length} 个唯一食物，全部可解析`;
  });

  // ---------- 输出 ----------

  const pad = Math.max(...results.map((r) => [...r.name].length)) + 2;
  console.log("\n数据延续自检（用早期版本结构的数据跑新版真实读函数）\n" + "─".repeat(72));
  for (const r of results) {
    console.log((r.ok ? "  ✓ " : "  ✗ ") + r.name.padEnd(pad, "·") + " " + r.got);
  }
  const failed = results.filter((r) => !r.ok);
  console.log("─".repeat(72));
  if (failed.length) {
    console.log(`\n✗ ${failed.length} 项读不到，不能发版。\n`);
    process.exit(1);
  }
  console.log(`\n✓ ${results.length} 项全部通过：早期版本数据在新版里读得出来。\n`);
}

main().catch((e: unknown) => {
  console.error("\n自检脚本自身出错（不是数据问题）：\n", e);
  process.exit(1);
});
