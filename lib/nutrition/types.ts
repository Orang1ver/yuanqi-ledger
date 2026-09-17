/**
 * 营养领域的类型契约。
 *
 * 这一层不依赖 React / Next / 任何 UI，也不碰 localStorage：
 * 它是纯计算与纯数据，换框架、上小程序、加 Android 壳都不用动。
 * 整个项目里唯一真正自有的资产就是这里 —— 公式、系数、评分口径都在这。
 *
 * ⚠️ 与 `lib/types.ts` 的区别：
 *    - `lib/types.ts` 是**持久化契约**（字段名写进了用户设备，改名 = 丢数据）
 *    - 这里的类型是**本层自己的**，可以自由演进；只有 `DietEntry` 例外，
 *      它会被写进 localStorage（键 `recipe.dietLog.v1`），改动需谨慎。
 */

import type { MealSlot } from "../tags";

// ---------- 分类 ----------

/**
 * 食物分类。刻意与「外卖库的菜品分类」分开：
 * 那边是给人浏览用的口味/品类（粉面米线、汉堡炸鸡…），
 * 这边是给统计用的营养学口径。两套混用会让「各分类供能占比」失去意义。
 */
export type FoodCategory =
  | "staple"
  | "meat"
  | "veg"
  | "protein"
  | "fruit"
  | "snack"
  | "drink"
  | "soup"
  | "seasoning"
  | "alcohol";

export const FOOD_CATEGORIES: { key: FoodCategory; label: string }[] = [
  { key: "staple", label: "主食" },
  { key: "meat", label: "荤菜" },
  { key: "veg", label: "素菜" },
  { key: "protein", label: "蛋豆乳" },
  { key: "fruit", label: "水果" },
  { key: "snack", label: "零食" },
  { key: "drink", label: "饮料" },
  { key: "soup", label: "汤粥" },
  { key: "seasoning", label: "油脂调味" },
  { key: "alcohol", label: "酒类" },
];

export function categoryLabel(c: FoodCategory | undefined): string {
  return FOOD_CATEGORIES.find((x) => x.key === c)?.label ?? "其他";
}

// ---------- 营养值 ----------

/**
 * 一份（或一条记录）的营养值。
 *
 * 单位：kcal / g / mg。
 *
 * ⚠️ **`sodium` 与 `fiber` 缺失时是 `undefined`，不是 `0`。**
 * 这是本层最重要的一条约定：库里查不到钠，和「这个食物不含钠」是两回事。
 * 把未知当 0 求和，会让「今天钠摄入 1200mg」这种结论在数据不全时变成谎言 ——
 * 而这类 App 最常见的说谎方式正是如此。
 * 求和时遇到 undefined 会跳过，并由 `coverage` 显式报告有多少条目缺这块数据。
 */
export type NutritionValues = {
  kcal: number;
  protein: number;
  fat: number;
  carb: number;
  /** 钠 mg。undefined = 暂无数据 */
  sodium?: number;
  /** 膳食纤维 g。undefined = 暂无数据 */
  fiber?: number;
};

export const EMPTY_NUTRITION: NutritionValues = {
  kcal: 0,
  protein: 0,
  fat: 0,
  carb: 0,
};

/** 供能比与汇总会用到；热量之外的可选营养素单独列 */
export type NutrientKey = "protein" | "fat" | "carb" | "sodium" | "fiber";

// ---------- 食物库 ----------

/**
 * 一种量词下的一个规格档位，例如「包」下的「小包 / 一包」、
 * 或「杯」下奶茶的「中杯 / 大杯」。
 */
export type FoodPortion = {
  /** 展示与匹配用的名称，如「一包」「中杯」 */
  label: string;
  /** 折算克数（液体按 ml，1ml≈1g） */
  grams: number;
  /** 常见取值区间。给区间而不是假精确 —— 别人家的「一杯奶茶」跟你家的不一样大 */
  range?: [number, number];
  note?: string;
  /** 该量词下的默认档。同一量词只有一个档位时恒为 true */
  isDefault?: boolean;
};

export type FoodItem = {
  id: string;
  name: string;
  /** 别名与俗称，用于搜索与口语命中：「薯片」←「土豆片」「乐事」 */
  alias?: string[];
  category: FoodCategory;
  /** 计量口径：固体按克，液体按毫升 */
  unit: "g" | "ml";
  /** 以下数值一律是**每 100g（液体每 100ml）** */
  kcal: number;
  protein: number;
  fat: number;
  carb: number;
  sodium?: number;
  fiber?: number;
  /**
   * 数值来源。**必填，不许留空** —— 热量本来就是估算，
   * 标不清依据就没法在出错时追溯。例：「通用成分值」「品牌官方营养表」
   * 「按标准菜谱估算」「餐馆做法估算（较家常 +20~40% 油脂）」
   */
  source: string;
};

export type FoodLibrary = {
  meta: {
    version: number;
    /** 说明数值口径，避免以后有人误以为是一份 */
    unit: string;
    updated: string;
    note?: string;
  };
  items: FoodItem[];
};

/**
 * 份量表的唯一存放处。
 *
 * ⚠️ 份量**只写在这里**，不要同时写进 `FoodItem` ——
 * 两处维护同一件事，早晚会互相矛盾，而且没人知道该信哪个。
 *
 * 这份表是**产品资产**而不是代码：它会被持续修正
 * （用户改一次「我的一杯奶茶其实是大杯」→ 记进个人默认值），
 * 所以跟食物库分开、单独可编辑。
 */
export type PortionRule = {
  /** 量词，如「包」「杯」「碗」「份」 */
  unit: string;
  /** 食物名或别名命中其中之一即适用（子串匹配，**先命中先取**，故特例写在前面） */
  match: string[];
  /** 该量词下的档位。第一档或 `isDefault` 为默认 */
  portions: FoodPortion[];
};

export type PortionTable = {
  meta: { version: number; updated: string; note?: string };
  rules: PortionRule[];
};

// ---------- 一条饮食记录 ----------

/** db = 查库得来；custom = 用户手输；ai = 模型解析（数值仍来自库） */
export type DietEntrySource = "db" | "custom" | "ai";

/**
 * 一条饮食记录。会写进 localStorage 的 `recipe.dietLog.v1`。
 *
 * 两个关键设计，都不是随手定的：
 *
 * 1. **`grams` 是唯一参与计算的值。**「一包」「一杯」只是录入手段，
 *    落库前必须先折算成克数。这样统计口径只有一个，不会随量词花样漂移。
 *
 * 2. **`nutrition` 是快照。** 把当时算出来的营养值原样存进记录。
 *    以后扩充或修正食物库，**都不会篡改历史数据** ——
 *    历史记录永远反映当时的认知，而不是被今天的库悄悄改写。
 *    这也是为什么 `name` / `category` 冗余存在这里。
 */
export type DietEntry = {
  id: string;
  /** ISO 日期 "2026-09-17" */
  date: string;
  /** "HH:mm" */
  time: string;
  mealSlot: MealSlot;
  /** 关联食物库；为空表示用户手输的自定义食物 */
  foodId?: string;
  /** 冗余存名字：库改了、条目删了，历史记录仍读得懂 */
  name: string;
  /** 同样冗余：库改了分类，历史统计口径也不跟着漂移 */
  category?: FoodCategory;
  /** 数量，如 2（两包） */
  amount: number;
  /** 份量单位，如「包」「杯」「克」 */
  unitLabel: string;
  /** 折算后的克数（液体即毫升） */
  grams: number;
  /** 计算当时的快照，见类注释 */
  nutrition: NutritionValues;
  source: DietEntrySource;
  createdAt: number;
};

// ---------- 汇总结果 ----------

/**
 * 汇总结果。除了各项数值，还必须带上**数据覆盖度** ——
 * 只有这样上层才能诚实地说「今天钠摄入 1800mg（基于 72% 的记录）」，
 * 而不是把查不到的部分当 0 混进总和。
 */
export type NutritionTotals = {
  values: NutritionValues;
  /** 参与汇总的条目数 */
  entries: number;
  /** 有明确钠数据的条目占比 0..1。1 = 全都有数据 */
  sodiumCoverage: number;
  /** 有明确纤维数据的条目占比 0..1 */
  fiberCoverage: number;
};

// ---------- 目标 ----------

/** 每日营养素目标。热量来自既有的 TDEE 推导，不在这里另算一套 */
export type NutritionTargets = {
  kcal: number;
  /** g */
  protein: number;
  /** g */
  fat: number;
  /** g */
  carb: number;
  /** mg */
  sodium: number;
  /** g */
  fiber: number;
};

/**
 * 目标的方向语义。这是「给建议」时能不能说对话的关键：
 * 热量与钠是「别超」，纤维与蛋白是「要够」，供能比是「落在区间内」。
 * 如果一律当成「越多越好」或「越少越好」，建议就会变成误导。
 */
export type TargetDirection = "band" | "atLeast" | "atMost";

export type NutrientStatus = {
  key: "kcal" | "protein" | "fat" | "carb" | "sodium" | "fiber";
  label: string;
  /** 实际摄入 */
  intake: number;
  /** 目标值 */
  target: number;
  unit: string;
  direction: TargetDirection;
  /** intake / target，用于画进度条；atMost 型超过 1 即为超标 */
  ratio: number;
  verdict: "ok" | "low" | "high" | "unknown";
  /** 数据不全时说明原因，避免让上层拿 0 去下结论 */
  note?: string;
};
