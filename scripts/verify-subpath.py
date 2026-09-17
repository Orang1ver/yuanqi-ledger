#!/usr/bin/env python3
"""
子路径自检 —— 把每个按钮"点"一遍。

为什么需要它：项目部署在 GitHub Pages 的**子路径**（如 /yuanqi-ledger/）下，
而 Next.js 只会给 `next/link` 的 <Link> 自动加 basePath。
一旦哪里写了原生 `<a href="/health">`，直接访问路由是 200（因为 GitHub Pages 会兜底），
**但用户点下去会跳到站点根目录、404**。所以"访问一遍路由"这种测法根本测不出来。

本脚本改成静态分析构建产物：
  1) 检查产物里有没有**根相对路径**的站内链接 —— 有就说明漏了 basePath
  2) 检查每个站内链接在 out/ 里是否真有对应文件
  3) 可选：起一个静态服务，真的逐个 GET 一次看状态码

用法：
    python scripts/verify-subpath.py                      # 静态分析
    python scripts/verify-subpath.py --base /yuanqi-ledger
    python scripts/verify-subpath.py --http http://127.0.0.1:4177   # 附加 HTTP 探测
"""

from __future__ import annotations

import argparse
import html.parser
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"

# 这些属性里的站内路径需要检查
LINK_ATTRS = {"href", "src", "srcset", "action", "poster"}
SKIP_PREFIXES = ("http://", "https://", "//", "mailto:", "tel:", "data:", "blob:", "javascript:", "#")


class LinkExtractor(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []  # (tag, url)
        self.raw_html = ""

    def handle_starttag(self, tag, attrs):
        for k, v in attrs:
            if k.lower() in LINK_ATTRS and v:
                for part in v.split(","):  # srcset 可能是 "a.png 1x, b.png 2x"
                    self.links.append((tag, part.strip().split(" ")[0]))


def strip_base(url: str, base: str) -> str | None:
    """去掉 basePath 前缀，返回站点根相对路径；不属于本站则返回 None"""
    if any(url.startswith(p) for p in SKIP_PREFIXES) or url == "":
        return None
    if url.startswith(base.rstrip("/") + "/"):
        return "/" + url[len(base.rstrip("/")) + 1 :]
    return url if url.startswith("/") else None


def resolve(url_path: str) -> Path:
    """把站点路径映射到 out/ 里的文件"""
    p = url_path.split("?")[0].split("#")[0]
    rel = p.lstrip("/")
    cand = OUT / rel
    if rel == "" or p.endswith("/"):
        return cand / "index.html"
    if cand.is_dir():
        return cand / "index.html"
    if not cand.suffix:
        return cand / "index.html"
    return cand


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="/yuanqi-ledger", help="部署子路径（默认 /yuanqi-ledger）")
    ap.add_argument("--http", default="", help="可选的静态服务地址，用于附加真实请求探测")
    args = ap.parse_args()
    base = "/" + args.base.strip("/")

    if not OUT.is_dir():
        print(f"✗ 找不到 {OUT}，先跑 npm run build")
        return 1

    pages = sorted(OUT.rglob("*.html"))
    if not pages:
        print("✗ out/ 里没有任何 html")
        return 1

    # ⓿ 前置判断：这份产物到底是不是用 BASE_PATH 构建的？
    # 漏了 BASE_PATH 的话，所有资源和站内链接都会退化成根相对路径，
    # 于是下面每一条都会报"漏 basePath" —— 但根因在构建命令，不在代码里。
    # 与其让人去追几十条假错误，不如在这里一句话说清楚。
    probe = OUT / "index.html"
    if base and probe.is_file() and base not in probe.read_text(encoding="utf-8", errors="ignore"):
        print(f"✗ out/ 里完全没出现 basePath {base!r}，说明这次构建没带 BASE_PATH。")
        print("  此状态下所有资源路径都是根相对的，下面的检查会**全是误报**，先别改代码。")
        print("  正确做法：")
        print(f"      BASE_PATH={base} npm run build          # bash / Git Bash")
        print(f"      set BASE_PATH={base}&& npm run build    # Windows cmd")
        print(f"  然后再跑：python scripts/verify-subpath.py --base {base}")
        return 2

    errors: list[str] = []
    warnings: list[str] = []
    checked = 0

    for page in pages:
        rel_page = page.relative_to(OUT).as_posix()
        parser = LinkExtractor()
        parser.feed(page.read_text(encoding="utf-8", errors="ignore"))

        for tag, raw in parser.links:
            if any(raw.startswith(p) for p in SKIP_PREFIXES) or raw == "":
                continue
            checked += 1

            # ① 根相对路径 = 几乎一定是漏了 basePath
            if raw.startswith("/") and not raw.startswith(base + "/") and raw != base:
                errors.append(
                    f"[漏 basePath] {rel_page} 里的 <{tag}> 指向根相对路径 {raw!r}\n"
                    f"              在子路径部署下会跳到站点根 → 404。\n"
                    f"              站内跳转请用 next/link 的 <Link>，不要写原生 <a href=\"/...\">。"
                )
                continue

            site_path = strip_base(raw, base)
            if site_path is None:
                continue

            target = resolve(site_path)
            if not target.exists():
                errors.append(f"[404] {rel_page} 里的 <{tag}> → {raw!r}（期望文件 {target.relative_to(OUT).as_posix()} 不存在）")

    print(f"检查了 {len(pages)} 个页面、{checked} 条链接（basePath = {base}）")

    # ② 可选：真实 HTTP 探测
    if args.http:
        print(f"\n▶ HTTP 探测 {args.http}")
        for page in pages:
            rel = page.relative_to(OUT).as_posix()
            if rel.endswith("index.html"):
                rel = rel[: -len("index.html")]
            url = f"{args.http.rstrip('/')}{base}/{rel}"
            try:
                with urllib.request.urlopen(url, timeout=5) as r:
                    code = r.status
            except urllib.error.HTTPError as e:
                code = e.code
            except Exception as e:  # noqa: BLE001
                code = f"ERR {e}"
            flag = "✓" if code == 200 else "✗"
            print(f"  {flag} {code}  {url}")
            if code != 200:
                errors.append(f"[HTTP {code}] {url}")

    if warnings:
        print()
        for w in warnings:
            print("⚠ " + w)

    if errors:
        print(f"\n✗ 发现 {len(errors)} 个问题：\n")
        for e in errors:
            print(e + "\n")
        return 1

    print("\n✓ 子路径自检通过：没有根相对路径泄漏，所有站内链接都有对应产物。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
