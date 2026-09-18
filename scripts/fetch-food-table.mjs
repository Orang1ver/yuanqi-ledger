#!/usr/bin/env node
/**
 * 从「食物营养成分查询平台」取数（中国疾控中心营养与健康所）。
 *
 * ⚠️ 这是**取数工具，不是闸门** —— 它要联网，所以**不进** `npm test` 与闸门链。
 *
 * 它存在的理由：`data/foodSources.json` 里的 `code` 是那个平台的**食物编号**，
 * 而官网 UI 上**没有**「按编号查」的入口，只有按名字搜。
 * 定了这个工具，"每条数值都可复核"才有一条**走得通**的路 ——
 * 否则台账里那个数字就只是个没人能验证的记号。
 *
 * 用法：
 *   node scripts/fetch-food-table.mjs --id 784
 *   node scripts/fetch-food-table.mjs --search 猪蹄
 *   node scripts/fetch-food-table.mjs --cat 16 63        # 畜肉类及制品 / 猪
 *
 * ⚠️ 按名字搜时**别带括号**（`猪肉(里脊)` 搜不到，用「里脊」）——
 * 接口像是把搜索词当整串匹配。
 *
 * 数据源声明**仅限非商业使用**；本项目是个人非商业项目（见 README）。
 */

const BASE = "https://nlc.chinanutri.cn/fq";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

/** 返回的是**数字索引**的数组；列名按列表页表头顺序 */
const COLS = [
  [0, "编号"],
  [2, "食物名"],
  [5, "食部"],
  [6, "水分"],
  [7, "能量"],
  [8, "蛋白质"],
  [9, "脂肪"],
  [10, "胆固醇"],
  [11, "灰分"],
  [12, "碳水"],
  [13, "膳食纤维"],
  [21, "钙"],
  [24, "钠"],
  [26, "铁"],
];

async function query(categoryOne, categoryTwo, foodName, pageNum = 1) {
  const body = `categoryOne=${categoryOne}&categoryTwo=${categoryTwo}&foodName=${encodeURIComponent(foodName)}&pageNum=${pageNum}&field=0&flag=0`;
  const r = await fetch(`${BASE}/FoodInfoQueryAction!queryFoodInfoList.do`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${BASE}/foodlist_0_${categoryOne}_${categoryTwo}_0_0_1.htm`,
    },
    body,
  });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`接口没返回 JSON（HTTP ${r.status}）：${text.slice(0, 200)}`);
  }
}

const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const kcal = (kj) => {
  const n = num(kj);
  return n === null ? null : Math.round((n / 4.184) * 10) / 10;
};

function show(it) {
  const e = kcal(it[7]);
  const p = num(it[8]) ?? 0;
  const f = num(it[9]) ?? 0;
  const c = num(it[12]) ?? 0;
  const closure = e === null ? null : p * 4 + f * 9 + c * 4;
  console.log(`\n### ${it[2]}   (code ${it[0]})`);
  for (const [k, label] of COLS) {
    if (k === 0 || k === 2) continue;
    console.log(`   ${label.padEnd(5)}: ${it[k] === "" || it[k] == null ? "（未检测）" : it[k]}`);
  }
  if (e !== null) {
    console.log(
      `   → ${e} kcal/100g（原值 ${it[7]}）· 闭合校验 ${closure.toFixed(1)}` +
        `（差 ${(((closure - e) / e) * 100).toFixed(1)}%）`,
    );
  }
  console.log(
    `   库条目写法： "kcal": ${e}, "protein": ${p}, "fat": ${f}, "carb": ${c}, "sodium": ${num(it[24]) ?? "（缺，留 undefined）"}`,
  );
}

const argv = process.argv.slice(2);
const flag = argv[0];

if (flag === "--id") {
  const want = Number(argv[1]);
  if (!Number.isInteger(want)) {
    console.error("用法：node scripts/fetch-food-table.mjs --id <编号>");
    process.exit(2);
  }
  // 接口没有"按编号取一条"，但按名字搜能拿到一批 —— 这里说明清楚，别让人以为工具坏了
  console.error("⚠️ 接口不支持按编号直查。用 --search 按名字搜，再从结果里认编号；");
  console.error("   或者用 --cat <大类> <小类> 列整个分类，用返回里的第 0 个字段核对编号。");
  process.exit(2);
} else if (flag === "--search") {
  const kw = argv[1];
  if (!kw) {
    console.error("用法：node scripts/fetch-food-table.mjs --search <词>");
    process.exit(2);
  }
  const j = await query(0, 0, kw);
  const list = j.list ?? [];
  console.log(`搜「${kw}」：${list.length} 条 / 共 ${j.totalPages} 页`);
  if (!list.length) console.log("（换个更短的词再试 —— 带括号的词搜不到）");
  for (const it of list) show(it);
} else if (flag === "--cat") {
  const c1 = Number(argv[1]);
  const c2 = Number(argv[2]);
  if (!Number.isInteger(c1) || !Number.isInteger(c2)) {
    console.error("用法：node scripts/fetch-food-table.mjs --cat <大类> <小类>");
    process.exit(2);
  }
  const j = await query(c1, c2, "0");
  const list = j.list ?? [];
  console.log(`分类 ${c1}/${c2}：${list.length} 条 / 共 ${j.totalPages} 页`);
  for (const it of list) {
    console.log(`  code ${String(it[0]).padStart(5)}  ${String(it[2]).padEnd(24)} ${String(kcal(it[7]) ?? "-").padStart(6)} kcal`);
  }
  console.log("\n（要看某条的完整字段：--search 它的名字）");
} else {
  console.log(`食物营养成分查询平台取数工具

  --id <编号>            说明为什么不行（接口不支持按编号直查）
  --search <词>          按名字搜（⚠️ 别带括号，用短词）
  --cat <大类> <小类>     列一个分类

分类编号在平台上形如 foodlist_0_<大类>_<小类>_0_0_1.htm，
例如 1/30 = 谷类及制品/小麦、10/37 = 淀粉类、16/63 = 猪、17/70 = 鸭。
`);
}
