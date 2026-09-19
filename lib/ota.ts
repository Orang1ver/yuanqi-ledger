/**
 * OTA（安卓壳「无感更新」）的**纯逻辑**层 —— 解析清单、算增量、校验哈希。
 *
 * 为什么单独一层：下载与落盘要碰 Capacitor，而 `lib/` 是**脱离打包器的领域层**
 * （不 import UI / Next / localStorage / Capacitor），所以把能单测的部分全放这里。
 * 真机上的 IO 在 `lib/ota-runner.ts`。
 *
 * ⚠️ 清单来自网络，**一律当不可信输入**：结构不对、字段缺失、路径可疑一律返回 `null`，
 * 让调用方安静地当「这次没得更新」处理 —— 与 `lib/update.ts` 的 `fetchRemoteVersion` 同一风格。
 * 失败是常态（离线、代理、Pages 抽风），永远不要让"检查更新"把界面搞崩。
 */

/** 清单里的一个文件 */
export type OtaFile = {
  /** 相对站点根的路径，如 `_next/static/chunks/abc.js` */
  path: string;
  bytes: number;
  sha256: string;
};

export type OtaManifest = {
  version: string;
  files: OtaFile[];
};

/** OTA 资源都放在应用私有目录的这个子目录下 */
export const OTA_ROOT = "ota";

/** 版本目录名：`ota/<version>` */
export function otaDir(version: string): string {
  return `${OTA_ROOT}/${version}`;
}

/**
 * 下载中的临时目录：`ota/<version>.tmp`
 *
 * ⚠️ 必须"先下到 `.tmp`、全部校验通过才改名"。Capacitor 的 Bridge 在冷启动时
 * 只用 `new File(path).exists()` 判断基址目录在不在 —— **半成品目录一旦被选中就是白屏**，
 * 所以半个包比没有包更危险。
 */
export function otaTmpDir(version: string): string {
  return `${OTA_ROOT}/${version}.tmp`;
}

/**
 * 版本目录里额外存一份清单，供**下次**算增量用。
 *
 * 点开头是故意的：`scripts/deploy.mjs` 生成站点清单时会跳过点开头的文件，
 * 所以它只存在于壳的本地目录里，不会出现在远端清单里、也不会被再次下载。
 */
export const OTA_LOCAL_MANIFEST = ".ota-manifest.json";

/** 路径是否安全：不给绝对路径、不给往上跳、不给反斜杠（Windows 风格混入） */
function isSafePath(path: string): boolean {
  if (!path) return false;
  if (path.startsWith("/") || path.startsWith(".")) return false;
  if (path.includes("..") || path.includes("\\")) return false;
  if (path.includes("//")) return false;
  return true;
}

/**
 * 只取远端 `version.json` 里的**版本号**，不要求它带 OTA 清单。
 *
 * ⚠️ 这一步必须与 `parseManifest` 分开，且调用方要**先调它、再调 `parseManifest`**。
 * 理由：线上可能正跑着一份**没有 `ota` 字段**的部署（比如回滚过、或那还是老版本发布）。
 * 那种情况下"没有可更新的东西"是正常的，可一旦先解析清单就会失败，
 * 于是界面把一句本来只是"暂无更新"说成了一次错误 —— 而它根本不是错误。
 *
 * 坏数据一律 `null`（与 `lib/update.ts` 的 `fetchRemoteVersion` 一个风格）。
 */
export function readVersion(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const v = (raw as Record<string, unknown>).version;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * 解析远端 `version.json`，取出 OTA 清单。
 *
 * 入参是**整个 `version.json`**（不是里面的 `ota` 字段）—— 因为版本号在外层，
 * 而这两样东西必须一起拿到才有意义（版本没变就不该下任何东西）。
 *
 * 任何一项不合格就返回 `null`：宁可"这次不更新"，也不要拿着半截清单去覆盖用户的 App。
 *
 * ⚠️ 调用方应当**已经比过版本号**（用 `readVersion` + `isNewer`）——
 * 这里返回 `null` 才真正意味着"这个新版本发布得不完整"。
 */
export function parseManifest(raw: unknown): OtaManifest | null {
  const version = readVersion(raw);
  if (!version) return null;

  const ota = (raw as Record<string, unknown>).ota;
  if (!ota || typeof ota !== "object") return null;
  const filesRaw = (ota as Record<string, unknown>).files;
  if (!Array.isArray(filesRaw) || filesRaw.length === 0) return null;

  const files: OtaFile[] = [];
  const seen = new Set<string>();
  for (const item of filesRaw) {
    if (!item || typeof item !== "object") return null;
    const f = item as Record<string, unknown>;

    const path = typeof f.path === "string" ? f.path : "";
    if (!isSafePath(path)) return null;

    const bytes = f.bytes;
    if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return null;

    const sha256 = typeof f.sha256 === "string" ? f.sha256.toLowerCase() : "";
    if (!/^[0-9a-f]{64}$/.test(sha256)) return null;

    // 同一路径出现两次 = 清单自相矛盾（到底该信哪个哈希？）→ 整份作废
    if (seen.has(path)) return null;
    seen.add(path);

    files.push({ path, bytes, sha256 });
  }

  return { version, files };
}

/**
 * 算出「这次要下哪些文件」。
 *
 * `present` 是本地已有的「路径 → sha256」，`sha256` 相同就跳过 ——
 * 于是**只下载真正变了的文件**（Next.js 的 chunk 带内容 hash，没改的页面不会重复下），
 * 这是个白送的增量更新。
 *
 * ⚠️ **只按 sha256 判断，不看文件大小**：大小相同、内容不同的情况真实存在，
 * 而哈希相同基本就等于内容相同。
 */
export function planDownload(manifest: OtaManifest, present: Record<string, string>): OtaFile[] {
  return manifest.files.filter((f) => present[f.path] !== f.sha256);
}

/** 整个清单是否都校验通过了 —— 只有全通过才允许改名生效 */
export function isComplete(manifest: OtaManifest, verified: Record<string, boolean>): boolean {
  return manifest.files.every((f) => verified[f.path] === true);
}

/** 清单总字节数（用于给用户显示"要下多少"） */
export function totalBytes(files: OtaFile[]): number {
  return files.reduce((n, f) => n + f.bytes, 0);
}

/** 算字节的 sha256（WebCrypto；`https://localhost` 是 secure context，壳里可用） */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 校验一份下载到的内容是否符合清单里记的哈希 */
export async function verifyFile(data: ArrayBuffer, expectedSha256: string): Promise<boolean> {
  return (await sha256Hex(data)) === expectedSha256.toLowerCase();
}
