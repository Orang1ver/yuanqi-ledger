/**
 * OTA 纯逻辑单测。
 *
 * 重点全在**坏输入不许炸** —— 清单来自网络，可能被截断、被 CDN 改写、被代理塞进一个 HTML。
 * 另外钉住两条容易写错的判据：
 *   - 路径安全性（不接受绝对路径 / `..` / 反斜杠）
 *   - 增量只按 sha256 比，不看文件大小
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  isComplete,
  otaDir,
  otaRemotePath,
  otaTmpDir,
  OTA_LOCAL_MANIFEST,
  OTA_ROOT,
  parseManifest,
  planDownload,
  readVersion,
  sha256Hex,
  totalBytes,
  verifyFile,
} from "./ota";

/** 造一份合法的 version.json */
function good(overrides: Record<string, unknown> = {}) {
  return {
    version: "1.3.0",
    build: "20260919.1600",
    site: "https://example.test/app",
    apk: "apk/app-1.3.0.apk",
    ota: {
      files: [
        { path: "index.html", bytes: 100, sha256: "a".repeat(64) },
        { path: "_next/static/chunks/x.js", bytes: 200, sha256: "b".repeat(64) },
      ],
    },
    ...overrides,
  };
}

const buf = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe("readVersion —— 只取版本号，不要求带 ota 清单", () => {
  it("有 ota 清单时就是外层那个 version", () => {
    assert.equal(readVersion(good()), "1.3.0");
  });

  it("⚠️ 没有 ota 字段也拿得到 —— 线上还是老部署时，「暂无更新」不该被报成失败", () => {
    assert.equal(readVersion({ version: "1.2.0", apk: "apk/yuanqi-ledger-1.2.0.apk" }), "1.2.0");
  });

  it("两端空白要 trim", () => {
    assert.equal(readVersion({ version: "  1.3.0  " }), "1.3.0");
  });

  it("坏输入一律 null（版本号来自网络，坏数据不该让检查更新崩掉）", () => {
    const bad = [null, undefined, 0, "", "1.3.0", [], {}, { version: "" }, { version: "   " }, { version: 3 }];
    for (const input of bad) {
      assert.equal(readVersion(input), null, `应当为 null：${JSON.stringify(input) ?? String(input)}`);
    }
  });
});

describe("readVersion 与 parseManifest 的分工", () => {
  /**
   * ⚠️ 这是「先比版本号、再解析清单」那个顺序的判据。
   * 反过来的话，下面这种老部署（线上真实存在过：1.2.0 的 version.json 就没有 ota 字段）
   * 会被当成一次错误，而不是「已是最新版本」。
   */
  it("没有 ota 清单时：readVersion 成功，parseManifest 失败", () => {
    const older = { version: "1.2.0", apk: "apk/yuanqi-ledger-1.2.0.apk" };
    assert.equal(readVersion(older), "1.2.0");
    assert.equal(parseManifest(older), null);
  });
});

describe("parseManifest —— 正常情况", () => {
  it("取出版本号与文件列表", () => {
    const m = parseManifest(good());
    assert.ok(m);
    assert.equal(m.version, "1.3.0");
    assert.equal(m.files.length, 2);
    assert.equal(m.files[0].path, "index.html");
  });

  it("sha256 统一成小写（远端大小写不该影响比对）", () => {
    const m = parseManifest(
      good({ ota: { files: [{ path: "a.js", bytes: 1, sha256: "A".repeat(64) }] } }),
    );
    assert.ok(m);
    assert.equal(m.files[0].sha256, "a".repeat(64));
  });

  it("版本号前后空白会被去掉", () => {
    const m = parseManifest(good({ version: "  1.3.0  " }));
    assert.ok(m);
    assert.equal(m.version, "1.3.0");
  });

  it("没有 base 字段 = 产物就在站点根（老清单的语义）", () => {
    const m = parseManifest(good());
    assert.ok(m);
    assert.equal(m.base, "");
  });

  it("带 base 字段时原样取出来", () => {
    const m = parseManifest(
      good({ ota: { base: "ota", files: [{ path: "index.html", bytes: 1, sha256: "a".repeat(64) }] } }),
    );
    assert.ok(m);
    assert.equal(m.base, "ota");
  });
});

/*
 * `base` 是 OTA 产物与站点产物**基址不同**的产物：站点在子路径下，
 * 壳的 WebView 在根下，所以发布时要单独构建一份根基址的产物放在这个目录里。
 * 这几个用例钉住"缺省宽松、写错严格"，以及拼 URL 的边界。
 */
describe("base —— OTA 产物在站点上的目录", () => {
  const withBase = (base: unknown) =>
    parseManifest(
      good({ ota: { base, files: [{ path: "index.html", bytes: 1, sha256: "a".repeat(64) }] } }),
    );

  it("undefined / null 都当站点根", () => {
    assert.equal(withBase(undefined)?.base, "");
    assert.equal(withBase(null)?.base, "");
  });

  it("空字符串也是站点根", () => {
    assert.equal(withBase("")?.base, "");
  });

  it("多级目录可以（`assets/ota`）", () => {
    assert.equal(withBase("assets/ota")?.base, "assets/ota");
  });

  it("⚠️ 写了但不安全 → 整份作废", () => {
    const bad: Array<[string, unknown]> = [
      ["绝对路径", "/ota"],
      ["结尾多余斜杠（拼出来会变 ota//x）", "ota/"],
      ["往上跳", "../ota"],
      ["反斜杠", "ota\\sub"],
      ["点开头", ".ota"],
      ["双斜杠", "a//b"],
      ["不是字符串", 42],
    ];
    for (const [name, base] of bad) {
      assert.equal(withBase(base), null, `应当拒绝：${name}`);
    }
  });

  it("otaRemotePath 拼出来的地址", () => {
    assert.equal(otaRemotePath("", "index.html"), "index.html");
    assert.equal(otaRemotePath("ota", "index.html"), "ota/index.html");
    assert.equal(otaRemotePath("ota", "_next/static/chunks/x.js"), "ota/_next/static/chunks/x.js");
  });
});

describe("parseManifest —— ⚠️ 坏数据一律返回 null", () => {
  const cases: Array<[string, unknown]> = [
    ["null", null],
    ["字符串", "not json at all"],
    ["数字", 42],
    ["数组", []],
    ["空对象（没有 version）", {}],
    ["version 是空白", good({ version: "   " })],
    ["version 不是字符串", good({ version: 130 })],
    ["没有 ota 字段", { version: "1.3.0" }],
    ["ota 不是对象", good({ ota: "nope" })],
    ["ota.files 不存在", good({ ota: {} })],
    ["ota.files 不是数组", good({ ota: { files: {} } })],
    ["ota.files 是空数组", good({ ota: { files: [] } })],
    ["条目不是对象", good({ ota: { files: ["index.html"] } })],
    ["条目缺 path", good({ ota: { files: [{ bytes: 1, sha256: "a".repeat(64) }] } })],
    ["条目 path 是空串", good({ ota: { files: [{ path: "", bytes: 1, sha256: "a".repeat(64) }] } })],
    ["条目缺 bytes", good({ ota: { files: [{ path: "a.js", sha256: "a".repeat(64) }] } })],
    [
      "bytes 是负数",
      good({ ota: { files: [{ path: "a.js", bytes: -1, sha256: "a".repeat(64) }] } }),
    ],
    [
      "bytes 不是数字",
      good({ ota: { files: [{ path: "a.js", bytes: "100", sha256: "a".repeat(64) }] } }),
    ],
    ["sha256 太短", good({ ota: { files: [{ path: "a.js", bytes: 1, sha256: "abc" }] } })],
    [
      "sha256 含非十六进制字符",
      good({ ota: { files: [{ path: "a.js", bytes: 1, sha256: "z".repeat(64) }] } }),
    ],
    [
      "⚠ 路径是绝对路径",
      good({ ota: { files: [{ path: "/etc/passwd", bytes: 1, sha256: "a".repeat(64) }] } }),
    ],
    [
      "⚠ 路径往上跳",
      good({ ota: { files: [{ path: "../../secret", bytes: 1, sha256: "a".repeat(64) }] } }),
    ],
    [
      "⚠ 路径中间藏 ..",
      good({ ota: { files: [{ path: "a/../../b", bytes: 1, sha256: "a".repeat(64) }] } }),
    ],
    [
      "⚠ 路径带反斜杠（Windows 风格混入）",
      good({ ota: { files: [{ path: "a\\b.js", bytes: 1, sha256: "a".repeat(64) }] } }),
    ],
    [
      "⚠ 路径以点开头（`.nojekyll` 那种不该进清单）",
      good({ ota: { files: [{ path: ".env", bytes: 1, sha256: "a".repeat(64) }] } }),
    ],
    [
      "⚠ 同一路径出现两次（清单自相矛盾）",
      good({
        ota: {
          files: [
            { path: "a.js", bytes: 1, sha256: "a".repeat(64) },
            { path: "a.js", bytes: 2, sha256: "b".repeat(64) },
          ],
        },
      }),
    ],
  ];

  for (const [name, input] of cases) {
    it(name, () => {
      assert.equal(parseManifest(input), null);
    });
  }

  it("⚠ 只要有一条坏，整份清单作废（不能只跳过那一条）", () => {
    const m = parseManifest(
      good({
        ota: {
          files: [
            { path: "ok.js", bytes: 1, sha256: "a".repeat(64) },
            { path: "../evil", bytes: 1, sha256: "b".repeat(64) },
          ],
        },
      }),
    );
    assert.equal(m, null);
  });
});

describe("planDownload —— 增量", () => {
  it("本地全都有且哈希相同 → 一个都不用下", () => {
    const m = parseManifest(good());
    assert.ok(m);
    const present = { "index.html": "a".repeat(64), "_next/static/chunks/x.js": "b".repeat(64) };
    assert.deepEqual(planDownload(m, present), []);
  });

  it("只有一个变了 → 只下那一个", () => {
    const m = parseManifest(good());
    assert.ok(m);
    const present = { "index.html": "a".repeat(64), "_next/static/chunks/x.js": "CHANGED" };
    const plan = planDownload(m, present);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].path, "_next/static/chunks/x.js");
  });

  it("本地什么都没有 → 全部要下", () => {
    const m = parseManifest(good());
    assert.ok(m);
    assert.equal(planDownload(m, {}).length, 2);
  });

  it("⚠ 只按 sha256 判断，不看大小（大小相同也该重下）", () => {
    const m = parseManifest(good());
    assert.ok(m);
    // 本地记的是「大小一样、内容不同」的文件 —— 不能因为 bytes 相等就跳过
    const present = { "index.html": "f".repeat(64) };
    const plan = planDownload(m, present);
    assert.equal(plan.length, 2, "两个文件都该重下");
  });
});

describe("isComplete", () => {
  it("全部校验通过 → true", () => {
    const m = parseManifest(good());
    assert.ok(m);
    assert.equal(
      isComplete(m, { "index.html": true, "_next/static/chunks/x.js": true }),
      true,
    );
  });

  it("⚠ 缺一个 → false（差一个文件就不是完整产物）", () => {
    const m = parseManifest(good());
    assert.ok(m);
    assert.equal(isComplete(m, { "index.html": true }), false);
  });

  it("⚠ 有一个是 false（校验没过）→ false", () => {
    const m = parseManifest(good());
    assert.ok(m);
    assert.equal(
      isComplete(m, { "index.html": true, "_next/static/chunks/x.js": false }),
      false,
    );
  });
});

describe("目录名", () => {
  it("版本目录与临时目录", () => {
    assert.equal(otaDir("1.3.0"), "ota/1.3.0");
    assert.equal(otaTmpDir("1.3.0"), "ota/1.3.0.tmp");
    assert.equal(OTA_ROOT, "ota");
  });

  it("⚠ 本地清单文件名点开头（否则会被站点清单收进去、再下回来一遍）", () => {
    assert.ok(OTA_LOCAL_MANIFEST.startsWith("."));
  });
});

describe("totalBytes", () => {
  it("求和；空数组是 0", () => {
    assert.equal(
      totalBytes([
        { path: "a", bytes: 10, sha256: "a".repeat(64) },
        { path: "b", bytes: 32, sha256: "b".repeat(64) },
      ]),
      42,
    );
    assert.equal(totalBytes([]), 0);
  });
});

describe("sha256 与校验", () => {
  it("空内容的 sha256 是那个众所周知的常量", async () => {
    assert.equal(
      await sha256Hex(new ArrayBuffer(0)),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it('"hello" 的 sha256 正确（证明算的是字节、不是字符串编码后的别的东西）', async () => {
    assert.equal(
      await sha256Hex(buf("hello")),
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("verifyFile：对上 → true，对不上 → false", async () => {
    const expect = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    assert.equal(await verifyFile(buf("hello"), expect), true);
    assert.equal(await verifyFile(buf("hello!"), expect), false);
  });

  it("verifyFile：期望值大写也能对上", async () => {
    const upper = "2CF24DBA5FB0A30E26E83B2AC5B9E29E1B161E5C1FA7425E73043362938B9824";
    assert.equal(await verifyFile(buf("hello"), upper), true);
  });
});
