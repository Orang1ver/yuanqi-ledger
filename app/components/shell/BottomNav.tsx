"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 底部导航。
 *
 * ⚠️ 站内跳转**必须**用 next/link 的 <Link>：Next.js 只给 <Link> 自动加 basePath，
 * 原生 <a href="/health"> 在子路径部署下会跳到站点根目录、直接 404。
 * 这个坑在本项目的历史上出现过，`no-html-link-for-pages` 那条 lint 报错就是它，别忽略。
 */

const TABS = [
  { href: "/", label: "今天", icon: "◉" },
  { href: "/health/", label: "健康", icon: "♥" },
  { href: "/takeout/", label: "菜单", icon: "▤" },
  { href: "/weekly/", label: "周报", icon: "▦" },
] as const;

export function BottomNav() {
  const pathname = usePathname() || "/";

  return (
    <nav
      style={{
        position: "sticky",
        bottom: 0,
        zIndex: 30,
        borderTop: "1px solid var(--yq-line)",
        background: "var(--yq-surface)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div
        style={{
          maxWidth: 560,
          marginInline: "auto",
          display: "grid",
          gridTemplateColumns: `repeat(${TABS.length}, 1fr)`,
        }}
      >
        {TABS.map((t) => {
          const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                padding: "9px 0 10px",
                textDecoration: "none",
                color: active ? "var(--yq-primary)" : "var(--yq-muted)",
                fontSize: 11,
                fontWeight: active ? 700 : 500,
              }}
            >
              <span style={{ fontSize: 17, lineHeight: 1 }}>{t.icon}</span>
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** 页面顶部标题栏，右侧放操作按钮 */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 12,
        padding: "18px 0 12px",
      }}
    >
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>{title}</h1>
        {subtitle && <p className="yq-hint" style={{ marginTop: 3 }}>{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
