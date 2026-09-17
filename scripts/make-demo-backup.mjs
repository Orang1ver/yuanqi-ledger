#!/usr/bin/env node
/**
 * 生成一份「样例数据」备份，用于肉眼验收界面 —— 日期锚定到运行当天。
 *
 * 为什么需要它：
 * 新装的站是空的，看空界面判断不出「早期版本数据接没接得过来」。这份备份装的是
 * **早期版本结构的数据**（字段名、嵌套层次、以及早期版本才有/没有的字段都照旧），
 * 导入后四个页面立刻是活的，一眼就能看出兼容性有没有掉。
 *
 * 结构来源：scripts/fixtures/legacy-v1.json —— 与 `npm run check:data` 用的是同一份样本，
 * 只在这里补数量与日期，避免两处各写一套而漂移。
 *
 * 刻意留下三处「不完美」，用来覆盖兼容分支：
 * 1. 最早一天喝水未达标 → 不该被算进连续打卡（连续应为 7 天，不是 8 天）
 * 2. 有一条饮食记录没有 time 字段 → 早期版本的数据就是这样，新版应自动补上时间
 * 3. 运动累计 45.1km → `ex-km-50` 应当是**未解锁**状态，能看到「还差 N km」的进度文案
 *
 * 刻意**不**包含 API Key：假 Key 会让 AI 功能直接报错，反而误导演收。
 *
 * 用法：
 *   npm run demo:data          # 输出到 .tmp-demo/元气账本-样例数据.json
 * 隔几天再要看，重跑一次即可（它会以当天为锚点重算日期）。
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const legacy = JSON.parse(readFileSync(join(HERE, "fixtures", "legacy-v1.json"), "utf8"));
const seedDishes = JSON.parse(readFileSync(join(ROOT, "data", "takeoutSeed.json"), "utf8"));

const OUT_DIR = join(ROOT, ".tmp-demo");
const OUT_FILE = join(OUT_DIR, "元气账本-样例数据.json");

// ---------- 日期工具（与 lib/date.ts 同口径：周一为一周之始） ----------

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

/** 距今天 offset 天的 ISO 日期（offset 为负即过去） */
const day = (offset) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + offset);
  return iso(d);
};

/** 距今天 offset 天、指定钟点的时间戳 */
const at = (offset, hour = 12) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + offset);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
};

const weekStartOf = (isoStr) => {
  const d = new Date(`${isoStr}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return iso(d);
};

// ---------- 达标线：与 lib/health.ts 的 calcWaterTarget / calcStepsTarget 同口径 ----------

const ACTIVITY_STEPS = { 久坐少动: 6000, 轻度活动: 8000, 中度活动: 10000, 高度活动: 12000 };

const profile = legacy["recipe.healthProfile.v1"];
const WATER_TARGET = Math.min(3500, Math.max(1500, Math.round((profile.weightKg * 35) / 50) * 50));
const STEP_TARGET = ACTIVITY_STEPS[profile.activityLevel] ?? 8000;

// ---------- 打卡：8 天，最老一天喝水故意未达标 ----------

const CHECKIN_PLAN = [
  { off: -7, waterMl: WATER_TARGET - 400, steps: 12000, sleepHours: 7, mood: "还行" },
  { off: -6, waterMl: WATER_TARGET + 50, steps: 8400, sleepHours: 6.5, mood: "一般" },
  { off: -5, waterMl: WATER_TARGET + 200, steps: 9200, sleepHours: 7.5, mood: "好" },
  { off: -4, waterMl: WATER_TARGET + 400, steps: 11200, sleepHours: 8, mood: "好" },
  { off: -3, waterMl: WATER_TARGET + 100, steps: 10400 }, // 这一天空着睡眠与心情，测可选字段
  { off: -2, waterMl: WATER_TARGET + 300, steps: 9800, sleepHours: 6.5, mood: "一般" },
  { off: -1, waterMl: WATER_TARGET, steps: 8600, sleepHours: 7.5, mood: "好" },
  { off: 0, waterMl: WATER_TARGET + 200, steps: 9800, sleepHours: 7.5, mood: "好" },
];

const dailyCheckins = {};
for (const c of CHECKIN_PLAN) {
  const date = day(c.off);
  dailyCheckins[date] = {
    date,
    waterMl: c.waterMl,
    steps: c.steps,
    ...(c.sleepHours !== undefined ? { sleepHours: c.sleepHours } : {}),
    ...(c.mood !== undefined ? { mood: c.mood } : {}),
    updatedAt: at(c.off, 21),
  };
}

// 连续打卡只认「喝水+步数都达标」的日子 —— 最老那天喝水不够，所以是 7 天不是 8 天
const rewardDays = {};
let streak = 0;
for (const c of CHECKIN_PLAN) {
  if (c.waterMl < WATER_TARGET || c.steps < STEP_TARGET) continue;
  const date = day(c.off);
  rewardDays[date] = { streak: ++streak, at: at(c.off, 21) };
}

// ---------- 体重：三周缓降，让曲线不是一条直线 ----------

const WEIGHT_PLAN = [
  [-21, 58.0],
  [-17, 57.6],
  [-13, 57.2],
  [-9, 56.9],
  [-5, 56.6],
  [0, 56.4],
];

const weights = {};
for (const [off, weightKg] of WEIGHT_PLAN) {
  const date = day(off);
  weights[date] = { date, weightKg, at: at(off, 7) };
}

// ---------- 运动：10 条、累计 45.1km（刚够 10 次，差一点到 50km） ----------

const EXERCISE_PLAN = [
  { off: 0, type: "跑步", minutes: 32, distanceKm: 5.2, note: "夜跑" },
  { off: -1, type: "散步", minutes: 40, distanceKm: 2.8 },
  { off: -2, type: "跑步", minutes: 28, distanceKm: 4.6 },
  { off: -3, type: "骑行", minutes: 50, distanceKm: 12 },
  { off: -4, type: "散步", minutes: 35 },
  { off: -5, type: "游泳", minutes: 45 },
  { off: -7, type: "跑步", minutes: 30, distanceKm: 5, note: "操场 12 圈" },
  { off: -9, type: "爬山", minutes: 120, distanceKm: 6.5 },
  { off: -11, type: "散步", minutes: 30, distanceKm: 2 },
  { off: -14, type: "徒步", minutes: 90, distanceKm: 7 },
];

const exercises = EXERCISE_PLAN.map((e, i) => ({
  id: `demo-ex-${i + 1}`,
  date: day(e.off),
  type: e.type,
  ...(e.minutes !== undefined ? { minutes: e.minutes } : {}),
  ...(e.distanceKm !== undefined ? { distanceKm: e.distanceKm } : {}),
  ...(e.note ? { note: e.note } : {}),
  at: at(e.off, 20),
}));

// ---------- 饮食记录 ----------

const dish = (name, role, ingredients, flavorTags) => ({
  name,
  role,
  ingredients: ingredients.map((label) => ({ label, fromPantry: true })),
  flavorTags,
});

const legacyMeal = legacy["recipe.mealRecords.v1"][0];

const mealRecords = [
  // 早期版本那条：没有 time 字段，且是若干天前的 —— 新版应自动补出时间
  { ...legacyMeal, date: day(-6), createdAt: at(-6, 19) },
  {
    id: "demo-meal-2",
    date: day(-2),
    mealSlot: "晚餐",
    time: "19:10",
    dishes: [
      dish("清蒸鲈鱼", "主菜", ["鲈鱼", "姜"], ["清淡", "少盐"]),
      dish("青菜豆腐汤", "汤", ["青菜", "豆腐"], ["清淡"]),
      dish("米饭", "主食", ["米饭"], ["清淡"]),
    ],
    channel: "自己做",
    avoidTags: [],
    methodTags: ["清蒸", "炖煮"],
    source: "manual",
    createdAt: at(-2, 19),
  },
  {
    id: "demo-meal-3",
    date: day(0),
    mealSlot: "午餐",
    time: "12:30",
    dishes: [
      dish("鸡胸肉沙拉", "主菜", ["鸡胸肉", "西兰花"], ["清淡", "少油"]),
      dish("杂粮饭", "主食", ["米饭"], ["清淡"]),
    ],
    channel: "自己做",
    avoidTags: ["不吃香菜"],
    methodTags: ["凉拌"],
    source: "manual",
    createdAt: at(0, 12),
  },
  {
    id: "demo-meal-4",
    date: day(-4),
    mealSlot: "晚餐",
    time: "18:40",
    dishes: [dish("黄焖鸡米饭（微辣）", "主食", ["鸡肉", "米饭"], ["咸鲜", "微辣"])],
    channel: "外卖",
    avoidTags: [],
    methodTags: ["不限"],
    source: "ai-edited", // 让"模型结果被改过"这个来源也出现一次
    createdAt: at(-4, 18),
  },
];

// ---------- 饮食日记（`recipe.dietLog.v1`） ----------
//
// 数值在这里算，而不是手写死 —— 手写的数字没人复核，会悄悄和食物库脱节。
// 这条乘法与 `lib/nutrition/core.ts` 的 `nutritionOf` 是同一个式子（每 100g 值 × grams/100）；
// 刻意不在生成器里 import 应用的 TS 模块（纯 .mjs 引入编译链路会把这份工具的依赖搞复杂），
// 代价是"两处同一个式子"，所以下面自检里会逐条重算复核一遍。

const FOODS = JSON.parse(readFileSync(join(ROOT, "data", "foods.zh.json"), "utf8"));
const foodById = (id) => FOODS.items.find((f) => f.id === id);

/** 造一条饮食记录；`off` 是距今天的天数（0 = 今天） */
function dietEntry({ id, foodId, grams, time, slot, amount, unitLabel, off = 0 }) {
  const f = foodById(foodId);
  if (!f) throw new Error(`样例数据引用了库里不存在的食物 id：${foodId}`);
  const k = grams / 100;
  return {
    id,
    date: day(off),
    time,
    mealSlot: slot,
    foodId,
    name: f.name,
    category: f.category,
    amount,
    unitLabel,
    grams,
    nutrition: {
      kcal: f.kcal * k,
      protein: f.protein * k,
      fat: f.fat * k,
      carb: f.carb * k,
      // 缺哪项就**不要写这一项**：写成 0 会让页面把"不知道"显示成"没有"
      ...(f.sodium !== undefined ? { sodium: f.sodium * k } : {}),
      ...(f.fiber !== undefined ? { fiber: f.fiber * k } : {}),
    },
    source: "db",
    createdAt: at(off, Number(time.slice(0, 2))),
  };
}

// 今天这一天故意吃得"零食偏多、钠偏高、蔬果偏少" —— 这样饮食页的建议卡与质量分
// 有真实内容可看，而不是一片满分或一片空白。库里 110 条食物没有纤维数据，
// 所以这份记录里纤维覆盖率也不满，正好能验「数据不全时会说出来」。
const dietLog = [
  dietEntry({ id: "demo-diet-1", foodId: "doujiang-sweet", grams: 300, time: "08:10", slot: "早餐", amount: 1, unitLabel: "一杯" }),
  dietEntry({ id: "demo-diet-2", foodId: "jidan-zhu", grams: 50, time: "08:10", slot: "早餐", amount: 1, unitLabel: "一个" }),
  dietEntry({ id: "demo-diet-3", foodId: "mantou", grams: 100, time: "08:15", slot: "早餐", amount: 1, unitLabel: "一个" }),
  dietEntry({ id: "demo-diet-4", foodId: "rice-cooked", grams: 180, time: "12:20", slot: "午餐", amount: 1, unitLabel: "一碗" }),
  dietEntry({ id: "demo-diet-5", foodId: "xianggu-qingcai", grams: 200, time: "12:25", slot: "午餐", amount: 1, unitLabel: "一份" }),
  dietEntry({ id: "demo-diet-6", foodId: "rice-cooked", grams: 150, time: "19:00", slot: "晚餐", amount: 1, unitLabel: "一碗" }),
  dietEntry({ id: "demo-diet-7", foodId: "xianggu-qingcai", grams: 200, time: "19:05", slot: "晚餐", amount: 1, unitLabel: "一份" }),
  dietEntry({ id: "demo-diet-8", foodId: "shupian", grams: 70, time: "21:30", slot: "加餐", amount: 1, unitLabel: "一包" }),
  dietEntry({ id: "demo-diet-9", foodId: "naicha-quantang", grams: 500, time: "21:35", slot: "加餐", amount: 1, unitLabel: "中杯" }),
  // 昨天留一条，用来验"切日期能看前一天"
  dietEntry({ id: "demo-diet-10", foodId: "rice-cooked", grams: 200, time: "12:00", slot: "午餐", amount: 1, unitLabel: "一碗", off: -1 }),
  dietEntry({ id: "demo-diet-11", foodId: "xianggu-qingcai", grams: 250, time: "12:05", slot: "午餐", amount: 1, unitLabel: "一份", off: -1 }),
];

// ---------- 其余 ----------

const commonIngredients = [
  "鸡胸肉",
  "西兰花",
  "米饭",
  "鸡蛋",
  "番茄",
  "豆腐",
  "猪肉",
  "青菜",
].map((label, i) => ({ id: `demo-ing-${i + 1}`, label, createdAt: at(-30, 9) }));

// 菜单库：早期版本那条 + 随包分发的 12 道示例（按 店|菜名 去重）
const takeoutMock = [legacy["recipe.takeoutMock.v2"][0], ...seedDishes].filter(
  (d, i, arr) => arr.findIndex((x) => `${x.restaurant}|${x.name}` === `${d.restaurant}|${d.name}`) === i,
);

const weekStart = weekStartOf(day(0));

const demo = {
  // 结构照早期版本逐字，仅 updatedAt 换成真实毫秒
  "recipe.healthProfile.v1": { ...profile, updatedAt: at(-3, 8) },
  "recipe.dailyCheckins.v1": dailyCheckins,
  "recipe.rewards.v1": {
    days: rewardDays,
    badges: { "streak-3": day(-4), "streak-7": day(0) },
    celebrated: Object.keys(rewardDays),
  },
  "recipe.weights.v1": weights,
  "recipe.exercises.v1": exercises,
  "recipe.exerciseAwards.v1": { "ex-first": day(-14), "ex-count-10": day(0) },
  "recipe.mealRecords.v1": mealRecords,
  "recipe.commonIngredients.v1": commonIngredients,
  "recipe.userProfile.v1": {
    content: "不爱吃香菜，乳糖不耐（奶茶只喝无乳的），口味偏清淡，晚饭想少吃点主食",
    updatedAt: at(-2, 21),
  },
  "recipe.takeoutMock.v2": takeoutMock,
  "recipe.takeoutSeeded.v1": true,
  "recipe.weeklyInsight.v1": {
    [weekStart]: {
      weekStart,
      reply:
        "这周喝水有 2 天没到 2000ml，基本上都卡在下午到晚上这段时间 —— 建议把杯子放在手边，上午先喝掉一半。步数完成得不错，7 天里 6 天都过 8000 步，周末那次爬山很加分。运动以有氧为主，可以补一次力量训练，对基础代谢更友好。",
      generatedAt: at(-1, 21),
    },
  },
  "recipe.prefs.v1": { cupMl: 300, theme: "system" },
  "recipe.dietLog.v1": dietLog,
  "recipe.iosInstallHintDismissed.v1": true,
  "recipe.updateBannerDismissed.v1": true,
};

// ---------- 自检：这份样例自己得先立得住 ----------

const problems = [];
for (const k of Object.keys(demo)) {
  if (!k.startsWith("recipe.")) problems.push(`键名缺 recipe. 前缀，备份会把它丢掉：${k}`);
}
if (Object.keys(rewardDays).length !== 7) {
  problems.push(`连续打卡应为 7 天，实际算出 ${Object.keys(rewardDays).length} 天`);
}
if (Object.keys(dailyCheckins).length !== 8) {
  problems.push(`打卡应为 8 天，实际 ${Object.keys(dailyCheckins).length} 天`);
}
const km = exercises.reduce((s, e) => s + (e.distanceKm ?? 0), 0);
if (km >= 50) problems.push(`累计里程 ${km}km 已过 50，ex-km-50 会意外解锁，看不到"还差 N km"`);
if (exercises.length !== 10) problems.push(`运动应为 10 条（刚好够 ex-count-10），实际 ${exercises.length} 条`);
if (!mealRecords.some((m) => !("time" in m))) problems.push("缺少「没有 time 字段」的早期版本饮食记录");

// 饮食日记：逐条把 nutrition 重算一遍 —— 生成器里那条乘法和 nutritionOf 是同一个式子，
// 分开写就有脱节的可能，所以这里必须复核，不能只信上面的写法。
for (const e of dietLog) {
  const f = foodById(e.foodId);
  const k = e.grams / 100;
  for (const key of ["kcal", "protein", "fat", "carb"]) {
    if (Math.abs(e.nutrition[key] - f[key] * k) > 1e-9) {
      problems.push(`饮食记录 ${e.id} 的 ${key} 与食物库对不上：${e.nutrition[key]} vs ${f[key] * k}`);
    }
  }
  // 「没有数据」≠「0」：库里没有的成分，记录里必须整项缺席，不能是 0
  for (const key of ["sodium", "fiber"]) {
    const hasInLib = f[key] !== undefined;
    const hasInEntry = e.nutrition[key] !== undefined;
    if (hasInLib && !hasInEntry) problems.push(`饮食记录 ${e.id} 漏了库里有的 ${key}`);
    if (!hasInLib && hasInEntry) {
      problems.push(`饮食记录 ${e.id} 给库里没有的 ${key} 编了个值（${e.nutrition[key]}），会把"不知道"显示成"没有"`);
    }
  }
}
if (!dietLog.some((e) => e.date === day(0))) {
  problems.push("今天没有任何饮食记录 —— 饮食页一打开就是空的，看不出效果");
}
{
  const todayKcal = dietLog
    .filter((e) => e.date === day(0))
    .reduce((s, e) => s + e.nutrition.kcal, 0);
  if (todayKcal < 900 || todayKcal > 3000) {
    problems.push(`今天的总热量 ${Math.round(todayKcal)}kcal 不像一天的饭量，八成是份量写错了量级`);
  }
}
if (problems.length) {
  console.error("✗ 样例数据自身不一致，先修生成器：");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

// ---------- 输出 ----------

const data = {};
for (const [k, v] of Object.entries(demo)) data[k] = JSON.stringify(v);

const backup = {
  app: "元气账本",
  version: 1,
  exportedAt: new Date().toISOString(),
  includesApiKey: false, // 明确不含 Key，可以放心分享
  data,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(backup, null, 2), "utf8");

// ---------- 汇报 ----------

const kb = (Buffer.byteLength(JSON.stringify(backup)) / 1024).toFixed(1);
console.log("✓ 样例数据已生成\n");
console.log(`  文件      ${OUT_FILE}`);
console.log(`  大小      ${kb} KB，共 ${Object.keys(data).length} 个键\n`);
console.log("  内容");
console.log(`    健康档案   ${profile.sex} / ${profile.age} 岁 / ${profile.heightCm}cm / ${profile.weightKg}kg / ${profile.activityLevel}`);
console.log(`    打卡       ${Object.keys(dailyCheckins).length} 天（连续 ${streak} 天，最老一天喝水未达标）`);
console.log(`    体重       ${Object.keys(weights).length} 条，${WEIGHT_PLAN[0][1]} → ${WEIGHT_PLAN.at(-1)[1]}kg`);
console.log(`    运动       ${exercises.length} 条，累计 ${Math.round(km * 10) / 10}km（ex-km-50 保持未解锁）`);
console.log(`    饮食       ${mealRecords.length} 条，其中 1 条是早期版本无 time 的格式`);
{
  const today = dietLog.filter((e) => e.date === day(0));
  const kcal = today.reduce((s, e) => s + e.nutrition.kcal, 0);
  const sodium = today.reduce((s, e) => s + (e.nutrition.sodium ?? 0), 0);
  const fiberCovered = today.filter((e) => e.nutrition.fiber !== undefined).length;
  console.log(
    `    饮食日记   ${dietLog.length} 条（今天 ${today.length} 条 = ${Math.round(kcal)}kcal / 钠 ${Math.round(sodium)}mg）` +
      `，纤维只有 ${fiberCovered}/${today.length} 条有数据`,
  );
}
console.log(`    菜单库     ${takeoutMock.length} 道（示例种子 + 早期版本那条）`);
console.log(`    每日达标线 喝水 ${WATER_TARGET}ml · 步数 ${STEP_TARGET} 步（由上面档案推出）`);
console.log("\n  导入方式：设置 → 数据备份 → 导入备份 → 选上面那个文件 → **覆盖** 模式\n");
