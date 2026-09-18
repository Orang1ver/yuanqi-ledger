/**
 * 跨组件**必须一致**的那几处文案。
 *
 * ⚠️ 这里**刻意不是**一份"全部界面文案表"。探索过一轮，结论是那样做不划算：
 * `app/` 下的组件里有几百条界面文案，全抽出来会得到一个几百行的文件 + 几百处改动，
 * 而**对用户没有可见的收益** —— 反而让每个组件离自己的文案更远，
 * 与 AGENTS 地雷 7「页面要一眼读完」的方向相反。
 *
 * 只有下面这些值得集中，因为**它们一旦不一致就是错的**：
 *
 *  1) `PAGE_ROUTES` / `PAGE_LABELS`：同一个页面在导航、页头、提示语里必须叫同一个名字。
 *     之前导航叫「菜单」、页头叫「菜单库」，而提示语让用户「去「菜单」关联一下」——
 *     他照着去找一个叫「菜单库」的页面。名字取自**页头那个更完整的**。
 *  2) `DISCLAIMER`：免责声明，法律意义上的表述，不该有几个版本。
 *  3) `HEALTHY_RANGE_NOTE`：健康体重区间是**参考**、不是给用户定的目标 ——
 *     这句话写歪了就等于在替他做决定。
 *
 * ⚠️ 这个文件保证不了"全站文案风格统一"，它只保证上面三件事各只有一个版本。
 */

/** 页面标识 */
export type PageKey = "today" | "diet" | "health" | "takeout" | "weekly";

/**
 * 各页面的显示名。
 *
 * ⚠️ 页面名与路由放在一份表里，是因为"加了一个页面却忘了给它名字"这件事
 * 只能在这里被发现 —— 单测会盯着它。
 */
export const PAGE_LABELS: Record<PageKey, string> = {
  today: "今天",
  diet: "饮食",
  health: "健康",
  takeout: "菜单库",
  weekly: "周报",
};

/** 底部导航的项。`icon` 是纯字符，不引图标库 */
export const PAGE_ROUTES: { href: string; key: PageKey; icon: string }[] = [
  { href: "/", key: "today", icon: "◉" },
  { href: "/diet/", key: "diet", icon: "◈" },
  { href: "/health/", key: "health", icon: "♥" },
  { href: "/takeout/", key: "takeout", icon: "▤" },
  { href: "/weekly/", key: "weekly", icon: "▦" },
];

/** 全站免责声明。写的是这个应用**能**给什么、**不能**给什么 */
export const DISCLAIMER = "数字都是估算与参考，不构成医学建议。身体有异常请找医生。";

/**
 * 健康体重区间的性质说明。
 *
 * ⚠️ 纯文本，**不要在这里写 Markdown 的 `**加粗**`** —— 它会被 JSX 原样显示成星号。
 * 这条注释不是多余的：这一段原来就带着 `**参考区间**` 印在周报页上，用户看到的是星号。
 */
export const HEALTHY_RANGE_NOTE =
  "这只是按 BMI 18.5~23.9 算的参考区间，不是给你定的目标 —— 该增该减看你自己。";
