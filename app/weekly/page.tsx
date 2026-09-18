"use client";

import { useMemo, useState } from "react";
import { BottomNav, PageHeader } from "../components/shell/BottomNav";
import { addDays, formatShort, formatWeekRange, todayISO, weekDates, weekStartOf } from "@/lib/date";
import { calcDailyTargets, healthyWeightRange } from "@/lib/health";
import { exerciseStats, weekStats } from "@/lib/exercise";
import { averageWeightOf, deltaVsDaysAgo, progressToHealthyRange } from "@/lib/weight";
import { loadCheckin, loadExercises, loadHealthProfile, loadWeights } from "@/lib/storage/health";
import { entriesOn } from "@/lib/storage";
import { sumNutrition } from "@/lib/nutrition/core";
import { scoreDay, summarizeWeek } from "@/lib/nutrition/score";
import { calcNutritionTargets } from "@/lib/nutrition/targets";
import type { NutritionTargets } from "@/lib/nutrition/types";
import { readinessOfWeek } from "@/lib/weekly";
import { SLEEP_REFERENCE_HOURS, weekWellness } from "@/lib/wellness";
import { DISCLAIMER, HEALTHY_RANGE_NOTE } from "@/lib/copy";

/**
 * 一周里每天的饮食质量分。
 *
 * 没记录的那天给 `null` 而不是 0 —— 「没记」和「吃得差」是两件事，
 * 混在一起会让分数跟着"记录习惯"走，而不是跟着"吃得好不好"走（详见 summarizeWeek）。
 */
function weekScores(start: string, targets: NutritionTargets) {
  return weekDates(start).map((d) => {
    const entries = entriesOn(d);
    if (!entries.length) return { date: d, score: null };
    return { date: d, score: scoreDay({ entries, totals: sumNutrition(entries), targets }) };
  });
}

/**
 * 周报。
 *
 * 这一版只做**统计**（打卡达标率 / 运动 / 体重变化），AI 周分析留到后面接 ——
 * 顺序是刻意的：先让数字可信，再让模型去解释数字。
 * 反过来做（先让 AI 写一段漂亮话）会出现"话很顺但数不对"的情况，那时更难查。
 */
export default function WeeklyPage() {
  const today = todayISO();
  const thisWeek = weekStartOf(today);
  const [offset, setOffset] = useState(0);

  const weekStart = addDays(thisWeek, offset * 7);
  const days = weekDates(weekStart);
  const profile = loadHealthProfile();
  const targets = profile ? calcDailyTargets(profile) : null;

  const data = useMemo(() => {
    const checkins = days.map((d) => loadCheckin(d)).filter((c): c is NonNullable<typeof c> => !!c);
    const exercises = loadExercises().filter((e) => e.date >= weekStart && e.date <= addDays(weekStart, 6));
    const weights = loadWeights();
    const weekWeights = days.map((d) => weights[d]).filter((x): x is NonNullable<typeof x> => !!x);
    return {
      checkins,
      ex: weekStats(loadExercises(), weekStart),
      exAll: exerciseStats(loadExercises()),
      exList: exercises,
      weightDelta: deltaVsDaysAgo(weights, addDays(weekStart, 6) > today ? today : addDays(weekStart, 6), 7),
      weightDays: weekWeights.length,
      /** 本周均值：一份都没称就是 null，界面据此说「这周没称」而不是显示 0 */
      weightAvg: averageWeightOf(weekWeights),
      /**
       * 睡眠 / 心情。
       * ⚠️ 运动日期要一起传进去：那句「心情好且有运动」的对照**两侧都得有数据**才成立，
       * 只传一边会让"没有运动记录"被读成"心情好的时候都没运动"。
       */
      wellness: weekWellness({ checkins, exerciseDates: exercises.map((e) => e.date) }),
    };
  }, [weekStart, today, days]);

  /**
   * 距健康体重区间还差多少。用**本周均值**而不是某一次称重 —— 单次波动说明不了趋势。
   *
   * 刻意**不 memo**：`loadHealthProfile()` 每次都返回新对象，拿它当依赖等于每次都重算，
   * 挂个 useMemo 只会让人误以为这里有缓存（`useDayNutrition` 里是同一个取舍）。
   */
  const weightProgress =
    profile && data.weightAvg !== null
      ? progressToHealthyRange(data.weightAvg, healthyWeightRange(profile))
      : null;

  const readiness = targets ? readinessOfWeek(data.checkins, targets) : null;

  const nutritionTargets = profile ? calcNutritionTargets(profile) : null;
  const diet = useMemo(() => {
    if (!nutritionTargets) return null;
    // 与上一周比才有意义 —— 单看一周的绝对分，用户没法判断自己是在变好还是变差
    const prev = summarizeWeek({ days: weekScores(addDays(weekStart, -7), nutritionTargets) });
    return summarizeWeek({ days: weekScores(weekStart, nutritionTargets), previousAverage: prev.average });
  }, [weekStart, nutritionTargets]);

  return (
    <>
      <main className="yq-shell" style={{ flex: 1, paddingBottom: 20 }}>
        <PageHeader title="周报" subtitle={formatWeekRange(weekStart)} />

        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          <button className="yq-chip" data-on={offset === 0} onClick={() => setOffset(0)}>
            本周
          </button>
          <button className="yq-chip" data-on={offset === -1} onClick={() => setOffset(-1)}>
            上周
          </button>
          <button className="yq-chip" data-on={offset === -2} onClick={() => setOffset(-2)}>
            前两周
          </button>
        </div>

        {/* 打卡达标 */}
        <section className="yq-card" style={{ marginBottom: 14 }}>
          <div className="yq-section-title">
            <span>打卡达标</span>
            <span className="yq-hint">{data.checkins.length} 天有记录</span>
          </div>

          {!targets ? (
            <div className="yq-empty">
              还没填健康档案，所以没有目标可比。
              <br />
              去「健康」页填一下，这里就能告诉你这一周达标了几天。
            </div>
          ) : readiness ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 12 }}>
                <BigStat label="喝水达标" value={`${readiness.waterDays}`} unit={`/ ${readiness.totalDays} 天`} color="var(--yq-primary)" />
                <BigStat label="步数达标" value={`${readiness.stepsDays}`} unit={`/ ${readiness.totalDays} 天`} color="var(--yq-accent)" />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: `repeat(${days.length}, 1fr)`, gap: 5, marginBottom: 8 }}>
                {days.map((d) => {
                  const c = loadCheckin(d);
                  const waterPct = c && targets.waterTarget ? Math.min(100, Math.round((c.waterMl / targets.waterTarget) * 100)) : 0;
                  const stepPct = c && targets.stepsTarget ? Math.min(100, Math.round((c.steps / targets.stepsTarget) * 100)) : 0;
                  return (
                    <div key={d} style={{ textAlign: "center" }} title={`${d}｜水 ${c?.waterMl ?? 0}ml｜步 ${c?.steps ?? 0}`}>
                      <div
                        style={{
                          height: 56,
                          display: "flex",
                          alignItems: "flex-end",
                          justifyContent: "center",
                          gap: 2,
                          background: "var(--yq-surface-2)",
                          borderRadius: 6,
                          padding: 3,
                        }}
                      >
                        <span style={{ width: "38%", height: `${Math.max(2, waterPct)}%`, background: "var(--yq-primary)", borderRadius: 3 }} />
                        <span style={{ width: "38%", height: `${Math.max(2, stepPct)}%`, background: "var(--yq-accent)", borderRadius: 3 }} />
                      </div>
                      <div className="yq-hint" style={{ fontSize: 10, marginTop: 3 }}>
                        {Number(d.slice(8))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="yq-hint">
                <span style={{ color: "var(--yq-primary)" }}>■</span> 喝水
                <span style={{ color: "var(--yq-accent)", marginLeft: 10 }}>■</span> 步数
              </p>
            </>
          ) : null}
        </section>

        {/* 饮食质量 */}
        <section className="yq-card" style={{ marginBottom: 14 }}>
          <div className="yq-section-title">
            <span>饮食质量</span>
            <span className="yq-hint">{diet ? `${diet.scoredDays} 天可评` : "缺健康档案"}</span>
          </div>

          {!diet ? (
            <div className="yq-empty">
              还没填健康档案，没有目标就算不出质量分。
              <br />
              去「健康」页填一下，这里会按「实际 vs 目标」给你每天的分数。
            </div>
          ) : diet.average === null ? (
            <div className="yq-empty">
              这一周还没有可评的饮食记录。
              <br />
              去「饮食」页记几天，这里就能看出吃得怎么样、比上周好还是差。
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span className="yq-num" style={{ fontSize: 30, fontWeight: 700, color: scoreColor(diet.average) }}>
                  {diet.average}
                </span>
                <span className="yq-hint">分 · 按 {diet.scoredDays} 天平均</span>
                {diet.delta !== null && (
                  <span
                    className="yq-num"
                    style={{ marginLeft: "auto", color: diet.delta >= 0 ? "var(--yq-primary-ink)" : "var(--yq-accent-ink)" }}
                  >
                    比上周 {diet.delta >= 0 ? "+" : ""}
                    {diet.delta}
                  </span>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: `repeat(${days.length}, 1fr)`, gap: 5, margin: "12px 0 8px" }}>
                {diet.days.map((d) => (
                  <div key={d.date} style={{ textAlign: "center" }} title={`${d.date}｜${d.score ?? "没有可评的记录"}`}>
                    <div
                      style={{
                        height: 56,
                        display: "flex",
                        alignItems: "flex-end",
                        justifyContent: "center",
                        background: "var(--yq-surface-2)",
                        borderRadius: 6,
                        padding: 3,
                      }}
                    >
                      {d.score !== null && (
                        <span
                          style={{
                            width: "70%",
                            height: `${Math.max(4, d.score)}%`,
                            background: scoreColor(d.score),
                            borderRadius: 3,
                          }}
                        />
                      )}
                    </div>
                    <div className="yq-hint" style={{ fontSize: 10, marginTop: 3 }}>
                      {Number(d.date.slice(8))}
                    </div>
                  </div>
                ))}
              </div>

              <p className="yq-hint" style={{ lineHeight: 1.6 }}>
                {diet.best && diet.worst && diet.scoredDays > 1
                  ? `最好 ${diet.best.score} 分（${formatShort(diet.best.date)}），最差 ${diet.worst.score} 分（${formatShort(
                      diet.worst.date,
                    )}）。`
                  : ""}
                没记录的那天不参与平均 —— 一周只记两天也算两天，不按 7 天摊。
              </p>
            </>
          )}
        </section>

        {/* 运动 */}
        <section className="yq-card" style={{ marginBottom: 14 }}>
          <div className="yq-section-title">
            <span>运动</span>
            <span className="yq-hint">累计 {data.exAll.count} 次</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <BigStat label="本周次数" value={`${data.ex.count}`} unit="次" color="var(--yq-primary)" />
            <BigStat label="本周时长" value={`${data.ex.minutes}`} unit="分钟" color="var(--yq-primary)" />
            <BigStat label="本周里程" value={`${data.ex.km}`} unit="km" color="var(--yq-info)" />
          </div>
          {data.exList.length === 0 ? (
            <div className="yq-empty">这一周还没有运动记录</div>
          ) : (
            <div style={{ marginTop: 10 }}>
              {data.exList.map((e) => (
                <div key={e.id} className="yq-row">
                  <span style={{ fontSize: 13 }}>
                    {formatShort(e.date)} · {e.type}
                  </span>
                  <span className="yq-hint yq-num">
                    {e.minutes ? `${e.minutes} 分钟` : ""}
                    {e.distanceKm ? ` ${e.distanceKm}km` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 睡眠与心情 */}
        <section className="yq-card" style={{ marginBottom: 14 }}>
          <div className="yq-section-title">
            <span>睡眠与心情</span>
            <span className="yq-hint">
              {data.wellness.sleepDays > 0 || data.wellness.moodDays > 0
                ? `睡眠 ${data.wellness.sleepDays} 天 · 心情 ${data.wellness.moodDays} 天`
                : "这周没记"}
            </span>
          </div>

          {data.wellness.sleepDays === 0 && data.wellness.moodDays === 0 ? (
            <div className="yq-empty">
              这一周没记睡眠和心情。
              <br />
              在「今天」页打卡时顺手填一下，这里就能看出这一周睡得怎么样、状态如何。
            </div>
          ) : (
            <>
              {data.wellness.avgSleep !== null && (
                <p style={{ fontSize: 15, marginBottom: 10 }}>
                  平均睡 <b className="yq-num">{data.wellness.avgSleep}</b> 小时
                  <span className="yq-hint">
                    （{data.wellness.sleepDays} 晚有记录
                    {data.wellness.enoughSleepDays > 0
                      ? `，其中 ${data.wellness.enoughSleepDays} 晚到 ${SLEEP_REFERENCE_HOURS} 小时`
                      : ""}
                    ）
                  </span>
                </p>
              )}

              {data.wellness.moodDays > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                  <BigStat label="状态不错" value={`${data.wellness.moodCounts.好}`} unit="天" color="var(--yq-primary)" />
                  <BigStat label="一般" value={`${data.wellness.moodCounts.一般}`} unit="天" color="var(--yq-info)" />
                  <BigStat label="比较累" value={`${data.wellness.moodCounts.累}`} unit="天" color="var(--yq-accent)" />
                </div>
              )}

              {data.wellness.goodMoodWithExercise !== null && (
                <p className="yq-hint" style={{ marginTop: 10, lineHeight: 1.6 }}>
                  这周记了 {data.wellness.exerciseDays} 天运动，其中 {data.wellness.goodMoodWithExercise} 天也记了「状态不错」。
                  这两件事只是同一周里都发生了，看不出谁导致谁 —— 也可能只是那几天正好有空。
                </p>
              )}
            </>
          )}
        </section>

        {/* 体重 */}
        <section className="yq-card" style={{ marginBottom: 14 }}>
          <div className="yq-section-title">
            <span>体重</span>
            <span className="yq-hint">这一周记了 {data.weightDays} 天</span>
          </div>
          {data.weightDelta ? (
            <p style={{ fontSize: 15 }}>
              与上次记录相比{" "}
              <b className="yq-num" style={{ color: data.weightDelta.diff > 0 ? "var(--yq-accent-ink)" : "var(--yq-info-ink)" }}>
                {data.weightDelta.diff > 0 ? "+" : ""}
                {data.weightDelta.diff.toFixed(1)} kg
              </b>
            </p>
          ) : (
            <div className="yq-empty">这周边上还没有可对比的体重记录</div>
          )}

          {data.weightAvg !== null && (
            <p style={{ fontSize: 15, marginTop: 10 }}>
              本周均值 <b className="yq-num">{data.weightAvg}</b> kg
              <span className="yq-hint">
                （{data.weightDays} 天 · 只称一次就是那一次，不按 7 天摊）
              </span>
            </p>
          )}

          {weightProgress && (
            <p className="yq-hint" style={{ marginTop: 8, lineHeight: 1.6 }}>
              按你的身高，健康体重区间是 {weightProgress.range.min}~{weightProgress.range.max} kg，
              {weightProgress.inRange
                ? "本周均值就在区间里。"
                : `距${weightProgress.direction === "lose" ? "上沿" : "下沿"}还差 ${weightProgress.distanceKg} kg。`}
              <br />
              {HEALTHY_RANGE_NOTE}
            </p>
          )}
        </section>

        <p className="yq-hint" style={{ textAlign: "center" }}>
          {DISCLAIMER}
        </p>
      </main>
      <BottomNav />
    </>
  );
}

/** 分数对应的颜色。低分用点缀色（偏暖橙）而不是红色 —— 饮食没有"错误"这回事 */
function scoreColor(score: number): string {
  if (score >= 80) return "var(--yq-primary)";
  if (score >= 60) return "var(--yq-info)";
  return "var(--yq-accent)";
}

function BigStat({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div>
      <div className="yq-label">{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 2 }}>
        <span className="yq-num" style={{ fontSize: 24, fontWeight: 700, color }}>
          {value}
        </span>
        <span className="yq-hint">{unit}</span>
      </div>
    </div>
  );
}
