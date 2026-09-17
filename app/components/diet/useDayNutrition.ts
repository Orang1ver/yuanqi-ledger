"use client";

/**
 * 「某一天的饮食」这一个数据的唯一取法。
 *
 * 汇总、建议、质量分三张卡都要「当天记录 + 当天目标」，各读一遍各算一遍的话，
 * 三处迟早会用不同的口径（比如有一处忘了订阅数据变化，用户记完一条只有一张卡更新）。
 * 所以统一走这里。
 *
 * 目标来自健康档案；没有档案时用参考日（2000kcal）并让界面**明确标注是参考值** ——
 * 拿一个参考目标去评判用户今天吃得怎么样，不说清楚就是在误导。
 */

import { useEffect, useMemo, useState } from "react";
import { onDataChanged } from "@/lib/bus";
import { entriesOn } from "@/lib/storage";
import { loadHealthProfile } from "@/lib/storage/health";
import { sumNutrition } from "@/lib/nutrition/core";
import { calcNutritionTargets, referenceTargets } from "@/lib/nutrition/targets";
import type { DietEntry, NutritionTargets, NutritionTotals } from "@/lib/nutrition/types";

export type DayNutrition = {
  entries: DietEntry[];
  totals: NutritionTotals;
  targets: NutritionTargets;
  /** 目标是从健康档案推出来的（false = 用的是参考值，界面必须说明） */
  targetsFromProfile: boolean;
};

export function useDayNutrition(date: string): DayNutrition {
  const [entries, setEntries] = useState<DietEntry[]>(() => entriesOn(date));

  // 别处（导入备份、设置页清空、卡片删记录）动了数据就重新读一次。
  //
  // 注意这里**没有**「日期变了就重取」的 effect —— 那属于"在 effect 里同步 setState"，
  // 会引发级联渲染。日期变化由调用方用 `key={date}` 重挂载来重置，
  // 这也是 React 官方推荐的重置姿势。
  useEffect(() => onDataChanged(() => setEntries(entriesOn(date))), [date]);

  const totals = useMemo(() => sumNutrition(entries), [entries]);

  // 刻意不 memo：loadHealthProfile 每次都返回新对象，依赖它等于每次都重算，
  // 挂一个 useMemo 只会让人误以为这里有缓存。这点计算量不值得骗自己。
  const profile = loadHealthProfile();
  const targets = profile ? calcNutritionTargets(profile) : referenceTargets();

  return { entries, totals, targets, targetsFromProfile: !!profile };
}
