import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

/**
 * 元气账本 —— 纯前端静态站点。
 *
 * 所有数据存在浏览器 localStorage，AI 由浏览器直连 DeepSeek，
 * 没有服务端、没有 API 路由，因此可以整体静态导出（out/）。
 *
 * 部署到子路径（如 GitHub Pages 的 /yuanqi-ledger/）时通过 BASE_PATH 注入。
 */
const basePath = process.env.BASE_PATH || "";

/** 版本号的唯一来源是 package.json 的 version，这里只读，不再自己生成 */
const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  version: string;
};

const nextConfig: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString().slice(0, 16).replace("T", " "),
  },
  // 静态导出没有服务端，图片优化必须关掉
  images: { unoptimized: true },
  // 导出成 /path/index.html，静态托管能直接命中
  trailingSlash: true,
};

export default nextConfig;
