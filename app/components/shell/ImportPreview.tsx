"use client";

import { useState } from "react";
import type { BackupDetail, ImportMode } from "@/lib/storage/backup";

/**
 * 导入预览面板 —— 替掉原来的嵌套 `window.confirm`。
 *
 * 为什么非换不可：原来的确认是
 * `confirm("点确定=覆盖…") ? 覆盖 : confirm("要合并吗…") ? 合并 : 放弃`，
 * 三次点击、按钮上只有「确定/取消」，而**「覆盖」是整份替换的破坏性操作**：
 * 没有快照、没有撤销，误点一次数据就没了。
 *
 * 这个面板把三件事同时摆在用户面前：
 *  1) **这份备份里到底有什么**（每一类几项，而不是一句拼起来的话）；
 *  2) **两个按钮各自会发生什么**（写在按钮上，不写在弹窗正文里）；
 *  3) **覆盖要再点一次**（就地二次确认，不用 `window.confirm` —— 那样又回到原点了）。
 *
 * ⚠️ 用 `data-yq="import-preview"` 给冒烟一个稳定钩子，不靠文案定位（地雷 24）。
 */
export function ImportPreview({
  detail,
  onCancel,
  onConfirm,
}: {
  detail: Extract<BackupDetail, { ok: true }>;
  onCancel: () => void;
  onConfirm: (mode: ImportMode) => void;
}) {
  const [confirmingOverwrite, setConfirmingOverwrite] = useState(false);

  return (
    <div
      data-yq="import-preview"
      style={{
        border: "1px solid var(--yq-line-strong)",
        borderRadius: "var(--yq-r-md)",
        padding: 12,
        marginTop: 10,
        background: "var(--yq-surface)",
      }}
    >
      <p className="yq-label" style={{ marginBottom: 8 }}>
        这份备份里有
      </p>
      <ul style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 13, lineHeight: 1.9 }}>
        {detail.groups.map((g) => (
          <li key={g.label}>
            {g.label}
            {g.count > 1 ? ` · ${g.count} 条` : ""}
          </li>
        ))}
      </ul>

      <p className="yq-hint">导出时间：{fmtTime(detail.exportedAt)}</p>
      {detail.includesApiKey && (
        <p className="yq-hint" style={{ color: "var(--yq-accent-ink)" }}>
          ⚠ 这份备份里含 AI Key —— 如果是别人给你的，导入后建议换掉。
        </p>
      )}
      {detail.legacy && (
        <p className="yq-hint">来自更早的版本，可以直接用。</p>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        <button className="yq-btn yq-btn-sm yq-btn-primary" onClick={() => onConfirm("merge")}>
          合并导入（只补本地没有的）
        </button>
        {!confirmingOverwrite ? (
          <button
            className="yq-btn yq-btn-sm yq-btn-danger"
            onClick={() => setConfirmingOverwrite(true)}
          >
            整份覆盖（替换现在全部数据）
          </button>
        ) : (
          <>
            <button
              className="yq-btn yq-btn-sm yq-btn-danger"
              onClick={() => onConfirm("overwrite")}
            >
              确认覆盖，全部替换
            </button>
            <button className="yq-btn yq-btn-sm" onClick={() => setConfirmingOverwrite(false)}>
              再想想
            </button>
          </>
        )}
        <button className="yq-btn yq-btn-sm yq-btn-ghost" onClick={onCancel}>
          取消
        </button>
      </div>

      {confirmingOverwrite && (
        <p className="yq-hint" style={{ marginTop: 8, color: "var(--yq-danger)" }}>
          覆盖会先给你存一份快照 —— 导入完如果发现不对，可以在下面点「撤销这次导入」。
        </p>
      )}
    </div>
  );
}

/** `exportedAt` 是 ISO 串；缺失或读不出来时如实说，不显示一个假的日期 */
function fmtTime(iso: string | null): string {
  if (!iso) return "这份备份没写导出时间";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "导出时间读不出来";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
