/**
 * 应用内更新：问一句「服务器上是不是有更新的版本」。
 *
 * 两条路，刻意分开：
 *
 * - **网页版**：Service Worker 会在有新构建时广播 `SW_UPDATED`（见 `UpdateBanner`）。
 *   但那是**浏览器按自己的节奏**去查 SW 的，用户挂着的标签页可能几天都轮不到一次 ——
 *   所以这里再补一次**版本号对比**，把"多久查一次"这件事拿回自己手里。
 *
 * - **安卓壳**：壳里的资源是**打包进去**的，SW 永远不会说"有新版本"（它服务的是本地文件）。
 *   唯一的路是比版本号，然后让用户去**下载新的安装包** ——
 *   安卓不允许一个 App 给自己静默升级（除非走应用商店的更新 API），这条绕不过去，也不该绕。
 *
 * ⚠️ 这个模块**只读远端一个小 JSON**，不碰用户数据。
 * ⚠️ 失败是常态（离线、代理、GitHub Pages 抽风），所以一律返回 `null` ——
 * 调用方永远不需要为"检查更新失败"写错误分支。
 */

/** 远端 `version.json` 的内容 */
export type RemoteVersion = {
  version: string;
  /** 新安装包的地址（相对站点根）；没发布 APK 时为 null */
  apk: string | null;
};

/**
 * 线上站点的地址 —— **壳里必须知道它**。
 *
 * 网页版可以直接用相对路径问自己的站点，但安卓壳里 `location.origin` 是
 * `https://localhost`（Capacitor 的本地资源服务器），拿它当基址会问自己要更新，永远问不到。
 * 所以壳里一律走这个绝对地址。
 *
 * ⚠️ 这是**唯一**一处硬编码的线上地址。换域名时改这里，并且同步
 * `scripts/deploy.mjs` 里的 `SITE`。
 */
export const REMOTE_SITE = "https://orang1ver.github.io/yuanqi-ledger";

/** 检查更新该问哪个基址：壳里问线上站点，网页版问自己（相对路径） */
export function checkBase(isNative: boolean, basePath: string): string {
  return isNative ? REMOTE_SITE : basePath;
}

export type FetchRemoteOptions = {
  /** 测试用；默认全局 fetch */
  fetchImpl?: typeof fetch;
  /** 超时（毫秒）。检查更新不值得让用户等，默认 5 秒 */
  timeoutMs?: number;
};

/** `version.json` 的地址（`base` 是站点的 basePath，网页版为 `/yuanqi-ledger`，壳里为空） */
export function versionUrl(base: string): string {
  return `${base}/version.json`;
}

/**
 * 比较两个版本号：`a > b` 返回 1，`a < b` 返回 0 以下，相等返回 0。
 *
 * ⚠️ **必须按数字段比，不能按字符串比** —— 字符串比会让 `"1.10.0" < "1.9.0"`，
 * 而那是个真实会发生的版本号（第 10 个 PATCH）。
 * 认不出来的段当 0（`"1.0"` 与 `"1.0.0"` 相等），绝不抛错：
 * 版本号来自网络，坏数据不该让横幅崩掉。
 */
export function compareVersion(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .trim()
      .replace(/^v/i, "")
      .split(".")
      .map((s) => {
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? n : 0;
      });
  const x = parts(a);
  const y = parts(b);
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i += 1) {
    const xi = x[i] ?? 0;
    const yi = y[i] ?? 0;
    if (xi > yi) return 1;
    if (xi < yi) return -1;
  }
  return 0;
}

/** 远端版本是不是比当前这个更新 */
export function isNewer(remote: string, current: string): boolean {
  return compareVersion(remote, current) > 0;
}

/**
 * 现在是不是跑在**安卓壳**（或 iOS 壳）里。
 *
 * Capacitor 的原生桥会往 window 上挂 `Capacitor`，**不需要 import 它的 npm 包** ——
 * 这样网页版的包里不会多出一份 Capacitor 运行时代码。
 */
export function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

/**
 * 把 `version.json` 里的 apk 路径拼成可下载的地址。
 *
 * `base` 是**检查更新时用的那个基址**（网页版是 `/yuanqi-ledger`，壳里是 `REMOTE_SITE`）——
 * 刻意不用 `location.origin`：壳里那是 `https://localhost`，拼出来是个下不动的地址。
 */
export function apkDownloadUrl(base: string, apk: string): string {
  if (/^https?:\/\//i.test(apk)) return apk;
  const b = base.replace(/\/+$/, "");
  return `${b}/${apk.replace(/^\/+/, "")}`;
}

/**
 * 读远端的 `version.json`。**任何异常都变成 null**（离线、超时、不是 JSON、字段不对）。
 *
 * 带 `cache: "no-store"` + 时间戳参数：这个文件就是要拿最新的，
 * 被 HTTP 缓存住的话"检查更新"就成了摆设（用户会以为没有新版）。
 */
export async function fetchRemoteVersion(
  base: string,
  options: FetchRemoteOptions = {},
): Promise<RemoteVersion | null> {
  const doFetch = options.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!doFetch) return null;

  const timeoutMs = options.timeoutMs ?? 5000;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await doFetch(`${versionUrl(base)}?t=${Date.now()}`, {
      cache: "no-store",
      signal: controller?.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    if (!data || typeof data !== "object") return null;
    const { version, apk } = data as { version?: unknown; apk?: unknown };
    if (typeof version !== "string" || !version.trim()) return null;
    return { version: version.trim(), apk: typeof apk === "string" && apk ? apk : null };
  } catch {
    // 离线、超时、DNS 挂了、返回的不是 JSON —— 都是"这次没查到"，不是错误
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
