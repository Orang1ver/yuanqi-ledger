/**
 * 由健康档案推导每日营养素目标。
 *
 * 热量**不在这里另算一套** —— 直接复用 `lib/health.ts` 的 `calcCalorieTarget()`，
 * 那里面已经含了活动系数、目标增减与性别下限。同一件事有两份公式，
 * 早晚会出现「健康小屋说 1800、饮食页说 1650」这种自相矛盾。
 *
 * 其余各项按《中国居民膳食指南》的方向推导：蛋白按体重、脂肪按供能比、
 * 碳水吃掉剩下的份额；钠设上限、纤维设下限。
 */

import { calcCalorieTarget } from "../health";
import type { HealthProfile } from "../types";
import type { NutritionTargets } from "./types";

/** 每公斤体重的蛋白目标。减脂期要保肌肉，所以比维持期高；增肌期最高 */
const PROTEIN_PER_KG: Record<HealthProfile["goal"], number> = {
  减脂: 1.2,
  增肌: 1.6,
  维持健康: 1.0,
};

/** 脂肪供能比。指南建议 20%~30%，取中值偏上，因为中式烹饪的油很难再压 */
const FAT_ENERGY_SHARE = 0.27;

/** 钠上限：指南建议每日食盐 < 5g，折算成钠约 2000mg */
const SODIUM_LIMIT_MG = 2000;

/** 每 1000kcal 建议的纤维量（指南口径约 12~14g），并设 25g 的绝对下限 */
const FIBER_PER_1000KCAL = 12;
const FIBER_FLOOR_G = 25;

/**
 * 由「总热量 + 蛋白目标」推出其余各项。
 *
 * 单独抽出来，是因为除了健康档案之外还有别的场景需要目标
 * （例如验收探针要拿一个参考日做对比），而那些场景不该另抄一套比例 ——
 * 抄出来的第二份迟早会跟第一份不一致。
 */
export function targetsFromEnergy(kcal: number, proteinG: number, sodiumMg = SODIUM_LIMIT_MG): NutritionTargets {
  const fat = Math.round((kcal * FAT_ENERGY_SHARE) / 9);
  const carb = Math.max(0, Math.round((kcal - proteinG * 4 - fat * 9) / 4));
  const fiber = Math.round(Math.max(FIBER_FLOOR_G, (kcal / 1000) * FIBER_PER_1000KCAL));
  return { kcal, protein: proteinG, fat, carb, sodium: sodiumMg, fiber };
}

export function calcNutritionTargets(p: HealthProfile): NutritionTargets {
  const kcal = calcCalorieTarget(p);

  // 蛋白：先按体重算，但不低于总热量的 12% —— 极度低热量饮食下纯按体重算会推出离谱的比例
  const byWeight = p.weightKg * (PROTEIN_PER_KG[p.goal] ?? 1.0);
  const proteinFloor = (kcal * 0.12) / 4;
  const protein = Math.round(Math.max(byWeight, proteinFloor));

  return targetsFromEnergy(kcal, protein);
}

/** 蛋白按供能 15% 计的参考目标。用于没有健康档案的场景，界面上必须标明是参考值 */
export function referenceTargets(kcal = 2000, sodiumMg = SODIUM_LIMIT_MG): NutritionTargets {
  return targetsFromEnergy(kcal, Math.round((kcal * 0.15) / 4), sodiumMg);
}

/** 目标能不能同时成立。返回 null 表示正常 */
export function targetsConflict(t: NutritionTargets): string | null {
  const used = t.protein * 4 + t.fat * 9 + t.carb * 4;
  // 允许 1% 的取整误差
  if (used > t.kcal * 1.01) {
    return "蛋白与脂肪的目标加起来已经超过总热量，碳水被挤没了。请检查体重或目标设置。";
  }
  return null;
}

/** 一句人话说明这套目标是怎么来的，放在界面上让用户能解释每个数字 */
export function describeTargets(t: NutritionTargets, p: HealthProfile): string {
  const perKg = PROTEIN_PER_KG[p.goal] ?? 1.0;
  return [
    `热量 ${t.kcal} kcal：按你的身高体重年龄算出基础代谢，乘活动系数，再按「${p.goal}」调整。`,
    `蛋白质 ${t.protein} g：按每公斤体重 ${perKg} g 计，约占供能的 ${Math.round(((t.protein * 4) / t.kcal) * 100)}%。`,
    `脂肪 ${t.fat} g：约占总热量 ${Math.round(FAT_ENERGY_SHARE * 100)}%。`,
    `碳水 ${t.carb} g：吃掉蛋白与脂肪之外的剩余份额。`,
    `钠 ≤ ${t.sodium} mg：相当于每天食盐不超过 5 g。`,
    `膳食纤维 ≥ ${t.fiber} g。`,
    "",
    "这些是公式估算值，个体差异可达 ±15%。用两三周的实际体重变化反推会更准。",
  ].join("\n");
}
