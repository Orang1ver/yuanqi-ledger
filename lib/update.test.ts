/**
 * 应用内更新的纯逻辑单测。
 *
 * 这里只测**判据**（版本号怎么比）与**坏数据怎么处理** ——
 * 更新检查的失败是常态（离线、超时、返回一坨 HTML），所以重点全在"坏输入不许炸"。
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  apkDownloadUrl,
  checkBase,
  compareVersion,
  fetchRemoteVersion,
  isNewer,
  REMOTE_SITE,
  versionUrl,
} from "./update";

/** 造一个假 fetch，只关心 URL 与返回 */
function fakeFetch(body: string, init: { ok?: boolean; status?: number; throw?: boolean } = {}) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push(url);
    if (init.throw) throw new Error("network down");
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => JSON.parse(body),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("版本号比较", () => {
  it("⚠ 按数字段比，不是按字符串比 —— 1.10.0 比 1.9.0 新", () => {
    assert.equal(compareVersion("1.10.0", "1.9.0"), 1);
    assert.equal(compareVersion("1.9.0", "1.10.0"), -1);
    // 字符串比会得出相反的结论，这条就是钉它
    assert.ok("1.10.0" < "1.9.0", "（说明：字符串比确实是反的）");
  });

  it("段数不同时缺的当 0：1.0 与 1.0.0 相等", () => {
    assert.equal(compareVersion("1.0", "1.0.0"), 0);
    assert.equal(compareVersion("1.0.0", "1.0"), 0);
    assert.equal(compareVersion("1.0.1", "1.0"), 1);
  });

  it("允许前缀 v（tag 上就带着它）", () => {
    assert.equal(compareVersion("v1.2.0", "1.2.0"), 0);
    assert.equal(compareVersion("v1.2.1", "1.2.0"), 1);
  });

  it("坏数据不抛错：认不出来的段当 0", () => {
    assert.equal(compareVersion("", "0"), 0);
    assert.equal(compareVersion("abc", "0.0.0"), 0);
    assert.equal(compareVersion("1.x.3", "1.0.3"), 0);
  });

  it("isNewer 只在真的更新时为真（同版本、旧版本都不算）", () => {
    assert.equal(isNewer("1.0.1", "1.0.0"), true);
    assert.equal(isNewer("1.0.0", "1.0.0"), false);
    assert.equal(isNewer("0.9.9", "1.0.0"), false);
  });
});

describe("读远端版本", () => {
  const BASE = "/yuanqi-ledger";

  it("正常读到版本与安装包地址", async () => {
    const { impl, calls } = fakeFetch('{"version":"1.0.1","apk":"apk/yuanqi-ledger-1.0.1.apk"}');
    const r = await fetchRemoteVersion(BASE, { fetchImpl: impl });
    assert.deepEqual(r, { version: "1.0.1", apk: "apk/yuanqi-ledger-1.0.1.apk" });
    // ⚠️ URL 上必须带时间戳：这个文件被缓存住的话「检查更新」就是摆设
    assert.match(calls[0], /\/yuanqi-ledger\/version\.json\?t=\d+/);
  });

  it("没发布安装包时 apk 是 null（网页版就是这个形态）", async () => {
    const { impl } = fakeFetch('{"version":"1.0.1"}');
    assert.deepEqual(await fetchRemoteVersion(BASE, { fetchImpl: impl }), {
      version: "1.0.1",
      apk: null,
    });
  });

  it("⚠ 所有失败都变成 null，绝不抛：离线 / 404 / 不是 JSON / 字段不对", async () => {
    const netDown = fakeFetch("{}", { throw: true });
    assert.equal(await fetchRemoteVersion(BASE, { fetchImpl: netDown.impl }), null);

    const notFound = fakeFetch("{}", { ok: false, status: 404 });
    assert.equal(await fetchRemoteVersion(BASE, { fetchImpl: notFound.impl }), null);

    const html = fakeFetch("<!DOCTYPE html><html></html>");
    assert.equal(await fetchRemoteVersion(BASE, { fetchImpl: html.impl }), null);

    for (const body of ['{"version":""}', '{"version":123}', "null", "[]", "{}"]) {
      const bad = fakeFetch(body);
      assert.equal(await fetchRemoteVersion(BASE, { fetchImpl: bad.impl }), null, `坏数据：${body}`);
    }
  });

  it("地址按 basePath 拼（子路径部署时不能漏）", () => {
    assert.equal(versionUrl("/yuanqi-ledger"), "/yuanqi-ledger/version.json");
    assert.equal(versionUrl(""), "/version.json");
  });

  it("⚠ 壳里问线上站点，网页版问自己 —— 壳里 location.origin 是 localhost", () => {
    assert.equal(checkBase(true, ""), REMOTE_SITE);
    assert.equal(checkBase(true, "/yuanqi-ledger"), REMOTE_SITE);
    assert.equal(checkBase(false, "/yuanqi-ledger"), "/yuanqi-ledger");
    assert.match(REMOTE_SITE, /^https:\/\//, "壳里拼接出来的必须是绝对地址，否则下不动");
  });

  it("安装包地址用检查更新那个基址拼（不能用 location.origin）", () => {
    assert.equal(
      apkDownloadUrl(REMOTE_SITE, "apk/yuanqi-ledger-1.0.1.apk"),
      `${REMOTE_SITE}/apk/yuanqi-ledger-1.0.1.apk`,
    );
    assert.equal(
      apkDownloadUrl("/yuanqi-ledger", "apk/x.apk"),
      "/yuanqi-ledger/apk/x.apk",
      "网页版用相对地址就够",
    );
    // 已经是绝对地址就原样返回
    assert.equal(apkDownloadUrl("/y", "https://example.com/x.apk"), "https://example.com/x.apk");
  });
});
