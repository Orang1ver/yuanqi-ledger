# 验收报告 · 添加糖追踪 + 自做饭菜

- **验收对象**：`feat-sugar-recipe`（worktree `yuanqi-ledger.dev`）
- **被验提交**：`cb0b70c feat(diet): 添加糖追踪 + 自做饭菜（按配料与成品重量折算）` + `f16a0df docs: 留档交付报告`
- **交付报告**：`docs/DELIVERY-SUGAR-RECIPES.md`（566 行，接手方写的）
- **计划书**：`docs/HANDOFF-SUGAR-RECIPES.md`（T1–T7）
- **验收日期**：2026-09-22
- **结论**：**通过**（附四条修复，见 §5）

---

## 1. 独立复跑：十条命令全绿

不看交付报告、自己在新 worktree 里跑一遍：

| 命令 | 结果 |
|---|---|
| `npm test` | **473 / 473**，fail 0 |
| `npm run check:data` | **18 项**全过 |
| `npm run check:nutrition` | 食物 250 条 · 份量规则 144 条 · 无问题 |
| `YQ_SELFTEST=1 npm run check:nutrition` | **七处破坏全被对应检查拦下**（共 9 个问题） |
| `npm run check:reference` | 0 问题 |
| `npx eslint .` | 0 错 0 警 |
| `npm run build` | 7 路由全部静态预渲染 |
| `python3 scripts/verify-subpath.py` | 8 个页面、166 条链接，无根相对路径泄漏 |
| `npm run check:chunks` | 8 个页面分包全对 |
| `npm run smoke` | **22 条浏览器断言全过**（含周报「睡眠与心情」那条） |

自证那一条尤其关键：闸门故意改坏七处数据（薯片脂肪、孤儿食物、抽掉碗的干重规则、
抹掉一碗粥的 note、塞单字词「饺」、表头插泛化规则、白砂糖糖值 130），
**七处必须各自被对应的检查拦下** —— 只断言"有问题"是不够的，
那样其中一条检查坏掉了也照样绿。实测七处全中。

## 2. 关键不变量核对（逐条成立）

- **质量分仍是 7 维** —— `lib/nutrition/analysis.test.ts` 里钉着 `assert.equal(s.dimensions.length, 7)`，
  并有注释「不许新增第八维：会和零食甜饮双重扣分」。
- **内置数据没被顺手改** —— `git diff --stat main -- data/` 为空。
- **没有第二套乘法** —— 两个新组件 `RecipeSheet.tsx`(534 行) / `RecipeCookSheet.tsx`(204 行)
  里 `* k` 一次都没出现，全部走 `recipeTotals` / `recipePer100` / `recipeToFoodItem`；
  `lib/nutrition/recipe.ts` 头注释明写「这个文件里一次 `* k` 都不该出现」。
- **「＋ 一勺糖」的 8g 不是硬编码** —— 走 `resolvePortion(portionTable(), food, "勺")`。
- **成品重量默认 = 配料总重** —— `editor.yieldTouched ? draftNum(editor.yieldText) : autoYield`。
- **糖的缺失语义有钉子** —— `lib/nutrition/core.ts` 的 `coverageNote` 永远挂
  「**已记录的**添加糖……没标不等于没加糖」，`compareToTargets` 处明写「**没有数据 ≠ 0**」。
- **键与备份都接上了** —— `lib/storage/keys.ts` 的 `myRecipes: "recipe.myRecipes.v1"`
  （注释记了与既有全部键无子串重叠的核对）；`lib/storage/backup.ts` 补了「我的菜谱」分组。
- **菜谱 id 不会撞车** —— 用 `recipe-<uuid>` 前缀。

## 3. 对交付报告 §6「四处主动偏离计划书」的裁定

**全部认可。其中 6.1 是计划书写错了，不是实现偏离。**

| # | 偏离 | 裁定 |
|---|---|---|
| 6.1 | `addNutrition` 加了 `sugar: opt(a.sugar, b.sugar)` 一行；计划书说「不改代码」 | **接手方对。** 计划书的那个前提不成立：该函数是**逐字段手写的返回字面量**（`kcal`/`protein`/`fat`/`carb` 直加、`sodium`/`fiber` 走 `opt`），**根本没有 `sugar`**。照字面「一行都不加」，糖会在相加这步被整个丢掉 —— 而「做菜加的糖」正是糖的两个来源之一。真正该守的是 `opt` 表达式不动，核对两版**逐字相同**。 |
| 6.2 | `recipePer100` 守卫从 `yieldG <= 0` 收紧为 `!Number.isFinite(yieldG) \|\| yieldG <= 0` | 认可。`Infinity > 0` 为真 → `100 / Infinity = 0` → 整道菜被静默折成「每 100g 全 0 热量」，一个看起来完全正常却根本不对的数字，由新单测抓到。 |
| 6.3 | `myRecipes.persist` 读回来比**内容**不比长度 | 认可。本模块比 `customFoods` 多一个「改」动作，改一条菜谱**条数不变**，比长度的话「写失败了」和「写成功了」读回来一模一样 —— 用户改完配方以为存上了，重开还是旧的。 |
| 6.4 | `nutritionOf` 缺糖数据时**不写这个键**（而非 `sugar: undefined`） | 认可。`JSON.stringify` 会把 `undefined` 键丢掉，于是「刚记下的快照」与「重开读回来的快照」形状不同，`lib/storage/diet.test.ts` 那条断言**实测红过**。 |

## 4. 验收发现的问题

### F1（核心，需拍板）—— 「做菜加的糖」这个入口当时是空的

内置库 250 条里糖/蜜相关 13 条**全部没有 `sugar`**，真正的纯糖类只有两条：
`data/foods.zh.json` 的 `baitang`（白砂糖，carb 99.9）与 `fengmi`（蜂蜜，carb 75.6）。
后果：用户点「＋ 一勺糖」拿到 8g 克数，但按「没标 = 没加糖」的语义，
`nutritionOf(baitang, 8).sugar` 是 `undefined` ⇒ 计 **0**。
也就是说：**添加糖实际上只有「拍照识别包装标签」一个有效入口。**

（交接书 §0.2 决策 2「不影响现有体系」与 §5「不补糖」是按当时的口径写的；
纯糖类那两条属于**定义性**数值，不在此列 —— 见 §5 的修法。）

### F2（low）——质量分那条 note 与真实评分线不是一回事

`lib/nutrition/score.ts` 给用户看的 note 只说「膳食指南建议添加糖供能不超过 10%」，
但评分线是 `15 * rampDown(sugarShare, 0.05, 0.15)`（**5% 满分 / 15% 归零**）。
糖供能 6% 已经在扣分，而 note 读起来像达标。

### F3（low）——`sugar` 的 `undefined` 写法不统一（**复查后判定不改代码**）

`nutritionOf` / `scaleSnapshot` / `recipeToFoodItem` 不写键，
`scaleNutrition` / `roundValues` / `sumNutrition` / `addNutrition` 写键。

看似疏漏，实际是三条约束下的有意选择：`nutritionOf` 的输出会**原样落盘**成快照，
所以那里必须「不写键」（见 6.4）；其余三处跟进 `sodium` / `fiber` 的既有写法。
`core.ts` 的作者注释已写明「不在这里顺手改，是因为那会动到既有字段的产出形状，属于另一件事」。
**无论怎么改，`sugar` 都会在 `nutritionOf` 处与 `sodium`/`fiber` 不一致** ——
因为快照形状是硬约束。所以只在现场补上理由，代码一行不动。

### 环境 —— `verify-subpath.py` 在 pwsh / cmd 下会把成功跑成失败

打印 `✓` 时抛 `UnicodeEncodeError: 'gbk' codec can't encode character '\u2713'`。
Git Bash 下不复现；`PYTHONIOENCODING=utf-8` 可绕过，但那是调用方的事，不该要求。

## 5. 验收后的修复（提交 `3d08f4f`）

| # | 修法 |
|---|---|
| F1 | 只给**纯糖类那两条**补糖值：白砂糖 `sugar: 99.9`（蔗糖纯度）、蜂蜜 `sugar: 75.6`（游离糖）。其余 248 条**一条不动**。理由：这两条的糖值是定义性的，不需要查资料，与「不影响现有体系」不冲突；不补的话用户看到的是「添加糖 0g」，那是个假数字。**仍然不做**：不用「碳水」推糖（纯糖能推，同一条判据套到米饭上就是假精确）。按 AGENTS 红线**按文本插行**改 `data/foods.zh.json`，没有 JSON 整体重写。 |
| F2 | note 改成「膳食指南建议不超过 10%，**5% 以内最好**」。 |
| F3 | 不动代码，在 `scaleNutrition` / `roundValues` 现场补上「为什么这里写键、落盘那步不写」。 |
| 环境 | `scripts/verify-subpath.py` 把 stdout / stderr 显式 `reconfigure(encoding="utf-8")`。 |

**连带更新**：一批注释与断言原本依赖「内置库一条糖都没补」这个**已不再成立**的事实，
全部校正 —— `lib/nutrition/types.ts`、`lib/nutrition/core.ts`、`lib/nutrition/core.test.ts`、
`lib/nutrition/recipe.test.ts`、`scripts/check-data-continuity.ts`、`scripts/check-nutrition.mjs`。
其中 `recipe.test.ts` 那条原本**钉住缺口**的测试，改成断言「白砂糖 99.9 → 一勺糖 ≈ 8g 添加糖」。
留着不改会让下一个人读错。

### 复验（补完重跑，全部通过）

`npm test` 473/473 · `check:data` 18 项 · `check:nutrition` 无问题 ·
**自证模式仍然七处全拦**（第 7 处「白砂糖糖值超 100」在补了 sugar 之后依然生效）·
`check:reference` 0 · `eslint` 0 · `build` 7 路由 · `check:chunks` 8 页全对 · `smoke` 22 条全过 ·
`verify-subpath.py` **故意不设 `PYTHONIOENCODING`** 也通过（证明编码修复本身有效）。

## 6. 没做的事

1. **没有推送** —— 本机 schannel 整体故障（连 `baidu.com` / `gitee.com` 都报
   `SEC_E_NO_CREDENTIALS`），与 GitHub 和代理都无关。详见 `AGENTS.md` 相关记录。
2. **没有动 `CHANGELOG.md` 与版本号** —— 发版是单独一步，需要明示。
3. **没有改内置库其余 248 条**，也没有用碳水推糖。
4. **没有动 `docs/DELIVERY-SUGAR-RECIPES.md`** —— 那是交付时的历史留档，
   文中「内置库一条糖都没有」在写下时是事实，不该回改。

## 7. 一条环境坑（建议补进 `AGENTS.md`）

worktree 里的 `node_modules` **不能用符号链接 / Junction** 指回主仓库 ——
Turbopack 会直接 panic：

```
Symlink [project]/node_modules is invalid, it points out of the filesystem root
```

解法是硬链接复制出真实目录树（545MB 约 2 分钟、不复制数据）：

```bash
cp -al "<主仓库>/node_modules" "<worktree>/node_modules"
```

另外：本机 pwsh 下跑 Python 脚本要注意 stdout 编码（见 §4 环境）；
`python` 是 Microsoft Store 的占位 stub（什么都不做且退出码 0），真解释器是 `python3`。
