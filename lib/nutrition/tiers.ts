/**
 * 「这条记录当时用的是哪一档」—— 从克数**反推**。
 *
 * 为什么不把档位存进 `DietEntry`：那是**持久化契约**，加字段意味着所有老记录都没有它 ——
 * 而老记录恰恰是最需要被解释的那些（用户觉得数字不对，多半是回头看旧账）。
 *
 * 而档位本来就能算出来：`grams ÷ amount` 就是每单位的克数，
 * 跟份量表里那一档一比就知道当时用的是哪个。改了克数也照样反映得出来。
 *
 * ⚠️ 反推不出来时返回 `null`，**绝不编一个默认档**：
 * 说「按中号算的」而实际不是，比什么都不说更糟。
 */

import { resolvePortion } from "./core";
import { foodById, portionTable } from "./library";
import type { DietEntry } from "./types";

export type EntryTier = {
  /** 当时用的那一档 */
  label: string;
  /** 这个量词下总共有几档 */
  total: number;
  /** 所有档位 —— 给界面做选择用（`unit` 是 `PortionChips` 要的） */
  options: { unit: string; label: string; grams: number }[];
};

/** 每单位克数的容差：0.6g 够吸收四舍五入，又不足以串到隔壁档 */
const PER_UNIT_TOLERANCE = 0.6;

/**
 * 这条记录命中的份量规则与档位。
 *
 * 与 `tierOfEntry` 的分工：这个**只要有规则就给**（质疑入口对每条记录都要能解释
 * 「按什么折算的」）；那个只在**多档**时才给（界面只在真有歧义时才多画一行）。
 */
export function portionHitOf(entry: DietEntry) {
  if (!entry.foodId) return null;
  const food = foodById(entry.foodId);
  if (!food) return null;
  return resolvePortion(portionTable(), food, entry.unitLabel);
}

export function tierOfEntry(entry: DietEntry): EntryTier | null {
  if (entry.amount <= 0) return null;
  // 用「这条记录自己的量词」去找规则 —— 用户当时说的是「个」就按「个」的档位看
  const hit = portionHitOf(entry);
  if (!hit) return null;

  const portions = hit.rule.portions;
  // 只有一档就没什么不确定的，不用在界面上多一行
  if (portions.length <= 1) return null;

  const perUnit = entry.grams / entry.amount;
  const used = portions.find((p) => Math.abs(p.grams - perUnit) < PER_UNIT_TOLERANCE);
  // 对不上任何一档（比如用户自己改过克数）→ 不猜
  if (!used) return null;

  return {
    label: used.label,
    total: portions.length,
    options: portions.map((p) => ({ unit: entry.unitLabel, label: p.label, grams: p.grams })),
  };
}
