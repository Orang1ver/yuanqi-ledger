"use client";

import { useEffect } from "react";
import { checkAndDownloadOta, confirmOtaBoot, refreshOtaState } from "@/lib/ota-runner";
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

  /**
   * OTA 的两件事，顺序不能反：
   *
   * 1) **先确认上次切换成功** —— 能渲染到这儿就说明新版本没白屏，把 `.pending` 删掉，
   *    回滚保险就不会误触发。⚠️ 必须延迟一拍：页面还没画出来就宣布"成功"，
   *    等于把证据自己删了，保险形同虚设。
   * 2) **再检查并下载新版本** —— 只下载、不切换（切换由用户在设置面板里点）。
   *    再晚一点开始：别跟首屏和 SW 注册抢带宽。
   *
   * 这两件事只在**壳里**有意义；浏览器里 `loadNative()` 直接返回 null，安静退出。
   */
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;

    const confirmTimer = window.setTimeout(() => {
      void confirmOtaBoot().then((cleared) => {
        if (cleared) void refreshOtaState();
      });
    }, 1500);

    const checkTimer = window.setTimeout(() => {
      void checkAndDownloadOta();
    }, 5000);

    return () => {
      window.clearTimeout(confirmTimer);
      window.clearTimeout(checkTimer);
    };
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
