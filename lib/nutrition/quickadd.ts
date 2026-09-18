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
import { findFoodByName, foodsByCategory, portionTable, searchFoods } from "./library";
import { parseFragment, splitFragments } from "./parse";
import type { DietEntry, DietEntrySource, FoodCategory, FoodItem, PortionRule } from "./types";

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
  /** 没匹配上时**是哪种没匹配上** —— 界面据此说不同的话、给不同的出路 */
  reason?: MissingReason;
  /** 给用户看的一句解释（只在 missing 时给）。说清"为什么不记账"或"要怎么补" */
  explain?: string;
  /** 命中或相近的食物，界面用来让用户改选。第一项是当前选中的 */
  alternatives: FoodItem[];
  /** 命中的份量规则，界面可以据此列出「小包 / 一包 / 大包」让用户改 */
  rule?: PortionRule;
};

/**
 * 没匹配上的四种原因。
 *
 * 分开的理由：「未匹配：矿泉水」和「未匹配：顿饭」对用户来说是完全不同的两件事 ——
 * 前者是**不需要记**，后者是**说得太笼统**，只有第三种才是"库里真没有"。
 * 都糊成一句「未匹配」，用户只能自己猜，而他猜不出来的正是这个地方。
 */
export type MissingReason =
  /** 只有份量，没说吃什么（「一包」「半杯」） */
  | "no-name"
  /** 是整餐/整单的说法（「顿饭」「正餐」「外卖」），不是某一样食物 */
  | "meal"
  /** 水、茶、黑咖啡这类，记了也几乎不改变任何结论 */
  | "no-calorie"
  /** 说的是**哪一类**而不是哪一样（「肉」「蔬菜」「主食」） */
  | "generic"
  /** 库里确实没有这一条 */
  | "not-found";

/**
 * 泛称：用户说的是"哪一类"，不是"哪一样"。
 *
 * ⚠️ **绝不替他把泛称配成某一条具体食物。** 「一份肉」到底记成猪肉、鸡肉还是牛肉？
 * 猜错的后果是**账本上多了一条数值正常、但根本不是他吃的东西的记录** ——
 * 比说一句"太笼统"有害得多。所以这里只做两件事：说清太笼统，并按分类摆几个候选。
 *
 * ⚠️ 表里只放**库里精确匹配不到**的词。「饭」是「米饭」的别名、「青菜」能模糊命中
 * 「清炒时蔬」——那些轮不到这里，放进来反而会把本来能命中的说法抢走。
 */
const GENERIC_TERMS: { words: string[]; category: FoodCategory; label: string }[] = [
  { words: ["肉", "肉类", "荤菜", "荤"], category: "meat", label: "荤菜" },
  { words: ["蔬菜", "素菜", "青菜", "菜"], category: "veg", label: "素菜" },
  { words: ["主食", "碳水"], category: "staple", label: "主食" },
  { words: ["水果"], category: "fruit", label: "水果" },
  { words: ["汤", "汤水"], category: "soup", label: "汤粥" },
  { words: ["饮料", "喝的"], category: "drink", label: "饮料" },
];

function genericOf(name: string): { category: FoodCategory; label: string } | null {
  for (const g of GENERIC_TERMS) {
    if (g.words.includes(name)) return { category: g.category, label: g.label };
  }
  return null;
}

/**
 * 整餐的说法。**必须整名匹配**，否则「午饭吃了红烧肉」会被当成"只说了餐次"。
 */
const MEAL_PHRASE_RE = /^(一|两|几|半)?(顿|餐)?(饭|正餐|大餐|早饭|早餐|午饭|午餐|晚饭|晚餐|宵夜|夜宵|早点|加餐|外卖|家常菜)$/;

/**
 * 记了也几乎不改变结论的东西。
 *
 * ⚠️ **只能整名精确匹配，绝不能用子串** ——「茶」是「奶茶」的子串、
 * 「水」是「水煮肉片」的子串，子串匹配会让"不必记账"这句话说错对象。
 *
 * 这些不写进食物库，是因为账本算的是营养素，而它们的贡献约等于 0；
 * 喝水量本来就在首页有独立的打卡（那是"喝够没有"的问题，不是"热量多少"的问题）。
 */
const NO_CALORIE_NAMES = new Set([
  "水", "白开水", "开水", "热水", "温水", "凉白开", "凉开水", "冰水", "凉水",
  "矿泉水", "纯净水", "饮用水", "瓶装水", "茶水",
  "茶", "绿茶", "红茶", "乌龙茶", "普洱茶", "花茶", "黑咖啡", "美式", "美式咖啡", "气泡水", "苏打水",
]);

function missingReason(name: string): MissingReason {
  if (NO_CALORIE_NAMES.has(name)) return "no-calorie";
  if (MEAL_PHRASE_RE.test(name)) return "meal";
  return "not-found";
}

/** 把「为什么没记上」说成人话。界面原样展示，所以措辞要能直接给用户看 */
function missingExplain(name: string, reason: MissingReason): string {
  switch (reason) {
    case "meal":
      return `「${name}」是整餐的说法，账本要落到具体吃了什么才估得出热量 —— 下面挑一样，或者分开记几条。`;
    case "no-calorie":
      return `水和清茶这类几乎没有热量，记进来不会改变任何结论。想记喝了多少水，用首页的「喝水」打卡更合适。`;
    default:
      return `库里没有「${name}」。从下面挑一个相近的，或者用「搜索添加」自己找。`;
  }
}

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

/**
 * 约数（「两三个」）要标成估算，并在依据里说清取的是哪个值。
 *
 * 用户说的是"大概"，屏幕上就不该出现一个看起来精确的 2 —— 那正是"假精确"。
 * 取的是两个数里小的那个（宁低不高），理由见 `parse.ts` 的 `parseCnAmount`。
 */
function withApprox(c: QuickCandidate, parsed: { amount: number; approximate?: boolean }): QuickCandidate {
  if (!parsed.approximate) return c;
  c.estimated = true;
  if (c.basis) c.basis = `「${fmt(parsed.amount)}」是约数里取保守的那个；${c.basis}`;
  return c;
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
    c.reason = "no-name";
    c.explain = `「${fragment}」里只有份量、没说是吃什么 —— 补上食物名就能算`;
    return withApprox(c, parsed);
  }

  /*
   * ⚠️ **先拿剥尺寸词之前的原名去查**。
   * 库里有「大白菜」这种以「大」开头的正名 —— 直接拿剥过的「白菜」去查会落空
   * （眼下侥幸被模糊匹配救回来了，但那是碰运气，不能依赖）。
   * 原名查不到，才说明那个「大」多半是形容词：这时才用剥过的名字，并拿 `sizeHint` 去挑档。
   */
  const rawName = parsed.nameRaw ?? parsed.name;
  /*
   * ⚠️ 判据必须是**精确**匹配，不能用 `matchFood`。
   * 「大饺子」也能被 `matchFood` **模糊**配到「饺子」—— 用它就会把这种情况误判成
   * 「原名就查到了，那个大字是正名的一部分」，于是尺寸档**永远不生效**。
   * 而「大白菜」是**精确**命中的正名。这两种必须分开，所以这里用 `findFoodByName`。
   */
  const exactRaw = findFoodByName(rawName);
  /*
   * 没有 nameRaw（没剥尺寸词）时 rawName === parsed.name，这一行就退化成原来的 matchFood；
   * 有了 nameRaw 才是「先精确查原名，查不到再拿剥过的去模糊查」。
   */
  const food = exactRaw ?? matchFood(parsed.name);
  /** 只有「剥了之后才查到」时，那个尺寸词才是形容词 */
  const sizeHint = exactRaw ? undefined : parsed.sizeHint;

  if (!food) {
    // 泛称（「肉」「蔬菜」）走单独一条路：不硬配具体食物，只按分类摆候选
    const generic = genericOf(rawName);
    c.missing = true;
    if (generic) {
      c.reason = "generic";
      c.explain = `「${rawName}」太笼统了 —— 说明白是哪一样才记得准。下面按${generic.label}给你几个，或者自己搜一个。`;
      c.alternatives = foodsByCategory(generic.category).slice(0, altLimit);
    } else {
      c.reason = missingReason(rawName);
      c.explain = missingExplain(rawName, c.reason);
      // 仍然给几个相近的让用户挑，别让他从零搜。
      // 整餐的说法也给：说「吃了顿饭」的人多半要的是主食，摆个「米饭」出来比让他自己搜强。
      c.alternatives = searchFoods(rawName, altLimit);
    }
    return withApprox(c, parsed);
  }

  c.food = food;
  c.name = food.name;
  c.alternatives = dedupe([food, ...searchFoods(rawName, altLimit)]);

  // 用户既说了份量又说了克数（「一包 70g 的薯片」）—— 两个信息都用上：
  // 数量进 `amount`（记录里显示「1 包」，跟他说的一致），克数由 perUnitGrams 定。
  if (parsed.perUnitGrams) {
    const per = parsed.perUnitGrams;
    c.grams = parsed.amount * per;
    c.basis = `你说的「${fmt(parsed.amount)}${parsed.unit ?? ""} ${fmt(per)}g」= ${fmt(parsed.amount)} × ${fmt(per)}g = ${fmt(c.grams)}g`;
    return withApprox(c, parsed);
  }

  if (parsed.unit === "克") {
    c.grams = parsed.amount;
    c.unitLabel = "克";
    c.basis = `你自己给了克数 ${parsed.amount}g`;
    return withApprox(c, parsed);
  }

  if (parsed.unit) {
    // sizeHint 是用户说的档位（「大饺子」→ 大）。份量表里没有这一档时它会被忽略，
    // 退回默认档 —— 不会因为多说了一个形容词就查不到。
    const hit = resolvePortion(portionTable(), food, parsed.unit, sizeHint);
    if (hit) {
      c.grams = hit.grams * parsed.amount;
      c.rule = hit.rule;
      const range = hit.portion.range ? `（常见 ${hit.portion.range[0]}~${hit.portion.range[1]}g）` : "";
      c.basis = `${fmt(parsed.amount)} × 「${hit.portion.label}」${hit.grams}g = ${fmt(c.grams)}g${range}`;
      return withApprox(c, parsed);
    }
    // 份量表里没有这个组合 —— 按分类兜底，并且**明确标成估算**
    c.grams = fallbackGrams(food) * parsed.amount;
    c.estimated = true;
    c.unitLabel = "份";
    c.basis = `份量表里没有「${parsed.unit}」这条，按分类兜底 ${fallbackGrams(food)}g × ${fmt(parsed.amount)} = ${fmt(c.grams)}g（估算）`;
    return withApprox(c, parsed);
  }

  // 没写份量
  c.grams = fallbackGrams(food) * parsed.amount;
  c.estimated = true;
  c.unitLabel = "份";
  c.basis = `没写份量，按分类兜底 ${fallbackGrams(food)}g = ${fmt(c.grams)}g（估算）`;
  return withApprox(c, parsed);
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

/**
 * 某个食物有哪些档位可选（界面用：小包 / 一包 / 大包）。
 *
 * 刻意**只留这一个入口**：它跨所有量词（「一个苹果」和「一盘苹果」的档位一起给），
 * 因为调用方（`PortionPicker` / `QuickAddCard`）手上只有"这个食物"，
 * 而档位标签自己就带量词（「一包 · 70g」），用户看得懂，不需要我们先按量词筛一遍。
 *
 * ⚠️ 这里曾经还有第二个函数 `portionOptions(food, unit)`（限定量词），
 * 但它**一个调用点都没有** —— 留着两套口径只会让人不知道该信哪个，已删。
 */
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
