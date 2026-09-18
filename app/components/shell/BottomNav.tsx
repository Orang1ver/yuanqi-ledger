"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PAGE_LABELS, PAGE_ROUTES } from "@/lib/copy";

/**
 * 底部导航。
 *
 * ⚠️ 站内跳转**必须**用 next/link 的 <Link>：Next.js 只给 <Link> 自动加 basePath，
 * 原生 <a href="/health"> 在子路径部署下会跳到站点根目录、直接 404。
 * 这个坑在本项目的历史上出现过，`no-html-link-for-pages` 那条 lint 报错就是它，别忽略。
 */

/*
 * 页面名与路由都来自 lib/copy.ts —— 同一个页面在导航、页头、提示语里必须是同一个名字。
 * 这里原来写死的是「菜单」，而页头写的是「菜单库」、提示语又让用户「去「菜单」关联一下」，
 * 他照着去找的是一个叫「菜单库」的页面。
 */
const TABS = PAGE_ROUTES;

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
              {PAGE_LABELS[t.key]}
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
