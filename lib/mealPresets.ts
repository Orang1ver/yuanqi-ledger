/**
 * 「一顿饭」预设 —— 把常见搭配展开成 N 条食材，一次落库。
 *
 * 只存 `foodId + grams`（这是**输入**，不是结果）。营养值一律由
 * `makeDietEntry` → `nutritionOf(food, grams)` 现算，**这里绝不写任何数字**。
 *
 * `foodId` 必须能在 `data/foods.zh.json` 里查到（由 `check:data` 的
 * 「一顿饭预设完整性」断言与单测共同保证）；克数取自 `foodPortions.json`
 * 已核准的「份」口径（主食一碗 200g / 米线一碗 250g / 荤菜一份 150g /
 * 素菜 200g / 汤一碗 300g），不是另起炉灶拍脑袋。
 */

import type { DishRole, PortionPresetKey } from "./tags";

export type MealPresetItem = {
  foodId: string;
  grams: number;
  /** 只用于展示「这是主食还是主菜」，不落库 */
  role?: DishRole;
};

export type MealPreset = {
  /** 复用现有键，UI 文案与「一餐饭 MealRecord」口径保持一致 */
  key: PortionPresetKey;
  label: string;
  description: string;
  items: MealPresetItem[];
};

export const MEAL_PRESETS: MealPreset[] = [
  {
    key: "1人食-盖饭",
    label: "盖饭",
    description: "一碗饭 + 一个荤菜铺上去，一人份最省事",
    items: [
      { foodId: "rice-cooked", grams: 200, role: "主食" },
      { foodId: "gongbaojiding", grams: 150, role: "主菜" }, // 宫保鸡丁
    ],
  },
  {
    key: "1人食-1菜1汤",
    label: "一菜一汤",
    description: "主食 + 一个荤菜 + 一碗汤，一个人吃也不将就",
    items: [
      { foodId: "rice-cooked", grams: 200, role: "主食" },
      { foodId: "yuxiangrousi", grams: 150, role: "主菜" }, // 鱼香肉丝
      { foodId: "fanqie-dan-tang", grams: 300, role: "汤" }, // 番茄蛋汤
    ],
  },
  {
    key: "家常-2菜1汤",
    label: "两菜一汤",
    description: "家里饭桌最常见的样子：主食 + 两菜 + 一汤",
    items: [
      { foodId: "rice-cooked", grams: 200, role: "主食" },
      { foodId: "hongshaorou", grams: 150, role: "主菜" }, // 红烧肉
      { foodId: "qingchao-shishu", grams: 200, role: "主菜" }, // 清炒时蔬
      { foodId: "fanqie-dan-tang", grams: 300, role: "汤" },
    ],
  },
  {
    key: "1人食-小火锅",
    label: "小火锅",
    description: "一人小锅：主食 + 涮肉 + 涮菜",
    items: [
      { foodId: "rice-noodle-cooked", grams: 250, role: "主食" }, // 米线
      { foodId: "shuizhuroupian", grams: 150, role: "主菜" }, // 水煮肉片
      { foodId: "suanrong-xilanhua", grams: 200, role: "主菜" }, // 蒜蓉西兰花
    ],
  },
  {
    key: "丰盛",
    label: "丰盛",
    description: "三到四道菜，荤素汤都有，适合聚餐或犒劳自己",
    items: [
      { foodId: "rice-cooked", grams: 200, role: "主食" },
      { foodId: "hongshaoyu", grams: 150, role: "主菜" }, // 红烧鱼
      { foodId: "jingjiangrousi", grams: 150, role: "主菜" }, // 京酱肉丝
      { foodId: "hongshao-doufu", grams: 200, role: "主菜" }, // 红烧豆腐
      { foodId: "fanqie-dan-tang", grams: 300, role: "汤" },
    ],
  },
];

/** 所有预设引用到的 foodId 集合（供闸门 / 单测复用） */
export function mealPresetFoodIds(): string[] {
  return [...new Set(MEAL_PRESETS.flatMap((p) => p.items.map((i) => i.foodId)))];
}
