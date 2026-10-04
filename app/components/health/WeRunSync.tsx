"use client";

import { useEffect, useRef, useState } from "react";
import { readWeRun, WERUN_API_URL, WERUN_MINIPROGRAM_NAME, type WeRunSnapshot } from "@/lib/werun";
import { applyWeRunSteps, forgetWeRunToken, loadWeRunToken, previewWeRunSteps, saveWeRunToken } from "@/lib/storage/werun";

import type { DailyCheckin } from "@/lib/types";

/** 批量同步全部返回日期；父组件按日期提供 key，切换上下文会丢弃未确认的预览。 */
export function WeRunSync({ onApply }: { onApply: (days: DailyCheckin[]) => void }) {
  const [token, setToken] = useState(loadWeRunToken);
  const [draft, setDraft] = useState("");
  const [snapshot, setSnapshot] = useState<WeRunSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  if (!WERUN_API_URL) return null;
  const rows = snapshot ? previewWeRunSteps(snapshot) : [];

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
      if (!result.days.length) setMessage("没有微信步数记录，未修改账本。");
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
      {rows.length > 0 && <div style={{ marginTop: 12 }}>
        <p style={{ fontSize: 14, fontWeight: 600 }}>批量同步 {rows.length} 天的步数</p>
        <p className="yq-hint" style={{ marginTop: 4 }}>
          {rows[0].date} 至 {rows[rows.length - 1].date}，包含微信返回的全部日期，不受上方所选日期限制。
          喝水、睡眠、心情和未返回的日期保持原样。
        </p>
        <table aria-label="微信步数批量预览" style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", marginTop: 8 }}>
          <thead><tr>
            <th scope="col" style={{ textAlign: "left", padding: "8px 0" }}>日期</th>
            <th scope="col" style={{ textAlign: "right", padding: "8px 4px" }}>当前步数</th>
            <th scope="col" style={{ textAlign: "right", padding: "8px 0" }}>微信步数</th>
          </tr></thead>
          <tbody>{[...rows].reverse().map((row) => <tr key={row.date} style={{ borderTop: "1px solid var(--yq-line)" }}>
            <th scope="row" style={{ textAlign: "left", fontWeight: 400, padding: "8px 0" }}>{row.date}</th>
            <td className="yq-num" style={{ textAlign: "right", padding: "8px 4px" }}>{row.previousSteps ?? "未记录"}</td>
            <td className="yq-num" style={{ textAlign: "right", padding: "8px 0" }}>{row.steps}</td>
          </tr>)}</tbody>
        </table>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <button className="yq-btn yq-btn-primary" style={{ minHeight: 44 }} disabled={busy} onClick={() => {
            if (!snapshot) return;
            try {
              const updated = applyWeRunSteps(snapshot);
              onApply(updated);
              setSnapshot(null);
              setMessage(`已同步 ${updated.length} 天的步数，喝水、睡眠和心情保持原样。`);
            } catch (error) {
              setMessage(error instanceof Error ? error.message : "同步失败，请重试");
            }
          }}>确认替换 {rows.length} 天的步数</button>
          <button className="yq-btn" style={{ minHeight: 44 }} disabled={busy} onClick={() => {
            setSnapshot(null); setMessage("已取消预览，未修改账本。");
          }}>取消预览</button>
        </div>
      </div>}
      <p className="yq-hint" role="status" aria-live="polite" style={{ marginTop: 6 }}>{message}</p>
    </details>
  );
}
