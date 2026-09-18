/**
 * 一次性：把「做法变体」的 6 份配方按**文本行**插进 data/foodRecipes.json。
 *
 * 为什么配方也要给变体各写一份：`check:reference` 会**重算**每一条标了
 * 「按配方估算」的条目。不写配方，那 6 条新值就成了没人能复核的数字 ——
 * 等于把原来那个「按标准菜谱估算」的问题**乘以六**。
 */
import { readFileSync, writeFileSync } from "node:fs";

const PATH = "data/foodRecipes.json";
const lines = readFileSync(PATH, "utf8").split("\n");
const before = lines.length;

const ADD = [
  {
    id: "hongshaorou-shou",
    yieldG: 126,
    note: "瘦：五花肉 40g + 里脊 60g（靠里脊把肥肉比例压下来）",
    parts: [["wuhua-rou", 40], ["zhuliji", 60], ["jiangyou", 10], ["baitang", 10], ["zhiwuyou", 5], ["yan", 1]],
  },
  {
    id: "hongshaorou",
    yieldG: 126,
    note: "正常：纯五花肉，肥瘦相间",
    parts: [["wuhua-rou", 100], ["jiangyou", 10], ["baitang", 10], ["zhiwuyou", 5], ["yan", 1]],
  },
  {
    id: "hongshaorou-fei",
    yieldG: 136,
    note: "肥：五花肉 + 额外 15g 油（收汁时那股油光）",
    parts: [["wuhua-rou", 100], ["zhiwuyou", 15], ["jiangyou", 10], ["baitang", 10], ["yan", 1]],
  },
  {
    id: "fried-rice-shaoyou",
    yieldG: 311.5,
    note: "少油：一盘只放 5g 油",
    parts: [["rice-cooked", 250], ["jidan-zhu", 50], ["zhiwuyou", 5], ["jiangyou", 5], ["yan", 1.5]],
  },
  {
    id: "fried-rice",
    yieldG: 316.5,
    note: "正常：10g 油。⚠️ 按**家常放盐**算；外卖通常更咸，钠会比这个高",
    parts: [["rice-cooked", 250], ["jidan-zhu", 50], ["zhiwuyou", 10], ["jiangyou", 5], ["yan", 1.5]],
  },
  {
    id: "fried-rice-duoyou",
    yieldG: 326.5,
    note: "多油：20g 油，饭粒能炒到发亮那种",
    parts: [["rice-cooked", 250], ["jidan-zhu", 50], ["zhiwuyou", 20], ["jiangyou", 5], ["yan", 1.5]],
  },
];

/** 一个配方块 —— 与文件里已有的缩进风格一致 */
function block(r, isLast) {
  const parts = r.parts.map(([id, g]) => `        { "foodId": "${id}", "grams": ${g} }`).join(",\n");
  return [
    "    {",
    `      "foodId": "${r.id}",`,
    `      "yieldG": ${r.yieldG},`,
    `      "note": "${r.note}",`,
    '      "parts": [',
    parts,
    "      ]",
    `    }${isLast ? "" : ","}`,
  ].join("\n");
}

// 找最后一个配方对象的结束行（4 空格缩进的 `}`）
let lastClose = -1;
for (let i = lines.length - 1; i >= 0; i--) {
  if (lines[i] === "    }") {
    lastClose = i;
    break;
  }
}
if (lastClose < 0) throw new Error("找不到最后一个配方对象的结束行");

lines[lastClose] = "    },";
lines.splice(
  lastClose + 1,
  0,
  ...ADD.map((r, i) => block(r, i === ADD.length - 1)).flatMap((s) => s.split("\n")),
);

const out = lines.join("\n");
const parsed = JSON.parse(out);
if (parsed.recipes.length !== 17) throw new Error(`配方数不对：${parsed.recipes.length}，期望 17`);

const ids = parsed.recipes.map((r) => r.foodId);
const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
if (dup.length) throw new Error(`配方重复：${dup.join(", ")}`);

writeFileSync(PATH, out, "utf8");
console.log(`✓ 配方 ${before} 行 → ${lines.length} 行 · 共 ${parsed.recipes.length} 份`);
