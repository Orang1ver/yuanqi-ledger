"use client";

import { useRef, useState } from "react";
import { CUP_PRESETS, clampCupMl, DEFAULT_CUP_ML } from "@/lib/steps";
import { loadApiKeys, loadPrefs, saveApiKeys, savePrefs } from "@/lib/prefs";
import { emitDataChanged } from "@/lib/bus";
import { recentChanges } from "@/lib/changelog";
import { THEME_OPTIONS, loadThemeChoice, saveThemeChoice, type ThemeChoice } from "@/lib/theme";
import {
  clearAllData,
  describeBackupDetail,
  downloadBackup,
  importBackup,
  peekImportUndo,
  undoImport,
  type BackupDetail,
  type ImportMode,
} from "@/lib/storage/backup";
import { describeBackupStatus, shouldRemindBackup } from "@/lib/storage/backupReminder";
import { ImportPreview } from "./ImportPreview";

/**
 * 设置面板。
 *
 * 这里是「数据不丢」的最后一道闸门，所以备份区做得比别处啰嗦：
 * - 导出支持「含 / 不含 AI Key」——分享配置给别人时不该连钥匙一起给
 * - 导入先看「这份备份里有什么」再决定怎么导，两个按钮各自写明后果（见 ImportPreview），
 *   而且「整份覆盖」会先存快照、事后能撤销一次
 * - 清空需要二次确认，且明确告诉用户"先导出再清"
 *
 * ⚠️ 数字输入用**字符串 state**（见 cup 输入框）：用 value={number} + onChange(Number(v)||0)
 * 会导致删不掉、永远留个 0。
 */

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME || "";

/** 选好文件、还没确认之前的那份待导入内容 */
type PendingImport =
  | { kind: "ok"; text: string; detail: Extract<BackupDetail, { ok: true }> }
  | { kind: "bad"; reason: string };

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [prefs, setPrefs] = useState(() => loadPrefs());
  const [theme, setTheme] = useState<ThemeChoice>(() => loadThemeChoice());
  // ⚠️ 字符串 state：数字 state 会导致退格删不掉
  const [cupDraft, setCupDraft] = useState(() => String(loadPrefs().cupMl));
  const [key, setKey] = useState(() => loadApiKeys().deepseekKey ?? "");
  const [keySaved, setKeySaved] = useState(false);

  const [includeKey, setIncludeKey] = useState(false);
  const [msg, setMsg] = useState("");
  /*
   * 备份状态行。这个弹窗是「点了设置才动态 import + 条件渲染」的（见 SettingsButton），
   * 永远不会在 SSR 时渲染，所以惰性初始化里读 localStorage 是安全的 ——
   * 与上面几行 loadPrefs() 同一个理由。
   */
  const [backupStatus, setBackupStatus] = useState(() => ({
    text: describeBackupStatus(),
    remind: shouldRemindBackup(),
  }));
  const [confirmClear, setConfirmClear] = useState(false);
  const [pending, setPending] = useState<PendingImport | null>(null);
  /** 「整份覆盖」之前有没有快照可撤 —— 它决定那个按钮出不出现 */
  const [undoable, setUndoable] = useState(() => peekImportUndo() !== null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 导出 / 导入之后重读一次，否则状态行会停在旧值上，看起来像按钮没生效 */
  const refreshBackupStatus = () => {
    setBackupStatus({ text: describeBackupStatus(), remind: shouldRemindBackup() });
    setUndoable(peekImportUndo() !== null);
  };

  function applyCup(raw: string) {
    setCupDraft(raw);
    const n = Number(raw);
    // 只存合法值；输入过程中（空串、半截数字）不写库，避免把杯子写成 NaN/100
    if (raw.trim() === "" || !Number.isFinite(n)) return;
    setPrefs(savePrefs({ cupMl: clampCupMl(n) }));
    // 喝水卡按「杯」录入时要读杯子容量，改完得广播一声让它换过来
    emitDataChanged();
  }

  function pickCupPreset(ml: number) {
    setCupDraft(String(ml));
    setPrefs(savePrefs({ cupMl: ml }));
    emitDataChanged();
  }

  /**
   * 选完文件先**只读出来、不动任何数据**，交给下面的预览面板。
   *
   * 原来这里直接弹一串 `window.confirm` 问「覆盖还是合并」——
   * 那是在用户**还没看到这份备份里有什么**之前，就让他做一个不可逆的选择。
   */
  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const detail = describeBackupDetail(text);
      setMsg("");
      // 解析不了也进面板 —— 把原因摆出来，比弹一个只有「确定」的框强
      setPending(detail.ok ? { kind: "ok", text, detail } : { kind: "bad", reason: detail.reason });
    };
    reader.readAsText(file);
    // 允许重复选同一个文件
    e.target.value = "";
  }

  function confirmImport(mode: ImportMode) {
    if (!pending || pending.kind !== "ok") return;
    try {
      const r = importBackup(pending.text, mode);
      setMsg(
        `导入完成：写入 ${r.keys} 项` +
          (r.skipped ? `，跳过 ${r.skipped} 项（本地已有，合并模式不覆盖）` : ""),
      );
      setPending(null);
      refreshBackupStatus();
      /*
       * 覆盖之后**必须重载**：内存里那些 hook 还拿着导入**之前**的数据，
       * 用户接着打卡或记饮食就会把旧值写回去，把刚导入的东西冲掉。
       * 而快照已经落在 localStorage 里，重载后「撤销这次导入」会自动出现 —— 所以有退路。
       */
      if (mode === "overwrite") setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "导入失败");
    }
  }

  function onUndoImport() {
    const n = undoImport();
    setMsg(n ? `已撤销，恢复了 ${n} 项数据。` : "没有可撤销的导入了。");
    refreshBackupStatus();
    // 同覆盖导入：内存里的状态是「撤销之前」的，必须重载才准确
    if (n) setTimeout(() => window.location.reload(), 1200);
  }

  return (
    <div className="yq-scrim" onClick={onClose}>
      <div className="yq-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="yq-section-title">
          <span>设置</span>
          <button className="yq-btn yq-btn-sm yq-btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>

        {/* 我的杯子 */}
        <section style={{ marginBottom: 18 }}>
          <p className="yq-label" style={{ marginBottom: 8 }}>
            我的杯子（喝水按「杯」录入时用它换算）
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {CUP_PRESETS.map((ml) => (
              <button
                key={ml}
                className="yq-chip"
                data-on={prefs.cupMl === ml}
                onClick={() => pickCupPreset(ml)}
              >
                {ml}ml
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              className="yq-input"
              type="number"
              inputMode="numeric"
              value={cupDraft}
              onChange={(e) => applyCup(e.target.value)}
              onBlur={() => {
                if (cupDraft.trim() === "") setCupDraft(String(DEFAULT_CUP_ML));
              }}
              style={{ maxWidth: 130 }}
            />
            <span className="yq-hint">ml / 杯</span>
          </div>
          <p className="yq-hint" style={{ marginTop: 6 }}>
            已记录的水量以 ml 存储，换杯子不会改动历史数据。
          </p>
        </section>

        {/* 主题 */}
        <section style={{ marginBottom: 18 }}>
          <p className="yq-label" style={{ marginBottom: 8 }}>
            外观
          </p>
          <div className="yq-seg">
            {THEME_OPTIONS.map((o) => (
              <button
                key={o.key}
                className="yq-seg-item"
                data-on={theme === o.key}
                title={o.hint}
                onClick={() => setTheme(saveThemeChoice(o.key))}
              >
                {o.label}
              </button>
            ))}
          </div>
        </section>

        {/* AI Key */}
        <section style={{ marginBottom: 18 }}>
          <p className="yq-label" style={{ marginBottom: 8 }}>
            AI 接口 Key（推荐与建议用，可留空）
          </p>
          <input
            className="yq-input"
            type="password"
            placeholder="sk-..."
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setKeySaved(false);
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <button
              className="yq-btn yq-btn-sm yq-btn-primary"
              onClick={() => {
                saveApiKeys({ deepseekKey: key.trim() || undefined });
                // 广播一次：首页那张推荐卡靠它决定「帮我挑」按钮要不要出现。
                // 不广播的话，用户粘完 Key 得手动刷新才看得到入口 —— 他会以为没生效。
                emitDataChanged();
                setKeySaved(true);
              }}
            >
              保存
            </button>
            {keySaved && <span className="yq-hint">已保存</span>}
          </div>
          <p className="yq-hint" style={{ marginTop: 6 }}>
            纯前端应用，Key 只存在你这台设备的浏览器里，不会上传到任何服务器。
            但请理解：<b>它也会随备份文件一起被导出</b>（导出时可选择不含 Key）。
          </p>
        </section>

        {/* 备份 */}
        <section style={{ marginBottom: 18 }}>
          <p className="yq-label" style={{ marginBottom: 8 }}>
            数据备份
          </p>
          <p className="yq-hint" style={{ marginBottom: 10 }}>
            你的全部记录都存在这台设备的浏览器里。清缓存、换手机、换网址都会带走它 ——
            建议每换一次设备就导出一份留着。
          </p>
          <p className="yq-hint" style={{ marginBottom: 10 }}>
            <b>{backupStatus.text}</b>
            {backupStatus.remind && " —— 该导一份了"}
          </p>
          <label className="yq-chip" data-on={includeKey} style={{ marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={includeKey}
              onChange={(e) => setIncludeKey(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            备份里包含 AI Key
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              className="yq-btn yq-btn-sm yq-btn-primary"
              onClick={() => {
                downloadBackup(includeKey);
                refreshBackupStatus();
              }}
            >
              导出备份
            </button>
            <button className="yq-btn yq-btn-sm" onClick={() => fileRef.current?.click()}>
              导入备份
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              onChange={onPickFile}
              style={{ display: "none" }}
            />
          </div>
          {pending?.kind === "bad" && (
            <p className="yq-hint" style={{ marginTop: 10, color: "var(--yq-danger)" }}>
              这份文件用不了：{pending.reason}
            </p>
          )}
          {pending?.kind === "ok" && (
            <ImportPreview
              detail={pending.detail}
              onCancel={() => setPending(null)}
              onConfirm={confirmImport}
            />
          )}

          {msg && (
            <p className="yq-hint" style={{ marginTop: 8, color: "var(--yq-primary-ink)" }}>
              {msg}
            </p>
          )}

          {undoable && (
            <div style={{ marginTop: 10 }} data-yq="import-undo">
              <button className="yq-btn yq-btn-sm" onClick={onUndoImport}>
                撤销这次导入
              </button>
              <p className="yq-hint" style={{ marginTop: 4 }}>
                把数据恢复成上次「整份覆盖」之前的样子。快照只留最近一份，所以只能撤一次。
              </p>
            </div>
          )}
        </section>

        {/* 清空 */}
        <section style={{ marginBottom: 18 }}>
          <p className="yq-label" style={{ marginBottom: 8 }}>
            危险操作
          </p>
          {!confirmClear ? (
            <button className="yq-btn yq-btn-sm yq-btn-danger" onClick={() => setConfirmClear(true)}>
              清空全部数据
            </button>
          ) : (
            <div
              style={{
                border: "1px solid var(--yq-danger)",
                borderRadius: "var(--yq-r-md)",
                padding: 12,
                background: "var(--yq-danger-soft)",
              }}
            >
              <p style={{ fontSize: 13, lineHeight: 1.7, color: "var(--yq-danger)", marginBottom: 10 }}>
                <b>⚠️ 此操作不可撤销。</b>健康档案、体重、运动、打卡、饮食、菜单库会全部删除。
                <br />
                请先点上面的「导出备份」—— 有了备份，随时能导回来。
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="yq-btn yq-btn-sm yq-btn-danger"
                  onClick={() => {
                    const n = clearAllData();
                    setMsg(`已清空 ${n} 项数据`);
                    setConfirmClear(false);
                    setTimeout(() => window.location.reload(), 700);
                  }}
                >
                  确认清空
                </button>
                <button className="yq-btn yq-btn-sm" onClick={() => setConfirmClear(false)}>
                  取消
                </button>
              </div>
            </div>
          )}
        </section>

        <ChangelogSection />

        <p className="yq-hint" style={{ textAlign: "center" }}>
          元气账本 v{APP_VERSION}
          {BUILD_TIME ? ` · 构建于 ${BUILD_TIME}` : ""}
        </p>
      </div>
    </div>
  );
}

/** 最近几个版本改了什么 —— 用户唯一能看到的更新说明 */
export function ChangelogSection() {
  return (
    <section style={{ marginBottom: 18 }}>
      <p className="yq-label" style={{ marginBottom: 8 }}>
        更新了什么
      </p>
      {recentChanges(3).map((e) => (
        <div key={e.version} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            v{e.version} <span className="yq-hint">{e.date}</span>
          </div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, listStyle: "disc" }}>
            {e.highlights.map((h) => (
              <li key={h} className="yq-hint" style={{ marginBottom: 2 }}>
                {h}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
