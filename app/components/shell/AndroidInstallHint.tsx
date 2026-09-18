"use client";

import { useEffect, useState } from "react";
import { dismiss, loadDismissed } from "@/lib/prefs";
import { KEYS } from "@/lib/storage/keys";

/**
 * `beforeinstallprompt` 不在 lib.dom 的类型里，得自己声明。
 * 它只在**浏览器认为这个站点可安装**时才触发（有 manifest、有 Service Worker、HTTPS）。
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * 安卓「装到桌面」提示。
 *
 * 为什么需要它：**Chrome 从 76 起不再自动弹安装提示了**（mini-infobar 已被移除）。
 * `beforeinstallprompt` 虽然还会触发，但它**自己不显示任何 UI** ——
 * 只给你一个 `prompt()` 的能力。也就是说「什么时候问、怎么问」得应用自己做，
 * **不做就等于没有**：用户只看到一个地址栏，根本不知道这东西能装到桌面。
 * （这也是 `IOSInstallHint` 注释里那句「Android 会自己弹」过期的地方。）
 *
 * 与 iOS 那个的分工：iOS 没有任何编程接口，只能教用户手动「添加到主屏」；
 * 安卓这边是真的能调起系统安装流程的，按钮点下去就进系统弹窗。
 *
 * ⚠️ `preventDefault()` 是**必须**的：拦下来我们才有机会自己问一句。
 *    不拦的话浏览器什么都不会做（它已经不自已弹了），这个组件等于白写。
 */
export function AndroidInstallHint() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (loadDismissed(KEYS.androidInstallHintDismissed)) return;

    // 已经装在桌面上了就不再提 —— 与 IOSInstallHint 同一个判据。
    // 只能在 effect 里判断：读的是外部环境，服务端读不到，放进惰性初始化会造成 hydration 不一致。
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    // 装好了（或从别处装好了）就收起来
    const onInstalled = () => setDeferred(null);

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!deferred) return null;

  return (
    <div
      /* 冒烟靠它定位 —— 不靠按钮文案（地雷 24） */
      data-yq="android-install-hint"
      style={{
        background: "var(--yq-accent-soft)",
        color: "var(--yq-accent-ink)",
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <span style={{ flex: 1 }}>装到桌面，以后点图标就能记 —— 不用每次开浏览器找。</span>
      <button
        className="yq-btn yq-btn-sm yq-btn-primary"
        onClick={() => {
          const ev = deferred;
          // 先收起来：这次 prompt 只能用一次，用过就作废
          setDeferred(null);
          void ev.prompt();
          void ev.userChoice.catch(() => null);
        }}
      >
        安装
      </button>
      <button
        className="yq-btn yq-btn-sm yq-btn-ghost"
        style={{ color: "var(--yq-accent-ink)" }}
        onClick={() => {
          dismiss(KEYS.androidInstallHintDismissed);
          setDeferred(null);
        }}
      >
        不用了
      </button>
    </div>
  );
}
