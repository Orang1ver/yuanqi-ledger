import { TakeoutLibrary } from "../components/takeout/TakeoutLibrary";
import { BottomNav, PageHeader } from "../components/shell/BottomNav";
import { SettingsButton } from "../components/shell/SettingsButton";

/**
 * 菜单库页面。
 *
 * 页面只做编排，逻辑都在 TakeoutLibrary 里 —— 保持这个习惯，
 * 页面文件应该永远是一眼能读完的长度。
 */
export default function TakeoutPage() {
  return (
    <>
      <main className="yq-shell" style={{ flex: 1, paddingBottom: 20 }}>
        <PageHeader title="菜单库" subtitle="你常点的店与菜，推荐的数据底座" action={<SettingsButton />} />
        <TakeoutLibrary />
      </main>
      <BottomNav />
    </>
  );
}
