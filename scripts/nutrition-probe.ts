/**
 * 营养探针 —— P1 的验收工具。
 *
 * 做一件事：把一句中文口语（如「一包薯片，一杯奶茶」）算成营养数字，
 * 并且把**每个数字的依据**摆出来：命中了库里哪一条、用了哪条份量规则、折算成多少克。
 *
 * 为什么先有它、后有界面：P1 的价值主张是"数字可信"，而可信与否只有在
 * 能把依据打印出来的时候才验得了。界面上做不到这一点（屏幕装不下），
 * 命令行可以。
 *
 * 本脚本的解析刻意很浅（正则 + 份量表），**只覆盖「数量 + 量词 + 食物名」这一形态**。
 * 真正的口语解析（歧义消解、LLM 兜底）是 P2 的事，这里只是把数据层验通。
 *
 * 用法：
 *   npm run probe -- --text "一包薯片，一杯奶茶"
 *   npm run probe -- --text "两个鸡蛋 一碗米饭" --kcal 1800 --sodium 1500
 *   npm run probe -- --text "一杯奶茶" --json     # 输出机器可读结果
 */

import { compareToTargets, roundValues, sumNutrition } from "../lib/nutrition/core";
import { foodCount, libraryMeta } from "../lib/nutrition/library";
import { candidateToEntry, resolveText } from "../lib/nutrition/quickadd";
import { referenceTargets } from "../lib/nutrition/targets";
import type { DietEntry, NutritionTotals } from "../lib/nutrition/types";
import { formatDateISO, nowHM } from "../lib/date";

// ---------- 参数 ----------

const argv = process.argv.slice(2);
function argValue(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const text = argValue("--text");
const wantJson = argv.includes("--json");
const refKcal = Number(argValue("--kcal") ?? 2000);
const refSodium = Number(argValue("--sodium") ?? 2000);

if (!text) {
  console.error("用法：npm run probe -- --text \"一包薯片，一杯奶茶\" [--kcal 1800] [--sodium 1500] [--json]");
  process.exit(2);
}

// ---------- 逐段解析 ----------
//
// 切句、找食物、折算克数、写出依据 —— 这部分逻辑**不在这里实现**，
// 而是从 `lib/nutrition/quickadd.ts` 拿。界面用的是同一份，
// 两边各写一份的话，「探针说 70g、界面算出 50g」这种不一致迟早会出现，
// 而且会先出现在用户手上，不是出现在这里。

const items = resolveText(text).map((c, i) => ({
  c,
  entry: c.missing
    ? undefined
    : candidateToEntry(c, {
        id: `probe-${i}`,
        createdAt: Date.now(),
        date: formatDateISO(new Date()),
        time: nowHM(),
      }),
}));

const entries = items.map((x) => x.entry).filter((e): e is DietEntry => !!e);
const totals: NutritionTotals = sumNutrition(entries);
const targets = referenceTargets(refKcal, refSodium);
const statuses = compareToTargets(totals, targets);

// ---------- 输出 ----------

const meta = libraryMeta();

if (wantJson) {
  console.log(
    JSON.stringify(
      {
        text,
        items: items.map(({ c }) => ({
          fragment: c.raw,
          matched: c.food ? { id: c.food.id, name: c.food.name, source: c.food.source } : null,
          amount: c.amount,
          unit: c.unitLabel,
          grams: c.grams || null,
          basis: c.basis,
          estimated: c.estimated,
          failed: c.missing ? `库里没有匹配到「${c.name}」` : null,
        })),
        totals: roundValues(totals.values),
        coverage: { sodium: totals.sodiumCoverage, fiber: totals.fiberCoverage },
        referenceTargets: targets,
        statuses,
      },
      null,
      2,
    ),
  );
  process.exit(items.some((x) => x.c.missing) ? 1 : 0);
}

const line = "─".repeat(66);
const f1 = (n: number) => n.toFixed(1);

console.log("元气账本 · 营养探针");
console.log(`输入  ${text}`);
console.log(`食物库 ${foodCount()} 条（${meta.updated}）· 数值口径：${meta.unit}`);

console.log(`\n${line}`);
console.log("逐项追溯");
console.log(line);

for (const { c, entry } of items) {
  if (!entry) {
    console.log(`\n✗ 「${c.raw}」`);
    console.log(`    ${c.basis}，未计入合计`);
    continue;
  }
  const n = entry.nutrition;
  console.log(`\n✓ 「${c.raw}」 → ${c.food!.name}  (库 id: ${c.food!.id})`);
  if (c.cleaned !== c.raw) console.log(`    解析：剥掉时间词与动词 → 「${c.cleaned}」`);
  console.log(`    折算：${c.basis}${c.estimated ? "  ⚠ 估算" : ""}`);
  console.log(`    依据（每 100${c.food!.unit}）：${c.food!.kcal} kcal · 蛋白 ${c.food!.protein}g · 脂肪 ${c.food!.fat}g · 碳水 ${c.food!.carb}g${c.food!.sodium !== undefined ? ` · 钠 ${c.food!.sodium}mg` : " · 钠 无数据"}`);
  console.log(`    来源：${c.food!.source}`);
  console.log(
    `    本条：${f1(n.kcal)} kcal · 蛋白 ${f1(n.protein)}g · 脂肪 ${f1(n.fat)}g · 碳水 ${f1(n.carb)}g` +
      (n.sodium !== undefined ? ` · 钠 ${Math.round(n.sodium)}mg` : " · 钠 ——"),
  );
}

const r = roundValues(totals.values);
console.log(`\n${line}`);
console.log("合计");
console.log(line);
console.log(
  `${r.kcal} kcal · 蛋白 ${f1(r.protein)}g · 脂肪 ${f1(r.fat)}g · 碳水 ${f1(r.carb)}g · ` +
    (r.sodium !== undefined ? `钠 ${r.sodium}mg` : "钠 无数据"),
);
console.log(`钠数据覆盖 ${entries.filter((e) => e.nutrition.sodium !== undefined).length}/${entries.length} 条`);

console.log(`\n${line}`);
console.log(`对比参考目标：${refKcal} kcal / 钠 ${refSodium}mg`);
console.log("（这是探针的参考日，不是你的真实目标 —— 真实目标由健康档案推导）");
console.log(line);

for (const s of statuses) {
  if (s.verdict === "unknown") {
    console.log(`  ${s.label.padEnd(5)} ——    ${s.note ?? "暂无数据"}`);
    continue;
  }
  const pct = Math.round(s.ratio * 100);
  const bar = "█".repeat(Math.min(20, Math.round(s.ratio * 20))).padEnd(20, "·");
  const mark = s.verdict === "ok" ? " " : s.verdict === "high" ? "↑" : "↓";
  const shown = s.unit === "kcal" || s.unit === "mg" ? Math.round(s.intake) : f1(s.intake);
  const targetShown = s.unit === "kcal" || s.unit === "mg" ? Math.round(s.target) : f1(s.target);
  console.log(`  ${s.label.padEnd(5)} ${String(shown).padStart(6)} / ${String(targetShown).padStart(6)} ${s.unit.padEnd(4)} ${String(pct).padStart(3)}% ${bar} ${mark}`);
}

console.log(`\n方向说明：热量/脂肪/碳水看「是否落在区间」，钠看「别超」，蛋白/纤维看「够不够」。`);
console.log(`标记 ↑ = 超了，↓ = 不足，无标记 = 在范围内。`);

process.exit(items.some((x) => x.c.missing) ? 1 : 0);
