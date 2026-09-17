"use client";

/**
 * 某一天的四张分析卡。
 *
 * 之所以单独成一个组件（而不是铺在 page.tsx 里），是为了让页面能对它用 `key={date}`：
 * 日期一变就整块重挂载，`useDayNutrition` 随之重新初始化。
 * 这比在 effect 里同步 setState（会级联渲染，React 的 lint 规则也会拦）干净得多。
 *
 * 顺带一个好处：「记一笔」那张卡在 key 之外，切日期时**不会**把已经打好的半句话弄丢。
 */

import { AdviceCard } from "./AdviceCard";
import { DietDayList } from "./DietDayList";
import { NutritionOverview } from "./NutritionOverview";
import { QualityScoreCard } from "./QualityScoreCard";
import { useDayNutrition } from "./useDayNutrition";

export function DayPanels({ date }: { date: string }) {
  const { entries, totals, targets, targetsFromProfile } = useDayNutrition(date);

  return (
    <>
      <NutritionOverview totals={totals} targets={targets} targetsFromProfile={targetsFromProfile} />
      <AdviceCard entries={entries} totals={totals} targets={targets} />
      <QualityScoreCard entries={entries} totals={totals} targets={targets} />
      <DietDayList entries={entries} />
    </>
  );
}
