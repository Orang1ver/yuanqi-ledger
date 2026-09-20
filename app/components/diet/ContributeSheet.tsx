"use client";

/**
 * 把「我的食物库」里的一条申请进正式库。
 *
 * 三条刻意的设计：
 *
 * 1. **技术真相写在按钮下面，不藏在帮助里。**
 *    `mailto:` 只是打开邮件草稿、GitHub 预填链接也要用户亲手点 Submit ——
 *    不说清的话，用户点完以为发出去了，然后一直等回复。
 *
 * 2. **URL 太长就降级。** 浏览器和 GitHub 对 URL 长度有上限，超了会**静默截断** ——
 *    用户看到的是一个残缺的草稿。所以超限时改成「复制文本 + 打开空白新建页」，
 *    让用户自己粘。宁可多一步，也不要发出去一份缺一半的申请。
 *
 * 3. **隐私提示不省略。** 申请内容本身不含任何个人数据（无饮食记录、无 Key、无照片），
 *    但**收件邮箱会写进公开仓库**，可能被爬虫抓取。这是用户主动提供的地址，
 *    照做，但要让他知道这件事。
 */

import { useState } from "react";
import type { FoodItem } from "@/lib/nutrition/types";
import { CHANGELOG } from "@/lib/changelog";
import {
  buildFoodRequest,
  githubIssueUrl,
  limitFor,
  mailtoUrl,
  urlTooLong,
} from "@/lib/ai/contribute";

/** 收件邮箱。用户本人提供 */
export const CONTRIBUTE_EMAIL = "1843842330@qq.com";

/** 空白新建页 —— URL 超限时的降级目标 */
const BLANK_ISSUE_URL = "https://github.com/Orang1ver/yuanqi-ledger/issues/new";

export function ContributeSheet({
  food,
  verdict,
  energyKj,
  onClose,
}: {
  food: FoodItem;
  /** 校验结论原文（从 FoodPhotoSheet 带过来）。没有就是"未做校验" */
  verdict?: string;
  /** 照片上标的 kJ（有就带上，方便对方复核换算） */
  energyKj?: number;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [portion, setPortion] = useState("");
  const [copied, setCopied] = useState("");

  const req = buildFoodRequest(food, {
    appVersion: CHANGELOG[0]?.version ?? "未知",
    verdict,
    energyKj,
    portion: portion.trim() || undefined,
    note: note.trim() || undefined,
  });

  const ghUrl = githubIssueUrl(req);
  const mailUrl = mailtoUrl(req, CONTRIBUTE_EMAIL);
  const ghTooLong = urlTooLong(ghUrl, limitFor("github"));
  const mailTooLong = urlTooLong(mailUrl, limitFor("mailto"));

  async function copy() {
    try {
      await navigator.clipboard.writeText(req);
      setCopied("已复制。粘到你要发的地方就行。");
    } catch {
      setCopied("这台设备不让自动复制。手动全选下面那段文本复制吧。");
    }
  }

  /** 超限时只打开空白页，让用户自己粘 —— 不打开一个必然会截断的链接 */
  function openGithub() {
    window.open(ghTooLong ? BLANK_ISSUE_URL : ghUrl, "_blank", "noopener,noreferrer");
    if (ghTooLong) setCopied("内容太长，GitHub 的链接装不下。已打开空白新建页 —— 请用上面的「复制完整文本」粘进去。");
  }

  function openMail() {
    window.location.href = mailTooLong ? `mailto:${CONTRIBUTE_EMAIL}` : mailUrl;
    if (mailTooLong) setCopied("内容太长，邮件链接装不下。已打开空白邮件 —— 请用上面的「复制完整文本」粘进去。");
  }

  return (
    <div className="yq-scrim" onClick={onClose}>
      <div className="yq-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="yq-section-title">
          <span>申请进正式库</span>
          <button className="yq-btn yq-btn-sm yq-btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>

        <p className="yq-hint" style={{ marginBottom: 10 }}>
          把「{food.name}」报给开发者，核定后它就会进所有用户的正式库 ——
          以后别人搜这个名字也能直接用。
        </p>

        <label className="yq-label">常见份量（可选，帮你补进份量表）</label>
        <input
          className="yq-input"
          value={portion}
          onChange={(e) => setPortion(e.target.value)}
          placeholder="比如「一瓶 500ml」「一包 70g」"
          style={{ marginBottom: 10 }}
        />

        <label className="yq-label">备注（可选）</label>
        <input
          className="yq-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="比如「这个牌子换包装了，数值和以前不一样」"
          style={{ marginBottom: 12 }}
        />

        <label className="yq-label">会发出去的内容</label>
        <pre
          className="yq-hint"
          style={{
            background: "var(--yq-surface-)",
            border: "1px solid var(--yq-line)",
            borderRadius: 8,
            padding: 10,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            maxHeight: 200,
            overflow: "auto",
            marginBottom: 12,
          }}
        >
          {req}
        </pre>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <button className="yq-btn yq-btn-primary" onClick={openGithub}>
            在 GitHub 上提一个 Issue
          </button>
          <button className="yq-btn" onClick={openMail}>
            发邮件给开发者
          </button>
          <button className="yq-btn yq-btn-ghost" onClick={copy}>
            复制完整文本
          </button>
        </div>

        {copied && (
          <p className="yq-hint" style={{ marginBottom: 10, color: "var(--yq-primary-ink)" }}>
            {copied}
          </p>
        )}

        {/* ---------- 技术真相：不做这步就等于没提交 ---------- */}
        <div
          className="yq-card-flat"
          style={{ borderLeft: "3px solid var(--yq-info)", paddingLeft: 10, marginBottom: 10 }}
        >
          <p className="yq-hint" style={{ marginBottom: 4 }}>
            <strong>点了不会自动发出去</strong>，还需要你补一步：
          </p>
          <ul className="yq-hint" style={{ margin: 0, paddingLeft: 18 }}>
            <li>GitHub：链接只帮你把内容**填好**，得点页面上的 Submit 才算提交。</li>
            <li>邮件：只是帮你**打开草稿**，得自己按发送。</li>
            <li>两条渠道都不能自动带图。如需附图，在打开后的页面里手动拖进去。</li>
          </ul>
        </div>

        {/* ---------- 隐私：邮箱会进公开仓库 ---------- */}
        <p className="yq-hint" style={{ color: "var(--yq-accent-ink)" }}>
          这条申请里只有食物本身、app 版本和校验结论，
          <strong>不含你的饮食记录、Key 或照片</strong>。
          但发到 GitHub 的那份是公开的，**收件邮箱（{CONTRIBUTE_EMAIL}）会显示在上面**，
          可能被爬虫抓走。不想公开就改用「发邮件给开发者」那条。
        </p>
      </div>
    </div>
  );
}
