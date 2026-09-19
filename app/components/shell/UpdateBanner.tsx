"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deferVersion, loadDeferredVersion } from "@/lib/prefs";
import {
  apkDownloadUrl,
  checkBase,
  fetchRemoteVersion,
  isNativeShell,
  isNewer,
  type RemoteVersion,
} from "@/lib/update";

const CACHE_PREFIX = "yuanqi-v";
const CURRENT = process.env.NEXT_PUBLIC_APP_VERSION ?? "";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

/**
 * 版本更新横幅。
 *
 * **两种运行环境，两条更新路** —— 这是这个组件最要紧的一件事：
 *
 * - **网页版**：资源在服务器上，清掉 Cache Storage 再进一次就有新版。
 * - **安卓壳**：资源是**打包进 APK** 的，刷新一万次也还是这一版；
 *   唯一的办法是**下载新的安装包**（安卓不允许一个 App 给自己静默升级）。
 *   所以壳里点的是「下载新版」，走系统浏览器去装。
 *
 * 触发检查的时机（三个都要，缺一个就会"挂着不管就永远收不到"）：
 *  1) 打开时；2) 从后台回到前台（`visibilitychange`）；3) 网络恢复（`online`）。
 *
 * ⚠️ 别把它简化掉：这套机制曾经因为"看似多余"被删过，删了以后 iOS 主屏 App
 * 就再也看不到新版 —— 主屏 App 会被长期挂起，页面不会自己重新加载。
 *
 * ⚠️ 用户数据在 **localStorage**，这里清的是 **Cache Storage**，两者无关，不会丢数据。
 * ⚠️ 「稍后」只对**这一个版本**闭嘴（记的是版本号，不是一个布尔）——
 * 记布尔会让"稍后"变成一次性买断，以后任何新版本都不再提示。
 */
export function UpdateBanner() {
  const [remote, setRemote] = useState<RemoteVersion | null>(null);
  const [swVersion, setSwVersion] = useState("");
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState("");
  /** 一个版本的提示只处理一次，免得每次回前台都重新弹 */
  const handled = useRef("");

  const native = typeof window !== "undefined" && isNativeShell();

  /** 清 Cache Storage 后带时间戳重进 —— 时间戳是为了绕过 HTTP 缓存拿到真正的新文档 */
  const forceRefresh = useCallback(async () => {
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
  }, []);

  /** 壳里：把安装包交给系统浏览器去下（安卓不许 App 自己装自己） */
  const downloadApk = useCallback(async (url: string) => {
    try {
      // 只有壳里会走到这儿，所以动态 import —— 网页版的包里不必带 Capacitor 的插件代码
      const mod = await import("@capacitor/browser");
      await mod.Browser.open({ url });
      return;
    } catch {
      /* 插件不在（网页版 / 没同步）→ 退回普通打开 */
    }
    window.open(url, "_blank", "noopener");
    setNote("浏览器没弹出来的话，用旁边的「复制地址」自己下载");
  }, []);

  const copyUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setNote("复制不了（浏览器不给权限），手动选中上面的地址吧");
    }
  }, []);

  /** 检查一次：和远端比版本号（两种环境都做，这是壳里唯一的更新线索） */
  const check = useCallback(async () => {
    if (process.env.NODE_ENV !== "production") return;
    const info = await fetchRemoteVersion(checkBase(native, BASE_PATH));
    if (!info || !isNewer(info.version, CURRENT)) return;
    if (loadDeferredVersion(CURRENT) === info.version) return; // 这个版本用户说过「稍后」
    if (handled.current === info.version) return;
    handled.current = info.version;
    setRemote(info);
    setShown(true);
  }, [native]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV !== "production") return;

    void check();

    const onWake = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
    };
  }, [check]);

  // SW 广播：只有网页版有意义 —— 壳里资源是本地的，它报"有新版本"是误报
  useEffect(() => {
    if (typeof window === "undefined" || native) return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== "SW_UPDATED") return;
      const v = typeof e.data.version === "string" ? e.data.version : "";
      if (v && loadDeferredVersion(CURRENT) === v) return;
      setSwVersion(v);
      setShown(true);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [native]);

  if (!shown) return null;

  const version = remote?.version ?? swVersion;
  const base = checkBase(native, BASE_PATH);
  const apkUrl = remote?.apk ? apkDownloadUrl(base, remote.apk) : "";
  const canDownload = native && Boolean(apkUrl);

  /** 「稍后」= 只对**这个版本**闭嘴，出下一个版本照样提示 */
  function later() {
    if (version) deferVersion(version);
    setShown(false);
    setNote("");
    setCopied(false);
  }

  return (
    <div
      data-yq="update-banner"
      style={{
        background: "var(--yq-primary-soft)",
        color: "var(--yq-primary-ink)",
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        fontSize: 13,
      }}
    >
      <span style={{ flex: 1, minWidth: 150 }}>
        {canDownload
          ? `有新版本${version ? ` v${version}` : ""}，下载新的安装包就能用上`
          : `发现新版本${version ? ` v${version}` : ""}，刷新即可用上`}
      </span>

      {canDownload ? (
        <>
          <button
            className="yq-btn yq-btn-sm yq-btn-primary"
            data-yq="update-download"
            onClick={() => void downloadApk(apkUrl)}
          >
            下载新版
          </button>
          <button
            className="yq-btn yq-btn-sm yq-btn-ghost"
            data-yq="update-copy"
            onClick={() => void copyUrl(apkUrl)}
          >
            {copied ? "已复制" : "复制地址"}
          </button>
        </>
      ) : (
        <button
          className="yq-btn yq-btn-sm yq-btn-primary"
          data-yq="update-reload"
          onClick={() => void forceRefresh()}
        >
          立即更新
        </button>
      )}

      <button className="yq-btn yq-btn-sm yq-btn-ghost" data-yq="update-later" onClick={later}>
        稍后
      </button>

      {canDownload && (
        <p className="yq-hint" style={{ flexBasis: "100%", margin: 0 }}>
          {note || "会跳到浏览器下载安装包，点开装一次就行 —— 记录不会丢。"}
        </p>
      )}
    </div>
  );
}
