import { CheckinCard } from "./components/health/CheckinCard";
import { ExerciseCard } from "./components/health/ExerciseCard";
import { WeightCard } from "./components/health/WeightCard";
import { DataOverview } from "./components/today/DataOverview";
import { WhatToEatCard } from "./components/today/WhatToEatCard";
import { BottomNav, PageHeader } from "./components/shell/BottomNav";
import { SettingsButton } from "./components/shell/SettingsButton";
import { todayISO, WEEKDAY_LABELS, weekdayIndex } from "@/lib/date";

/**
 * 首页 = 今天。
 *
 * 页面只做**编排**：摆卡片、给标题，自己不持有任何业务 state。
 * 每张卡自管状态（见各卡组件顶部的说明）—— 这条纪律是为了避免页面膨胀
 * （状态一旦全堆在页面里，一个文件能压进十几个 useState，改一处要通读几百行）。
 */
export default function TodayPage() {
  const today = todayISO();

  return (
    <>
      <main className="yq-shell" style={{ flex: 1, paddingBottom: 20 }}>
        <PageHeader
          title="今天"
          subtitle={`${today} ${WEEKDAY_LABELS[weekdayIndex(today)]}`}
          action={<SettingsButton />}
        />

        <WhatToEatCard />
        <CheckinCard />
        <WeightCard />
        <ExerciseCard compact />
        <DataOverview />
      </main>
      <BottomNav />
    </>
  );
}
