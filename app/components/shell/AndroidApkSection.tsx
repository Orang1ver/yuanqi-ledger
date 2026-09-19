"use client";

import { useEffect, useState } from "react";
import { apkDownloadUrl, checkBase, fetchRemoteVersion, isNativeShell } from "@/lib/update";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** 查到了才渲染 —— 没查到就不给一个点不动的链接 */
type Found = { url: string; version: string };

/**
 * 设置面板里的「安卓安装包」入口（**只在网页版、只在安卓上出现**）。
 *
 * 为什么需要它：应用内更新的「下载新版」按钮只存在于**安卓壳里** ——
 * 可还没装壳的人恰恰看不到它（他看到的永远是网页版的「立即更新」）。
 * 于是"第一次怎么装"这件事在界面上是断的，只能靠用户知道那个 `/apk/...` 地址。
 *
 * 三条边界，都是刻意的：
 *
 * - **壳里不显示**：它自己就是那个包，让用户对着自己下载自己是荒谬的
 *   （壳里的更新走顶部横幅，那边会明说「下载新版」）。
 * - **非安卓不显示**：iPhone 装不了 `.apk`，摆出来不是没帮上忙，是帮倒忙。
 * - **地址从站点上的 `version.json` 读**，不硬编码版本号 ——
 *   硬编码的话发下一版就得记得改代码，忘了就是个 404。
 *
 * ⚠️ 文案里那句「数据是分开的」不是废话，是**最容易踩的坑**：
 * 「装到桌面」（PWA）与浏览器是**同一个存储**，数据无缝；
 * 而 `.apk` 是个**独立的 App**（Origin 是 `https://localhost`），
 * 它的 localStorage 与浏览器里那份**完全是两套**。
 * 不写清楚，用户装完会发现"记录全没了"，而数据其实好好的在浏览器里。
 */
export function AndroidApkSection() {
  const [found, setFound] = useState<Found | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isNativeShell()) return;
    if (!/android/i.test(navigator.userAgent)) return;

    let alive = true;
    void (async () => {
      const base = checkBase(false, BASE_PATH);
      const info = await fetchRemoteVersion(base);
      // 离线 / 没发布过安装包 → 什么都不显示（宁可不说，也不给一个下不动的地址）
      if (!alive || !info?.apk) return;
      setFound({ url: apkDownloadUrl(base, info.apk), version: info.version });
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!found) return null;

  // 提前取出来：闭包里再用 `found.` 就得写非空断言，而那种断言正是以后会被改坏的地方
  const apkUrl = found.url;
  const apkVersion = found.version;

  async function copy() {
    try {
      await navigator.clipboard.writeText(apkUrl);
      setCopied(true);
    } catch {
      /* 复制不了也不阻塞 —— 下面那行地址是可以长按选中的 */
    }
  }

  return (
    <section style={{ marginBottom: 18 }} data-yq="android-apk">
      <p className="yq-label" style={{ marginBottom: 8 }}>
        安卓 App（安装包）
      </p>
      <p className="yq-hint" style={{ marginBottom: 10 }}>
        浏览器里的这份可以「装到桌面」，<b>数据与现在完全相通</b>，一般这样就够了。
        <br />
        安装包（.apk）是<b>另一个独立的 App</b>：点图标就进、离线更顺，
        但 ⚠️ <b>它的数据和浏览器里这份是分开的两套</b> ——
        要搬过去，请先在下面导出一份备份，装好 App 之后再导入。
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          className="yq-btn yq-btn-sm yq-btn-primary"
          data-yq="android-apk-download"
          onClick={() => window.open(apkUrl, "_blank", "noopener")}
        >
          下载 v{apkVersion} 安装包
        </button>
        <button
          className="yq-btn yq-btn-sm yq-btn-ghost"
          data-yq="android-apk-copy"
          onClick={() => void copy()}
        >
          {copied ? "已复制" : "复制链接"}
        </button>
      </div>
      <p className="yq-hint" style={{ marginTop: 6, wordBreak: "break-all" }}>
        {apkUrl}
      </p>
    </section>
  );
}
