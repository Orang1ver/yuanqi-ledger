import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppInit } from "./components/shell/AppInit";
import { AndroidInstallHint } from "./components/shell/AndroidInstallHint";
import { BackupReminderBanner } from "./components/shell/BackupReminderBanner";
import { BootSplash } from "./components/shell/BootSplash";
import { IOSInstallHint } from "./components/shell/IOSInstallHint";
import { UpdateBanner } from "./components/shell/UpdateBanner";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

/**
 * 启动遮罩的环形几何：r=30 的圆周长 188.5，取 300° 的弧（157.08）+ 剩下一段缺口。
 * ⚠️ 数字要和 `scripts/make-icons.py` 里那个 300° 环**同一口径**（缺口留在左上），
 * 否则手机上是「系统启动图 → 这一层」会看见环转了个角度。
 */
const BOOT_RING_LEN = 157.08;
const BOOT_RING_CIRC = 188.5;

export const metadata: Metadata = {
  title: "元气账本",
  description: "记录每天的吃、喝、动、睡，看清自己的健康状况",
  manifest: `${basePath}/manifest.json`,
  appleWebApp: { capable: true, statusBarStyle: "default", title: "元气账本" },
  icons: {
    icon: `${basePath}/icons/icon-192.png`,
    apple: `${basePath}/icons/icon-192.png`,
  },
};

export const viewport: Viewport = {
  /*
   * 顶栏颜色只给一条（浅色）。深色改由运行期设置：主题可被用户手动选成
   * 浅色/深色/跟随系统，而 media 版的 meta 只能跟系统、跟不了手动选择。
   * 首帧由下面那段内联脚本贴 data-theme，lib/theme.ts 的 applyTheme 负责同步这条 meta。
   */
  themeColor: "#F7F5EF",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/** iOS 启动图：没有它，从主屏打开会先闪一下白屏 */
const SPLASH: { w: number; h: number; dpr: number }[] = [
  { w: 430, h: 932, dpr: 3 },
  { w: 393, h: 852, dpr: 3 },
  { w: 428, h: 926, dpr: 3 },
  { w: 390, h: 844, dpr: 3 },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <head>
        {/*
          首帧防闪：在 React 之前同步把主题贴到 <html data-theme>。
          不引 next-themes 之类的运行时依赖，几行内联脚本就够，也更可控。
          ⚠️ 键名 `recipe.prefs.v1` 是历史数据契约，读的是用户既有的偏好，不能改。
          ⚠️ 这里的判断必须与 lib/theme.ts 一致（那边负责运行期切换与系统跟随）；
          这里只管"第一笔绘制前别闪"，所以不碰 meta（此时 head 还没排完）。
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var p=JSON.parse(localStorage.getItem('recipe.prefs.v1')||'{}');" +
              "var c=p&&p.theme;var d=c==='dark'||(c!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);" +
              "document.documentElement.dataset.theme=d?'dark':'light';}catch(e){}})();" +
              /*
               * 启动遮罩的兜底出口：正常由 BootSplash 在 ~420ms 收掉，
               * 万一 React 没起来（或水合报错），4 秒后无条件收掉 ——
               * 一层永远不会消失的遮罩比白屏更糟：用户会以为卡死了。
               */
              "setTimeout(function(){document.documentElement.dataset.boot='done'},4000);",
          }}
        />
        {SPLASH.map((s) => (
          <link
            key={`${s.w}x${s.h}`}
            rel="apple-touch-startup-image"
            href={`${basePath}/splash/splash-${s.w}x${s.h}@${s.dpr}x.png`}
            media={`(device-width: ${s.w}px) and (device-height: ${s.h}px) and (-webkit-device-pixel-ratio: ${s.dpr})`}
          />
        ))}
      </head>
      <body className="min-h-full flex flex-col">
        {/*
          启动动画的遮罩。刻意**服务端渲染**在这里（不是客户端组件画的）：
          它要盖住的正是"HTML 到了、React 还没水合"那段白屏，放客户端就来不及了。
          BootSplash 只负责在挂载后把它收掉（见那个文件的注释）。
          `aria-hidden` 是因为它纯装饰，读屏不该念它。
        */}
        <div id="yq-boot" aria-hidden="true">
          <svg className="yq-boot-mark" viewBox="0 0 100 100" width="92" height="92" role="presentation">
            <rect x="0" y="0" width="100" height="100" rx="22" fill="var(--yq-primary)" />
            <circle
              className="yq-boot-ring"
              cx="50"
              cy="50"
              r="30"
              fill="none"
              stroke="#fff"
              strokeWidth="7.5"
              strokeLinecap="round"
              strokeDasharray={`${BOOT_RING_LEN} ${BOOT_RING_CIRC}`}
              transform="rotate(-90 50 50)"
            />
          </svg>
          <p className="yq-boot-name">元气账本</p>
          {/* 没有 JS 就没有这个应用，但至少别让装饰盖住整页 */}
          <noscript>
            <style>{"#yq-boot{display:none}"}</style>
          </noscript>
        </div>
        <BootSplash />
        <AppInit />
        <UpdateBanner />
        <IOSInstallHint />
        <AndroidInstallHint />
        <BackupReminderBanner />
        {children}
      </body>
    </html>
  );
}
