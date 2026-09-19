"use client";

/**
 * OTA 的**执行侧** —— 拉清单、下载、校验、原子落盘、切换基址。
 *
 * 纯逻辑（解析 / 增量 / 哈希）在 `lib/ota.ts`，那边能单测；这里要碰 Capacitor 与文件系统，
 * **只能在真机上验证**（`npm run smoke` 跑的是浏览器，没有 `window.Capacitor`）。
 *
 * ⚠️ 四条不可违背的顺序：
 *   1. **先下到 `.tmp`、全部校验通过才改名** —— 半成品目录一旦被 Bridge 选中就是白屏
 *      （Bridge 冷启动只用 `new File(path).exists()` 判断，不检查内容完整）
 *   2. **改名成功之后才切基址** —— 反了就会切到一个还不存在的目录
 *   3. **切基址前先写 `.pending` 标记** —— 那是"上次切了但还没确认"的证据，
 *      新版白屏时 Java 侧靠它回滚（见 `MainActivity.java`）
 *   4. Capacitor 一律**动态 import** —— 网页版的包里不该出现壳的代码
 *      （与 `UpdateBanner.tsx` 里 `import("@capacitor/browser")` 同一套做法）
 */

import {
  isComplete,
  otaDir,
  otaRemotePath,
  otaTmpDir,
  OTA_LOCAL_MANIFEST,
  OTA_ROOT,
  parseManifest,
  planDownload,
  readVersion,
  totalBytes,
  verifyFile,
  type OtaManifest,
} from "./ota";
import { isNewer, REMOTE_SITE } from "./update";

/** 与 `UpdateBanner` 同一套缓存名；清缓存时按这个前缀找 */
const CACHE_PREFIX = "yuanqi-v";

/** 回滚保险用的标记文件（相对 OTA 根目录）；内容 = 上一个可用版本号 */
export const OTA_PENDING_FLAG = ".pending";

type NativeBits = {
  Capacitor: typeof import("@capacitor/core").Capacitor;
  registerPlugin: typeof import("@capacitor/core").registerPlugin;
  Filesystem: typeof import("@capacitor/filesystem").Filesystem;
  Directory: typeof import("@capacitor/filesystem").Directory;
  Encoding: typeof import("@capacitor/filesystem").Encoding;
};

export type OtaStage = "checking" | "downloading" | "saving" | "done" | "failed";

export type OtaProgress = {
  stage: OtaStage;
  /** 已完成 / 总数（按文件数） */
  done: number;
  total: number;
  /** 预计要下的总字节，用于显示"还要下多少" */
  bytes: number;
  note?: string;
};

export type OtaOutcome =
  | { kind: "unsupported" }
  | { kind: "uptodate"; version: string }
  /** 已下好、可以切了。`downloaded` 是真的下了几个，`copied` 是从旧版本复制的（增量） */
  | { kind: "ready"; version: string; downloaded: number; copied: number; bytes: number }
  | { kind: "failed"; reason: string };

/** 缓存的 Native 能力；null 表示"不在壳里" */
let nativeCache: NativeBits | null = null;
let nativeProbed = false;

async function loadNative(): Promise<NativeBits | null> {
  if (nativeProbed) return nativeCache;
  try {
    const [core, fs] = await Promise.all([
      import("@capacitor/core"),
      import("@capacitor/filesystem"),
    ]);
    if (!core.Capacitor.isNativePlatform()) {
      nativeProbed = true;
      return null;
    }
    nativeCache = {
      Capacitor: core.Capacitor,
      registerPlugin: core.registerPlugin,
      Filesystem: fs.Filesystem,
      Directory: fs.Directory,
      Encoding: fs.Encoding,
    };
    nativeProbed = true;
    return nativeCache;
  } catch {
    nativeProbed = true;
    return null;
  }
}

type CapWebViewPlugin = {
  getServerBasePath(): Promise<{ path: string }>;
  setServerBasePath(options: { path: string }): Promise<void>;
  persistServerBasePath(): Promise<void>;
};

function webViewPlugin(native: NativeBits): CapWebViewPlugin {
  return native.registerPlugin<CapWebViewPlugin>("WebView");
}

/** ArrayBuffer → base64（Capacitor 的 writeFile 不传 encoding 时按 base64 解码成二进制） */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x2000; // 一次 8192 个字符，远离参数个数上限
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function exists(native: NativeBits, path: string): Promise<boolean> {
  try {
    await native.Filesystem.stat({ path, directory: native.Directory.Data });
    return true;
  } catch {
    return false;
  }
}

async function removeQuiet(native: NativeBits, path: string): Promise<void> {
  try {
    await native.Filesystem.rmdir({
      path,
      directory: native.Directory.Data,
      recursive: true,
    });
  } catch {
    /* 不存在就算了 —— 清理失败不该打断主流程 */
  }
}

type PresentIndex = {
  /** path → sha256 */
  sha: Record<string, string>;
  /** path → 它所在的本地目录（相对 Directory.Data），用于把没变的文件复制过去 */
  dir: Record<string, string>;
};

/**
 * 扫本地已有的 OTA 版本目录，汇总成「哪些文件已经有了」。
 *
 * ⚠️ **跳过 `.tmp` 目录** —— 那是没下完的半成品，里面的文件不一定完整，
 * 拿它当"已有"会拼出一个坏的新版本。
 */
async function collectPresent(native: NativeBits): Promise<PresentIndex> {
  const index: PresentIndex = { sha: {}, dir: {} };
  let entries: Array<{ name: string; type: string }> = [];
  try {
    const r = await native.Filesystem.readdir({ path: OTA_ROOT, directory: native.Directory.Data });
    entries = r.files as Array<{ name: string; type: string }>;
  } catch {
    return index; // ota/ 还不存在 = 第一次更新
  }

  for (const ent of entries) {
    if (ent.type !== "directory" || ent.name.endsWith(".tmp")) continue;
    const dir = `${OTA_ROOT}/${ent.name}`;
    try {
      const f = await native.Filesystem.readFile({
        path: `${dir}/${OTA_LOCAL_MANIFEST}`,
        directory: native.Directory.Data,
        encoding: native.Encoding.UTF8,
      });
      const raw = typeof f.data === "string" ? f.data : "";
      const list = JSON.parse(raw) as Array<{ path?: unknown; sha256?: unknown }>;
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const p = typeof item?.path === "string" ? item.path : "";
        const s = typeof item?.sha256 === "string" ? item.sha256.toLowerCase() : "";
        if (!p || !/^[0-9a-f]{64}$/.test(s)) continue;
        index.sha[p] = s;
        index.dir[p] = dir;
      }
    } catch {
      /* 没有本地清单 / 读坏了 —— 当作这一版没东西可用 */
    }
  }
  return index;
}

/** 某个版本目录是不是已经完整下好了（幂等：重复触发不会重复下载） */
async function isVersionReady(native: NativeBits, manifest: OtaManifest): Promise<boolean> {
  const dir = otaDir(manifest.version);
  if (!(await exists(native, `${dir}/index.html`))) return false;
  try {
    const f = await native.Filesystem.readFile({
      path: `${dir}/${OTA_LOCAL_MANIFEST}`,
      directory: native.Directory.Data,
      encoding: native.Encoding.UTF8,
    });
    const list = JSON.parse(typeof f.data === "string" ? f.data : "") as Array<{
      path?: unknown;
      sha256?: unknown;
    }>;
    if (!Array.isArray(list) || list.length !== manifest.files.length) return false;
    const got = new Map(
      list.map((i) => [String(i?.path ?? ""), String(i?.sha256 ?? "").toLowerCase()]),
    );
    return manifest.files.every((f2) => got.get(f2.path) === f2.sha256);
  } catch {
    return false;
  }
}

/** 清掉 SW 的旧缓存 —— 否则壳里的 SW 可能继续拿旧资源（方案文档 §2.5） */
export async function clearAppCaches(): Promise<number> {
  if (typeof caches === "undefined") return 0;
  try {
    const keys = await caches.keys();
    const targets = keys.filter((k) => k.startsWith(CACHE_PREFIX));
    await Promise.all(targets.map((k) => caches.delete(k)));
    return targets.length;
  } catch {
    return 0;
  }
}

/**
 * 检查并下载新版本（**下载但不切换**）。
 *
 * 幂等：同一个版本已经下好过就直接返回 `ready`，不会重下一遍。
 */
export async function downloadOta(options: {
  currentVersion: string;
  onProgress?: (p: OtaProgress) => void;
}): Promise<OtaOutcome> {
  const { currentVersion, onProgress } = options;
  const report = (p: OtaProgress) => onProgress?.(p);

  const native = await loadNative();
  if (!native) return { kind: "unsupported" };

  report({ stage: "checking", done: 0, total: 0, bytes: 0 });

  let payload: unknown;
  try {
    const res = await fetch(`${REMOTE_SITE}/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return { kind: "failed", reason: `拿不到更新清单（HTTP ${res.status}）` };
    payload = (await res.json()) as unknown;
  } catch {
    return { kind: "failed", reason: "拿不到更新清单（网络不通）" };
  }

  // ⚠️ 顺序不能反：**先比版本号，再解析清单**（见 lib/ota.ts 里 readVersion 的注释）。
  // 反过来的话，"线上还是老部署、压根没有 ota 字段"这种正常情况会被报成一次失败。
  const remoteVersion = readVersion(payload);
  if (!remoteVersion) return { kind: "failed", reason: "更新清单里读不出版本号" };
  if (!isNewer(remoteVersion, currentVersion)) {
    return { kind: "uptodate", version: remoteVersion };
  }

  const manifest = parseManifest(payload);
  if (!manifest) {
    return { kind: "failed", reason: "线上这一版的更新清单不完整，这次先跳过" };
  }

  if (await isVersionReady(native, manifest)) {
    return { kind: "ready", version: manifest.version, downloaded: 0, copied: 0, bytes: 0 };
  }

  const tmp = otaTmpDir(manifest.version);
  // 清掉可能残留的半成品：它可能来自上一次中断的下载
  await removeQuiet(native, tmp);

  const present = await collectPresent(native);
  const plan = planDownload(manifest, present.sha);
  const planPaths = new Set(plan.map((f) => f.path));
  const bytesTotal = totalBytes(plan);

  const verified: Record<string, boolean> = {};
  let downloaded = 0;
  let copied = 0;

  try {
    // 1) 没变的文件：从已有目录**复制**过去，不必重新下载（这就是增量）
    for (const f of manifest.files) {
      if (planPaths.has(f.path)) continue;
      const src = present.dir[f.path];
      if (!src) {
        // 理论到不了这儿（planDownload 说"相同"，就一定在 present 里）；真到了就退化成下载
        planPaths.add(f.path);
        continue;
      }
      await native.Filesystem.copy({
        from: `${src}/${f.path}`,
        to: `${tmp}/${f.path}`,
        directory: native.Directory.Data,
        toDirectory: native.Directory.Data,
      });
      verified[f.path] = true;
      copied += 1;
    }

    // 2) 变化的文件：下载 → 校验 → 落盘
    const toDownload = manifest.files.filter((f) => planPaths.has(f.path));
    report({ stage: "downloading", done: 0, total: toDownload.length, bytes: bytesTotal });

    for (const f of toDownload) {
      const res = await fetch(`${REMOTE_SITE}/${otaRemotePath(manifest.base, f.path)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`${f.path}：HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      if (buf.byteLength !== f.bytes) {
        throw new Error(`${f.path}：大小不符（期望 ${f.bytes}，实际 ${buf.byteLength}）`);
      }
      if (!(await verifyFile(buf, f.sha256))) {
        throw new Error(`${f.path}：哈希对不上`);
      }
      await native.Filesystem.writeFile({
        path: `${tmp}/${f.path}`,
        data: bytesToBase64(new Uint8Array(buf)),
        directory: native.Directory.Data,
        recursive: true,
      });
      verified[f.path] = true;
      downloaded += 1;
      report({ stage: "downloading", done: downloaded, total: toDownload.length, bytes: bytesTotal });
    }

    // 3) 全部到位才允许改名 —— 这是"原子"的全部意义
    if (!isComplete(manifest, verified)) {
      throw new Error("有文件没校验通过，整包作废");
    }
    report({ stage: "saving", done: downloaded, total: toDownload.length, bytes: bytesTotal });

    // 记一份本地清单，供下次算增量
    await native.Filesystem.writeFile({
      path: `${tmp}/${OTA_LOCAL_MANIFEST}`,
      data: JSON.stringify(manifest.files.map((f) => ({ path: f.path, sha256: f.sha256 }))),
      directory: native.Directory.Data,
      encoding: native.Encoding.UTF8,
      recursive: true,
    });

    // 目标目录若已存在（上次失败留下的），先清掉再改名
    await removeQuiet(native, otaDir(manifest.version));
    await native.Filesystem.rename({
      from: tmp,
      to: otaDir(manifest.version),
      directory: native.Directory.Data,
      toDirectory: native.Directory.Data,
    });
  } catch (e) {
    // ⚠️ 任何失败都要把 .tmp 整个作废 —— 半个包比没有包更危险
    await removeQuiet(native, tmp);
    return {
      kind: "failed",
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  report({ stage: "done", done: downloaded, total: downloaded, bytes: bytesTotal });
  return { kind: "ready", version: manifest.version, downloaded, copied, bytes: bytesTotal };
}

/** 当前 WebView 跑的是打包资源还是某个 OTA 目录（`"public"` = 打包资源） */
export async function currentServerBasePath(): Promise<string | null> {
  const native = await loadNative();
  if (!native) return null;
  try {
    const r = await webViewPlugin(native).getServerBasePath();
    return typeof r?.path === "string" ? r.path : null;
  } catch {
    return null;
  }
}

/**
 * 把基址切到已下好的版本目录，并持久化（**下次冷启动生效**）。
 *
 * ⚠️ 切之前写 `.pending` 标记：那是给 `MainActivity` 的回滚保险用的 ——
 * 新版一旦白屏，JS 就跑不起来了，只有 Java 侧能在 `super.onCreate()` 之前救回来。
 * 新版本启动成功后会把这个标记删掉（见 `app/components/shell/OtaUpdater.tsx`）。
 */
export async function activateOta(
  version: string,
  previousVersion?: string | null,
): Promise<{ ok: boolean; reason?: string }> {
  const native = await loadNative();
  if (!native) return { ok: false, reason: "不在安卓壳里" };

  const dir = otaDir(version);
  if (!(await exists(native, `${dir}/index.html`))) {
    return { ok: false, reason: "版本目录不存在或不完整" };
  }

  try {
    // 先落回滚标记：只留最近一次，内容记「回滚到哪一版」
    await native.Filesystem.writeFile({
      path: `${OTA_ROOT}/${OTA_PENDING_FLAG}`,
      data: previousVersion ?? "",
      directory: native.Directory.Data,
      encoding: native.Encoding.UTF8,
      recursive: true,
    });

    const { uri } = await native.Filesystem.getUri({
      path: `${dir}/index.html`,
      directory: native.Directory.Data,
    });
    const abs = uri.replace(/^file:\/\//, "").replace(/\/index\.html$/, "");

    const wv = webViewPlugin(native);
    await wv.setServerBasePath({ path: abs });
    await wv.persistServerBasePath();

    // 清 SW 旧缓存：壳里的 SW 按 origin 注册，会继续控制 OTA 页面（方案文档 §2.5）
    await clearAppCaches();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 启动确认：能跑到这里就说明新版本没白屏 → 删掉回滚标记。
 *
 * ⚠️ **必须在新版本真的渲染出来之后调用**，不能一进页面就调 ——
 * 那等于"还没验证就宣布成功"，回滚保险会形同虚设。
 */
export async function confirmOtaBoot(): Promise<boolean> {
  const native = await loadNative();
  if (!native) return false;
  const flag = `${OTA_ROOT}/${OTA_PENDING_FLAG}`;
  if (!(await exists(native, flag))) return false;
  try {
    await native.Filesystem.deleteFile({ path: flag, directory: native.Directory.Data });
    return true;
  } catch {
    return false;
  }
}

/** 当前是不是跑在某个 OTA 版本上（用于设置面板显示状态） */
export async function otaRuntime(): Promise<{ active: boolean; path: string | null }> {
  const p = await currentServerBasePath();
  return { active: Boolean(p) && p !== "public", path: p };
}

/** 从基址绝对路径里抠出版本号（`…/files/ota/1.3.0` → `1.3.0`）；跑打包资源时返回 null */
async function activeOtaVersion(): Promise<string | null> {
  const p = await currentServerBasePath();
  if (!p || p === "public") return null;
  const m = /[\\/]ota[\\/]([^\\/]+)$/.exec(p);
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ *
 * 对外状态：模块级 + 订阅
 *
 * 为什么不用 context/props：设置面板与启动流程（`AppInit`）在树上离得很远，
 * 为一个"全局唯一的下载任务"把状态提上去不划算。与 `lib/bus.ts` 同一套思路。
 * ------------------------------------------------------------------ */

export type OtaState = {
  stage: "idle" | "checking" | "downloading" | "ready" | "uptodate" | "failed" | "unsupported";
  /** 目标版本号（`ready` 时就是它可以启用的那一版） */
  version: string;
  done: number;
  total: number;
  bytes: number;
  /** 失败原因，只给用户看一句人话 */
  reason: string;
  /** 当前正跑在哪个 OTA 版本上（空 = 跑的是 APK 里的打包资源） */
  activeVersion: string;
};

let state: OtaState = {
  stage: "idle",
  version: "",
  done: 0,
  total: 0,
  bytes: 0,
  reason: "",
  activeVersion: "",
};

const listeners = new Set<(s: OtaState) => void>();

export function getOtaState(): OtaState {
  return state;
}

export function onOtaState(cb: (s: OtaState) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** 订阅 OTA 状态（React 侧的包装在 `app/components/shell/OtaSection.tsx`） */

function patch(p: Partial<OtaState>): void {
  state = { ...state, ...p };
  for (const cb of listeners) cb(state);
}

/** 刷新一次"当前跑在哪一版"（设置面板打开时调） */
export async function refreshOtaState(): Promise<OtaState> {
  const v = await activeOtaVersion();
  patch({ activeVersion: v ?? "" });
  return state;
}

/** 同一时刻只允许一个下载任务（启动、回前台、手动点击可能撞在一起） */
let running = false;

/**
 * 高层入口：检查 + 下载（**不切换**）。
 *
 * 刻意不在下载后自动切换 —— 换版本必须由用户在设置面板里明确点一下。
 * 理由：切过去如果白屏，虽然 Java 侧能回滚，但那对用户是个惊吓；
 * 让他自己点，"刚刚更新了什么、什么时候生效"是可预期的。
 */
export async function checkAndDownloadOta(): Promise<OtaOutcome> {
  if (running) return { kind: "uptodate", version: state.version };

  running = true;
  try {
    const current = process.env.NEXT_PUBLIC_APP_VERSION ?? "";
    patch({ stage: "checking", done: 0, total: 0, bytes: 0, reason: "" });

    const out = await downloadOta({
      currentVersion: current,
      onProgress: (p) => {
        // "saving"（改名落盘）在界面上和"下载中"是一回事，不必多一个状态
        const stage: OtaState["stage"] =
          p.stage === "done" ? "ready" : p.stage === "saving" ? "downloading" : p.stage;
        patch({ stage, done: p.done, total: p.total, bytes: p.bytes });
      },
    });

    switch (out.kind) {
      case "unsupported":
        patch({ stage: "unsupported" });
        break;
      case "uptodate":
        patch({ stage: "uptodate", version: out.version });
        break;
      case "ready":
        patch({ stage: "ready", version: out.version });
        break;
      case "failed":
        patch({ stage: "failed", reason: out.reason });
        break;
    }
    return out;
  } finally {
    running = false;
  }
}

/**
 * 启用已下好的新版本（用户点「立即更新」时调）。
 *
 * 这一步之后 `setServerBasePath` 会立刻让 WebView 去加载新版本 ——
 * 不需要用户自己去杀进程重开。若新版白屏，`.pending` 标记还在，
 * 用户下次冷启动时 `MainActivity` 会把基址回退（详见该类注释）。
 */
export async function enableOta(): Promise<{ ok: boolean; reason?: string }> {
  if (!state.version) return { ok: false, reason: "没有可启用的新版本" };
  const previous = await activeOtaVersion();
  const r = await activateOta(state.version, previous);
  if (r.ok) {
    patch({ stage: "ready", activeVersion: state.version });
  } else {
    patch({ stage: "failed", reason: r.reason ?? "切换失败" });
  }
  return r;
}
