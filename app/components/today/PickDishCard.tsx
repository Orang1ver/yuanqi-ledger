"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { emitDataChanged, onDataChanged } from "@/lib/bus";
import { mealSlotFromTime, nowHM, todayISO } from "@/lib/date";
import { estimateDish } from "@/lib/nutrition/menu";
import { pickDishForToday, type PickOutcome } from "@/lib/nutrition/pickDish";
import { foodById } from "@/lib/nutrition/library";
import type { FoodItem } from "@/lib/nutrition/types";
import { lastEatenByDish, loadTakeoutDishes, recordDietEntries } from "@/lib/storage";
import { loadHealthProfile } from "@/lib/storage/health";
import { updateTakeoutDish } from "@/lib/storage/takeout";
import { avoidLabelsFromText, MEAL_SLOTS } from "@/lib/tags";
import type { MealSlot } from "@/lib/tags";
import type { TakeoutDish } from "@/lib/types";
import { PAGE_LABELS } from "@/lib/copy";
import { DishNutrition } from "../takeout/DishNutrition";

/**
 * 首页的「今天吃什么」。
 *
 * 它与下面那张「今天还该吃点啥」**不是一回事**，分工写在这里免得以后合掉：
 *   - 这张回答**决定吃哪道**：从**你自己的菜单库**里挑一道，可以「换一个」，
 *     可以「就吃这个」直接记进饮食日记。**不需要任何前提** —— 今天一条记录都没有、
 *     没填 DeepSeek Key、断网，它都照常说话。
 *   - 下面那张回答**还缺什么营养**：缺口驱动，要先有记录才算得出缺口。
 *
 * 四条刻意的做法：
 * 1) **一个数字都不产生。** 挑选过程（`pickDishForToday`）不碰食物库，
 *    屏幕上的热量全部来自对**选中的那一道**调 `estimateDish()` —— 与饮食记录同一个查表口径。
 * 2) **估不出热量的菜照样能推。** 菜单库里约八成是套餐长名，本来就估不出来；
 *    把它们排除掉的话"今天吃什么"只能在那两成里兜圈子。所以这里不显示数字，
 *    但把出路（关联一次就记住）直接摆在旁边。
 * 3) **估不出来的菜不给「就吃这个」。** 它的食材拆不干净，记下来只会漏算 ——
 *    那正是它被判定为估不出来的原因。此时按钮不出现，换成一句说明。
 * 4) **所有读外部环境的东西都在 `useEffect` 里**（菜单库、忌口、吃过什么、随机值、当前钟点）。
 *    放进渲染期会在预渲染时先挑一道、水合后再挑另一道 —— 那是 hydration 不一致，
 *    而且用户会看到菜名闪一下才定下来。
 */

/** 一次读齐这张卡需要的"菜单长什么样"。纯读，不写任何东西 */
type Env = {
  dishes: TakeoutDish[];
  avoid: string[];
  today: string;
};

/**
 * 「我吃过什么」。
 *
 * ⚠️ 它与 `Env` **刻意分开刷新**，不是一个打字错误：
 * 吃完一道菜之后 `emitDataChanged` 会让 `Env` 重读一次，如果"吃过什么"也跟着重读，
 * 那道菜的新鲜度当场掉到 0.15，卡片就会**在用户眼前换成另一道菜** ——
 * 而下面那行提示还写着「已把「红烧肉」记到午餐」。看起来就像点错了。
 * 所以它只在**装载**与**点「换一个」**时重读：那时候用户明确要一个新答案。
 */
type History = { last: Map<string, string>; count: Map<string, number> };

function readEnv(): Env {
  return {
    dishes: loadTakeoutDishes(),
    avoid: avoidLabelsFromText(loadHealthProfile()?.allergies),
    today: todayISO(),
  };
}

function readHistory(): History {
  return lastEatenByDish();
}

/** 记一条菜时用的量词。菜是"一份"，所以统一用「份」——克数才是真正参与计算的那个值 */
const DISH_UNIT = "份";

export function PickDishCard() {
  /*
   * 外部环境用**惰性初始化**读进来，与旁边的「今天还该吃点啥」同一个写法。
   *
   * 这里权衡过要不要改成"水合后再读"（`useSyncExternalStore` 或 effect 里 setState）：
   *   - effect 里同步 setState 被 lint 拦下（`react-hooks/set-state-in-effect`），是对的；
   *   - `useSyncExternalStore` 能消掉这张卡的水合差异，但**整页的差异依旧存在** ——
   *     同一个页面上的 `WhatToEatCard` / `DataOverview` / `CheckinCard` 全都这么做，
   *     服务端读不到 localStorage。只修这一张卡，页面照样要重渲染一次，白增一套机制。
   * 所以这里跟大部队保持一致；差异的根源是"服务端没有 localStorage"，不是这里的随机数。
   */
  const [env, setEnv] = useState<Env>(readEnv);
  const [history, setHistory] = useState<History>(readHistory);
  /** 0..1 的随机值。只有它变，「换一个」才会换 —— 结果因此可复现（同一个值必得同一道菜） */
  const [roll, setRoll] = useState(() => Math.random());
  const [exclude, setExclude] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  /** 记到哪一餐。默认按现在的钟点猜，用户随时可以改 —— 补录时这个默认值基本是错的 */
  const [slot, setSlot] = useState<MealSlot>(() => mealSlotFromTime(nowHM()));
  const [msg, setMsg] = useState("");

  /*
   * 菜单库 / 健康档案在别处被改动时跟着更新。
   * ⚠️ 这里**只重读菜单与忌口，不重读"吃过什么"、也不重掷随机值** —— 理由见 `History` 的注释。
   */
  useEffect(() => onDataChanged(() => setEnv(readEnv())), []);

  const outcome: PickOutcome = useMemo(
    () =>
      pickDishForToday({
        dishes: env.dishes,
        today: env.today,
        avoid: env.avoid,
        category,
        lastEaten: history.last,
        eatenCount: history.count,
        exclude,
        roll,
      }),
    [env, history, category, exclude, roll],
  );

  const categories = useMemo(
    () => [...new Set(env.dishes.map((d) => d.category))].sort(),
    [env],
  );

  const pick = outcome.kind === "picked" ? outcome.pick : null;
  const est = pick ? estimateDish(pick.dish) : null;

  function again() {
    if (!pick) return;
    // 放宽过（也就是已出过的排完了）就从头再来一轮：只排除当前这道，
    // 否则 exclude 会一直加下去，每点一次都得先"放宽"一遍
    setExclude(pick.relaxed ? [pick.dish.id] : [...exclude, pick.dish.id]);
    // 「换一个」是用户明确在要一个新答案 —— 这时候才重读"吃过什么"
    setHistory(readHistory());
    setRoll(Math.random());
    setMsg("");
  }

  /**
   * 「就吃这个」：把这道菜折算成饮食记录。
   *
   * - 关联过的菜 → **一条**，名字就用菜名（用户认得出）。
   * - 拆食材估出来的菜 → **一条食材一条记录**，克数与刚才屏幕上那个区间**完全同源**
   *   （同一个 `splitDishIngredients`、同一份克数），所以记下的数不会和刚看到的数打架。
   * - 估不出来的菜走不到这里（按钮不出现）。
   *
   * ⚠️ 绝不把区间中点当成"每 100g 的数值表"写成一条自定义记录 ——
   * 那是从 ±35% 的估算里造一个精确数，正是这个项目最不能接受的那种输出。
   */
  function eat() {
    if (!pick) return;
    const m = estimateDish(pick.dish);
    if (m.kind === "none") return;

    const parts =
      m.kind === "linked"
        ? [{ foodId: m.foodId, grams: m.grams, name: pick.dish.name }]
        : m.ingredients.map((ing) => ({
            foodId: ing.foodId,
            grams: ing.grams,
            name: ing.foodName,
          }));

    // 食物库里查不到就整条不记：`makeDietEntry` 在没有 food 时会算成 0，
    // 那样账本上会多出一条"0 kcal"的记录，比不记更糟
    const rows: { food: FoodItem; grams: number; name: string }[] = [];
    for (const p of parts) {
      const food = foodById(p.foodId);
      if (food) rows.push({ food, grams: p.grams, name: p.name });
    }
    if (!rows.length) {
      setMsg("这道菜的食材在食物库里查不到了 —— 先关联一下再记。");
      return;
    }

    const time = nowHM();
    recordDietEntries(
      rows.map((r) => ({
        date: env.today,
        time,
        mealSlot: slot,
        food: r.food,
        name: r.name,
        amount: 1,
        unitLabel: DISH_UNIT,
        grams: r.grams,
        source: "db" as const,
        dishId: pick.dish.id,
      })),
    );
    /*
     * ⚠️ 这里**刻意不把这道菜加进 `exclude`**：加了的话，下一帧卡片就会换成另一道菜，
     * 而下面那行提示还写着"已把「某某」记到午餐" —— 用户会以为点错了。
     * "别再推刚吃过的"由新鲜度降权负责（见 `History` 的注释）：点「换一个」时它就会被压下去。
     */
    emitDataChanged();
    setMsg(
      `已把「${pick.dish.name}」记到${slot}` +
        (rows.length > 1 ? `（按 ${rows.length} 样食材折算）` : ""),
    );
  }

  return (
    <section className="yq-card" style={{ marginBottom: 14 }} data-yq="pick-dish">
      <div className="yq-section-title">
        <span>今天吃什么</span>
        {env.dishes.length > 0 && (
          <span className="yq-hint">从你的菜单库里挑一道</span>
        )}
      </div>

      {outcome.kind === "empty-menu" ? (
        <p className="yq-empty" style={{ paddingBottom: 0 }}>
          菜单库还是空的 —— 把常点的店录进「{PAGE_LABELS.takeout}」，
          这里才知道能给你挑什么。
          <br />
          <Link className="yq-link-btn" href="/takeout/">
            去「{PAGE_LABELS.takeout}」加菜
          </Link>
        </p>
      ) : outcome.kind === "all-filtered" ? (
        <p className="yq-empty" style={{ paddingBottom: 0 }}>
          这 {outcome.total} 道里没有能挑的：
          {outcome.byAvoid > 0 && `按你的忌口排掉了 ${outcome.byAvoid} 道`}
          {outcome.byAvoid > 0 && outcome.byNarrow > 0 && "，"}
          {outcome.byNarrow > 0 && `当前筛选又排掉了 ${outcome.byNarrow} 道`}。
          <br />
          忌口是在「{PAGE_LABELS.health}」的档案里写的，也可以去「{PAGE_LABELS.takeout}」
          改单道菜的忌口标签。
        </p>
      ) : pick && est ? (
        <>
          <div className="yq-row" style={{ alignItems: "flex-start", gap: 10 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{ fontSize: 16, fontWeight: 600 }}
                data-yq="pick-dish-name"
              >
                {pick.dish.name}
                <span className="yq-tag" style={{ marginLeft: 6 }}>
                  {pick.dish.restaurant}
                </span>
              </div>
              <div className="yq-hint">
                {pick.dish.category}
                {pick.dish.priceRange ? ` · ${pick.dish.priceRange}` : ""}
                {pick.dish.flavorTags.length ? ` · ${pick.dish.flavorTags.join("/")}` : ""}
              </div>
              {/* 营养那一行整个交给 DishNutrition：它就是为"估不出来要给条出路"写的 */}
              <DishNutrition
                dish={pick.dish}
                onLink={(patch) => {
                  updateTakeoutDish(pick.dish.id, patch);
                  setEnv(readEnv());
                  emitDataChanged();
                }}
              />
              <div className="yq-hint" style={{ marginTop: 4 }}>
                {pick.reason}
                {pick.relaxed && " · 菜单里能挑的就这些了，从头再来一轮"}
              </div>
            </div>
          </div>

          {est.kind !== "none" && (
            <div
              style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 8 }}
            >
              <span className="yq-label" style={{ marginBottom: 0 }}>
                记到
              </span>
              {MEAL_SLOTS.map((s) => (
                <button
                  key={s}
                  className="yq-chip"
                  data-on={slot === s}
                  aria-pressed={slot === s}
                  onClick={() => setSlot(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {est.kind !== "none" ? (
              <button className="yq-btn yq-btn-sm yq-btn-primary" data-yq="pick-dish-eat" onClick={eat}>
                就吃这个
              </button>
            ) : (
              <span className="yq-hint">
                先关联一下再记 —— 这道菜算不出成分，直接记下来只会漏算。
              </span>
            )}
            <button className="yq-btn yq-btn-sm" data-yq="pick-dish-again" onClick={again}>
              换一个
            </button>
          </div>

          {msg && (
            <p className="yq-hint" style={{ marginTop: 8, color: "var(--yq-primary-ink)" }}>
              {msg}
            </p>
          )}

          {/* 筛选：一次只挑得出一道时，先"想到吃哪一类"比再随机一次有用得多 */}
          {categories.length > 1 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }} data-yq="pick-dish-category">
              <button
                className="yq-chip"
                data-on={category === ""}
                onClick={() => {
                  setCategory("");
                  setExclude([]);
                }}
              >
                不限
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  className="yq-chip"
                  data-on={category === c}
                  onClick={() => {
                    setCategory(c);
                    setExclude([]);
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {/*
           * 诚实披露：从多少道里挑的、被排掉了多少。
           * 不写这句的话，用户会以为整个菜单库都参与了挑选 ——
           * 而忌口和筛选可能已经把大部分菜排掉了（与「今天还该吃点啥」同一个口径）。
           */}
          <p className="yq-hint" style={{ marginTop: 10 }}>
            从 {env.dishes.length} 道里挑
            {pick.poolSize !== env.dishes.length && `（按忌口与筛选后剩 ${pick.poolSize} 道）`}
            {env.avoid.length > 0 && ` · 你的忌口：${env.avoid.join("、")}`}
          </p>
        </>
      ) : null}
    </section>
  );
}
