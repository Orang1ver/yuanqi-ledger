import { strict as assert } from "node:assert";
import { beforeEach, test } from "node:test";
import { applyWeRunSteps, previewWeRunSteps } from "./werun";
import { loadAllCheckins, saveCheckin } from "./health";
import { KEYS } from "./keys";
import type { WeRunSnapshot } from "../werun";

const records = new Map<string, string>();
let writes = 0;
let failWrites = false;
(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem(key: string) { return records.get(key) ?? null; },
  setItem(key: string, value: string) {
    if (failWrites) throw new Error("QuotaExceededError");
    writes++; records.set(key, value);
  },
};
const snapshot: WeRunSnapshot = { syncedAt: 1790964000000, days: [
  { date: "2026-10-03", steps: 4321 },
  { date: "2026-10-02", steps: 0 },
  { date: "2026-09-04", steps: 5678 },
] };
beforeEach(() => { records.clear(); writes = 0; failWrites = false; });
function seed() {
  records.set(KEYS.dailyCheckins, JSON.stringify({
    "2026-10-03": { date: "2026-10-03", steps: 1000, waterMl: 900, sleepHours: 7.5, mood: "好", updatedAt: 1 },
    "2026-10-02": { date: "2026-10-02", steps: 500, waterMl: 0, sleepHours: 0, mood: "累", updatedAt: 2 },
    "2026-10-01": { date: "2026-10-01", steps: 7777, waterMl: 1200, sleepHours: 8, mood: "一般", updatedAt: 3 },
  }));
  records.set(KEYS.dietLog, "unrelated-data");
}

test("批量预览区分未记录与零步，展示所有日期且不写数据", () => {
  seed();
  const before = records.get(KEYS.dailyCheckins);
  const rows = previewWeRunSteps(snapshot);
  assert.deepEqual(rows.map(r => r.date), ["2026-09-04", "2026-10-02", "2026-10-03"]);
  assert.equal(rows[0].previousSteps, null);
  assert.equal(rows[1].steps, 0);
  assert.equal(rows[2].previousSteps, 1000);
  assert.equal(records.get(KEYS.dailyCheckins), before);
  assert.equal(writes, 0);
});

test("批量同步只替换返回日期步数，保留其它字段和日期，一次写入", () => {
  seed();
  const before = loadAllCheckins();
  const updated = applyWeRunSteps(snapshot);
  const all = loadAllCheckins();
  assert.equal(writes, 1);
  assert.equal(updated.length, 3);
  assert.equal(all["2026-10-03"].steps, 4321);
  assert.equal(all["2026-10-03"].waterMl, 900);
  assert.equal(all["2026-10-03"].sleepHours, 7.5);
  assert.equal(all["2026-10-03"].mood, "好");
  assert.equal(all["2026-10-02"].steps, 0);
  assert.equal(all["2026-10-02"].sleepHours, 0);
  assert.deepEqual(all["2026-10-01"], before["2026-10-01"]);
  assert.equal(all["2026-09-04"].steps, 5678);
  assert.equal(all["2026-09-04"].waterMl, 0);
  assert.equal(all["2026-09-04"].sleepHours, undefined);
  assert.equal(records.get(KEYS.dietLog), "unrelated-data");
  applyWeRunSteps(snapshot);
  assert.equal(loadAllCheckins()["2026-10-03"].steps, 4321, "重复同步不累加");
});

test("确认时合并最新本地记录，保留预览之后更新的水量", () => {
  seed();
  previewWeRunSteps(snapshot);
  saveCheckin("2026-10-03", { waterMl: 1500 });
  applyWeRunSteps(snapshot);
  assert.equal(loadAllCheckins()["2026-10-03"].waterMl, 1500);
});

test("空快照不写数据；任意一条非法时整批不写，不产生半份同步", () => {
  seed();
  const before = records.get(KEYS.dailyCheckins);
  assert.deepEqual(applyWeRunSteps({ syncedAt: 1, days: [] }), []);
  for (const invalid of [
    { syncedAt: 1, days: [...snapshot.days, { date: "2026-09-05", steps: -1 }] },
    { syncedAt: 1, days: [...snapshot.days, snapshot.days[0]] },
    { syncedAt: 1, days: [{ date: "2026-02-30", steps: 1 }] },
  ]) assert.throws(() => applyWeRunSteps(invalid));
  assert.equal(records.get(KEYS.dailyCheckins), before);
  assert.equal(writes, 0);
});

test("存储写入失败明确报错且原始数据保持不变", () => {
  seed();
  const before = records.get(KEYS.dailyCheckins);
  failWrites = true;
  assert.throws(() => applyWeRunSteps(snapshot), /无法保存步数/);
  assert.equal(records.get(KEYS.dailyCheckins), before);
});
