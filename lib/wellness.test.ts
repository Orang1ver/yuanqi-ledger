/**
 * 睡眠与心情的周聚合单测。
 *
 * 全部火力都对着**「没有记录」与「值是 0」的区别** —— 这个模块没有别的难点，
 * 而它的每一种错法都会在屏幕上变成一句吓人的假结论（"这周平均睡 0 小时"）。
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { SLEEP_REFERENCE_HOURS, weekWellness } from "./wellness";
import type { DailyCheckin } from "./types";

function checkin(date: string, patch: Partial<DailyCheckin> = {}): DailyCheckin {
  return { date, waterMl: 0, steps: 0, updatedAt: 1, ...patch };
}

describe("周睡眠 · 没记录不等于 0", () => {
  it("一晚都没记 → 平均是 null，不是 0", () => {
    const w = weekWellness({ checkins: [checkin("2026-09-14"), checkin("2026-09-15")], exerciseDates: [] });
    assert.equal(w.sleepDays, 0);
    assert.equal(w.avgSleep, null, "没记睡眠时给 0，页面上会变成「这周平均睡 0 小时」");
  });

  it("睡 0 小时也不算「有记录」—— 那多半是误触，不是真实数据", () => {
    const w = weekWellness({ checkins: [checkin("2026-09-14", { sleepHours: 0 })], exerciseDates: [] });
    assert.equal(w.sleepDays, 0);
    assert.equal(w.avgSleep, null);
  });

  it("只记了两晚就按两晚平均，不按 7 天摊", () => {
    // 按 7 天摊的话，一周只记两天的人会被系统性地算成"严重睡眠不足"
    const w = weekWellness({
      checkins: [checkin("2026-09-14", { sleepHours: 6 }), checkin("2026-09-15", { sleepHours: 8 })],
      exerciseDates: [],
    });
    assert.equal(w.sleepDays, 2);
    assert.equal(w.avgSleep, 7);
  });

  it("「睡够」只在有记录的天下判定，且参考线写清楚", () => {
    const w = weekWellness({
      checkins: [
        checkin("2026-09-14", { sleepHours: SLEEP_REFERENCE_HOURS - 1 }),
        checkin("2026-09-15", { sleepHours: SLEEP_REFERENCE_HOURS }),
        checkin("2026-09-16", { sleepHours: SLEEP_REFERENCE_HOURS + 1 }),
        checkin("2026-09-17"), // 没记
      ],
      exerciseDates: [],
    });
    assert.equal(w.sleepDays, 3);
    assert.equal(w.enoughSleepDays, 2);
  });
});

describe("周心情 · 只做同期计数，不碰因果", () => {
  it("三档计数之和必须等于有记录的天数", () => {
    const w = weekWellness({
      checkins: [
        checkin("2026-09-14", { mood: "好" }),
        checkin("2026-09-15", { mood: "累" }),
        checkin("2026-09-16", { mood: "累" }),
        checkin("2026-09-17"), // 没记心情
      ],
      exerciseDates: [],
    });
    assert.equal(w.moodDays, 3);
    assert.equal(w.moodCounts.好 + w.moodCounts.一般 + w.moodCounts.累, w.moodDays);
    assert.equal(w.moodCounts.累, 2);
  });

  it("心情没记时三档都是 0，但 moodDays 也是 0（页面据此说「这周没记」）", () => {
    const w = weekWellness({ checkins: [checkin("2026-09-14")], exerciseDates: [] });
    assert.equal(w.moodDays, 0);
    assert.deepEqual(w.moodCounts, { 好: 0, 一般: 0, 累: 0 });
  });

  it("没有运动数据 → 那个对照是 null，不是 0", () => {
    // 给 0 会被读成"心情好的时候都没运动" —— 而那是个凭空造出来的对照
    const w = weekWellness({
      checkins: [checkin("2026-09-14", { mood: "好" })],
      exerciseDates: [],
    });
    assert.equal(w.goodMoodWithExercise, null);
  });

  it("心情一次都没记 → 那个对照也是 null（哪怕有运动）", () => {
    const w = weekWellness({
      checkins: [checkin("2026-09-14")],
      exerciseDates: ["2026-09-14"],
    });
    assert.equal(w.goodMoodWithExercise, null);
  });

  it("两侧都有数据时，只数「心情好 且 当天有运动」的天", () => {
    const w = weekWellness({
      checkins: [
        checkin("2026-09-14", { mood: "好" }),
        checkin("2026-09-15", { mood: "好" }),
        checkin("2026-09-16", { mood: "累" }),
      ],
      exerciseDates: ["2026-09-14", "2026-09-16"],
    });
    assert.equal(w.exerciseDays, 2);
    assert.equal(w.goodMoodWithExercise, 1, "只有 9-14 是「心情好且有运动」");
  });

  it("运动日期重复也只算一天", () => {
    const w = weekWellness({ checkins: [], exerciseDates: ["2026-09-14", "2026-09-14"] });
    assert.equal(w.exerciseDays, 1);
  });
});
