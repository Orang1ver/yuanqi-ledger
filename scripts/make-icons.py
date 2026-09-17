#!/usr/bin/env python3
"""
生成 PWA 图标与 iOS 启动图。

为什么用脚本而不是直接放几张贴图：
- 图标只有"圆环 + 底色"这么点图形，脚本生成可复现、可微调（改色值重跑即可）
- 不引入 Pillow 之类的依赖，纯标准库（zlib + struct）手写 PNG，
  这样任何机器上 clone 下来都能重跑，符合项目"全部开源、零构建依赖"的取向

用法：
    python scripts/make-icons.py

产出：
    public/icons/icon-192.png
    public/icons/icon-512.png
    public/icons/maskable-512.png
    public/splash/splash-<w>x<h>@<dpr>x.png
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "public" / "icons"
SPLASH_DIR = ROOT / "public" / "splash"

# 与 app/globals.css 的 --yq-primary / --yq-bg 保持一致。
# 改了主题色记得回来同步，否则图标会和界面"不是一套"。
BRAND = (0x2E, 0x7D, 0x62)
BRAND_DARK = (0x1B, 0x5B, 0x47)
PAPER = (0xF7, 0xF5, 0xEF)
WHITE = (0xFF, 0xFF, 0xFF)

SS = 2  # 超采样倍数：先按 2 倍画再缩，边缘不会有锯齿


def write_png(path: Path, w: int, h: int, rgba: bytearray) -> None:
    """把 RGBA 像素缓冲写成 PNG（8 位真彩 + Alpha）"""
    stride = w * 4
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # 每行的 filter type：0 = None
        raw += rgba[y * stride : (y + 1) * stride]

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 6))
    png += chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def aa(w: int, h: int, shader) -> bytearray:
    """
    通用渲染：shader(x, y, size) -> (r, g, b, a) 或 None（全透明）。
    内部按 SS 倍超采样后取平均，得到平滑边缘。
    """
    W, H = w * SS, h * SS
    buf = bytearray(W * H * 4)
    for y in range(H):
        row = y * W * 4
        for x in range(W):
            px = shader(x / SS, y / SS, w, h)
            i = row + x * 4
            if px is not None:
                buf[i] = px[0]
                buf[i + 1] = px[1]
                buf[i + 2] = px[2]
                buf[i + 3] = px[3]

    out = bytearray(w * h * 4)
    n = SS * SS
    for y in range(h):
        for x in range(w):
            r = g = b = a = 0
            for dy in range(SS):
                base = ((y * SS + dy) * W + x * SS) * 4
                for dx in range(SS):
                    i = base + dx * 4
                    a += buf[i + 3]
                    # 按 alpha 加权累加颜色，避免透明区把颜色拉黑
                    r += buf[i] * buf[i + 3]
                    g += buf[i + 1] * buf[i + 3]
                    b += buf[i + 2] * buf[i + 3]
            o = (y * w + x) * 4
            if a == 0:
                out[o : o + 4] = b"\x00\x00\x00\x00"
            else:
                out[o] = min(255, r // a)
                out[o + 1] = min(255, g // a)
                out[o + 2] = min(255, b // a)
                out[o + 3] = a // n
    return out


def in_rounded_rect(x: float, y: float, w: float, h: float, r: float) -> bool:
    if x < 0 or y < 0 or x >= w or y >= h:
        return False
    cx = min(max(x, r), w - r)
    cy = min(max(y, r), h - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def mark_color(x: float, y: float, size: float, ring: bool = True):
    """
    图形本体：一个 300° 的进度环（缺口留在右上），代表"每天在推进的账本"。
    返回 (r,g,b,a) 或 None。
    """
    import math

    c = size / 2
    R = size * 0.30          # 环的半径
    t = size * 0.075         # 环的粗细
    dx, dy = x - c, y - c
    d = math.hypot(dx, dy)
    if abs(d - R) > t / 2:
        return None
    # 从 12 点方向顺时针计角度
    ang = (math.degrees(math.atan2(dx, -dy))) % 360
    if ring and ang > 300:
        return None
    return (WHITE[0], WHITE[1], WHITE[2], 255)


def rounded_logo(size: int) -> bytearray:
    """应用图标：圆角方形底 + 白色进度环"""

    def shader(x, y, w, h):
        if not in_rounded_rect(x, y, w, h, w * 0.22):
            return None
        m = mark_color(x, y, w)
        if m is None:
            return (BRAND[0], BRAND[1], BRAND[2], 255)
        return m

    return aa(size, size, shader)


def maskable_logo(size: int) -> bytearray:
    """maskable 版：底色铺满整块，图形缩到 60% 留在安全区内（系统可能裁成任意形状）"""

    def shader(x, y, w, h):
        m = mark_color(x, y, w * 0.62)
        if m is None:
            return (BRAND[0], BRAND[1], BRAND[2], 255)
        return m

    return aa(size, size, shader)


def splash(w: int, h: int) -> bytearray:
    """
    iOS 启动图：宣纸白底 + 居中的圆角 Logo。
    尺寸按设备像素给足（@3x），否则 iOS 会把图拉伸导致模糊。
    """
    logo_size = int(min(w, h) * 0.30)
    logo = rounded_logo(logo_size)
    ox = (w - logo_size) // 2
    oy = (h - logo_size) // 2

    buf = bytearray(bytes(PAPER + (255,)) * (w * h))
    for ly in range(logo_size):
        y = oy + ly
        if y < 0 or y >= h:
            continue
        for lx in range(logo_size):
            x = ox + lx
            if x < 0 or x >= w:
                continue
            i = (ly * logo_size + lx) * 4
            a = logo[i + 3]
            if a == 0:
                continue
            o = (y * w + x) * 4
            inv = 255 - a
            buf[o] = (logo[i] * a + buf[o] * inv) // 255
            buf[o + 1] = (logo[i + 1] * a + buf[o + 1] * inv) // 255
            buf[o + 2] = (logo[i + 2] * a + buf[o + 2] * inv) // 255
    return buf


SPLASH_SIZES = [(430, 932, 3), (393, 852, 3), (428, 926, 3), (390, 844, 3)]


def main() -> None:
    print("icons…")
    write_png(ICON_DIR / "icon-192.png", 192, 192, rounded_logo(192))
    write_png(ICON_DIR / "icon-512.png", 512, 512, rounded_logo(512))
    write_png(ICON_DIR / "maskable-512.png", 512, 512, maskable_logo(512))

    print("splash…")
    for w, h, dpr in SPLASH_SIZES:
        pw, ph = w * dpr, h * dpr
        p = SPLASH_DIR / f"splash-{w}x{h}@{dpr}x.png"
        write_png(p, pw, ph, splash(pw, ph))
        print(f"  {p.name}  {pw}x{ph}")

    print("done.")


if __name__ == "__main__":
    main()
