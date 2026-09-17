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
 * 所以走 `scripts/run-continuity.mjs`：先用项目自带的 tsc 编成 CommonJS
 * （CJS 的 require 会自动补 .js 后缀），再用 node 执行。见 tsconfig.continuity.json。
 *
 * 退出码 0 = 全部读得出来；1 = 有数据读不到，不能发版。
 */

import { strict as assert } from "node:assert";

// 早期版本样本数据的**唯一来源**：自检脚本与浏览器冒烟测试共用这一份，
// 免得两边各写一套、日子久了互相漂移。结构逐字照抄早期版本真实落库的形态。
import legacy from "./fixtures/legacy-v1.json";

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
  const { loadPrefs } = await import("../lib/prefs");
  const { normalizeRewards, calcCurrentStreak } = await import("../lib/rewards");
  const { calcDailyTargets } = await import("../lib/health");
  const { sortWeights, deltaVsPrevious } = await import("../lib/weight");
  const { exerciseStats, pendingMilestones } = await import("../lib/exercise");
  const { readinessOfWeek } = await import("../lib/weekly");

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
