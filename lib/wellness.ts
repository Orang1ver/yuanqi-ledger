/**
 * 周维度的睡眠与心情（纯函数）。
 *
 * 为什么要单独一个文件：周报页面会随视觉反复重写，但"这一周睡了几晚、平均几小时"
 * 这个口径必须稳定，而且它要能被单测覆盖（`lib/exercise.ts` 的 `weekStats` 是同一个范式）。
 *
 * ⚠️ 这个文件最容易走偏的地方，是**把同期记录说成因果**。
 * 「心情好的那几天都在运动」听起来像"运动让人心情好"，但那可能只是那几天正好有空、
 * 正好也吃得好。所以这里**只产出计数**，一句话都不写：句子交给界面，
 * 且界面必须带上"这只是同一周里的记录"。
 * **刻意不做**相关系数、不做显著性 —— 一周 7 个点算出来的相关系数没有意义，
 * 而它长得像个科学结论，比不给更糟。
 *
 * ⚠️ 「没有记录」一律是 `null`，不是 0（见 AGENTS 地雷 11/17）：
 * 一周没记睡眠，和"这周平均睡 0 小时"是两件事，后者会让页面显示一个吓人的假结论。
 */

import type { DailyCheckin, Mood } from "./types";

const MOODS: Mood[] = ["好", "一般", "累"];

/** 「睡够了」的参考线。⚠️ 这是**参考**，不是判定对错的尺子 —— 界面必须这么写 */
export const SLEEP_REFERENCE_HOURS = 7;

const round1 = (n: number): number => Math.round(n * 10) / 10;

export type WeekWellness = {
  /** 有睡眠记录的天数 */
  sleepDays: number;
  /** 这些天的平均睡眠（小时）。一晚都没记 → `null` */
  avgSleep: number | null;
  /** 达到参考线的天数（只在有记录的天下判定） */
  enoughSleepDays: number;

  /** 记了心情的天数 */
  moodDays: number;
  /** 各档的天数。三档之和等于 `moodDays` */
  moodCounts: Record<Mood, number>;

  /** 这一周有运动记录的天数（运动不在 `DailyCheckin` 里，由调用方传进来） */
  exerciseDays: number;
  /**
   * 心情「好」**且**当天有运动记录的天数。
   *
   * 两侧都有数据时才给数字，否则 `null` —— 只有心情没有运动记录时给 0，
   * 会被读成"心情好的时候都没运动"，那是个凭空造出来的对照。
   */
  goodMoodWithExercise: number | null;
};

export function weekWellness(input: {
  checkins: readonly DailyCheckin[];
  /** 这一周里有运动记录的日期（ISO），由调用方从运动记录里取 */
  exerciseDates: readonly string[];
}): WeekWellness {
  const { checkins, exerciseDates } = input;

  const slept = checkins.filter((c) => typeof c.sleepHours === "number" && c.sleepHours > 0);
  const sleepDays = slept.length;
  const avgSleep = sleepDays
    ? round1(slept.reduce((sum, c) => sum + (c.sleepHours as number), 0) / sleepDays)
    : null;
  const enoughSleepDays = slept.filter((c) => (c.sleepHours as number) >= SLEEP_REFERENCE_HOURS).length;

  const moodCounts: Record<Mood, number> = { 好: 0, 一般: 0, 累: 0 };
  let moodDays = 0;
  for (const c of checkins) {
    if (c.mood && MOODS.includes(c.mood)) {
      moodCounts[c.mood] += 1;
      moodDays += 1;
    }
  }

  const exerciseSet = new Set(exerciseDates);
  const exerciseDays = exerciseSet.size;
  const goodMoodWithExercise =
    moodDays > 0 && exerciseDays > 0
      ? checkins.filter((c) => c.mood === "好" && exerciseSet.has(c.date)).length
      : null;

  return {
    sleepDays,
    avgSleep,
    enoughSleepDays,
    moodDays,
    moodCounts,
    exerciseDays,
    goodMoodWithExercise,
  };
}
