/**
 * 饮食建议规则引擎（纯函数）。
 *
 * 分工是刻意的：**这里负责「说什么」，不负责「怎么说漂亮」**。
 * 先按数据判定今天真正偏了哪一项、偏了多少、主要是被哪一样拉起来的，
 * 再把结论交给模型去措辞（P4 的 AI 建议）。反过来做 ——
 * 先让模型看着一堆指标自由发挥 —— 就会出现「建议你今天注意均衡饮食」这种
 * 正确但没用的废话，以及更糟的：编一个数据里不存在的结论。
 *
 * 四条自律：
 * 1) **只报真实偏差。** 每一项都先算，不满足条件就不产生 issue，不是"凑几条建议"。
 * 2) **每条建议必须指向具体食物。** 能用 `topContributors` 找到主要来源时，
 *    就说清是哪一样、占多少，而不是泛泛地说"少吃盐"。
 * 3) **今天还没吃完时，不许说"营养不够"。**
 *    这是踩过才发现的一条：只记了 400kcal 的一天，纤维必然"不足"、
 *    蛋白必然"不够" —— 但用户还没吃晚饭。此时报"缺纤维"是把
 *    「记录进度」误当成「饮食质量」，会让人按错误结论去补吃。
 *    所以"不足型"的问题一律要求当天热量已到目标的 60% 才报；
 *    "超标型"（钠、热量、零食）不受此限 —— 吃超了就是吃超了。
 * 4) **不碰医疗。** 只说食物层面的替换，不说任何身体状况、疾病、疗效。
 */

import type {
  DietEntry,
  FoodCategory,
  NutritionTargets,
  NutritionTotals,
  TargetDirection,
} from "./types";
import { categoryEnergyShare, compareToTargets, energyRatios, topContributors } from "./core";

export type AdviceIssue = {
  key: string;
  label: string;
  /** 越大越该先处理。仅用于排序，不要展示给用户 */
  severity: number;
  /** 说清事实：带具体数字，不带评价 */
  fact: string;
  /** 一条可执行的改法 */
  action: string;
  /** 替换方案：把什么换成什么 */
  swap?: string;
};

/**
 * 各条规则的优先级（0~1 的偏离幅度再乘上它）。
 *
 * 钠排第一是有理由的：它是中式饮食里最常见、也最容易在今天这一顿就改掉的一项，
 * 而纤维/蔬果偏"长期结构"问题 —— 每天都把"纤维不足"顶在最前面，
 * 用户会对这条建议彻底麻木，真正急的那条反而被淹没。
 * 顺序不是拍脑袋定的：**能被今天一顿饭解决的事排在前面。**
 */
const PRIORITY = {
  sodium: 1.5,
  kcal: 1.3,
  ultra: 1.1,
  veg: 1.0,
  protein: 0.9,
  fiber: 0.8,
  fatHigh: 0.7,
  fatLow: 0.5,
} as const;

/** 替换建议：按分类给方向。刻意只给「换什么类别」，不写成营养学处方 */
const SWAP_BY_CATEGORY: Record<FoodCategory, string> = {
  staple: "一半白米饭换成杂粮饭或蒸红薯",
  meat: "换成清蒸鱼、白灼鸡胸这类少油的做法",
  veg: "换成一大盘清炒或白灼的绿叶菜",
  protein: "换成水煮蛋、无糖酸奶或原味豆浆",
  fruit: "换成整颗水果，别喝果汁",
  snack: "换成一小把坚果或无糖酸奶",
  drink: "换成无糖茶或白水",
  soup: "换成蔬菜汤，别用浓汤宝",
  seasoning: "把用量减半，先用香辛料提味",
  alcohol: "换成无醇的，或者只留一小杯",
};

function swapFor(e: DietEntry): string {
  const hint = e.category ? SWAP_BY_CATEGORY[e.category] : "换成同类里做法更简单的那样";
  return `把「${e.name}」${hint}`;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** 「其中 62% 来自「一包薯片」」这类归因。找不到主因或占比过低时返回 null */
function attributeTo(
  entries: readonly DietEntry[],
  key: "kcal" | "protein" | "fat" | "carb" | "sodium",
  total: number | undefined,
): { text: string; entry: DietEntry } | null {
  if (!total || total <= 0) return null;
  const top = topContributors(entries, key, 1)[0];
  if (!top) return null;
  const share = Math.round((top.value / total) * 100);
  // 占比太小时不值得点名 —— 说了反而让人以为问题就在那一样
  if (share < 20) return null;
  return { text: `其中 ${share}% 来自「${top.entry.name}」`, entry: top.entry };
}

export function findIssues(input: {
  entries: readonly DietEntry[];
  totals: NutritionTotals;
  targets: NutritionTargets;
}): AdviceIssue[] {
  const { entries, totals, targets } = input;
  if (!entries.length) return [];

  const statuses = compareToTargets(totals, targets);
  const byKey = new Map(statuses.map((s) => [s.key, s]));
  const v = totals.values;
  const shares = categoryEnergyShare(entries);
  const vegFruit = shares
    .filter((s) => s.category === "veg" || s.category === "fruit")
    .reduce((a, s) => a + s.share, 0);
  const ultraKcal = entries
    .filter((e) => e.category === "snack" || e.category === "alcohol")
    .reduce((a, e) => a + e.nutrition.kcal, 0);
  const ultraShare = v.kcal > 0 ? ultraKcal / v.kcal : 0;
  const fatShare = energyRatios(v).fat / 100;

  /** 今天的热量是否已经吃得差不多了。不足型问题必须过这一关，见文件头的第 3 条 */
  const daySettled = targets.kcal > 0 && v.kcal >= targets.kcal * 0.6;

  const issues: AdviceIssue[] = [];

  // ---- 钠超标：优先级最高 ----
  const sodium = byKey.get("sodium");
  if (sodium && sodium.verdict === "high" && v.sodium !== undefined) {
    const attr = attributeTo(entries, "sodium", v.sodium);
    issues.push({
      key: "sodium",
      label: "钠",
      severity: PRIORITY.sodium * clamp01(sodium.ratio - 1),
      fact: `今天钠 ${Math.round(v.sodium)}mg，是目标 ${sodium.target}mg 的 ${Math.round(sodium.ratio * 100)}%。${attr?.text ?? ""}`,
      action: "今天剩下一顿别再放酱油、蚝油、豆瓣酱，咸菜与加工肉先停一次",
      swap: attr ? swapFor(attr.entry) : "把调味重的菜换成一荤一素、只放盐的做法",
    });
  }

  // ---- 热量超出上沿 ----
  const kcal = byKey.get("kcal");
  if (kcal && kcal.verdict === "high") {
    const attr = attributeTo(entries, "kcal", v.kcal);
    issues.push({
      key: "kcal",
      label: "热量",
      severity: PRIORITY.kcal * clamp01((kcal.ratio - 1) / 0.5),
      fact: `今天 ${Math.round(v.kcal)}kcal，超出目标 ${kcal.target}kcal 的 ${Math.round((kcal.ratio - 1) * 100)}%。${attr?.text ?? ""}`,
      action: "下一顿把主食减三分之一，先吃菜和蛋白",
      swap: attr ? swapFor(attr.entry) : "把油炸、糖醋这类做法换成清蒸或白灼",
    });
  }

  // ---- 零食甜饮占比偏高（超标型，不受 daySettled 限制）----
  if (ultraShare > 0.2 && v.kcal > 200) {
    issues.push({
      key: "ultra",
      label: "零食甜饮",
      severity: PRIORITY.ultra * clamp01((ultraShare - 0.2) / 0.25),
      fact: `零食与甜饮占了今天热量的 ${Math.round(ultraShare * 100)}%，大致是 ${Math.round(ultraKcal)}kcal。`,
      action: "今天剩下的时间只喝水或无糖茶，别再开零食袋",
      swap: "嘴馋的话换成一小把原味坚果或一个苹果",
    });
  }

  // ---- 以下都是"不足型"，只在今天热量已到 60% 时才报 ----

  // 蔬果太少
  if (daySettled && vegFruit < 0.08) {
    issues.push({
      key: "veg",
      label: "蔬果",
      severity: PRIORITY.veg * clamp01((0.08 - vegFruit) / 0.08),
      fact: `蔬果只占今天热量的 ${Math.round(vegFruit * 100)}%，基本没有吃到。`,
      action: "下一顿先安排一份绿叶菜，再考虑别的",
      swap: "把桌上的一个肉菜换成清炒时蔬或凉拌菜",
    });
  }

  // 纤维不足（只在有纤维数据时判定）
  const fiber = byKey.get("fiber");
  if (daySettled && fiber && fiber.verdict === "low" && v.fiber !== undefined) {
    issues.push({
      key: "fiber",
      label: "膳食纤维",
      severity: PRIORITY.fiber * clamp01((1 - fiber.ratio) / 0.7),
      fact: `膳食纤维 ${v.fiber.toFixed(1)}g，只到目标 ${fiber.target}g 的 ${Math.round(fiber.ratio * 100)}%。`,
      action: "主食里换一半成杂粮、燕麦或薯类",
      swap: "把白米饭换成杂粮饭，再补一份凉拌木耳或芹菜",
    });
  }

  // 脂肪供能比偏离
  if (fatShare > 0.35) {
    issues.push({
      key: "fatratio",
      label: "脂肪供能比",
      severity: PRIORITY.fatHigh * clamp01((fatShare - 0.35) / 0.2),
      fact: `脂肪供能占了 ${Math.round(fatShare * 100)}%，高于建议的 20%~30%。`,
      action: "今天剩下的菜用蒸煮，别再煎炒",
      swap: "把红烧、干煸换成清蒸或白灼",
    });
  } else if (daySettled && fatShare > 0 && fatShare < 0.18) {
    issues.push({
      key: "fatratio",
      label: "脂肪供能比",
      severity: PRIORITY.fatLow * clamp01((0.18 - fatShare) / 0.18),
      fact: `脂肪供能只有 ${Math.round(fatShare * 100)}%，低于建议的 20%~30%。`,
      action: "炒菜正常放油，可以加一份坚果",
      swap: "把水煮菜换成少油快炒，或者加一勺芝麻酱",
    });
  }

  // 蛋白质不足
  const protein = byKey.get("protein");
  if (daySettled && protein && protein.verdict === "low") {
    issues.push({
      key: "protein",
      label: "蛋白质",
      severity: PRIORITY.protein * clamp01((1 - protein.ratio) / 0.7),
      fact: `蛋白质 ${v.protein.toFixed(1)}g，只到目标 ${protein.target}g 的 ${Math.round(protein.ratio * 100)}%。`,
      action: "下一顿加一个水煮蛋或一份鸡胸/豆腐",
      swap: "把一部分主食换成鸡蛋、无糖酸奶或豆制品",
    });
  }

  return issues.sort((a, b) => b.severity - a.severity);
}

/** 今天最该改的那一条。没有真实偏差时返回 null —— 不硬凑建议 */
export function topAdvice(issues: readonly AdviceIssue[]): AdviceIssue | null {
  return issues[0] ?? null;
}

/**
 * 今日缺口：还有多少余量、哪些已经满了。
 *
 * 给 P4 的推荐用 —— 让推荐知道"今天缺什么"，而不是脱离实际情况乱推荐。
 * `direction` 直接带出来，避免调用方自己猜「这项是越多越好还是越少越好」。
 */
export function describeGaps(input: {
  totals: NutritionTotals;
  targets: NutritionTargets;
}): {
  key: string;
  label: string;
  /** atMost 型超了就为负；atLeast 型不够时为正 */
  remaining: number;
  /** 目标值。算「偏了百分之多少」时用，避免拿不同单位的 remaining 直接比 */
  target: number;
  unit: string;
  direction: TargetDirection;
  ratio: number;
  /** 数据不足，无法判断余量 */
  unknown: boolean;
}[] {
  return compareToTargets(input.totals, input.targets).map((s) => ({
    key: s.key,
    label: s.label,
    remaining: s.direction === "atMost" ? s.target - s.intake : Math.max(0, s.target - s.intake),
    /**
     * 目标值。调用方要算「偏了百分之多少」时用它 ——
     * 钠是 mg、纤维是 g，拿 remaining 直接比大小没有意义。
     */
    target: s.target,
    unit: s.unit,
    direction: s.direction,
    ratio: s.ratio,
    unknown: s.verdict === "unknown",
  }));
}

/**
 * 把缺口写成一句给模型看的话。数值仍然由这里给，模型不许自己算。
 * 数据不足的项直接跳过 —— 让模型看到"钠：0mg，还有 2000mg 余量"会引出错误建议。
 */
export function gapSummary(input: {
  totals: NutritionTotals;
  targets: NutritionTargets;
}): string {
  // 一条记录都没有时，「热量还差 2000kcal」是句会误导人的话 ——
  // 它把"还没记"说成了"还差这么多"，跟拿记录进度当饮食质量是同一类错误。
  if (!input.totals.entries) return "今天还没有足够的饮食记录，无法判断缺口。";

  const gaps = describeGaps(input).filter((g) => !g.unknown);
  if (!gaps.length) return "今天还没有足够的饮食记录，无法判断缺口。";
  return (
    gaps
      .map((g) => {
        if (g.direction === "atMost") {
          return g.remaining > 0
            ? `${g.label}还有 ${Math.round(g.remaining)}${g.unit} 余量`
            : `${g.label}已超 ${Math.round(-g.remaining)}${g.unit}`;
        }
        return g.remaining > 0
          ? `${g.label}还差 ${Math.round(g.remaining)}${g.unit}`
          : `${g.label}已经够了`;
      })
      .join("；") + "。"
  );
}
