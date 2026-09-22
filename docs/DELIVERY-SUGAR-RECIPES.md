# 交付报告 · 添加糖追踪 + 自做饭菜

- **计划书**：`docs/HANDOFF-SUGAR-RECIPES.md`（T1–T7）
- **分支**：`feat-sugar-recipe`（扁平名 —— 本机建不了带斜杠的分支名，见 `AGENTS.md` §1 红框）
- **提交**：`cb0b70c`，父提交 `0d0c9ac`
- **`main` 状态**：**未动**（仍为 `0d0c9ac`），等用户确认后再合并
- **日期**：2026-09-22

---

## 1. 改动清单（每文件一句话）

### 计算层

| 文件 | 改了什么 |
|---|---|
| `lib/nutrition/types.ts` | `NutritionValues` / `FoodItem` 加 `sugar?`；`NutritionTotals` 加 `sugarCoverage`；`NutritionTargets` 加 `sugar`；`NutrientStatus["key"]` 加 `"sugar"`。头注释写明「糖的缺失语义与钠/纤维不同」两条边界 |
| `lib/nutrition/core.ts` | 六处加糖：`nutritionOf`（缺数据**不写键**）、`scaleNutrition`、`addNutrition`（**加一行 + opt 判据一字未动**）、`roundValues`、`sumNutrition`（+ `sugarCoverage`）、`TARGET_META`；新增 `coverageOf` helper；`intakeOf` / `coverageNote` / `compareToTargets` 各加 sugar 分支 |
| `lib/nutrition/targets.ts` | 加 `SUGAR_IDEAL_G = 25` / `SUGAR_LIMIT_G = 50`；`targetsFromEnergy` 返回 `sugar: 25`；`describeTargets` 加一句说明（只统计标了糖的包装食品与做菜加的糖） |
| `lib/nutrition/score.ts` | 「零食甜饮」这一维改成两条路：有糖数据走真糖供能占比（5% 满分 / 15% 归零），没有时保留原代理。**维度数、权重、key 一个没动** |
| `app/components/diet/NutritionOverview.tsx` | 只加注释说明「添加糖」那一行由 `TARGET_META` 自动出现、措辞在 `coverageNote`；**渲染逻辑一行没改** |

### 自做饭菜

| 文件 | 改了什么 |
|---|---|
| `lib/storage/keys.ts` | 加 `myRecipes: "recipe.myRecipes.v1"`（注释里记了与既有键无子串重叠的核对） |
| `lib/storage/myRecipes.ts`（新） | `MyRecipe` 类型 + 增删改查 + 上限 200 + 写后读回**比对内容**（不是长度，见 §5） |
| `lib/storage/index.ts` | 导出新模块 |
| `lib/storage/backup.ts` | 备份分组加「我的菜谱」 |
| `lib/storage/diet.ts` | `scaleSnapshot` 加糖（改克数时不静默丢糖快照）；缺数据不写键 |
| `lib/nutrition/recipe.ts`（新） | 纯函数：`totalPartsGrams` / `recipeTotals` / `recipePer100` / `recipeToFoodItem` / `RECIPE_SOURCE`。折算只走 `nutritionOf` + `addNutrition` + `scaleNutrition` |
| `app/components/diet/RecipeSheet.tsx`（新） | 配方编辑器 + 菜谱列表；「＋ 一勺糖」走 `resolvePortion`（不硬编码 8g）；成品重量默认 = 配料总重 |
| `app/components/diet/RecipeCookSheet.tsx`（新） | 两条记账路径：展开成多条（同一 `dishId`）/ 合成一条；配料失效或成品重量非法时**拒绝记账** |
| `app/components/diet/QuickAddCard.tsx` | 加「我的菜谱」入口（不受 `hasPhotoKey` 限制）+ 渲染面板 |

### 拍照识别（添加糖的入口之一）

| 文件 | 改了什么 |
|---|---|
| `lib/ai/foodVision.ts` | `FoodReading` 加 `sugar_g?`；prompt 加硬规则 8（只填标签上单列的那行「糖」，**绝不把碳水当糖**）；解析加 `sugar_g`；`kind === "dish"` 时抹掉它 |
| `app/components/diet/FoodPhotoSheet.tsx` | 表单加「添加糖 g（可选）」字段（紧跟碳水）+ 提示句；没填就**不写这个键** |

### 闸门与测试

| 文件 | 改了什么 |
|---|---|
| `scripts/check-nutrition.mjs` | 加添加糖区间校验（**只有区间，一点匹配逻辑都不抄** —— 地雷 29）；补第 7 处破坏自证 |
| `scripts/check-data-continuity.ts` | 加两条老数据检查（老记录没有 `sugar` / 老 `FoodItem` 折算不报错也不当 0）→ 18 项 |
| `lib/nutrition/recipe.test.ts`（新） | 17 项：配料折算 / 成品重量影响 / `missing` 传播 / `yieldG ≤ 0` 返回 null / 糖的两条边界 / 与真实数据核对 |
| `lib/storage/myRecipes.test.ts`（新） | 13 项：增删改 / 同名不查重 / 到上限报错 / 写不进去报错 |
| `lib/nutrition/core.test.ts` | 补 9 项糖用例（含「一个配料有糖、另一个没标 → 结果 = 有糖那个」与「一条都没有 → `undefined` 不是 0」） |
| `lib/nutrition/analysis.test.ts` | 补 5 项：质量分两条路径都走一遍 + 不许出现第八维 |
| `package.json` | 两个新测试文件加进 `test` 显式列表（那是显式列表，不会自动发现） |

---

## 2. `git diff --stat` 全文

```
$ git diff --stat main

 app/components/diet/FoodPhotoSheet.tsx    |  14 +
 app/components/diet/NutritionOverview.tsx |   8 +
 app/components/diet/QuickAddCard.tsx      |  22 ++
 app/components/diet/RecipeCookSheet.tsx   | 204 ++++++++++++
 app/components/diet/RecipeSheet.tsx       | 534 ++++++++++++++++++++++++++++++
 lib/ai/foodVision.ts                      |  21 +-
 lib/nutrition/analysis.test.ts            |  96 +++++-
 lib/nutrition/core.test.ts                | 163 ++++++++-
 lib/nutrition/core.ts                     | 110 +++++-
 lib/nutrition/recipe.test.ts              | 282 ++++++++++++++++
 lib/nutrition/recipe.ts                   | 151 +++++++++
 lib/nutrition/score.ts                    |  73 +++-
 lib/nutrition/targets.ts                  |  18 +-
 lib/nutrition/types.ts                    |  49 ++-
 lib/storage/backup.ts                     |   3 +
 lib/storage/diet.ts                       |   7 +
 lib/storage/index.ts                      |   1 +
 lib/storage/keys.ts                       |  10 +
 lib/storage/myRecipes.test.ts             | 188 +++++++++++
 lib/storage/myRecipes.ts                  | 128 +++++++
 package.json                              |   2 +-
 scripts/check-data-continuity.ts          |  69 +++-
 scripts/check-nutrition.mjs               |  46 ++-
 23 files changed, 2165 insertions(+), 34 deletions(-)

[exit=0]
```

---

## 3. 十条命令的原文输出

### ① `npx eslint .`

```
$ npx eslint .


[exit=0]
```

### ② `MSYS_NO_PATHCONV=1 BASE_PATH=/yuanqi-ledger npm run build`

```
$ MSYS_NO_PATHCONV=1 BASE_PATH=/yuanqi-ledger npm run build


> yuanqi-ledger@1.4.0 build
> next build

▲ Next.js 16.2.9 (Turbopack)

  Creating an optimized production build ...
✓ Compiled successfully in 1788ms
  Running TypeScript ...
  Finished TypeScript in 3.7s ...
  Collecting page data using 8 workers ...
  Generating static pages using 8 workers (0/7) ...
  Generating static pages using 8 workers (1/7) 
  Generating static pages using 8 workers (3/7) 
  Generating static pages using 8 workers (5/7) 
✓ Generating static pages using 8 workers (7/7) in 596ms
  Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /diet
├ ○ /health
├ ○ /takeout
└ ○ /weekly


○  (Static)  prerendered as static content


[exit=0]
```

### ③ `python scripts/verify-subpath.py`

```
$ python scripts/verify-subpath.py

检查了 8 个页面、166 条链接（basePath = /yuanqi-ledger）

✓ 子路径自检通过：没有根相对路径泄漏，所有站内链接都有对应产物。

[exit=0]
```

### ④ `npm run check:data`

```
$ npm run check:data


> yuanqi-ledger@1.4.0 check:data
> node scripts/run-ts.mjs scripts/check-data-continuity.ts


数据延续自检（用早期版本结构的数据跑新版真实读函数）
────────────────────────────────────────────────────────────────────────
  ✓ 健康档案································ 女 26岁 165cm 56.5kg / 轻度活动 / 维持健康
  ✓ 由档案算出的目标···························· BMR 1305 / TDEE 1794 / 热量 1794 / 水 2000ml / 步 8000 / BMI 20.8 正常
  ✓ 每日打卡································ 9-15 水1800 步8200 睡7.5 心情好；9-16 水2200 步11200
  ✓ 本周打卡窗口······························ 本周 2 天，近 7 天 2 天
  ✓ 体重记录与差值····························· 2026-09-10 57.2kg → 2026-09-16 56.4kg（较上次 -0.8）
  ✓ 运动记录与统计····························· 2 次 / 75 分钟 / 4.2km / 活跃 2 天；已有里程碑 2 个；待授 0 个
  ✓ 打卡奖励与连续天数··························· 2 天达标 / 1 枚徽章 / 当前连续 2 天
  ✓ 菜单库································· 1 道菜：沙县小吃·拌面
  ✓ 菜单库播种不会覆盖已有数据······················· 播种后仍是 1 道菜（未被示例数据覆盖）
  ✓ 饮食记录（兼容早期无 time 的数据）················ 1 条，老记录 mealSlot=晚餐 已补 time=19:00
  ✓ 饮食日记（早期版本没有这个键）····················· 键不存在 → 读出空表（升级用户首次进入就是这种情况）
  ✓ 饮食日记 · 老记录没有 dishId（1.2.0 新增的可选字段）·· 缺 dishId 的老记录读得出、也不算吃过；带 dishId 的才进「最近吃过」
  ✓ 饮食日记 · 老记录没有 sugar（新增的可选营养素字段）······ 缺 sugar 的老记录读得出、也不被补 0；一条都没有时总量是 undefined 而不是 0
  ✓ 老 FoodItem 没有 sugar · 折算时不报错、也不当 0·· 老 FoodItem 缺 sugar → undefined（不是 0）；带糖的按克数折算正常
  ✓ 常用食材 / 偏好笔记 / 周分析··················· 食材 1 项；笔记「不爱吃香菜」；周分析已缓存
  ✓ 偏好（我的杯子）···························· 杯子 300ml，主题 system
  ✓ 周维度达标率······························ 2 天有记录，喝水达标 1 天，步数达标 2 天，两项都达标 1 天
  ✓ 一顿饭预设完整性···························· 5 个预设 / 17 条食材 / 12 个唯一食物，全部可解析
────────────────────────────────────────────────────────────────────────

✓ 18 项全部通过：早期版本数据在新版里读得出来。


[exit=0]
```

### ⑤ `npm run check:nutrition`

```
$ npm run check:nutrition


> yuanqi-ledger@1.4.0 check:nutrition
> node scripts/check-nutrition.mjs

========================================================================
食物库质检闸门
========================================================================
食物 250 条 · 份量规则 144 条（154 个档位）
体积 原始 57.4KB · gzip 10.8KB（预算 100KB）

分类覆盖：
  主食      53 条
  素菜      41 条
  荤菜      40 条
  零食      23 条
  水果      20 条
  饮料      20 条
  蛋豆乳     18 条
  油脂调味    17 条
  汤粥      14 条
  酒类       4 条

闭合校验：检查了 234 条，跳过 16 条（酒类含乙醇、热量低于 20 kcal 的条目算式不适用）
干重口径：检查了 8 个「干重食物 × 量词」组合 —— 口径必须写明是干重
生熟口径：检查了 25 个「带做法口径的食物 × 碗/份/盘」组合 —— 必须写明生熟

✓ 没发现问题。
  注意：本闸门只能发现算术错误与结构问题，**证明不了数值全对** ——
  数值本身错但比例自洽的情况，需要另一道参照校核。
========================================================================

[exit=0]
```

### ⑥ `YQ_SELFTEST=1 node scripts/check-nutrition.mjs`（破坏自证）

```
$ YQ_SELFTEST=1 node scripts/check-nutrition.mjs

========================================================================
食物库质检闸门 · 自证模式
========================================================================
已故意破坏：把「薯片」的脂肪从 34 改成 3.4；并塞进一条没有任何份量规则能命中的食物「自证用孤儿食物」；再抽掉碗的干重专门规则，让「挂面」掉回熟重的 250g；抹掉「一碗粥」那条规则的 note；往「一碗饺子」的 match 里塞一个谁也叫不上的单字词「饺」；在表头塞一条泛化的「一份拌饭 = 300g」，把更具体的拌饭规则挡住；最后把「白砂糖」的添加糖标成 130g/100g（纯糖不可能超过 100）

食物 251 条 · 份量规则 144 条（154 个档位）
体积 原始 57.4KB · gzip 10.8KB（预算 100KB）

分类覆盖：
  主食      53 条
  素菜      42 条
  荤菜      40 条
  零食      23 条
  水果      20 条
  饮料      20 条
  蛋豆乳     18 条
  油脂调味    17 条
  汤粥      14 条
  酒类       4 条

闭合校验：检查了 235 条，跳过 16 条（酒类含乙醇、热量低于 20 kcal 的条目算式不适用）
干重口径：检查了 7 个「干重食物 × 量词」组合 —— 口径必须写明是干重
生熟口径：检查了 24 个「带做法口径的食物 × 碗/份/盘」组合 —— 必须写明生熟

发现 9 个问题：

  ✗ items[172] (shupian)
    闭合校验不过：7×4 + 3.4×9 + 52.9（其中纤维 4g 按 2 kcal/g 算）×4 = 262.2，与标注热量 548 差 52.2%，超过容差 15%
  ✗ items[242] (baitang)
    添加糖 130 超过纯糖的 100g/100g
  ✗ rules[39] 量词「碗」
    match 里的这些词一条食物都命中不了：[饺] —— 其中 饺 是单字词，而单字只认精确命中（库里没有正好叫这个名字的食物），等于白写
  ✗ yq-selftest-orphan (自证用孤儿食物)
    没有任何份量规则命中它 —— 写「一份 / 一个」时会静默走分类兜底估算，出来的数字没有依据
  ✗ shousijikaoroubanfan (手撕鸡奥尔良烤肉拌饭) · 量词「份」
    命中的是前面的「拌饭」(300g)，但后面还有更具体的「手撕鸡奥尔良烤肉拌饭」(570g) —— 同一量词下先命中先赢，后面那条**永远走不到**。把具体规则挪到泛化规则前面（这是这个文件最容易出错的地方）
  ✗ noodles-dry (挂面) · 量词「碗」
    干重数据（346 kcal/100g）命中了熟重口径的规则「一碗」：250g → 865 kcal（note：指煮熟 / 泡发后的重量）。干面 / 干粉煮熟或泡发后重量翻几倍，按熟重克数算会高估数倍 —— 修法是在这条通用规则**前面**插一条按干重给克数的专门规则，note 里写明「按干…」
  ✗ rice-noodle-dry (米粉（干）) · 量词「碗」
    干重数据（346 kcal/100g）命中了熟重口径的规则「一碗」：250g → 865 kcal（note：指煮熟 / 泡发后的重量）。干面 / 干粉煮熟或泡发后重量翻几倍，按熟重克数算会高估数倍 —— 修法是在这条通用规则**前面**插一条按干重给克数的专门规则，note 里写明「按干…」
  ✗ congee-white (白粥) · 量词「碗」
    source 是「通用成分值（煮）」，说明这个数值自带做法口径；但它命中的份量规则「一碗」= 300g 没写这个克数指什么 —— 生熟 / 干湿能差两三倍，用户看不出这 300g 是下锅前还是盛出来后。修法：给这条规则的默认档补一句 note（**只说明口径，不动克数**）
  ✗ congee-millet (小米粥) · 量词「碗」
    source 是「通用成分值（煮）」，说明这个数值自带做法口径；但它命中的份量规则「一碗」= 300g 没写这个克数指什么 —— 生熟 / 干湿能差两三倍，用户看不出这 300g 是下锅前还是盛出来后。修法：给这条规则的默认档补一句 note（**只说明口径，不动克数**）
========================================================================

✓ 自证通过：七处破坏都被对应的检查拦下了（共 9 个问题）。
  永远通过的闸门等于没有闸门，所以这一步不能省。

[exit=0]
```

### ⑦ `npm run check:reference`

```
$ npm run check:reference


> yuanqi-ledger@1.4.0 check:reference
> node scripts/check-food-reference.mjs

========================================================================
数值引用台账闸门
========================================================================
食物 250 条 · 标了「中国食物成分表」的 67 条（其中按配方估算 22 条） · 台账登记 45 条 · 配方 22 份
引用：中国疾病预防控制中心营养与健康所《中国食物成分表》 https://nlc.chinanutri.cn

✓ 没发现问题。
  注意：本闸门保证的是「抄来的有据可查」+「算出来的重算得回去」，**证明不了数值对不对** ——
  台账存的是引用标识而不是数值，要核对请拿 code 走查询接口（见 foodSources.json 的 meta.note）；
  配方的可靠性锚在原料上，原料错了它跟着错。
========================================================================

[exit=0]
```

### ⑧ `npm run smoke`

```
$ npm run smoke


> yuanqi-ledger@1.4.0 smoke
> node scripts/browser-smoke.mjs

▶ recipe.dailyCheckins.v1 的日期已从 [2026-09-15, 2026-09-16] 平移到本周
▶ 饮食页断言词：（无记录，验空状态）（饮食记录 0 条）
▶ 浏览器：C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe
▶ 目标：http://127.0.0.1:4177/yuanqi-ledger
▶ http://127.0.0.1:4177/yuanqi-ledger 没响应，自动起预览服务（:4177/yuanqi-ledger）
▶ 已写入 17 个键到浏览器 localStorage（来源：早期版本样本（legacy-v1.json））

✓ 今天 /（截图 today.png）
✓ 饮食 /diet/（截图 diet.png）
✓ 健康小屋 /health/（截图 health.png）
✓ 菜单库 /takeout/（截图 takeout.png）
✓ 周报 /weekly/（截图 weekly.png）
✓ 进度环首次点击就有动画（起点 0%，弧线元素 2 个，offset 307.9 → 261.7，采到 26 个中间值）
✓ 记到「早餐」就落在「早餐」（默认按时间猜的是「晚餐」，按钮「记到早餐· 1 条」；早餐 0 → 内存 1 / 刷新后 1，晚餐 0 → 0）
✓ 「一顿饭·两菜一汤」一次落下含「红烧肉」的那批到「早餐」（按钮「记到早餐· 4 条」；早餐 0 → 内存 1 / 刷新后 1，晚餐 0 → 0）
✓ 点份量档位「大包 · 135g」后克数 70 → 135（期望 135），落库 135g
✓ 周报「睡眠与心情」：有记录时显示平均睡眠；只抹掉睡眠后仍显示心情、但不再谈平均睡眠（0 小时出现次数：有数据 0 / 无睡眠 0）
✓ 久未备份提醒：刚打开不打扰；推到 60 天前 → 出现，读到 60 天；点「稍后」消失；点「导出备份」记下了备份时间
✓ 导入预览：选定文件后出现面板（原生弹窗 0 次）；整份覆盖要二次确认，数据变成 [imp1,imp2]、快照有；撤销后回到 [before]
✓ 已落库记录：档位写「中」→ 点「大 · 30g」后 克数 300→450（期望 450）、热量快照 720→1080；质疑入口无 Key 时按钮写「生成反馈文本」，反馈文本 267 字、复制反馈「明确报错」、档案泄漏 0 处
✓ 安卓装到桌面：可安装信号 → 出现引导条；点「安装」真的调起了系统安装（并收起）；点「不用了」消失且重载后不再出现
✓ 帮我挑：没填 Key 时不显示按钮
✓ 帮我挑（假 Key；前置数据 2026-09-22，接口调用 1 次）：接口真的被调了一次 · 请求带着设置里的 Key · 菜单里的菜进了 prompt · 1 号菜画到了屏幕上 · 本地估的热量画出来了 · 菜单里没有的菜没上屏 · 模型编的热量没上屏 · 模型理由里的数字没上屏
✓ 今天吃什么（无饮食记录 / 忌口 1 道 / 刚吃过 1 道）：没有饮食记录时也给出推荐 · 能选记到哪一餐 · 忌口那道从不出现 · 只剩忌口那道时也不推它 · 「换一个」真的会换 · 刚吃过的那道不再被推 · 「就吃这个」落库了 · 落库的每条都带 dishId · 落库的是屏幕上那道菜 · 记下的热量等于屏幕上那个数 · 记完有一句反馈 · 菜单库空时说清是空的 · 估不出来的菜不显示热量 · 估不出来的菜不给「就吃这个」
✓ 启动动画：遮罩在服务端 HTML 里=true；773ms 收起（data-boot=done）；环的动画=yq-boot-draw
✓ 应用内更新：同版本静默=true；网页版横幅=true（含 1.4.1=true）、显示「立即更新」=true；点「稍后」记下 "1.4.1"；同版本再进不再提示=true；壳里横幅=true、点「下载新版」打开的地址=https://orang1ver.github.io/yuanqi-ledger/apk/yuanqi-ledger-1.4.1.apk
✓ 安卓安装包入口：安卓浏览器里出现、两个按钮都在可视区（下载=true / 复制链接=true）、点「下载」打开的地址=/yuanqi-ledger/apk/yuanqi-ledger-9.9.9.apk；iPhone 上不出现；壳里不出现

✓ 5 个页面都渲染出了注入的数据（来源：早期版本样本（legacy-v1.json））。
  截图在 C:\Users\StarRiver\Desktop\code\yuanqi-ledger.dev\.tmp-smoke

[exit=0]
```

### ⑨ `npm test`

原文是 473 项的完整 TAP 输出（约 114KB），这里只贴汇总行（`fail 0`）：

```
# suites 107
# pass 473
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1126.6829

[exit=0]
```

### ⑩ `npm run check:chunks`

```
$ npm run check:chunks


> yuanqi-ledger@1.4.0 check:chunks
> node scripts/check-page-chunks.mjs

========================================================================
页面分包检查
========================================================================
食物库 chunk 2 个 · 原始共 178.2KB · 探针「noodles-dry」

  ✓ _not-found/index.html 无关  食物库 / 实际没有 （引用  7 个 js）
  ✓ 404.html             无关  食物库 / 实际没有 （引用  7 个 js）
  ✓ 404/index.html       无关  食物库 / 实际没有 （引用  7 个 js）
  ✓ diet/index.html      需要  食物库 / 实际有  （引用 10 个 js）
  ✓ health/index.html    不要  食物库 / 实际没有 （引用  9 个 js）
  ✓ index.html           需要  食物库 / 实际有  （引用 11 个 js）
  ✓ takeout/index.html   需要  食物库 / 实际有  （引用  9 个 js）
  ✓ weekly/index.html    不要  食物库 / 实际没有 （引用  8 个 js）

✓ 分包正确：食物库只出现在需要它的页面上。
========================================================================

[exit=0]
```

---

## 4. 破坏自证

第 ⑥ 条就是。闸门的自证模式**故意改坏七处数据**，七处必须各自被对应的检查拦下
（只断言"有问题"是不够的 —— 那样其中一条检查坏掉了也照样绿）。

本次新增的第 7 处破坏：把「白砂糖」标成 `130g/100g`（纯糖最多 100，物理上不可能）。
自证输出里能看到它确实被拦下：

```
    添加糖 130 超过纯糖的 100g/100g
```

另外单独做了一次**改坏 → 变红 → 改回**的实证：`recipePer100` 的守卫原先写成
`!(r.yieldG > 0)`，新单测当场红（`Infinity > 0` 为真 → `100 / Infinity = 0` →
整道菜折成"每 100g 全 0 热量"），改成 `Number.isFinite` 判据后转绿。

---

## 5. 分支自证（本机 git 出过"孤儿提交"事故，这几条必须实测）

```
$ git show-ref refs/heads/feat-sugar-recipe
cb0b70c58f2e414e14e73ad2f10e2c533aff540a refs/heads/feat-sugar-recipe

$ git rev-parse HEAD
cb0b70c58f2e414e14e73ad2f10e2c533aff540a

$ git rev-parse HEAD^
0d0c9accee3e368271bee43f8df49da4dc90bd50

$ git rev-list --parents -n1 HEAD
cb0b70c58f2e414e14e73ad2f10e2c533aff540a 0d0c9accee3e368271bee43f8df49da4dc90bd50

$ git log --oneline -3
cb0b70c feat(diet): 添加糖追踪 + 自做饭菜（按配料与成品重量折算）
0d0c9ac merge: 拍照入口 UX 改进与 smoke 时间炸弹修复（feat-photo-ux）
f26e919 fix(smoke): 样例数据的打卡日期平移到本周 —— 修掉一条会永久变红的时间炸弹

$ git symbolic-ref --short HEAD
feat-sugar-recipe

$ git rev-parse main
0d0c9accee3e368271bee43f8df49da4dc90bd50

$ git status --short
(空 = 工作区干净)

[exit=0]
```

要点：`HEAD^` 解析到 `0d0c9ac`、`git rev-list --parents -n1 HEAD` 给出**两个** sha
（不是孤儿提交）、分支 ref 存在且与 `HEAD` 一致、工作区干净、`main` 仍是 `0d0c9ac`。

---

## 6. 与计划书不一致的四处（都是**有意**的，请重点看）

### 6.1 `addNutrition` 加了那一行 —— 计划书说"不改代码"

§5 与 T1 第 3 条都写着「**不改 `addNutrition` 的代码**（它对添加糖的行为恰好正确，只补注释）」。
但那句话的前提不成立：`addNutrition` 是**逐字段手写的返回字面量**，改动前长这样：

```ts
return {
  kcal: a.kcal + b.kcal,
  protein: a.protein + b.protein,
  fat: a.fat + b.fat,
  carb: a.carb + b.carb,
  sodium: opt(a.sodium, b.sodium),
  fiber: opt(a.fiber, b.fiber),
};
```

里面**没有 `sugar`**。照字面"一行都不加"，糖会在相加这一步被整个丢掉 ——
而「做菜加的糖」正是糖的两个来源之一，`recipeTotals` 全靠这个函数。
所以加了一行 `sugar: opt(a.sugar, b.sugar)`，并加了那段"糖把未标当 0 是有意的"注释。

**真正该守的是"不动那个 `opt` 表达式"**：`opt` 一个字没改，
`(x ?? 0) + (y ?? 0)` 之外没有为糖写任何特例 —— 这才是计划书想守的东西。
（审核项里的「addNutrition 没被改代码」如果按字面执行，得到的是一个静默丢糖的实现。）

### 6.2 `recipePer100` 的守卫从 `> 0` 收紧为 `Number.isFinite`

T1/T5 只写了「`yieldG ≤ 0` 时返回 null」。实测 `Infinity` 是漏网的：
`Infinity > 0` 为真 → `100 / Infinity = 0` → 整道菜被静默折成"每 100g 全 0 热量"，
一个看起来完全正常却根本不对的数字。这是**新写的单测抓到的**。

### 6.3 `myRecipes.persist` 比的是内容，不是长度

T5 要求「照 `customFoods.ts` 的 `persist()` 写法：写完读回来**比对长度**」。
但本模块比 `customFoods` 多了一个**改**动作：改一条菜谱**条数不变**，
于是"写失败了"和"写成功了"读回来长度一模一样 —— 用户改完配方以为存上了，重开还是旧的。
这正是该模块注释里说的"静默失败是最坏的结果"，所以判据收紧成逐条对内容。
（新增的 `myRecipes.test.ts` 里有专门一条钉这个。）

### 6.4 附带一处形状调整：`nutritionOf` 缺糖数据时不写这个键

不是偏离设计意图（T1 要的就是"缺了保持 undefined"），但写法上从 `sugar: undefined`
改成了"不写这个键"。理由：`JSON.stringify` 会把值为 `undefined` 的键**丢掉**，
于是"刚记下的快照"与"重开读回来的快照"形状不同，
`lib/storage/diet.test.ts` 那条「营养值等于 `nutritionOf` 的一次乘法」**真的红了**（实测）。
形状上"没这个键"与"值是 undefined"在所有读的地方完全等价，
所以选了干净的那一种（也和 `recipeToFoodItem` / `FoodPhotoSheet` 的既有约定一致）。

---

## 7. 已知缺口（需用户拍板，未擅自决定）

**内置库一条糖都没有 → 目前「做菜加的糖」产不出糖数据。**

一勺白砂糖（`baitang`）的碳水是 99.9，而 `sugar` 是空的；按 §2.2 的语义
（没标 = 没加糖），它贡献的糖是 **0**。也就是说「一勺糖」这个入口**现在还没有数**。

已用 `lib/nutrition/recipe.test.ts` 里一条测试把这个状态钉住（含出处说明），
免得它以后悄悄变成另一件事。两条出路都要用户决定：

1. 给内置库补糖 —— §0 决策 2 / §5 明确不做；
2. 用「碳水」推糖 —— §5 明确不做（纯糖能推，但同一条判据套到米饭上就是假精确）。

**在用户拍板之前，添加糖实际上只有「拍照识别包装标签」一个有效入口。**

---

## 8. 没做的事

1. **没有合并回 `main`** —— 按 §1 分支纪律，合并要等用户确认。`main` 仍是 `0d0c9ac`。
2. **没有推送到 origin** —— 推送被本机 TLS 环境挡住，不是我擅自绕过证书校验的场景：

   ```
   $ git push origin feat-sugar-recipe

fatal: unable to access 'https://github.com/Orang1ver/yuanqi-ledger.git/': schannel: next InitializeSecurityContext failed: CRYPT_E_NO_REVOCATION_CHECK (0x80092012) - ���������޷����֤���Ƿ������

[exit=0]
   ```

   `CRYPT_E_NO_REVOCATION_CHECK` 是"证书吊销检查做不了"（常见于本机代理在做 TLS 拦截），
   **与 `AGENTS.md` §2 里那条 DNS 问题不是一回事**（那条走 `http.curloptResolve`，这里解析是通的）。
   候选解法都需要放宽本机证书校验，**请用户定**：
   让 Steam++ 重启一下，或允许用 `git -c http.schannelCheckRevoke=false push origin feat-sugar-recipe`。
3. **没有动内置 250 条食物数据**（§5 第 1 条）。
4. **没有把自做食谱写进 `data/foodRecipes.json`**（§5 第 4 条）。
5. **没有新开 `recipeId` 字段**，复用的 `dishId`（§5 第 6 条）。
6. **没有增加质量分维度、没有重分配权重**（§5 第 3 条）。
7. **没有改 `CHANGELOG.md` 与版本号** —— 计划书没把发版列进本次范围；
   若这次要发版，版本三处同步 + `CHANGELOG.md` 是单独一步，请明示。

---

## 9. 一条环境上的坑（建议补进 `AGENTS.md`）

`AGENTS.md` §1 的 worktree 流程没写这条：**worktree 里的 `node_modules` 不能用符号链接**
（Junction / symlink 指回主仓库会让 `next build` 直接 panic）：

```
Symlink [project]/node_modules is invalid, it points out of the filesystem root
```

Turbopack 拒绝指向工程根之外的链接。解法是**硬链接复制**，造出真实目录树：

```bash
cp -al "<主仓库>/node_modules" "<worktree>/node_modules"
```

545MB 约 2 分钟、不复制数据。本次就是这么绕过去的。
