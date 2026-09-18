"use client";

import { useState } from "react";
import {
  analyzeFeedback,
  buildIssueText,
  ISSUE_URL,
  type FeedbackContext,
  type FeedbackVerdict,
} from "@/lib/ai/feedback";
import { loadApiKeys } from "@/lib/prefs";

/**
 * 每条记录旁边的「这个数不对？」。
 *
 * 三步，按顺序发生：
 *  1) 用户写一句质疑（**不填表** —— 让他用自己的话说）；
 *  2) 有 Key 就交给模型**归因**：这个数能不能用已有信息解释清楚（模型不产生任何数字）；
 *  3) 解释不了时，给一段**能直接贴到 GitHub issue 的文本**。
 *
 * ⚠️ **没有服务端，所以没有"上传反馈"这条路。** 能做的只是把上下文整理成人能贴的一段话，
 * 由用户自己发过去。与其放一个假装能上传的按钮，不如把这段文本写清楚。
 *
 * ⚠️ **没填 Key 时入口照样在**：直接跳到第 3 步（本地就能拼出反馈文本）。
 * 少了这条路，没配 Key 的用户连"这个数不对"都说不出来。
 */
export function EntryFeedback({ ctx }: { ctx: FeedbackContext }) {
  const [open, setOpen] = useState(false);
  const [doubt, setDoubt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FeedbackVerdict | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const hasKey = () => Boolean(loadApiKeys().deepseekKey?.trim());

  async function submit() {
    const text = doubt.trim();
    if (!text) return;
    setError("");
    setResult(null);
    setCopied(false);

    // 没 Key 就直接给反馈文本 —— 不拦着，也不假装分析了
    if (!hasKey()) {
      setResult({
        verdict: "unexplained",
        explanation: "没填 DeepSeek Key，所以这次没法自动分析。下面这段可以贴给开发者。",
        issueText: `用户觉得这一笔不对：${text}`,
      });
      return;
    }

    setBusy(true);
    try {
      setResult(await analyzeFeedback(ctx, text, loadApiKeys().deepseekKey!));
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析失败");
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError("复制不了（浏览器不给权限）。手动选中下面那段吧。");
    }
  }

  if (!open) {
    return (
      <button
        className="yq-btn yq-btn-sm yq-btn-ghost"
        data-yq="entry-doubt"
        onClick={() => setOpen(true)}
      >
        这个数不对？
      </button>
    );
  }

  return (
    <div
      data-yq="entry-feedback"
      style={{
        marginTop: 8,
        padding: 10,
        border: "1px solid var(--yq-line-strong)",
        borderRadius: "var(--yq-r-md)",
      }}
    >
      <p className="yq-hint" style={{ marginBottom: 6 }}>
        觉得哪里不对？用你自己的话说一句就行（比如「15 个饺子不该这么多钠」）。
      </p>
      <textarea
        className="yq-input"
        aria-label="你觉得哪里不对"
        rows={2}
        value={doubt}
        onChange={(e) => setDoubt(e.target.value)}
        style={{ width: "100%", resize: "vertical" }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button
          className="yq-btn yq-btn-sm yq-btn-primary"
          disabled={busy || !doubt.trim()}
          onClick={() => void submit()}
        >
          {busy ? "分析中…" : hasKey() ? "让它分析一下" : "生成反馈文本"}
        </button>
        <button
          className="yq-btn yq-btn-sm yq-btn-ghost"
          onClick={() => {
            setOpen(false);
            setDoubt("");
            setResult(null);
            setError("");
          }}
        >
          收起
        </button>
      </div>

      {error && (
        <p className="yq-hint" style={{ marginTop: 8, color: "var(--yq-danger)" }}>
          {error}
        </p>
      )}

      {result?.verdict === "explained" && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 13, lineHeight: 1.7 }}>{result.explanation}</p>
          {result.suggestTier && (
            <p className="yq-hint" style={{ marginTop: 4 }}>
              上面那一条的档位可以改成「{result.suggestTier}」试试。
            </p>
          )}
        </div>
      )}

      {result?.verdict === "unexplained" && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 13, lineHeight: 1.7 }}>{result.explanation}</p>
          <p className="yq-label" style={{ marginTop: 10, marginBottom: 6 }}>
            这段可以直接贴给开发者
          </p>
          <pre
            className="yq-hint"
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              background: "var(--yq-bg)",
              padding: 10,
              borderRadius: "var(--yq-r-sm)",
              fontSize: 12,
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            {buildIssueText(ctx, doubt, result.explanation)}
          </pre>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button
              className="yq-btn yq-btn-sm"
              onClick={() => void copy(buildIssueText(ctx, doubt, result.explanation))}
            >
              {copied ? "已复制" : "复制这段"}
            </button>
            <a className="yq-btn yq-btn-sm" href={ISSUE_URL} target="_blank" rel="noreferrer">
              去 GitHub 提（新标签打开）
            </a>
          </div>
          <p className="yq-hint" style={{ marginTop: 6 }}>
            ⚠️ 这段只包含<b>这一笔</b>的信息，不含你的健康档案和其它记录。
          </p>
        </div>
      )}
    </div>
  );
}
