"use client";

import { useEffect, useState } from "react";
import { dismiss, loadDismissed } from "@/lib/prefs";
import { KEYS } from "@/lib/storage/keys";

/**
 * iOS「添加到主屏」提示。
 *
 * 为什么只对 iOS 显示：iOS Safari 没有任何编程接口，只能教用户手动操作；
 * 安卓那边是真的能调起系统安装流程的，走 `AndroidInstallHint`。
 *
 * ⚠️ 这里原来写着「Android/桌面 Chrome 会自己弹安装提示（beforeinstallprompt）」——
 * **那句已经过期**：Chrome 76 起移除了 mini-infobar，`beforeinstallprompt`
 * 不再自带任何 UI，所以安卓也**必须自己问一句**，否则用户根本不知道能装到桌面。
 *
 * 且**必须用 Safari 打开**——微信内置浏览器、Chrome for iOS 都不支持"添加到主屏"。
 *
 * 已装到主屏时（standalone 模式）不再显示。
 */
export function IOSInstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (loadDismissed(KEYS.iosInstallHintDismissed)) return;

    const ua = window.navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
    // 未安装时 standalone 为 false；从主屏打开才是 true
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    /*
     * 这里必须 setState，而且只能在 effect 里做：
     * 判断依赖 userAgent 与 display-mode，服务端都读不到，
     * 所以不能放进 useState 的惰性初始化（会造成 hydration 不一致）。
     * 这是"读一次外部环境"的正当用法，不是派生状态；
     * lint 规则区分不了，定点豁免。
     */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isIOS && !standalone) setShow(true);
  }, []);

  if (!show) return null;

  return (
    <div
      style={{
        background: "var(--yq-accent-soft)",
        color: "var(--yq-accent-ink)",
        padding: "10px 16px",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <span style={{ flex: 1 }}>
        想装到手机主屏：用 <b>Safari</b> 打开本页 → 点底部「分享」→ 选「添加到主屏幕」。
        微信/Chrome 内置浏览器不支持这一步。
      </span>
      <button
        className="yq-btn yq-btn-sm yq-btn-ghost"
        style={{ color: "var(--yq-accent-ink)" }}
        onClick={() => {
          dismiss(KEYS.iosInstallHintDismissed);
          setShow(false);
        }}
      >
        知道了
      </button>
    </div>
  );
}
