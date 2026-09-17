"use client";

import { useEffect } from "react";
import { seedDefaultIngredientsIfEmpty } from "@/lib/storage/meals";
import { seedTakeoutMockIfEmpty } from "@/lib/storage/takeout";
import { applyTheme, loadThemeChoice, resolveTheme } from "@/lib/theme";

/**
 * 应用启动时的一次性初始化：
 * 1) 首次运行播种菜单库与常用食材（两者都是"只在从未播过种时"才写，见 takeout.ts 的注释）
 * 2) 注册 Service Worker（更新链路见 ./UpdateBanner.tsx 与 public/sw.js）
 * 3) 跟随系统主题变化：用户选「跟随系统」时，系统切换要实时生效
 *
 * 渲染 null —— 它只跑副作用，不参与界面。
 */
export function AppInit() {
  useEffect(() => {
    seedTakeoutMockIfEmpty();
    seedDefaultIngredientsIfEmpty();
  }, []);

  useEffect(() => {
    // 注册 SW。开发环境（localhost dev server 没有构建产物）跳过。
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
    navigator.serviceWorker
      .register(`${base}/sw.js`, { scope: `${base}/`, updateViaCache: "none" })
      .then((reg) => {
        reg.update().catch(() => {});
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // 跟随系统：用户没手动定主题时，系统切换要跟着变
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const choice = loadThemeChoice();
      if (choice === "system") applyTheme(choice);
    };
    mq.addEventListener("change", onChange);
    // 兜底：DOM 已经就绪但属性还没贴上（比如从 bfcache 恢复）
    if (!document.documentElement.dataset.theme) {
      document.documentElement.dataset.theme = resolveTheme(loadThemeChoice());
    }
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return null;
}
