"use client";

import { useState } from "react";
import { WERUN_MINIPROGRAM_NAME, WERUN_MINIPROGRAM_URL } from "@/lib/werun";
import { isNativeShell } from "@/lib/update";

/** 打开助手只影响导航，连接与预览仍由 WeRunSync 管理。 */
export function WeRunMiniProgramEntry() {
  const [message, setMessage] = useState("");
  const [opening, setOpening] = useState(false);

  async function openMiniProgram() {
    if (!WERUN_MINIPROGRAM_URL || opening) return;
    if (!isNativeShell()) {
      // 保持在点击手势内打开，保留当前账本与未确认的预览。
      window.open(WERUN_MINIPROGRAM_URL, "_blank", "noopener,noreferrer");
      setMessage("请在打开的微信页面中进入小程序；未打开时，可复制名称去微信搜索。");
      return;
    }
    setOpening(true);
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: WERUN_MINIPROGRAM_URL });
      setMessage("请在微信页面中进入小程序，同步后返回账本读取。");
    } catch {
      setMessage("暂时无法打开，请复制名称后在微信搜索。");
    } finally {
      setOpening(false);
    }
  }

  async function copyName() {
    try {
      await navigator.clipboard.writeText(WERUN_MINIPROGRAM_NAME);
      setMessage("已复制名称，请打开微信，在搜索中粘贴并进入小程序。");
    } catch {
      setMessage("无法自动复制，请长按上方名称复制，再到微信搜索。");
    }
  }

  return (
    <div style={{ marginTop: 10, padding: 12, border: "1px solid var(--yq-line)", borderRadius: 12 }}>
      <p style={{ fontSize: 14, fontWeight: 600, userSelect: "text" }}>{WERUN_MINIPROGRAM_NAME}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        {WERUN_MINIPROGRAM_URL && <button className="yq-btn yq-btn-primary" style={{ minHeight: 44 }}
          disabled={opening} onClick={openMiniProgram}>{opening ? "打开中…" : "打开步数助手"}</button>}
        <button className={WERUN_MINIPROGRAM_URL ? "yq-btn" : "yq-btn yq-btn-primary"}
          style={{ minHeight: 44 }} onClick={copyName}>复制名称去微信搜索</button>
      </div>
      <p className="yq-hint" style={{ marginTop: 8 }}>
        {WERUN_MINIPROGRAM_URL ? "手机可通过微信页面打开；电脑或无法跳转时，请在微信搜索上方名称。"
          : "打开微信，搜索上方名称，进入小程序同步步数。"}
      </p>
      <p className="yq-hint" role="status" aria-live="polite" style={{ marginTop: 6 }}>{message}</p>
    </div>
  );
}
