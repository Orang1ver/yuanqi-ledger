/**
 * 元气账本 —— 全量领域类型定义。
 *
 * ⚠️ 这些类型是**数据契约**，字段名与语义必须与历史版本逐字一致：
 * 用户的数据存在浏览器 localStorage 里（持久化契约：字段名已被写进用户设备，改名就等于丢数据），
 * 任何一个字段改名或改语义都会让老数据读不出来。改动前请先看 lib/storage/keys.ts。
 */

import type { DishRole, MealSlot, PortionPresetKey } from "./tags";

// ---------- 常用食材 ----------

export type CommonIngredient = {
  id: string;
  label: string;
  createdAt: number;
};

// ---------- 一餐饭 ----------

export type DishIngredient = {
  label: string;
  /** 是否来自「家里已有」清单（决定要不要进购物清单） */
  fromPantry: boolean;
};

export type Dish = {
  name: string;
  role: DishRole;
  ingredients: DishIngredient[];
  flavorTags: string[];
};

export type MealChannel = "自己做" | "外卖";
/** ai = 模型给的原始结果；manual = 手工记的；ai-edited = 模型结果被改过 */
export type MealSource = "ai" | "manual" | "ai-edited";

export type MealRecord = {
  id: string;
  date: string;
  /** "HH:mm"。用户自由选的具体时间；mealSlot 由它推导，只用于展示与语境 */
  time: string;
  mealSlot: MealSlot;
  title?: string;
  dishes: Dish[];
  channel: MealChannel;
  avoidTags: string[];
  methodTags: string[];
  portionPreset?: PortionPresetKey;
  dishCount?: number;
  onlyPantry?: boolean;
  shoppingList?: string[];
  goal?: string;
  aiMessage?: string;
  source: MealSource;
  createdAt: number;
};

// ---------- 每周分析缓存 ----------

export type WeeklyInsight = {
  /** 该周周一的 ISO 日期，作为缓存键 */
  weekStart: string;
  reply: string;
  generatedAt: number;
};

// ---------- 外卖 / 菜单库 ----------

export type TakeoutDish = {
  id: string;
  restaurant: string;
  name: string;
  category: string;
  priceRange?: string;
  flavorTags: string[];
  avoidConflicts: string[];
  /**
   * 关联到食物库里的某条食物。菜单里只有菜名，估不出营养 ——
   * 用户关联一次之后就记住了，之后这道菜的热量走的是与饮食记录同一个查表口径。
   */
  foodId?: string;
  /** 关联时定的克数；不给就按那条食物的分类兜底 */
  grams?: number;
};

// ---------- 用户饮食习惯笔记 ----------

export type UserProfile = {
  content: string;
  updatedAt: number;
};

// ---------- 健康档案 ----------

export type Sex = "男" | "女";
export type ActivityLevel = "久坐少动" | "轻度活动" | "中度活动" | "高度活动";
export type HealthGoal = "减脂" | "增肌" | "维持健康";

export type HealthProfile = {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  goal: HealthGoal;
  /** 过敏/忌口，自由文本 */
  allergies: string;
  /** 身体状况备注，如肠胃不好、乳糖不耐 */
  conditions: string;
  updatedAt: number;
};

// ---------- 每日打卡（喝水 / 步数 / 睡眠 / 心情） ----------

export type Mood = "好" | "一般" | "累";

export type DailyCheckin = {
  /** ISO "2026-09-13" */
  date: string;
  /** 唯一存储单位是 ml，「杯」只是显示层换算 */
  waterMl: number;
  steps: number;
  sleepHours?: number;
  mood?: Mood;
  updatedAt: number;
};

// ---------- 体重 ----------

/** 每天一条；同一天重复记录即覆盖 */
export type WeightEntry = {
  date: string;
  weightKg: number;
  at: number;
};

// ---------- 运动 ----------

export type ExerciseType = "散步" | "跑步" | "爬山" | "徒步" | "骑行" | "游泳" | "球类" | "其他";

/** 一天可以有多条（先散步再爬山），所以是数组 */
export type ExerciseRecord = {
  id: string;
  date: string;
  type: ExerciseType;
  minutes?: number;
  distanceKm?: number;
  note?: string;
  at: number;
};

/** 运动里程碑：id -> 获得日期。与打卡徽章是两套命名空间，绝不共用 */
export type ExerciseAwards = Record<string, string>;

// ---------- 打卡奖励 ----------

/**
 * 独立成键，不塞进 DailyCheckin —— 免得污染打卡的归一化逻辑与备份描述。
 * 因为带 `recipe.` 前缀，所以自动被备份导出/导入/清空覆盖。
 */
export type RewardState = {
  /** 达标日期 -> 当天的连续天数 */
  days: Record<string, { streak: number; at: number }>;
  /** 已获得徽章：徽章 id -> 获得日期（拿到就永久保留，断签不收回） */
  badges: Record<string, string>;
  /** 已弹过庆祝的日期，防止加一次水就弹一次 */
  celebrated: string[];
};
