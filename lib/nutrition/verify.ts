/**
 * 把「从照片里读出来的数字」过一遍体检 —— 全部是纯函数。
 *
 * 纪律（与 `core.ts` 同款，破坏任何一条都会让数字变成幻觉）：
 *
 * 1. **不许 import UI / Next / localStorage / 食物库 JSON。** 这里只有算术。
 *    它是**判官**，不该去问被审判的人。
 * 2. **`undefined` 不是 0。** 图上没印的项就是"没有数据"，不参与闭合、
 *    不参与 NRV 核对，也绝不补 0 —— 补了就等于替厂商编了个数（地雷 11）。
 * 3. **这一层只做减法，不做加法。** 它的产出是「给 / 不给 / 给了但要标存疑」，
 *    不产生任何新的营养数字。
 *
 * 它存在的理由：模型是**转录员**，转录就会抄错 —— 小数点丢一个（9.0 → 105）、
 * 单位看错（克看成毫克）、把 NRV 列的数字抄进含量列。这些错误单看都像模像样，
 * 只有让它们**互相印证**才露馅。三条判据：
 *
 *   A. **Atwater 闭合** —— 蛋白×4 + 脂肪×9 + 碳水×4 应该约等于热量。
 *      这是食品标注的物理约束，厂商也得守。对不上说明至少有一个数抄错了。
 *   B. **NRV 反算** —— 图上那个 NRV% 是用国标基准除出来的，拿含量反算回去
 *      应该对得上。对不上说明含量列或 NRV 列抄错了。
 *   C. **物理区间** —— 每 100g/ml 的能量/营养素都有物理上限（纯油 900 kcal、
 *      纯水 0），超出这个范围的东西不存在。
 *
 * ⚠️ 这条闸门**证明不了读对了** —— 四个数**一致地**抄错仍然过得去。
 * 它只能拦住"自相矛盾"，这正是转录错误最常见的形态。
 */

import type { FoodReading } from "../ai/foodVision";

export type VerifyVerdict = "ok" | "suspect" | "reject";
export type VerifyResult = { verdict: VerifyVerdict; reasons: string[]; closurePct?: number };

/**
 * 闭合的容差。沿用 `scripts/check-food-reference.mjs:55` 的既有口径
 * （kcal ±1、三大营养素 ±0.15），那是**库内自洽**的尺度。
 *
 * 但读照片的场景不同：厂商标的是**四舍五入后**的值，营养素的位数还可能只到整数，
 * 所以这里再放一档。三档：
 *   - `TIGHT`：库内自洽的尺度，抄得准就该落在这
 *   - `LOOSE`：标注舍入能解释的最大偏差 —— 落在这算「存疑」，数字仍可给
 *   - 超出 `LOOSE` 一律 `reject`
 */
export const CLOSURE_TOL = { kcal: 1, macro: 0.15 } as const;

/** 相对偏差的门槛：≤5% 算抄准了；>5% 但 ≤20% 算存疑；>20% 直接拒 */
const CLOSURE_OK_RATIO = 0.05;
const CLOSURE_SUSPECT_RATIO = 0.2;

/**
 * 国标 NRV 基准（GB 28050《预包装食品营养标签通则》）。
 * 厂商标 NRV% 就是拿含量除以这些数。
 *
 * ⚠️ 能量用**千焦**：包装上 NRV% 是按 kJ 算的，不是 kcal。
 * 拿 kcal 去除会差 4.184 倍，把好数据误判成冲突。
 */
export const NRV_BASE = {
  energyKj: 8400,
  protein: 60,
  fat: 60,
  carb: 300,
  sodium: 2000,
} as const;

/** NRV% 是整数（大多厂商只标到 1%），所以容差得容得下那次取整 */
const NRV_TOL_PCT = 1.0;
/** 含量很小时（如钠 10mg → 0.5%），厂商可能直接标 0% 或 1%，多给一点余地 */
const NRV_TOL_PCT_SMALL = 1.5;

/**
 * Atwater 闭合校验。
 *
 * 用 **kcal** 算（蛋白/脂肪/碳水各 4/9/4 kcal per g），
 * 因为这三者的 Atwater 系数本来就是按 kcal 定的。
 * 缺项（`undefined`）按 0 参与算术 —— 但会单独记一笔，因为缺项越多这个校验越不可信。
 *
 * @returns `expected` 由三大营养素反推的热量；`diffRatio` 相对偏差（0.05 = 5%）；
 *          `ok` 是否落在紧档内
 */
export function energyClosure(v: {
  kcal: number;
  protein: number;
  fat: number;
  carb: number;
}): { expected: number; diffRatio: number; ok: boolean } {
  const expected = v.protein * 4 + v.fat * 9 + v.carb * 4;
  // 两边都接近 0 时（如纯水、无糖茶），用绝对差判断，免得除出个无穷大
  const denom = Math.max(Math.abs(v.kcal), Math.abs(expected), 1);
  const diffRatio = Math.abs(v.kcal - expected) / denom;
  return { expected, diffRatio, ok: diffRatio <= CLOSURE_OK_RATIO };
}

/**
 * 用国标基准核对图上标的 NRV%。
 *
 * 只核对**两边都有值**的项 —— 图上没印 NRV、或含量读不出来，就跳过（不是错误）。
 *
 * @returns `mismatches` 每项一句中文，直接能给用户看
 */
export function nrvCheck(
  v: {
    energyKj?: number;
    protein?: number;
    fat?: number;
    carb?: number;
    sodium?: number;
  },
  nrv: { energy?: number; protein?: number; fat?: number; carb?: number; sodium?: number },
): { mismatches: string[] } {
  const mismatches: string[] = [];

  const pairs: [string, number | undefined, number | undefined, number][] = [
    ["能量", v.energyKj, nrv.energy, NRV_BASE.energyKj],
    ["蛋白质", v.protein, nrv.protein, NRV_BASE.protein],
    ["脂肪", v.fat, nrv.fat, NRV_BASE.fat],
    ["碳水化合物", v.carb, nrv.carb, NRV_BASE.carb],
    ["钠", v.sodium, nrv.sodium, NRV_BASE.sodium],
  ];

  for (const [label, value, pct, base] of pairs) {
    if (value === undefined || pct === undefined) continue;
    const expectedPct = (value / base) * 100;
    const tol = expectedPct < 1 ? NRV_TOL_PCT_SMALL + 1 : NRV_TOL_PCT;
    if (Math.abs(expectedPct - pct) > tol) {
      mismatches.push(
        `${label}：标的 NRV ${pct}%，但 ${value} ÷ ${base} 只有 ${expectedPct.toFixed(2)}%`,
      );
    }
  }

  return { mismatches };
}

/**
 * 每 100g / 100ml 的物理区间。
 * 超出即 `reject` —— 这不是"不太像"，是"物理上不存在"。
 *
 * 上限的来路：
 *   - 能量 900：纯油脂是食物里能量密度最高的（约 900 kcal/100g），没有比它更高的
 *   - 蛋白 100：100g 里最多 100g 蛋白（纯蛋白粉的极限）
 *   - 脂肪 100：同上（纯油）
 *   - 碳水 100：同上（纯糖、纯淀粉）
 *   - 钠 40000：纯食盐 100g 含钠约 39300mg，是食物含钠的天花板
 *     （蚝油、酱油这类调味品能到几千，但到不了这个数）
 *
 * @returns 每条越界一句中文；全部正常则返回空数组
 */
export function sanityRanges(v: {
  kcal?: number;
  protein?: number;
  fat?: number;
  carb?: number;
  sodium?: number;
}): string[] {
  const problems: string[] = [];

  const check = (
    label: string,
    value: number | undefined,
    min: number,
    max: number,
    unit: string,
  ) => {
    if (value === undefined) return;
    if (value < min) problems.push(`${label} 是 ${value}${unit}，低于物理下限 ${min}${unit}`);
    else if (value > max) problems.push(`${label} 是 ${value}${unit}，超出物理上限 ${max}${unit}`);
  };

  check("能量", v.kcal, 0, 900, "kcal");
  check("蛋白质", v.protein, 0, 100, "g");
  check("脂肪", v.fat, 0, 100, "g");
  check("碳水化合物", v.carb, 0, 100, "g");
  check("钠", v.sodium, 0, 40000, "mg");

  return problems;
}

/** 一份读数的「已读出多少项」。用来判断数据够不够做交叉校验 */
function countPresent(r: FoodReading): number {
  let n = 0;
  for (const v of [r.energy_kj, r.energy_kcal, r.protein_g, r.fat_g, r.carb_g, r.sodium_mg]) {
    if (v !== undefined) n += 1;
  }
  return n;
}

/**
 * 对一份照片读数做总检。
 *
 * 判据（与工单一致）：
 *   - `ok`      ：闭合一致 **且** NRV 无冲突 **且** 区间合理
 *   - `suspect` ：闭合在宽松档内（≤20%）或 NRV 有对不上的项 → 数字可以给，但要标「存疑」
 *   - `reject`  ：闭合离谱、或数值超出物理区间 → **不产出任何数字**
 *
 * 额外一条保守规则：**三大营养素一项都没读出来时不做闭合校验**，
 * 因为"闭合成立"会变成"0 ≈ 0"这种废话式的通过。这种情况下若热量本身
 * 数值可疑（超出区间）才 reject，否则给 `suspect` —— 让用户知道"这数没人复核过"。
 */
export function verifyLabelReading(r: FoodReading): VerifyResult {
  const reasons: string[] = [];

  // 把 kJ 换成 kcal 用来做闭合。只在图上给了 kJ 时才换算 ——
  // 这是唯一一处允许的换算，因为它是**单位换算**不是估算（与 foodVision 的口径一致）。
  const kcal = r.energy_kcal ?? (r.energy_kj === undefined ? undefined : r.energy_kj / 4.184);

  // ---------- C. 物理区间（最先查：越界就不必往下算了）----------
  const rangeProblems = sanityRanges({
    kcal,
    protein: r.protein_g,
    fat: r.fat_g,
    carb: r.carb_g,
    sodium: r.sodium_mg,
  });
  if (rangeProblems.length > 0) {
    return {
      verdict: "reject",
      reasons: rangeProblems.map((p) => `数值不合理：${p}`),
    };
  }

  // ---------- A. Atwater 闭合 ----------
  let closurePct: number | undefined;
  const macros = [r.protein_g, r.fat_g, r.carb_g];
  const hasAnyMacro = macros.some((m) => m !== undefined);

  if (kcal !== undefined && hasAnyMacro) {
    const closure = energyClosure({
      kcal,
      protein: r.protein_g ?? 0,
      fat: r.fat_g ?? 0,
      carb: r.carb_g ?? 0,
    });
    closurePct = closure.diffRatio * 100;

    if (closure.diffRatio > CLOSURE_SUSPECT_RATIO) {
      return {
        verdict: "reject",
        reasons: [
          `三大营养素算出来是 ${closure.expected.toFixed(1)} kcal，但热量标的是 ${kcal.toFixed(1)} kcal，` +
            `差了 ${(closure.diffRatio * 100).toFixed(0)}% —— 至少有一个数抄错了。`,
        ],
        closurePct,
      };
    }
    if (!closure.ok) {
      reasons.push(
        `三大营养素与热量对不太上（差 ${(closure.diffRatio * 100).toFixed(0)}%），可能是标注舍入，也可能是抄错了。`,
      );
    }
    // 缺项提示：缺得越多，"对得上"越没什么说服力
    const missing = [
      r.protein_g === undefined ? "蛋白质" : null,
      r.fat_g === undefined ? "脂肪" : null,
      r.carb_g === undefined ? "碳水化合物" : null,
    ].filter(Boolean);
    if (missing.length > 0) {
      reasons.push(`图上没读到 ${missing.join("、")}，闭合校验只用了读到的部分。`);
    }
  } else if (kcal !== undefined) {
    reasons.push("图上没读到任何一项三大营养素，没法做交叉校验。");
  }

  // ---------- B. NRV 反算 ----------
  if (r.nrv) {
    const { mismatches } = nrvCheck(
      {
        // 能量用 kJ 对 NRV 基准 —— 厂商标 NRV% 就是按 kJ 算的
        energyKj: r.energy_kj ?? (r.energy_kcal === undefined ? undefined : r.energy_kcal * 4.184),
        protein: r.protein_g,
        fat: r.fat_g,
        carb: r.carb_g,
        sodium: r.sodium_mg,
      },
      r.nrv,
    );
    if (mismatches.length > 0) {
      reasons.push(...mismatches.map((m) => `营养素参考值与含量对不上：${m}`));
    }
  }

  // ---------- 模型自己说看不清 ----------
  if (!r.readable) {
    reasons.push("模型说这张图的字看不太清，数字建议人工核对一遍。");
  }

  // ---------- 组装 ----------
  const present = countPresent(r);
  let verdict: VerifyVerdict = "ok";

  if (reasons.length > 0) verdict = "suspect";
  // 一项数值都没读出来 —— 不是"通过"，是"没得检"
  if (present === 0 && r.kind === "label") {
    verdict = "suspect";
    if (!reasons.some((s) => s.includes("没读到"))) {
      reasons.push("这张图上一个数值都没读出来。");
    }
  }

  const result: VerifyResult = { verdict, reasons };
  if (closurePct !== undefined) result.closurePct = closurePct;
  return result;
}
