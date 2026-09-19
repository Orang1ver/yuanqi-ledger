/**
 * 运动记录的排序测试。
 *
 * 这里压的是一类**静默**的错：补录一条上周的运动，它会插到列表最前面 ——
 * 条数一条没少、合计也全对，只是顺序变成了「按补录时间」。用户看到的
 * 是「明明记的是上周，却排在今天上面」，而所有统计闸门都是绿的。
 *
 * 所以断言必须落在**顺序**上，不能只看条数与合计。
 * 另外两条钉住「排序发生在数据层」：存量乱序数据读出来要有序（只在写入侧排不够），
 * 写进去的也得是有序的（只在读取侧排只是糊了一层）。
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

import { sortExercises } from "./exercise";
import { KEYS } from "./storage/keys";
import { addExercise, loadExercises } from "./storage/health";
import type { ExerciseRecord } from "./types";

/** `at` 是**录入**时间，`date` 是**运动发生**的日期 —— 两者可以相反 */
function rec(date: string, at: number): ExerciseRecord {
  return { id: `${date}@${at}`, date, type: "散步", at };
}

const shape = (list: ExerciseRecord[]) => list.map((r) => `${r.date}@${r.at}`);

describe("运动记录排序", () => {
  beforeEach(() => storage.clear());

  it("按运动日期倒序；同一天按录入时间倒序", () => {
    const list = [
      rec("2026-09-15", 100),
      rec("2026-09-17", 200),
      rec("2026-09-17", 300),
      rec("2026-09-16", 400),
    ];

    assert.deepEqual(shape(sortExercises(list)), [
      "2026-09-17@300",
      "2026-09-17@200",
      "2026-09-16@400",
      "2026-09-15@100",
    ]);
  });

  it("不改动传入的数组", () => {
    const list = [rec("2026-09-15", 1), rec("2026-09-17", 2)];
    const before = list.map((r) => r.id);

    sortExercises(list);
    assert.deepEqual(list.map((r) => r.id), before);
  });

  it("补录旧日期的运动，不会跑到列表最前面", () => {
    addExercise({ date: "2026-09-19", type: "跑步", minutes: 30 });
    // 这条 at 更新（刚录），但运动发生在更早的日期
    const list = addExercise({ date: "2026-09-14", type: "散步", minutes: 20 });

    assert.equal(list[0].date, "2026-09-19", "补录的旧记录不该排到今天上面");
    assert.deepEqual(
      list.map((r) => r.date),
      ["2026-09-19", "2026-09-14"],
    );
  });

  it("存量乱序数据（修复前按录入序写下的）读出来也是有序的", () => {
    // 直接塞进「补录序」：最早发生的反而排在最后面的那种数组
    storage.setItem(
      KEYS.exercises,
      JSON.stringify([rec("2026-09-14", 900), rec("2026-09-19", 100), rec("2026-09-16", 500)]),
    );

    assert.deepEqual(
      loadExercises().map((r) => r.date),
      ["2026-09-19", "2026-09-16", "2026-09-14"],
    );
  });

  it("写进存储的顺序也是有序的，不是只在读取时糊一层", () => {
    addExercise({ date: "2026-09-19", type: "跑步", minutes: 30 });
    addExercise({ date: "2026-09-14", type: "散步", minutes: 20 });

    const raw = JSON.parse(storage.getItem(KEYS.exercises) as string) as ExerciseRecord[];
    assert.deepEqual(
      raw.map((r) => r.date),
      ["2026-09-19", "2026-09-14"],
    );
  });
});
