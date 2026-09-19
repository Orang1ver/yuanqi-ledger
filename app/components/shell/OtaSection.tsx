"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  checkAndDownloadOta,
  enableOta,
  getOtaState,
  onOtaState,
  refreshOtaState,
} from "@/lib/ota-runner";
import { isNativeShell } from "@/lib/update";

/**
 * 订阅 OTA 状态。
 *
 * 状态存在 `lib/ota-runner.ts` 的模块级变量里（下载任务是全局唯一的），
 * 设置面板只是它的一个视图 —— 与 `lib/bus.ts` 同一套思路，不必为此把状态提到 React 树顶层。
 */
function useOtaState() {
  return useSyncExternalStore(
    (notify) => onOtaState(() => notify()),
    getOtaState,
    getOtaState,
  );
}

/**
 * 设置面板里的「无感更新」区 —— **只在安卓壳里出现**。
 *
 * 与顶部那条 `UpdateBanner` 的分工（别让两个组件各说各话）：
 * - `UpdateBanner`：**还没下载**时告诉用户"有新版本"，网页版走刷新、壳里走下载安装包。
 * - 这里：OTA **已经下好之后**的状态与启用入口。
 *
 * 也就是说两者是"发现"与"落地"的关系，不是二选一。壳里一旦 OTA 可用，
 * 用户就不必再去下载安装包 —— 那是 `UpdateBanner` 里"下载新版"的降级路径。
 *
 * ⚠️ 更新**由用户点一下才启用**，不自动切换。切过去若白屏，虽然 Java 侧能回滚，
 * 但让用户自己决定"什么时候生效"更可预期。
 */
export function OtaSection() {
  const ota = useOtaState();
  const [busy, setBusy] = useState(false);

  // 是不是跑在壳里。用 useSyncExternalStore 读环境值，而不是 effect + setState ——
  // 后者会触发级联渲染，而且这里本就没有"订阅"语义，只是在读一个不会变的环境事实。
  const native = useSyncExternalStore(
    () => () => {},
    () => isNativeShell(),
    () => false,
  );

  useEffect(() => {
    if (!native) return;
    void refreshOtaState();
  }, [native]);

  if (!native) return null;

  const { stage, version, done, total, bytes, reason, activeVersion } = ota;
  const mb = (n: number) => (n / 1048576).toFixed(2);

  const showEnable = stage === "ready" && Boolean(version);
  /**
   * 「检查更新」除了正在忙的时候**一直留着**。
   *
   * ⚠️ 别写成"只在 idle 时显示"：启动后那次自动检查会把 stage 推到 uptodate / failed，
   * 于是用户打开设置面板时既看到「已是最新版本。」、又找不到任何能重查的按钮 ——
   * 想手动确认一下更新就没了入口。（`ready` 时下面自带「重新检查」，不重复放。）
   */
  const showCheck = !busy && stage !== "checking" && stage !== "downloading" && !showEnable;

  async function check() {
    setBusy(true);
    await checkAndDownloadOta();
    setBusy(false);
  }

  async function enable() {
    setBusy(true);
    // 成功后 setServerBasePath 会让 WebView 立刻去加载新版本，
    // 所以这里不需要（也不该）自己做 `location.reload()`
    const r = await enableOta();
    if (!r.ok) setBusy(false);
  }

  return (
    <section style={{ marginBottom: 18 }}>
      <p className="yq-label" style={{ marginBottom: 8 }}>
        无感更新
      </p>

      <p className="yq-hint" style={{ marginTop: 0, marginBottom: 8 }}>
        当前运行：v{process.env.NEXT_PUBLIC_APP_VERSION || "?"}
        {activeVersion ? `（更新版 ${activeVersion}）` : "（安装包内版本）"}
      </p>

      {stage === "checking" ? <p className="yq-hint">正在检查…</p> : null}

      {stage === "downloading" ? (
        <p className="yq-hint">
          正在下载 v{version}…{total > 0 ? `（${done}/${total} 个文件，约 ${mb(bytes)}MB）` : ""}
        </p>
      ) : null}

      {stage === "uptodate" ? <p className="yq-hint">已是最新版本。</p> : null}

      {stage === "failed" ? (
        <p className="yq-hint" style={{ color: "var(--yq-danger, #c2410c)" }}>
          这次没成功：{reason || "未知原因"}。不影响使用，下次打开会再试。
        </p>
      ) : null}

      {stage === "ready" && version ? (
        <div data-yq="ota-ready">
          <p className="yq-hint" style={{ marginTop: 0, marginBottom: 8 }}>
            新版本 v{version} 已经下载好了。点一下就能用上 —— 不会丢记录。
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="yq-btn yq-btn-sm yq-btn-primary"
              data-yq="ota-enable"
              disabled={busy}
              onClick={() => void enable()}
            >
              {busy ? "正在切换…" : "立即更新"}
            </button>
            <button
              className="yq-btn yq-btn-sm yq-btn-ghost"
              data-yq="ota-recheck"
              disabled={busy}
              onClick={() => void check()}
            >
              重新检查
            </button>
          </div>
        </div>
      ) : null}

      {showCheck ? (
        <button
          className="yq-btn yq-btn-sm yq-btn-ghost"
          data-yq="ota-check"
          disabled={busy}
          onClick={() => void check()}
        >
          检查更新
        </button>
      ) : null}
    </section>
  );
}
