import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppInit } from "./components/shell/AppInit";
import { AndroidInstallHint } from "./components/shell/AndroidInstallHint";
import { BackupReminderBanner } from "./components/shell/BackupReminderBanner";
import { IOSInstallHint } from "./components/shell/IOSInstallHint";
import { UpdateBanner } from "./components/shell/UpdateBanner";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

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
              "document.documentElement.dataset.theme=d?'dark':'light';}catch(e){}})();",
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
