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


def mark_color(x: float, y: float, size: float, ring: bool = True, scale: float = 1.0):
    """
    图形本体：一个 300° 的进度环（缺口留在右上），代表"每天在推进的账本"。
    返回 (r,g,b,a) 或 None。

    ⚠️ `size` 是**画布边长**，环永远画在 `size/2` 这个中心上；
    要把环画小一点（maskable / 自适应图标那种要留安全区的）请用 `scale`，
    **不要**把 `size` 改小 —— 改 `size` 等于同时把中心挪到左上角去。
    这个坑真踩过：`maskable_logo` 原来传的是 `w * 0.62`，于是那个圆环
    一直画在画布的左上区域，而 maskable 图标在启动器里是被裁成圆形的，
    结果就是"环偏在一角"。加 `scale` 之后才对。
    """
    import math

    c = size / 2
    R = size * 0.30 * scale   # 环的半径
    t = size * 0.075 * scale  # 环的粗细（跟着一起缩，不然小图形会显得很粗）
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
    """maskable 版：底色铺满整块，图形缩到 62% 留在安全区内（系统可能裁成任意形状）"""

    def shader(x, y, w, h):
        # ⚠️ 用小比例（scale），不是小画布 —— 见 mark_color 的注释
        m = mark_color(x, y, w, scale=0.62)
        if m is None:
            return (BRAND[0], BRAND[1], BRAND[2], 255)
        return m

    return aa(size, size, shader)


def round_logo(size: int) -> bytearray:
    """圆形图标（安卓的 ic_launcher_round）：有些启动器只要圆的"""

    def shader(x, y, w, h):
        import math

        c = w / 2
        if math.hypot(x - c, y - c) > c:
            return None
        m = mark_color(x, y, w)
        if m is None:
            return (BRAND[0], BRAND[1], BRAND[2], 255)
        return m

    return aa(size, size, shader)


def foreground(size: int) -> bytearray:
    """
    安卓自适应图标的**前景层**：背景透明，只画那个环，而且缩到 62%。

    留白是必须的，不是审美：系统会把 108dp 的前景裁成圆形 / 方形 / 水滴，
    实际只保证中间 72dp 可见。画满就会在各个角上被切掉。
    底色由 `values/ic_launcher_background.xml` 那支品牌色提供。
    """

    def shader(x, y, w, h):
        return mark_color(x, y, w, scale=0.62)

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


# ---------- 安卓壳（Capacitor）的资源 ----------

ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"

# 这三个尺寸表都是安卓的约定，不是随便定的：
#   桌面图标 48dp；自适应图标前景 108dp（外面那圈会被系统裁掉，所以图形只占 62%）
ANDROID_ICON = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
ANDROID_FG = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}

# 启动图：**照抄模板自带的尺寸**。改了尺寸就可能被拉伸，
# 而"被拉伸"在手机上就是那一瞬间的糊，很难归因。
ANDROID_SPLASH = [
    ("drawable", 480, 320),
    ("drawable-land-mdpi", 480, 320),
    ("drawable-land-hdpi", 800, 480),
    ("drawable-land-xhdpi", 1280, 720),
    ("drawable-land-xxhdpi", 1600, 960),
    ("drawable-land-xxxhdpi", 1920, 1280),
    ("drawable-port-mdpi", 320, 480),
    ("drawable-port-hdpi", 480, 800),
    ("drawable-port-xhdpi", 720, 1280),
    ("drawable-port-xxhdpi", 960, 1600),
    ("drawable-port-xxxhdpi", 1280, 1920),
]


def assert_ring_centred(label: str, shader, size: int) -> None:
    """
    环（白色那圈）的外接框中心必须落在画布中心上。

    ⚠️ 这条断言是补出来的，因为这里真错过一次：`maskable_logo` 原来把 `w * 0.62`
    当 `size` 传给 `mark_color`，而 `mark_color` 以 `size/2` 为中心 ——
    于是那个环被画到了**左上角**，实测外接框中心偏了 137px（画布的 26.8%）。
    maskable 图标在启动器里会被裁成圆形，表现就是"环偏在一角"。
    判据用**外接框**而不是像素重心：环是 300° 的弧，缺的那 60° 本来就会把重心拉偏，
    用重心会误报；圆的 bbox 与缺口无关。
    """
    x0 = y0 = 10**9
    x1 = y1 = -1
    for y in range(size):
        for x in range(size):
            px = shader(x, y, size, size)
            if px is not None and px[0] == WHITE[0] and px[1] == WHITE[1] and px[2] == WHITE[2]:
                x0 = min(x0, x)
                x1 = max(x1, x)
                y0 = min(y0, y)
                y1 = max(y1, y)
    if x1 < 0:
        raise SystemExit(f"✗ {label}：一个环的像素都没画出来")
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    c = (size - 1) / 2
    off = ((cx - c) ** 2 + (cy - c) ** 2) ** 0.5
    if off > 1.5:
        raise SystemExit(
            f"✗ {label} 的环不居中：外接框中心 ({cx:.1f},{cy:.1f})，画布中心 ({c:.1f},{c:.1f})，偏移 {off:.1f}px"
            f"（多半是又有人把「画小一点」写成了改 size —— 那会连中心一起挪走，要用 scale）"
        )
    print(f"  ✓ {label} 的环居中（偏移 {off:.2f}px，直径 {x1 - x0 + 1}px）")


def assert_drawing() -> None:
    """出图之前先验画对了。跑得比 `aa()` 便宜得多，所以放在最前面。"""
    print("self-check…")

    def maskable_s(x, y, w, h):
        m = mark_color(x, y, w, scale=0.62)
        return m if m is not None else (BRAND[0], BRAND[1], BRAND[2], 255)

    def rounded_s(x, y, w, h):
        if not in_rounded_rect(x, y, w, h, w * 0.22):
            return None
        m = mark_color(x, y, w)
        return m if m is not None else (BRAND[0], BRAND[1], BRAND[2], 255)

    def fg_s(x, y, w, h):
        return mark_color(x, y, w, scale=0.62)

    assert_ring_centred("maskable", maskable_s, 512)
    assert_ring_centred("桌面图标", rounded_s, 192)
    assert_ring_centred("自适应前景", fg_s, 432)


def android_assets() -> None:
    """
    把图标和启动图铺进 Capacitor 生成的安卓工程。

    ⚠️ 必须在 `npx cap add android` **之后**跑：`android/` 不存在时直接跳过，
    免得在一个纯 Web 的 checkout 上报错。
    ⚠️ 这里没有一句 `Remove-Item`/`unlink` —— 全部是**原地覆盖同名文件**。
    模板里 splash/图标的尺寸和文件名照抄，就不会出现"同一资源名两个文件"的冲突。
    """
    if not ANDROID_RES.is_dir():
        print("android/ 还没生成（先 npx cap add android），跳过安卓资源")
        return

    print("android icons…")
    for d, size in ANDROID_ICON.items():
        write_png(ANDROID_RES / f"mipmap-{d}" / "ic_launcher.png", size, size, rounded_logo(size))
        write_png(ANDROID_RES / f"mipmap-{d}" / "ic_launcher_round.png", size, size, round_logo(size))
    for d, size in ANDROID_FG.items():
        write_png(ANDROID_RES / f"mipmap-{d}" / "ic_launcher_foreground.png", size, size, foreground(size))

    # 自适应图标的底色 —— 与图标里的品牌绿一致
    (ANDROID_RES / "values" / "ic_launcher_background.xml").write_text(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
        "<resources>\n"
        f"    <color name=\"ic_launcher_background\">#{BRAND[0]:02X}{BRAND[1]:02X}{BRAND[2]:02X}</color>\n"
        "</resources>\n",
        encoding="utf-8",
    )

    print("android splash…")
    for folder, w, h in ANDROID_SPLASH:
        write_png(ANDROID_RES / folder / "splash.png", w, h, splash(w, h))


def main() -> None:
    assert_drawing()

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

    android_assets()

    print("done.")


if __name__ == "__main__":
    main()
