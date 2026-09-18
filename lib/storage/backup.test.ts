/**
 * 备份层的单元测试。
 *
 * 这个文件重点压两件事，两件的错法都是**静默**的：
 *
 *  1) **预览数出来的条数，必须与 `importBackup` 真正会写进去的条数一致。**
 *     预览说「3 条」而实际写 5 条，用户在确认那一刻是看不出来的 ——
 *     要等他发现数据不对才回头怀疑，那时已经覆盖完了。
 *     所以两边共用同一套过滤规则，这里钉住它。
 *
 *  2) **「整份覆盖」的撤销必须真的回到原样。**
 *     最容易写错的版本是"把快照里的键写回去"——那样会漏掉
 *     「导入之后才出现、快照里根本没有」的键，撤销完还留着上次导入的残留，
 *     比不撤更让人困惑。所以单独有一条钉它。
 */

import { strict as assert } from "node:assert";
import { beforeEach, describe, it } from "node:test";

class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

const storage = new MemoryStorage();
(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { localStorage: unknown }).localStorage = storage;

import { KEYS } from "./keys";
import {
  BACKUP_APP_NAME,
  describeBackupDetail,
  importBackup,
  peekImportUndo,
  pushImportUndo,
  undoImport,
} from "./backup";

/** 造一份备份文本。`data` 的每个值会被序列化成字符串 —— 与真实导出格式一致 */
function backupText(
  data: Record<string, unknown>,
  opts: { app?: string; includesApiKey?: boolean; exportedAt?: string } = {},
): string {
  return JSON.stringify({
    app: opts.app ?? BACKUP_APP_NAME,
    version: 1,
    exportedAt: opts.exportedAt ?? "2026-09-19T00:00:00.000Z",
    includesApiKey: opts.includesApiKey ?? false,
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, JSON.stringify(v)])),
  });
}

describe("导入预览（结构化）", () => {
  beforeEach(() => storage.clear());

  it("每一类数出来的条数，就是它实际的条数", () => {
    const d = describeBackupDetail(
      backupText({
        [KEYS.dietLog]: [{ id: "a" }, { id: "b" }, { id: "c" }],
        [KEYS.dailyCheckins]: { "2026-09-18": { water: 1800 }, "2026-09-19": { water: 2000 } },
        [KEYS.healthProfile]: { height: 165, weight: 56 },
      }),
    );
    assert.equal(d.ok, true);
    if (!d.ok) return;
    assert.equal(d.total, 3);
    const byLabel = new Map(d.groups.map((g) => [g.label, g.count]));
    assert.equal(byLabel.get("饮食日记"), 3);
    assert.equal(byLabel.get("打卡记录"), 2);
    assert.equal(byLabel.get("健康档案"), 1);
    assert.equal(d.exportedAt, "2026-09-19T00:00:00.000Z");
    assert.equal(d.legacy, false);
  });

  it("⚠ 单份数据按「份」算，不按内部字段数 —— 否则会说「健康档案 3 条」", () => {
    const d = describeBackupDetail(
      backupText({ [KEYS.healthProfile]: { height: 165, weight: 56, age: 26 } }),
    );
    assert.equal(d.ok, true);
    if (!d.ok) return;
    assert.equal(d.groups.find((g) => g.label === "健康档案")?.count, 1);
  });

  it("同名下的多个键会累加（运动记录 = exercises + exerciseAwards）", () => {
    const d = describeBackupDetail(
      backupText({
        [KEYS.exercises]: [{ id: "e1" }, { id: "e2" }],
        [KEYS.exerciseAwards]: [{ id: "a1" }],
      }),
    );
    assert.equal(d.ok, true);
    if (!d.ok) return;
    assert.equal(d.groups.find((g) => g.label === "运动记录")?.count, 3);
  });

  it("AI Key 以**实际内容**为准，不看那个导出时写的字段", () => {
    const d = describeBackupDetail(
      backupText({ [KEYS.apikeys]: { deepseekKey: "sk-x" } }, { includesApiKey: false }),
    );
    assert.equal(d.ok, true);
    if (!d.ok) return;
    assert.equal(d.includesApiKey, true);
  });

  it("来自更早版本的备份标成 legacy（app 名字对不上）", () => {
    const d = describeBackupDetail(backupText({ [KEYS.dietLog]: [] }, { app: "今天吃什么呀" }));
    assert.equal(d.ok, true);
    if (!d.ok) return;
    assert.equal(d.legacy, true);
  });

  it("不是 recipe. 前缀的键不算数据 —— 与 importBackup 同一套规则", () => {
    const raw = JSON.stringify({
      app: BACKUP_APP_NAME,
      version: 1,
      data: { "other.thing": "{}", [KEYS.dietLog]: "[]" },
    });
    const d = describeBackupDetail(raw);
    assert.equal(d.ok, true);
    if (!d.ok) return;
    assert.equal(d.total, 1);
  });

  it("坏 JSON / 缺 data / data 为空：给可读的原因，不抛异常", () => {
    const cases: [string, string][] = [
      ["{不是 JSON", "不是有效"],
      [JSON.stringify({ app: BACKUP_APP_NAME }), "缺少 data"],
      [JSON.stringify({ app: BACKUP_APP_NAME, data: {} }), "没有可恢复"],
      [JSON.stringify({ app: BACKUP_APP_NAME, data: { "other.x": "{}" } }), "没有可恢复"],
    ];
    for (const [text, kw] of cases) {
      const d = describeBackupDetail(text);
      assert.equal(d.ok, false, `应当判定为不可用：${text.slice(0, 40)}`);
      if (d.ok) continue;
      assert.match(d.reason, new RegExp(kw), `原因里应当提到「${kw}」`);
    }
  });

  it("解析不了时给的是可读原因，不是抛异常", () => {
    const d = describeBackupDetail("{坏了");
    assert.equal(d.ok, false);
    if (d.ok) return;
    assert.match(d.reason, /不是有效/);
  });
});

describe("整份覆盖的撤销", () => {
  beforeEach(() => storage.clear());

  it("没有快照时说得很清楚，而不是假装成功", () => {
    assert.equal(peekImportUndo(), null);
    assert.equal(undoImport(), 0);
  });

  it("merge 不存快照 —— 它本来就不覆盖任何东西", () => {
    storage.setItem(KEYS.dietLog, "[]");
    importBackup(backupText({ [KEYS.weights]: { "2026-09-19": 56 } }), "merge");
    assert.equal(peekImportUndo(), null);
  });

  it("overwrite 存快照，撤销之后回到原样", () => {
    storage.setItem(KEYS.dietLog, JSON.stringify([{ id: "old" }]));
    storage.setItem(KEYS.weights, JSON.stringify({ "2026-09-18": 57 }));

    importBackup(backupText({ [KEYS.dietLog]: [{ id: "new" }] }), "overwrite");
    assert.equal((JSON.parse(storage.getItem(KEYS.dietLog)!) as { id: string }[])[0].id, "new");
    assert.notEqual(peekImportUndo(), null);

    const n = undoImport();
    assert.ok(n >= 2, `至少该恢复 2 个键，实际 ${n}`);
    assert.equal((JSON.parse(storage.getItem(KEYS.dietLog)!) as { id: string }[])[0].id, "old");
    assert.equal(storage.getItem(KEYS.weights), JSON.stringify({ "2026-09-18": 57 }));

    // 只能撤一次
    assert.equal(peekImportUndo(), null);
    assert.equal(undoImport(), 0);
  });

  it("⚠ 导入之后才出现的键，撤销时必须被清掉", () => {
    // 这是最容易写错的一条：只"把快照写回去"会留下上次导入的残留
    storage.setItem(KEYS.dietLog, "[]");
    importBackup(
      backupText({ [KEYS.dietLog]: [{ id: "n" }], [KEYS.takeoutMock]: [{ id: "t" }] }),
      "overwrite",
    );
    assert.notEqual(storage.getItem(KEYS.takeoutMock), null, "前置：导入确实写进了新键");

    undoImport();
    assert.equal(storage.getItem(KEYS.dietLog), "[]");
    assert.equal(storage.getItem(KEYS.takeoutMock), null, "导入后才有的键必须被清掉");
  });

  it("快照里不会有它自己 —— 否则会自我嵌套", () => {
    storage.setItem(KEYS.dietLog, "[]");
    pushImportUndo("overwrite");
    const snap = peekImportUndo();
    assert.notEqual(snap, null);
    assert.equal(snap!.data[KEYS.importUndo], undefined);
  });

  it("快照数据被改坏时当作没有，而不是崩", () => {
    storage.setItem(KEYS.importUndo, "{不是 JSON");
    assert.equal(peekImportUndo(), null);
    storage.setItem(KEYS.importUndo, JSON.stringify({ data: {} }));
    assert.equal(peekImportUndo(), null, "缺 at 的残值不算有效快照");
  });
});
