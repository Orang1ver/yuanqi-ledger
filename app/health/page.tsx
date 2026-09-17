import { CheckinCard } from "../components/health/CheckinCard";
import { ExerciseCard } from "../components/health/ExerciseCard";
import { HealthProfileCard } from "../components/health/HealthProfileCard";
import { WeightCard } from "../components/health/WeightCard";
import { BadgeWall } from "../components/health/BadgeWall";
import { BottomNav, PageHeader } from "../components/shell/BottomNav";
import { SettingsButton } from "../components/shell/SettingsButton";

/**
 * 健康小屋。
 *
 * 页面本身是服务端组件、只做编排 —— 每张卡自管状态。
 * 状态全堆在页面里的话，这个文件会长到七八百行、十几个 useState，改一处要通读全场，
 * 所以新版的硬规矩是：**页面不放业务 state**。
 */
export default function HealthPage() {
  return (
    <>
      <main className="yq-shell" style={{ flex: 1, paddingBottom: 20 }}>
        <PageHeader title="健康小屋" subtitle="档案 · 打卡 · 体重 · 运动" action={<SettingsButton />} />

        <HealthProfileCard />
        <CheckinCard />
        <BadgeWall />
        <WeightCard />
        <ExerciseCard />
      </main>
      <BottomNav />
    </>
  );
}
