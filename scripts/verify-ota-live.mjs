/*
 * 发布后核验：把线上 `version.json` 的 OTA 清单逐条下回来，核对字节数与 sha256。
 *
 * 为什么需要它：清单是**发布时现算**的（见 `scripts/deploy.mjs` 的 collectOtaFiles）。
 * 如果清单里的路径写错、或某个文件其实没推上去，本地一切正常、构建也全绿 ——
 * 但每台安卓壳的下载都会失败，而且失败得很晚（用户点更新时才暴露）。
 * 这是唯一能提前发现「清单与线上真实字节不一致」的办法。
 *
 * 用法（会在 sandbox 外发网络请求）：
 *   node scripts/verify-ota-live.mjs
 *   node scripts/verify-ota-live.mjs --site https://example.com/base
 *
 * ⚠️ 刚推完别马上跑：CDN 传播要 1~3 分钟，清单可能还是上一版。脚本会提示当前版本。
 */
import { createHash } from "node:crypto";

const siteArg = process.argv.indexOf("--site");
const SITE = (siteArg > -1 ? process.argv[siteArg + 1] : "https://orang1ver.github.io/yuanqi-ledger").replace(/\/$/, "");

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

let version;
try {
  const res = await fetch(`${SITE}/version.json?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) fail(`拿不到 version.json（HTTP ${res.status}）`);
  const info = await res.json();
  version = info.version;
  const files = info.ota && info.ota.files;
  if (!Array.isArray(files) || files.length === 0) {
    fail(
      `线上 version.json（version=${version}）里没有 ota.files。\n` +
        `  要么这次发布用的还是老版 deploy.mjs，要么 CDN 还没传开 —— 再等一两分钟重试。`,
    );
  }

  const total = files.reduce((n, f) => n + f.bytes, 0);
  // 产物不一定在站点根 —— 站点跑在子路径下，而壳的 WebView 在根下，
  // 所以 OTA 产物是另一次构建、放在 `ota.base` 指的目录里（见 scripts/deploy.mjs）
  const base = typeof info.ota.base === "string" ? info.ota.base : "";
  const at = (p) => `${SITE}/${base ? `${base}/` : ""}${p}`;
  console.log(
    `▶ 线上 version=${version} 产物目录=/${base || "(站点根)"} 清单 ${files.length} 个文件 / ${(total / 1048576).toFixed(2)}MB`,
  );

  let ok = 0;
  let cursor = 0;
  const bad = [];
  // 并发 8：够快又不会把 Pages 打急
  async function worker() {
    while (cursor < files.length) {
      const f = files[cursor++];
      try {
        const r = await fetch(at(f.path), { cache: "no-store" });
        if (!r.ok) {
          bad.push(`${f.path} → HTTP ${r.status}`);
          continue;
        }
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length !== f.bytes) {
          bad.push(`${f.path} → 字节数 期望 ${f.bytes} 实得 ${buf.length}`);
        } else if (createHash("sha256").update(buf).digest("hex") !== f.sha256) {
          bad.push(`${f.path} → sha256 与清单不符`);
        } else {
          ok++;
        }
      } catch (e) {
        bad.push(`${f.path} → ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));

  if (bad.length) {
    console.error(`\n✗ ${bad.length}/${files.length} 个文件对不上：`);
    for (const b of bad.slice(0, 20)) console.error(`  ${b}`);
    if (bad.length > 20) console.error(`  …还有 ${bad.length - 20} 条`);
    process.exit(1);
  }

  /*
   * ⚠️ 再查一层**基址** —— 清单全对**不等于**产物能在壳里跑。
   *
   * 壳的 WebView 从 `https://localhost` 起，站点根就是 `/`；而站点本身部署在子路径下。
   * 产物里的资源引用一旦带上站点子路径前缀（`/yuanqi-ledger/_next/...`），
   * 在壳里就是**页面能开、CSS 与 JS 全 404** 的裸样式 —— 这个坑真踩过，
   * 而上面那轮 sha256 核对**完全查不出来**（字节确实是对的，只是路径错了）。
   */
  const prefix = new URL(SITE).pathname.replace(/\/$/, "");
  if (!files.some((f) => f.path === "index.html")) fail("清单里没有 index.html —— 壳没有入口可加载");
  const entry = await (await fetch(at("index.html"), { cache: "no-store" })).text();
  if (!entry.includes("/_next/")) fail("产物的 index.html 里没有 /_next/ 引用 —— 产物不对");
  // ⚠️ 判据要精确到"根相对引用"：产物里合法地带着
  // `https://github.com/Orang1ver/yuanqi-ledger/issues/new`（反馈链接），
  // 那里面也有 `/yuanqi-ledger/` —— 不能一刀切 includes。
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (
    prefix &&
    (new RegExp(`(?<![A-Za-z0-9._@-])${esc}/`).test(entry) ||
      new RegExp(`"(?:basePath|assetPrefix)":"${esc}"`).test(entry))
  ) {
    fail(`产物的 index.html 里带着站点子路径前缀 ${prefix}/ —— 装进壳里会裸样式（CSS/JS 全 404）`);
  }

  console.log(`\n✓ ${ok}/${files.length} 全部一致（version=${version}）`);
  console.log(`✓ 产物按根路径生成（index.html 里没有 ${prefix}/ 前缀）`);
  console.log("  线上清单与真实字节一致，且产物能在壳里跑。");
} catch (e) {
  fail(e.message);
}
