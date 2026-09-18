/**
 * 「一句话 → 可确认的候选条目」。
 *
 * 这是记录入口的核心：把口语切段、逐段找食物、折算克数，
 * 并把**折算依据**一起返回。界面必须能把「为什么是 70g」摆到用户眼前 ——
 * 否则"数字可信"这条主张就落不了地（屏幕上只显示一个 70g，用户没法判断它对不对）。
 *
 * 这份逻辑原先只长在验收探针里。抽出来是因为它要被三处用到
 * （探针、界面、将来的 LLM 兜底前的预解析），三份实现必然各自跑偏。
 *
 * ⚠️ **本文件 import 了食物库**（`library.ts` 会带上那份 JSON）。
 * 所以只有饮食页可以 import 它 —— 别让首页碰到，首页的 bundle 不该装 184 条食物。
 */

import { mealSlotFromTime } from "../date";
import type { MealSlot } from "../tags";
import { fallbackGrams, makeDietEntry, resolvePortion } from "./core";
import { findFoodByName, portionTable, searchFoods } from "./library";
import { parseFragment, splitFragments } from "./parse";
import type { DietEntry, DietEntrySource, FoodItem, PortionRule } from "./types";

export type QuickCandidate = {
  /** 原句里的那一段 */
  raw: string;
  /** 剥掉时间词与动词后的部分 */
  cleaned: string;
  amount: number;
  unitLabel: string;
  /** 用户说的食物名（已剥噪音） */
  name: string;
  grams: number;
  /** 折算依据。会被界面原样展示，所以必须是人话 */
  basis: string;
  /** 克数是估算的：没写份量，或份量表里查不到这个组合 */
  estimated: boolean;
  food?: FoodItem;
  /** 库里没有匹配到，要请用户自己选一个 */
  missing: boolean;
  /** 命中或相近的食物，界面用来让用户改选。第一项是当前选中的 */
  alternatives: FoodItem[];
  /** 命中的份量规则，界面可以据此列出「小包 / 一包 / 大包」让用户改 */
  rule?: PortionRule;
};

/**
 * 找食物：先精确名再模糊 — 精确优先，免得「奶茶」被「奶茶（无糖）」抢走。
 *
 * ⚠️ **单字不给模糊检索。** 模糊检索有一条「被查询包含」的规则
 * （`q.includes(名字)`），对 1 个字的查询等于"随便挑一个含这个字的食物"：
 * 实测把量词残渣「包」配成了「肉包」200g。宁可返回 undefined 让上层说"没匹配到"，
 * 也不要给出一个**看起来正常的错数字**。
 * 单字的**精确**命中仍然放行（库里有「醋」「盐」这种正名单字）。
 */
export function matchFood(name: string): FoodItem | undefined {
  const q = name.trim();
  if (!q) return undefined;
  const exact = findFoodByName(q);
  if (exact) return exact;
  if (q.length < 2) return undefined;
  return searchFoods(q, 1)[0];
}

function resolveOne(fragment: string, altLimit: number): QuickCandidate {
  const parsed = parseFragment(fragment);
  const c: QuickCandidate = {
    raw: fragment,
    cleaned: parsed.cleaned,
    amount: parsed.amount,
    unitLabel: parsed.unit ?? "克",
    name: parsed.name,
    grams: 0,
    basis: "",
    estimated: false,
    missing: false,
    alternatives: [],
  };

  // 只有份量没说是吃什么（「一包」「半杯」）—— 不能拿残留的量词去模糊匹配
  if (!parsed.name) {
    c.missing = true;
    c.basis = `「${fragment}」里只有份量、没说是吃什么 —— 补上食物名就能算`;
    return c;
  }

  const food = matchFood(parsed.name);
  if (!food) {
    c.missing = true;
    c.basis = `库里没有匹配到「${parsed.name}」`;
    // 仍然给几个相近的让用户挑，别让他从零搜
    c.alternatives = searchFoods(parsed.name, altLimit);
    return c;
  }

  c.food = food;
  c.name = food.name;
  c.alternatives = dedupe([food, ...searchFoods(parsed.name, altLimit)]);

  // 用户既说了份量又说了克数（「一包 70g 的薯片」）—— 两个信息都用上：
  // 数量进 `amount`（记录里显示「1 包」，跟他说的一致），克数由 perUnitGrams 定。
  if (parsed.perUnitGrams) {
    const per = parsed.perUnitGrams;
    c.grams = parsed.amount * per;
    c.basis = `你说的「${fmt(parsed.amount)}${parsed.unit ?? ""} ${fmt(per)}g」= ${fmt(parsed.amount)} × ${fmt(per)}g = ${fmt(c.grams)}g`;
    return c;
  }

  if (parsed.unit === "克") {
    c.grams = parsed.amount;
    c.unitLabel = "克";
    c.basis = `你自己给了克数 ${parsed.amount}g`;
    return c;
  }

  if (parsed.unit) {
    const hit = resolvePortion(portionTable(), food, parsed.unit);
    if (hit) {
      c.grams = hit.grams * parsed.amount;
      c.rule = hit.rule;
      const range = hit.portion.range ? `（常见 ${hit.portion.range[0]}~${hit.portion.range[1]}g）` : "";
      c.basis = `${fmt(parsed.amount)} × 「${hit.portion.label}」${hit.grams}g = ${fmt(c.grams)}g${range}`;
      return c;
    }
    // 份量表里没有这个组合 —— 按分类兜底，并且**明确标成估算**
    c.grams = fallbackGrams(food) * parsed.amount;
    c.estimated = true;
    c.unitLabel = "份";
    c.basis = `份量表里没有「${parsed.unit}」这条，按分类兜底 ${fallbackGrams(food)}g × ${fmt(parsed.amount)} = ${fmt(c.grams)}g（估算）`;
    return c;
  }

  // 没写份量
  c.grams = fallbackGrams(food) * parsed.amount;
  c.estimated = true;
  c.unitLabel = "份";
  c.basis = `没写份量，按分类兜底 ${fallbackGrams(food)}g = ${fmt(c.grams)}g（估算）`;
  return c;
}

/** 去掉小数点后多余的 0，让依据读起来像人话 */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

function dedupe(list: FoodItem[]): FoodItem[] {
  const seen = new Set<string>();
  const out: FoodItem[] = [];
  for (const f of list) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  return out;
}

/** 把一句话切成若干候选。返回空数组表示这句话里没读出任何食物 */
export function resolveText(text: string, options?: { altLimit?: number }): QuickCandidate[] {
  const altLimit = options?.altLimit ?? 5;
  return splitFragments(text)
    .map((f) => resolveOne(f, altLimit))
    .filter((c) => c.cleaned.length > 0);
}

/** 该食物在某个量词下有哪些档位可选（界面用：小包 / 一包 / 大包） */
export function portionOptions(food: FoodItem, unit: string): { label: string; grams: number }[] {
  const rule = portionTable().rules.find(
    (r) =>
      r.unit === unit &&
      r.match.some((m) => [food.name, ...(food.alias ?? [])].some((n) => n.includes(m))),
  );
  return rule ? rule.portions.map((p) => ({ label: p.label, grams: p.grams })) : [];
}

/** 某个食物主力量词下的档位 —— 用户改份量时不用先想到量词 */
export function defaultPortionOptions(food: FoodItem): { unit: string; label: string; grams: number }[] {
  const names = [food.name, ...(food.alias ?? [])];
  return portionTable()
    .rules.filter((r) => r.match.some((m) => names.some((n) => n.includes(m))))
    .flatMap((r) => r.portions.map((p) => ({ unit: r.unit, label: p.label, grams: p.grams })));
}

/**
 * 把候选落成一条记录。
 *
 * ⚠️ 这里**不接收营养数值** —— 只有 `grams` 与 `food`，
 * 数值一律由 `makeDietEntry` 内部那一次 `nutritionOf` 乘法算出来。
 * 这是「模型与界面都塞不进数字」的结构性保证。
 */
export function candidateToEntry(
  c: QuickCandidate,
  opts: {
    id: string;
    createdAt: number;
    date: string;
    time: string;
    mealSlot?: MealSlot;
    /** 覆盖候选里的食物（用户改选过） */
    food?: FoodItem;
    /** 覆盖折算后的克数（用户手改了份量） */
    grams?: number;
    amount?: number;
    unitLabel?: string;
    source?: DietEntrySource;
    /** 只是一条手输的自定义食物，库里没有 */
    customName?: string;
  },
): DietEntry {
  const food = opts.food ?? c.food;
  const grams = opts.grams ?? c.grams;
  return makeDietEntry({
    id: opts.id,
    createdAt: opts.createdAt,
    date: opts.date,
    time: opts.time,
    mealSlot: opts.mealSlot ?? mealSlotFromTime(opts.time),
    food,
    name: food?.name ?? opts.customName ?? c.name,
    amount: opts.amount ?? c.amount,
    unitLabel: opts.unitLabel ?? c.unitLabel,
    grams,
    source: opts.source ?? "db",
  });
}
