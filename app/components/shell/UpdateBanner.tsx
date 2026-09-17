"use client";

import { useEffect, useState } from "react";
import { dismiss, loadDismissed } from "@/lib/prefs";
import { KEYS } from "@/lib/storage/keys";

const CACHE_PREFIX = "yuanqi-v";

/**
 * 版本更新横幅。
 *
 * 为什么需要它：iOS 主屏 App 会被长期挂起，SW 更新了但页面还是旧的。
 * 这里的做法是 —— 检测到新版本后提示用户，用户点了才刷新，
 * 且刷新前先清掉 **Cache Storage**（注意：不是 localStorage）。
 *
 * ⚠️ 用户数据在 localStorage，清 Cache Storage 与它无关，不会丢数据。
 * 这套机制曾经因为"看似多余"被删过，删了以后 iOS 上就再也看不到新版，所以别简化。
 */
export function UpdateBanner() {
  const [show, setShow] = useState(false);
  const [version, setVersion] = useState("");

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    if (loadDismissed(KEYS.updateBannerDismissed)) return;

    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "SW_UPDATED") {
        setVersion(typeof e.data.version === "string" ? e.data.version : "");
        setShow(true);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  /** 清 Cache Storage 后带时间戳重进 —— 时间戳是为了绕过 HTTP 缓存拿到真正的新文档 */
  async function forceRefresh() {
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => caches.delete(k)));
      }
      const reg = await navigator.serviceWorker.getRegistration();
      await reg?.update();
    } catch {
      /* 清缓存失败也照样刷新 */
    }
    const url = new URL(window.location.href);
    url.searchParams.set("_v", String(Date.now()));
    window.location.replace(url.toString());
  }

  if (!show) return null;

  return (
    <div
      style={{
        background: "var(--yq-primary-soft)",
        color: "var(--yq-primary-ink)",
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontSize: 13,
      }}
    >
      <span style={{ flex: 1 }}>
        发现新版本{version ? ` v${version}` : ""}，刷新即可用上
      </span>
      <button className="yq-btn yq-btn-sm yq-btn-primary" onClick={forceRefresh}>
        立即更新
      </button>
      <button
        className="yq-btn yq-btn-sm yq-btn-ghost"
        onClick={() => {
          dismiss(KEYS.updateBannerDismissed);
          setShow(false);
        }}
      >
        稍后
      </button>
    </div>
  );
}
