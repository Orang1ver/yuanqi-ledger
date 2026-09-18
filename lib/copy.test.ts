/**
 * 文案表的单测。
 *
 * 这里能验的只有**结构**：名字齐不齐、有没有重名。验不了"文案写得好不好"——
 * 那种事没有机器可判的判据，硬造一条只会变成摆设。
 *
 * 所以只钉三类**真的会出错**的地方：
 *  1) 加了页面、忘了给它名字（导航上会显示 undefined）；
 *  2) 两个页面共用同一个显示名（复制粘贴留下的）；
 *  3) **文案里带了 Markdown 的 `**`** —— JSX 会把它**原样显示成星号**。
 *     第 3 条不是假想：周报页那句「参考区间」原来就在屏幕上印着 `**`。
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { DISCLAIMER, HEALTHY_RANGE_NOTE, PAGE_LABELS, PAGE_ROUTES } from "./copy";

describe("页面名表", () => {
  it("每个导航项都有非空的显示名", () => {
    for (const t of PAGE_ROUTES) {
      const label = PAGE_LABELS[t.key];
      assert.equal(typeof label, "string", `路由 ${t.href} 的 key「${t.key}」在 PAGE_LABELS 里没有名字`);
      assert.ok(label.trim().length > 0, `路由 ${t.href} 的显示名是空的`);
    }
  });

  it("没有两个页面共用同一个显示名", () => {
    const seen = new Map<string, string>();
    for (const t of PAGE_ROUTES) {
      const label = PAGE_LABELS[t.key];
      const prev = seen.get(label);
      assert.equal(prev, undefined, `「${label}」同时被 ${prev} 和 ${t.href} 用了 —— 用户没法区分`);
      seen.set(label, t.href);
    }
  });

  it("路由写法一致：除首页外都以 / 结尾（子路径部署要的）", () => {
    for (const t of PAGE_ROUTES) {
      if (t.href === "/") continue;
      assert.ok(t.href.endsWith("/"), `路由 ${t.href} 没有以 / 结尾`);
      assert.ok(t.href.startsWith("/"), `路由 ${t.href} 不是绝对路径`);
    }
  });

  it("导航项之间没有重复路由", () => {
    const hrefs = PAGE_ROUTES.map((t) => t.href);
    assert.equal(new Set(hrefs).size, hrefs.length, `有重复路由：${hrefs.join("、")}`);
  });
});

describe("共享文案", () => {
  it("⚠ 不含 Markdown 的 ** —— JSX 会把它原样显示出来", () => {
    for (const [name, text] of [
      ["DISCLAIMER", DISCLAIMER],
      ["HEALTHY_RANGE_NOTE", HEALTHY_RANGE_NOTE],
    ] as const) {
      assert.doesNotMatch(text, /\*\*/, `${name} 里有 Markdown 星号，屏幕上会真的显示出来`);
    }
  });

  it("都是写给用户看的整句，不是占位符", () => {
    for (const [name, text] of [
      ["DISCLAIMER", DISCLAIMER],
      ["HEALTHY_RANGE_NOTE", HEALTHY_RANGE_NOTE],
    ] as const) {
      assert.ok(text.length >= 10, `${name} 太短了，像是没写完`);
      assert.doesNotMatch(text, /TODO|FIXME|XXX/i, `${name} 里留着占位符`);
    }
  });

  it("免责声明说清了两件事：是估算、不构成医学建议", () => {
    assert.match(DISCLAIMER, /估算|参考/);
    assert.match(DISCLAIMER, /医学|医生/);
  });
});
