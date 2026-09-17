/**
 * 本地预览构建产物。
 *
 * 为什么要单独一个脚本：项目部署在**子路径**（/yuanqi-ledger/）下，
 * 直接用 `python -m http.server` 打开 out/ 会让所有资源路径对不上、
 * 页面白屏 —— 于是你会误以为"构建坏了"。
 * 这个脚本把 /yuanqi-ledger/* 映射到 ./out/*，等价于 GitHub Pages 的目录结构。
 *
 * 用法：
 *   node scripts/preview.mjs
 *   node scripts/preview.mjs --port 4177 --base /yuanqi-ledger
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = Number(arg("port", "4177"));
const BASE = "/" + arg("base", "/yuanqi-ledger").replace(/^\/|\/$/g, "");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

/** 把请求路径映射到 out/ 里的文件；目录补 index.html（等价于 trailingSlash: true 的产物） */
async function resolveFile(urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (!rel.startsWith(BASE)) return null;
  rel = rel.slice(BASE.length);
  if (rel === "" || rel === "/") rel = "/index.html";

  const safe = normalize(rel).replace(/^([.]{2}[/\\])+/, "");
  let file = join(OUT, safe);
  if (!file.startsWith(OUT)) return null;

  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
  } catch {
    if (!extname(file)) file = join(file, "index.html");
  }
  return file;
}

const server = createServer(async (req, res) => {
  const file = await resolveFile(req.url || "/");
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end(`路径必须在 ${BASE}/ 下`);
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file)] || "application/octet-stream",
      // 预览时禁用缓存，改完重新 build 刷新就能看到
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404 " + file.replace(OUT, ""));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`元气账本预览： http://127.0.0.1:${PORT}${BASE}/`);
  console.log("（Ctrl+C 停止；改了代码要重新 npm run build）");
});
