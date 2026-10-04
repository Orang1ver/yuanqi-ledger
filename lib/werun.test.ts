import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseWeRunSnapshot, WERUN_TOKEN_PATTERN } from "./werun";

test("微信预览保留零步与原日期，不把缺失日期变成零", () => {
  const result = parseWeRunSnapshot({ syncedAt: 1790964000000, days: [{ date: "2026-10-03", steps: 0 }] });
  assert.equal(result.days[0].steps, 0);
  assert.equal(result.days.find((day) => day.date === "2026-10-02"), undefined);
  assert.deepEqual(parseWeRunSnapshot({ syncedAt: 1, days: [] }).days, []);
});

test("拒绝无效日期、重复日期、负数、小数、字符串步数", () => {
  for (const day of [{ date: "2026-02-30", steps: 1 }, { date: "bad", steps: 1 },
    { date: "2026-10-03", steps: -1 }, { date: "2026-10-03", steps: 1.5 },
    { date: "2026-10-03", steps: "1234" }, { date: "2026-10-03", steps: 100001 }]) {
    assert.throws(() => parseWeRunSnapshot({ syncedAt: 1, days: [day] }));
  }
  assert.throws(() => parseWeRunSnapshot({ syncedAt: 1, days: Array(2).fill({ date: "2026-10-03", steps: 1 }) }));
  assert.throws(() => parseWeRunSnapshot({ syncedAt: "1", days: [] }));
  assert.equal(WERUN_TOKEN_PATTERN.test("YQW1." + "a".repeat(64) + "." + "b".repeat(64)), true);
  assert.equal(WERUN_TOKEN_PATTERN.test("123456"), false);
});
