"use client";

import { useEffect, useRef, useState } from "react";
import { readWeRun, WERUN_API_URL, WERUN_MINIPROGRAM_NAME, type WeRunSnapshot } from "@/lib/werun";
import { forgetWeRunToken, loadWeRunToken, saveWeRunToken } from "@/lib/storage/werun";

/** 由父组件按日期提供 key，切换日期时丢弃旧预览与尚未完成的请求。 */
export function WeRunSync({ date, onApply }: { date: string; onApply: (steps: number) => void }) {
  const [token, setToken] = useState(loadWeRunToken);
  const [draft, setDraft] = useState("");
  const [snapshot, setSnapshot] = useState<WeRunSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  if (!WERUN_API_URL) return null;
  const day = snapshot?.days.find((item) => item.date === date);

  async function refresh() {
    const candidate = token || draft.trim();
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    setBusy(true);
    setMessage("");
    setSnapshot(null);
    try {
      const result = await readWeRun(candidate, controller.signal);
      if (controller.signal.aborted) return;
      saveWeRunToken(candidate);
      setToken(candidate);
      setDraft("");
      setSnapshot(result);
      if (!result.days.some((item) => item.date === date)) setMessage(`${date} 没有微信步数记录，未修改账本。`);
    } catch (error) {
      setMessage(controller.signal.aborted ? "读取已取消或超时，请重试" : error instanceof Error ? error.message : "连接失败，请检查网络");
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  return (
    <details style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontSize: 13 }}>微信步数</summary>
      <p className="yq-hint" style={{ marginTop: 8 }}>
        在微信搜索「{WERUN_MINIPROGRAM_NAME}」并同步，再回这里读取。日期按北京时间显示。
      </p>
      {!token && <>
        <p className="yq-hint">首次使用：复制小程序的连接码并粘贴到下方。连接码可读取步数，请勿分享。</p>
        <input className="yq-input" aria-label="微信步数连接码" type="password" autoComplete="off"
          placeholder="粘贴连接码" value={draft} disabled={busy}
          onChange={(event) => setDraft(event.target.value)} style={{ marginTop: 6 }} />
      </>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        <button className="yq-btn yq-btn-sm" disabled={busy || (!token && !draft.trim())} onClick={refresh}>
          {busy ? "读取中…" : token ? "读取最新步数" : "连接并读取"}
        </button>
        {token && <button className="yq-btn yq-btn-sm" disabled={busy} onClick={() => {
          forgetWeRunToken(); setToken(""); setSnapshot(null);
          setMessage("已移除本机连接。如需让连接码失效，请在小程序撤销连接。");
        }}>移除本机连接</button>}
      </div>
      {snapshot && <p className="yq-hint" style={{ marginTop: 8 }}>
        微信同步时间：{new Date(snapshot.syncedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（北京时间）。
        这里读取的是上次同步结果；更新需先进入小程序。
      </p>}
      {day && <div style={{ marginTop: 8 }}>
        <p style={{ fontSize: 13 }}>{day.date}：{day.steps} 步</p>
        <button className="yq-btn yq-btn-sm yq-btn-primary" onClick={() => {
          onApply(day.steps); setSnapshot(null); setMessage(`已将 ${date} 的步数设为 ${day.steps} 步`);
        }}>替换这一天的步数</button>
      </div>}
      <p className="yq-hint" role="status" aria-live="polite" style={{ marginTop: 6 }}>{message}</p>
    </details>
  );
}
