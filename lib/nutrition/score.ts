/**
 * 饮食质量分（100 分制）。
 *
 * ⚠️ 两条诚实性要求，不是可选项：
 *
 * 1) **算不出来的维度不许编。** 食物库（`data/foods.zh.json`）没有「添加糖」字段，
 *    所以这里**没有**「添加糖」这一维 —— 这一条至今没变，维度还是七维 100 分。
 *    用别的数据凑一个糖分出来，正是这个项目最反对的那种假精确 ——
 *    分数会看起来很专业，但没有任何数据支撑。
 *    同理，原来设想的「超加工」也没有依据，降级为**分类口径**的「零食甜饮」。
 *
 *    ⚠️ 但「零食甜饮」这一维的**判定**已经升级过（2026-09-22）：**有糖数据时用真糖**
 *    （`NutritionTotals.values.sugar`，来自拍照识别与做菜加的糖），没有时退回名字代理。
 *    这**不是**新增维度、也没有动权重，只是把代理换成了真数据 —— 见 `scoreDay` 里那一段。
 *
 * 2) **数据不全的维度不进分母。** 钠只有 40% 的记录含数据时，把缺失当 0 会白送满分。
 *    这里把该维标成 `insufficient` 并从满分里整体扣掉，再按剩余满分归一化到 100 ——
 *    所以「今天 82 分」永远配着「钠数据齐全」这类前提能说清。
 *    （添加糖不走这条路：按它的定义，没标 = 没加糖，所以那些记录按 0 计入是对的，
 *    该不该说"数据不够"由覆盖率口径管，见 `core.ts` 的 `sumNutrition` / `coverageNote`。）
 */

import type {
  DietEntry,
  FoodCategory,
  NutritionTargets,
  NutritionTotals,
} from "./types";
import { categoryEnergyShare, energyRatios } from "./core";

export type ScoreDimension = {
  key: string;
  label: string;
  /** 该维在满分里的权重 */
  max: number;
  /** 实际得分 */
  got: number;
  /** 0..1，实际摄入相对目标的位置，用于在界面上画条 */
  ratio: number;
  /** 数据不足：既不得分也不占分母 */
  insufficient?: boolean;
  note?: string;
};

export type DietScore = {
  /** 归一化后的百分制分数。available 为 0 时是 0 */
  total: number;
  earned: number;
  /** 参与计分的满分（排除数据不足的维度） */
  available: number;
  dimensions: ScoreDimension[];
  /** 有明确钠数据的条目占比，透传给界面做提示 */
  sodiumCoverage: number;
  fiberCoverage: number;
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 越低越好：full 处得满分，到 zero 处得 0 分 */
function rampDown(v: number, full: number, zero: number): number {
  if (v <= full) return 1;
  if (v >= zero) return 0;
  return clamp01((zero - v) / (zero - full));
}

/** 越高越好：zero 处得 0 分，到 full 处得满分 */
function rampUp(v: number, zero: number, full: number): number {
  if (v <= zero) return 0;
  if (v >= full) return 1;
  return clamp01((v - zero) / (full - zero));
}

/**
 * 甜饮的近似判据。
 *
 * ⚠️ 这是**代理指标**，不是真的含糖量 —— 库里的 `drink` 分类同时装着白水与无糖茶，
 * 直接把整个分类算成"含糖饮料"会冤枉它们。所以这里按名字做一次筛选，
 * 宁可标得保守，也不假装自己有糖含量数据。
 * 没有命中的饮料（白水、纯茶、黑咖啡）不计入。
 *
 * ⚠️ 它现在**只在当天没有任何添加糖数据时**才生效（`scoreDay` 里判的）：
 * 一旦有一条记录标了糖，那一维就改成按真糖算 —— 到那时这个名单是多余的，
 * 留着它只是为了让"还没数据"的那一天也有个保守的说法。
 */
const SWEET_DRINK_HINTS = [
  "奶茶", "可乐", "雪碧", "果汁", "果茶", "乳酸", "酸梅汤",
  "运动饮料", "能量饮料", "冰红茶", "柠檬茶", "豆奶", "椰汁", "汽水",
];

function isUltraish(e: DietEntry): boolean {
  if (e.category === "snack" || e.category === "alcohol") return true;
  if (e.category !== "drink") return false;
  const name = e.name;
  return SWEET_DRINK_HINTS.some((h) => name.includes(h));
}

/** 记录覆盖了几个不同的正餐餐次 —— 「进食规律」只能用有记录的部分说话 */
function mealSlotsCovered(entries: readonly DietEntry[]): number {
  const slots = new Set(entries.map((e) => e.mealSlot));
  return ["早餐", "午餐", "晚餐"].filter((s) => slots.has(s as DietEntry["mealSlot"])).length;
}

export function scoreDay(input: {
  entries: readonly DietEntry[];
  totals: NutritionTotals;
  targets: NutritionTargets;
}): DietScore {
  const { entries, totals, targets } = input;
  const v = totals.values;
  const dims: ScoreDimension[] = [];

  // ---- 钠（20）：越低越好，到目标的 2 倍时归零 ----
  if (v.sodium === undefined) {
    dims.push({
      key: "sodium",
      label: "钠",
      max: 20,
      got: 0,
      ratio: 0,
      insufficient: true,
      note: `只有 ${Math.round(totals.sodiumCoverage * 100)}% 的记录含钠数据`,
    });
  } else {
    const ratio = targets.sodium > 0 ? v.sodium / targets.sodium : 0;
    dims.push({
      key: "sodium",
      label: "钠",
      max: 20,
      got: 20 * rampDown(ratio, 1, 2),
      ratio,
      note: ratio > 1 ? `已达目标的 ${Math.round(ratio * 100)}%` : undefined,
    });
  }

  // ---- 膳食纤维（15）：越高越好 ----
  if (v.fiber === undefined) {
    dims.push({
      key: "fiber",
      label: "膳食纤维",
      max: 15,
      got: 0,
      ratio: 0,
      insufficient: true,
      note: `只有 ${Math.round(totals.fiberCoverage * 100)}% 的记录含纤维数据`,
    });
  } else {
    const ratio = targets.fiber > 0 ? v.fiber / targets.fiber : 0;
    dims.push({
      key: "fiber",
      label: "膳食纤维",
      max: 15,
      got: 15 * rampUp(ratio, 0.3, 1),
      ratio,
    });
  }

  // ---- 蛋白质（10）：越高越好 ----
  const pRatio = targets.protein > 0 ? v.protein / targets.protein : 0;
  dims.push({
    key: "protein",
    label: "蛋白质",
    max: 10,
    got: 10 * rampUp(pRatio, 0.4, 1),
    ratio: pRatio,
  });

  // ---- 蔬果（15）：按供能占比。指南口径约 15%，低于 3% 得 0 ----
  const shares = categoryEnergyShare(entries);
  const shareOf = (...cats: FoodCategory[]): number =>
    shares.filter((s) => s.category !== "unknown" && cats.includes(s.category)).reduce((a, s) => a + s.share, 0);
  const vegFruit = shareOf("veg", "fruit");
  dims.push({
    key: "veg",
    label: "蔬果",
    max: 15,
    got: 15 * rampUp(vegFruit, 0.03, 0.15),
    ratio: vegFruit / 0.15,
    note: `占今天热量的 ${Math.round(vegFruit * 100)}%`,
  });

  // ---- 零食甜饮（15）：有糖数据时用**真糖**，没有时退回分类与名称的代理 ----
  //
  // ⚠️ 「占比」类维度在没有任何摄入时是**无意义**的，必须先判断有没有吃。
  // 这是实测踩出来的：空记录的一天因为"没吃零食"拿了这 15 分，总分 23 ——
  // 一个什么都没记的日子反而比认真记了但零食偏多的日子好看，显然荒谬。
  //
  // ⚠️ **这一维的维度数、权重、key 都没动**，动的只是它的**判定依据**。
  // 为什么不索性新增一维「添加糖」：那会和这一维**双重扣分**（一罐可乐被罚两次），
  // 还要把七维 100 分重新分配 —— 那正是用户说的"影响现有体系"。
  // 所以这里做的是把代理**升级**成真数据，并让 note 说清这一跑用的是哪个口径。
  //
  // ⚠️ **补了糖数据之后，同一天的分数会变** —— 这是**有意**的，不是抖动：
  // 数据变准了，判据就该跟着变准。前提是 note 已经把口径写出来，
  // 否则用户只会看到分数莫名其妙地跳了一下。
  const hasIntake = v.kcal > 0;
  const sugar = v.sugar;
  const sugarShare = hasIntake && sugar !== undefined ? (sugar * 4) / v.kcal : null;
  if (hasIntake && sugarShare !== null) {
    /*
     * 真数据这条路：添加糖供能占比。阈值挂在指南那条线上 ——
     * 权威口径是「添加糖供能 < 10%（最好 < 5%）」，所以
     * 5% 及以下给满分、15% 及以上归零，中间线性。
     * 直接套代理那条 (0.1, 0.35) 不行：那对付的是"零食甜饮占了多少热量"，
     * 而糖是"整份餐里加了糖的那部分"，同样 10% 的含糖量，两者的严重程度不是一回事。
     */
    dims.push({
      key: "ultra",
      label: "零食甜饮",
      max: 15,
      got: 15 * rampDown(sugarShare, 0.05, 0.15),
      ratio: sugarShare / 0.15,
      note: `添加糖占今天热量的 ${Math.round(sugarShare * 100)}%（膳食指南建议不超过 10%，5% 以内最好）`,
    });
  } else {
    const ultraKcal = entries.filter(isUltraish).reduce((a, e) => a + e.nutrition.kcal, 0);
    const ultraShare = hasIntake ? ultraKcal / v.kcal : 0;
    dims.push({
      key: "ultra",
      label: "零食甜饮",
      max: 15,
      got: hasIntake ? 15 * rampDown(ultraShare, 0.1, 0.35) : 0,
      ratio: ultraShare / 0.35,
      note: hasIntake
        ? `占今天热量的 ${Math.round(ultraShare * 100)}%（按分类与名称估算，还没有糖数据）`
        : "今天还没有记录",
    });
  }

  // ---- 供能比（15）：脂肪供能 20%~30% 为满分 ----
  const ratios = energyRatios(v);
  const fatShare = ratios.fat / 100;
  const fatScore = fatShare < 0.2 ? rampUp(fatShare, 0.1, 0.2) : rampDown(fatShare, 0.3, 0.45);
  dims.push({
    key: "fatratio",
    label: "供能比",
    max: 15,
    got: 15 * fatScore,
    ratio: fatScore,
    note: `脂肪供能 ${Math.round(fatShare * 100)}%（建议 20%~30%）`,
  });

  // ---- 进食规律（10）：三个正餐有记录即满分 ----
  const covered = mealSlotsCovered(entries);
  dims.push({
    key: "regular",
    label: "进食规律",
    max: 10,
    got: 10 * (covered / 3),
    ratio: covered / 3,
    note: covered === 0 ? "还没有正餐记录" : `记录了 ${covered} 个正餐`,
  });

  const available = dims.reduce((a, d) => a + (d.insufficient ? 0 : d.max), 0);
  const earned = dims.reduce((a, d) => a + d.got, 0);

  return {
    total: available > 0 ? Math.round((earned / available) * 100) : 0,
    earned,
    available,
    dimensions: dims,
    sodiumCoverage: totals.sodiumCoverage,
    fiberCoverage: totals.fiberCoverage,
  };
}

/** 一句话说明分数的口径，放在分数旁边 —— 分数必须可解释，否则只是个数字 */
export function describeScore(s: DietScore): string {
  const skipped = s.dimensions.filter((d) => d.insufficient).map((d) => d.label);
  const base = `按 ${s.available} 分满分折算`;
  if (!skipped.length) return `${base}，全部维度都有数据`;
  return `${base}；${skipped.join("、")}因数据不足未计入`;
}

// ---------- 一周汇总 ----------

export type WeekDietSummary = {
  /** 参与平均的天数 */
  scoredDays: number;
  /** 平均分。没有一天算得出来时是 null —— 不是 0 */
  average: number | null;
  /** 与上周相比的变化。上周没有可算的天时是 null */
  delta: number | null;
  best: { date: string; score: number } | null;
  worst: { date: string; score: number } | null;
  /** 逐日，给柱状图用。没记录或算不出来的那天是 null */
  days: { date: string; score: number | null }[];
};

/**
 * 把一周的逐日分数汇总起来。
 *
 * ⚠️ 两处刻意不等于「按 7 天平均」：
 * 1) **没记录的那天不参与平均，也不当 0。** 一周只记了 2 天，
 *    按 7 天平均等于把"没记"当成"吃得差"，分数会凭记录习惯而非饮食质量上下浮动。
 * 2) **算不出来的那天也不参与。** 一条零食记录就能让某些维度全部数据不足，
 *    这种天的分数没有意义（`available === 0`），放进平均会把它当成"0 分的一天"。
 * 所以 `scoredDays` 与 `average` 成对出现，界面必须把"几天参与了"写出来。
 */
export function summarizeWeek(input: {
  days: { date: string; score: DietScore | null }[];
  /** 上一周的平均分（没有就算了，不要传 0） */
  previousAverage?: number | null;
}): WeekDietSummary {
  const rows = input.days.map((d) => ({
    date: d.date,
    score: d.score && d.score.available > 0 ? d.score.total : null,
  }));

  const valid = rows.filter((r): r is { date: string; score: number } => r.score !== null);
  if (!valid.length) {
    return {
      scoredDays: 0,
      average: null,
      delta: null,
      best: null,
      worst: null,
      days: rows,
    };
  }

  const average = Math.round(valid.reduce((s, r) => s + r.score, 0) / valid.length);
  const sorted = [...valid].sort((a, b) => b.score - a.score);
  const prev = input.previousAverage;
  return {
    scoredDays: valid.length,
    average,
    delta: typeof prev === "number" && prev > 0 ? average - prev : null,
    best: sorted[0],
    worst: sorted[sorted.length - 1],
    days: rows,
  };
}
