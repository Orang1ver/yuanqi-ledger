/**
 * 一次性：算「做法变体」各档的值（红烧肉肥瘦、蛋炒饭油多油少）。
 *
 * 为什么走配方而不是拍一个数：这几条原来的 source 是「按标准菜谱估算」——
 * 没有出处、也没人能复核。拆成三档如果继续拍，等于把不可复核的数字**乘以三**。
 * 用配方至少能说清每一档差在哪（多一块五花肉、少一勺油）。
 */
import { readFileSync } from "node:fs";

const foods = JSON.parse(readFileSync("data/foods.zh.json", "utf8")).items;
const byId = new Map(foods.map((f) => [f.id, f]));

/**
 * parts: [食物 id, 克数][]
 * yieldG: 这一份成品大约多重。炖/炒的过程有损耗，但糖和酱油会附着，
 *         所以这里直接用原料总重 —— 差的那点落在区间里，比拍一个系数好解释。
 */
const RECIPES = [
  {
    id: "hongshaorou",
    variants: [
      { suffix: "瘦", parts: [["wuhua-rou", 40], ["zhuliji", 60], ["jiangyou", 10], ["baitang", 10], ["zhiwuyou", 5], ["yan", 1]] },
      { suffix: "", parts: [["wuhua-rou", 100], ["jiangyou", 10], ["baitang", 10], ["zhiwuyou", 5], ["yan", 1]] },
      { suffix: "肥", parts: [["wuhua-rou", 100], ["zhiwuyou", 15], ["jiangyou", 10], ["baitang", 10], ["yan", 1]] },
    ],
  },
  {
    /*
     * ⚠️ 第一版漏了「盐」—— 算出来钠只有 114mg/100g，而原值是 650，差五倍。
     * 一盘蛋炒饭当然是要放盐的，漏了它等于把钠整个丢掉。
     */
    id: "fried-rice",
    variants: [
      { suffix: "少油", parts: [["rice-cooked", 250], ["jidan-zhu", 50], ["zhiwuyou", 5], ["jiangyou", 5], ["yan", 1.5]] },
      { suffix: "", parts: [["rice-cooked", 250], ["jidan-zhu", 50], ["zhiwuyou", 10], ["jiangyou", 5], ["yan", 1.5]] },
      { suffix: "多油", parts: [["rice-cooked", 250], ["jidan-zhu", 50], ["zhiwuyou", 20], ["jiangyou", 5], ["yan", 1.5]] },
    ],
  },
];

const n1 = (v) => Math.round(v * 10) / 10;
const n0 = (v) => Math.round(v);

for (const r of RECIPES) {
  const base = byId.get(r.id);
  console.log(`\n========== ${base ? base.name : r.id}（原值 ${base ? `${base.kcal} kcal · 脂肪 ${base.fat} · 钠 ${base.sodium}` : "?"}）`);

  for (const v of r.variants) {
    let kcal = 0, protein = 0, fat = 0, carb = 0, sodium = 0;
    let yieldG = 0;
    const detail = [];
    for (const [id, g] of v.parts) {
      const f = byId.get(id);
      if (!f) {
        console.error(`  ✗ 找不到原料 ${id}`);
        continue;
      }
      const k = g / 100;
      kcal += f.kcal * k;
      protein += f.protein * k;
      fat += f.fat * k;
      carb += f.carb * k;
      sodium += (typeof f.sodium === "number" ? f.sodium : 0) * k;
      yieldG += g;
      detail.push(`${f.name}${g}g`);
    }
    const per = (x) => n1((x / yieldG) * 100);
    const closure = per(protein) * 4 + per(fat) * 9 + per(carb) * 4;
    console.log(
      `\n  【${v.suffix || "正常"}】${detail.join(" + ")} = ${yieldG}g\n` +
        `     ${n0(per(kcal))} kcal/100g · 蛋白 ${per(protein)} · 脂肪 ${per(fat)} · 碳水 ${per(carb)} · 钠 ${n0((sodium / yieldG) * 100)}mg` +
        `  · 闭合校验差 ${(((closure - per(kcal)) / per(kcal)) * 100).toFixed(1)}%`,
    );
  }
}
