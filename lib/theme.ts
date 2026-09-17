/**
 * 主题：跟随系统 / 浅色 / 深色。
 *
 * 实现要点（这些细节都是踩过坑才定下来的，改之前先想清楚）：
 * - 用 `<html data-theme="light|dark">` 而**不是**媒体查询决定最终主题：
 *   媒体查询表达不了"用户手动选了浅色，但系统是深色"这件事。
 *   token 集中在 globals.css 的两块（`:root` / `:root[data-theme="dark"]`），
 *   组件里只写 `var(--yq-*)` —— 换主题不动任何组件代码。
 * - **首帧不能闪**：真正负责"第一笔绘制前把属性贴上"的是 app/layout.tsx 里的内联脚本
 *   （同步执行、不依赖 React）。这里的 applyTheme 负责运行期切换与系统主题变化。
 * - `color-scheme` 也跟着切（见 globals.css），原生控件与滚动条才会跟着变深。
 */

import { loadPrefs, savePrefs, type ThemeChoice } from "./prefs";

export type { ThemeChoice };

export const THEME_OPTIONS: { key: ThemeChoice; label: string; hint: string }[] = [
  { key: "system", label: "跟随系统", hint: "跟着手机的深色/浅色设置走" },
  { key: "light", label: "浅色", hint: "宣纸白主题" },
  { key: "dark", label: "深色", hint: "墨绿夜间主题" },
];

/**
 * 主题色（浏览器地址栏 / PWA 顶栏）。
 * ⚠️ 必须与 globals.css 里的 `--yq-bg` 保持一致 —— 不同步就会出现"顶栏比页面更深/更浅"的错位。
 */
export const THEME_COLOR: Record<"light" | "dark", string> = {
  light: "#F7F5EF",
  dark: "#121815",
};

export function isThemeChoice(v: unknown): v is ThemeChoice {
  return v === "system" || v === "light" || v === "dark";
}

/** 系统当前偏好（SSR 时按浅色处理） */
export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice === "system") return systemPrefersDark() ? "dark" : "light";
  return choice;
}

/** 把主题贴到 `<html data-theme>` 并同步顶栏颜色 */
export function applyTheme(choice: ThemeChoice): "light" | "dark" {
  const resolved = resolveTheme(choice);
  if (typeof document === "undefined") return resolved;
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[resolved]);
  return resolved;
}

/** 读取用户选择（存在 recipe.prefs.v1 里，与「我的杯子」同一份偏好） */
export function loadThemeChoice(): ThemeChoice {
  const t = loadPrefs().theme;
  return isThemeChoice(t) ? t : "system";
}

/** 保存并立刻生效 */
export function saveThemeChoice(choice: ThemeChoice): ThemeChoice {
  const saved = savePrefs({ theme: choice }).theme;
  const next = isThemeChoice(saved) ? saved : "system";
  applyTheme(next);
  return next;
}
