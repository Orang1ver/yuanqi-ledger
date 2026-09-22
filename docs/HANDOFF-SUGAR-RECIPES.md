# 元气账本 · 添加糖追踪 + 自做饭菜 · 实施移交文档

> **状态：待实施（方案已定稿，且四个关键取舍已由用户逐条拍板）** —— 2026-09-22
>
> **读法**：§0 是目标与**已拍板的决策**（**不要重新讨论这些**）；§1 是硬约束；
> **§2 是关键设计，每条都带了理由 —— 不要顺手简化**；§3 是逐任务工单（T1–T7）；
> §4 边界与失败模式；§5 明确不做；§6 开工前必做；§7 验收契约；§8 假设。
>
> 本文档所有 `文件:行` 对应 **`main` @ `f0927e0`**。
>
> **起因**：用户提了两个需求 ——
> ①「识别的商品多个『糖』，饮食质量一栏也加个糖的推荐摄入跟进度」；
> ②「能记录自己做的饭菜，比如记录西红柿炒鸡蛋，加了几个蛋几个西红柿加了几勺盐几勺糖等等，
> 然后来计算成分」。
>
> **关联**：`docs/HANDOFF-FOOD-PHOTO.md`（拍照识别食物，已实现）与本任务**同源** ——
> 糖数据的主要来源就是那条拍照链路（包装标签上印的「糖」）。
> 那套东西的实现取舍与踩过的坑写在那份文档和 `CHANGELOG.md` 的 1.4.0 一节里。

---

## 0. 目标与已定决策

### 0.1 一句话目标

两件事一起做：

1. **添加糖**：只在**两个入口**产生数据 —— ① 拍照识别（包装标签上印的糖）
   ② 做菜时加的糖。饮食页加「添加糖」的推荐摄入与进度，
   **数据不足时如实说明覆盖率**。
2. **自做饭菜**：用户按配料组合一道菜（几个蛋、几勺盐几勺糖），存成**可复用食谱**；
   记账时可选**展开成多条**或**合成一条**。

### 0.2 用户已拍板（**不要再问、不要重新权衡**）

| # | 决策 | 值 |
|---|---|---|
| 1 | 糖的推荐值口径 | 《中国居民膳食指南 2022》：理想 **≤25g** / 上限 **≤50g** |
| 2 | **糖的语义 = 添加糖** | 只来自①拍照识别 ②做菜加的糖；**内置 250 条一条不动**；**尽量不影响现有体系** |
| 3 | 食谱形态 | **两者都要**：存食谱 + 记账时选展开方式 |
| 4 | 成品重量 `yieldG` | **默认 = 配料总重**，允许用户改 |

> 决策 2 是**范围约束**，不只是语义澄清：它把功能 1 从一个"全库营养素字段"
> 缩小成"两个入口的小字段"，因此**内置库不用回填、不用逐条确认**。

### 0.3 成功标准

1. 拍照识别出的包装食品能带上「添加糖」，记账后进入当日进度
2. 自做饭菜能按配料算出成分，两条记账路径都可用，且**数字只来自 `nutritionOf`**
3. 一条糖数据都没有的那天，界面**不许**显示"糖 0g 达标"（地雷 11）
4. 质量分仍是**七维 100 分**（不新增维度、不重分配权重）
5. 老的 `DietEntry`（无 `sugar` 字段）不报错、不回填、也不算"有数据"
6. 九条验证命令全绿；闸门自证仍然通过

---

## 1. 硬约束

### 1.1 仓库纪律（本机有过真实事故，别试）

- 分支用**扁平名**（本机建不出带斜杠的：`git branch feat/x` 返回 0 但 ref 不存在，
  且会让下一个提交变成**孤儿提交**）。建完 `git show-ref refs/heads/<名字>` 自证。
- **不许 `git merge`、不许 `git checkout <branch>`**（后者稳定复现过删掉 `scripts/` 下 17 个文件）。
  合并走底层管道：`merge-tree → commit-tree → update-ref`，`update-ref` 之后**必须** `git rev-parse` 复核。
- 隔离开发用 `git worktree add <绝对路径> -b <扁平名>`。
- **动手前 `cp -r .git` 到仓库外** —— 该仓库 2026-09-19 真丢过一次 `.git`（1062 个文件进回收站）。
- 构建必须在沙箱外跑，否则 `next build` 清 `.next` 会撞批量删除保护。

### 1.2 红线（本任务强相关）

| 红线 | 出处 | 含义 |
|---|---|---|
| 数字只能有一次乘法 | `lib/nutrition/core.ts` 头注释 | 自做饭菜的数值必须走 `nutritionOf` + `addNutrition`，**不许手写 `grams / 100 * k`** |
| 「没有数据」≠ 0 | 地雷 11 | 一整天都没有糖数据 → `undefined`，**不许按 0 求和**（**但见 §2.2 的重要区别**） |
| 数字输入框用字符串 state | 地雷 5 | 配方编辑器里的克数、成品重量、糖克数**全部**字符串 state |
| 闸门判据只有一份 | 地雷 29 | 若在 `check-nutrition.mjs` 加校验，别在那里抄一份运行时逻辑 |
| 新文案要对冒烟断言 | 地雷 21/24 | 新增界面文案先用 grep 跟 `scripts/browser-smoke.mjs` 的 `EXPECT` 对一遍 |
| 数据文件按文本插行 | 地雷 27 | 本任务**不改任何 `data/*.json`**，所以这条只是提醒 |

---

## 2. 关键设计（**含理由，接手时不要"顺手简化"**）

### 2.1 为什么这次值得给 `FoodItem` 加字段

`lib/storage/customFoods.ts:11` 刚写下一条原则：

> **复用 `FoodItem`，不新增字段。** 数值来源全靠 `source` 字符串表达 ——
> 多开一个字段意味着下游每一处都要多认一个概念，而收益只是让 UI 少读一行字符串。

**这次必须破例**，理由要写进代码注释：

- `source` 能表达"这条怎么来的"，但**表达不了数值本身**；
- 糖要参与三处计算：求和（`sumNutrition`）、目标对比（`compareToTargets`）、质量分（`scoreDay`）；
- 把它塞进 `source` 字符串，下游每处都得 parse 一遍 —— **那才是真的"每处都要多认一个概念"**。

**判据**：能塞进既有字段的是**元信息**（来源、口径），塞不进去的是**新维度**。糖属于后者。

### 2.2 ⚠️ 糖的缺失语义与钠**不同** —— 这是本计划最容易做错的一处

看起来与地雷 11 冲突，其实不冲突。**必须在代码注释里写清**：

| | 钠 / 纤维 | **添加糖** |
|---|---|---|
| 缺失意味着 | **不知道**这个食物含多少钠 | 按「添加糖」的**定义**，这个配料**没加糖** |
| 求和时 | 必须跳过 + 报覆盖率，当 0 是撒谎 | **跳过（= 当 0）反而是对的** |

所以 `lib/nutrition/core.ts` 的 `addNutrition` **不需要改代码**：

```ts
const opt = (x, y) => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0));
```

一个配料有糖、另一个没标 → 结果 = 有糖那个的量 ✓ **正确**（没标的就是没加）。

**但两条边界必须守住**：

1. **一个配料都没有糖数据时，总量必须是 `undefined`**，不是 0 ——
   这由 `addNutrition` 的 `x === undefined && y === undefined` 分支保证 ✓
2. **界面措辞不能说"今天糖摄入 Xg"**，只能说"**已记录的添加糖 Xg**"
   （因为只统计了标了糖的那些记录）

### 2.3 覆盖率与质量分：不新增维度，而是把现有"代理"升级成真数据

现状：`lib/nutrition/score.ts:75` 有个 `SWEET_DRINK_HINTS` 代理指标（按名字筛甜饮），
注释自己写着"宁可标得保守，也不假装自己有糖含量数据"。

**如果新增一维「添加糖」，会与「零食甜饮」维度双重扣分**（一罐可乐被罚两次），
而且要把七维 100 分重新分配 —— 那正是用户说的"影响现有体系"。

**所以**：

- **质量分维度不变**（仍是七维 100 分，权重一个不动）✓
- 把「零食甜饮」这一维的**判定**升级：**有糖数据时用真糖，没有时退回名字代理**，
  并在 `note` 里写明这一跑用的是哪个
- **进度条是另一回事**：`NutritionOverview` 里**新增一行**「添加糖」
  （这是用户要的"加一栏"），与质量分互不影响

### 2.4 自做饭菜的数据形状：刻意照 `data/foodRecipes.json`

```ts
type MyRecipe = {
  id: string;            // "recipe-<uuid>"
  name: string;          // "西红柿炒鸡蛋"
  yieldG: number;        // 成品重量；默认 = 配料总重
  parts: { foodId: string; grams: number }[];
  createdAt: number;
  note?: string;
};
```

**形状照 `data/foodRecipes.json` 的 `{ foodId, yieldG, parts: [{ foodId, grams }] }`**，理由：
同一套概念 → 将来"申请进正式库"时能直接喂给 `scripts/check-food-reference.mjs` 的重算逻辑，
不必再造第二种配方表示。

### 2.5 记账的两条路（用户要"选展开方式"）

| | 展开成多条 | 合成一条 |
|---|---|---|
| 落库 | 每个 part 一条 `DietEntry` | 一条 `DietEntry` |
| 数值 | 每条 = `nutritionOf(配料, grams)` | 配料加权求和（`nutritionOf` + `addNutrition`）÷ `yieldG` × 100 → 每 100g → 再按用户吃的克数算 |
| 克数 | 用 `part.grams`（**下锅前**的重量） | 用户填"我吃了多少克"（按**成品**重量） |
| 批量写 | `recordDietEntries`（一次读写，别循环单条写） | `recordDietEntry` |
| `dishId` | 每条都带**同一个** `dishId`（值 `recipe-<uuid>`） | 同左 |

**关于 `dishId`**：它的注释写的是"从菜单库的哪道菜记下来的（`TakeoutDish.id`）"。
自做食谱**复用这个字段**、值用 `recipe-` 前缀 —— 因为它的语义就是"这条记录来自哪道菜"，
**不为自做食谱新开字段**（同 §2.1 的判据：这是元信息，塞得进去）。

### 2.6 「几勺盐几勺糖」为什么不用新做

`data/foodPortions.json` 里**已经有**：

| 规则 | 值 | 位置 |
|---|---|---|
| `勺[糖, 白砂糖, 白糖, 冰糖]` | **8g** | `:433` |
| `勺[盐, 食盐, 精盐]` | **5g**（note 写明"约等于 2000mg 钠"） | `:442` |
| `勺[植物油, 橄榄油, 花生油…]` | 10g | `:430` |

原料也都有：`baitang`（白砂糖，carb 99.9）在 `data/foods.zh.json:259`。

所以配方编辑器**直接复用 `resolvePortion` / `defaultPortionOptions`**（已成熟的纯函数），
**不要另写一套"勺 = N 克"**（地雷 29：判据只能有一份）。

---

## 3. 逐任务工单

| ID | 名称 | 依赖 |
|---|---|---|
| **T1** | 类型与计算层加 `sugar`（六处 + coverage） | — |
| **T2** | 目标与进度（`targets.ts` + `NutritionOverview` 新增一行） | T1 |
| **T3** | 质量分：把「零食甜饮」从代理升级为真数据 | T1 |
| **T4** | 拍照识别产出添加糖（prompt + 解析 + 表单） | T1 |
| **T5** | 自做饭菜：存储层 `myRecipes.ts` + 纯函数 `recipe.ts` | — |
| **T6** | 自做饭菜：配方编辑器 + 两条记账路径 | T5 |
| **T7** | 闸门与测试 | T1–T6 |

**建议顺序**：T1 →（T2 ∥ T3 ∥ T4）→ T5 → T6 → T7。

---

### T1 —— 类型与计算层

**`lib/nutrition/types.ts`**

```ts
// NutritionValues
/** 添加糖 g。undefined = 这条没标（≠ 0，但求和时按 0 计入 —— 理由见 core.ts 的 addNutrition 注释） */
sugar?: number;

// FoodItem
sugar?: number;

// NutritionTargets
/** 添加糖理想值 g（膳食指南 2022：理想 ≤25g / 上限 ≤50g） */
sugar: number;

// NutritionTotals
/** 有明确添加糖数据的条目占比 0..1 */
sugarCoverage: number;

// NutrientStatus["key"] 联合类型加 "sugar"
```

⚠️ 同时在 `NutritionTotals` 的注释里**写明**：`sugarCoverage` 与 `sodiumCoverage` 语义相同，
但**求和行为不同**（糖把未标当 0），理由指向 §2.2。
**不写这段注释，下一个人一定会当成 bug 改掉。**

**`lib/nutrition/core.ts`**（六处）

1. `nutritionOf`：加 `sugar: food.sugar === undefined ? undefined : food.sugar * k`（照 `sodium`）
2. `scaleNutrition`：加 sugar（照 sodium）
3. `addNutrition`：**不改代码**，但**必须补注释**说明"糖把未标当 0 是有意的"
4. `roundValues`：加 `sugar: v.sugar === undefined ? undefined : round(v.sugar, digits)`
5. `sumNutrition`：加 `sugarSum` / `sugarKnown`，
   返回 `sugar: sugarKnown ? sugarSum : undefined` 与 `sugarCoverage`
6. `TARGET_META` 加一项：
   ```ts
   { key: "sugar", label: "添加糖", unit: "g", direction: "atMost" },
   ```
   `compareToTargets` 的 `intakeOf` 与 `coverageNote` 都要加 `sugar` 分支

---

### T2 —— 目标与进度

**`lib/nutrition/targets.ts`**

```ts
/** 《中国居民膳食指南 2022》：每天添加糖不超过 50g，最好控制在 25g 以下 */
export const SUGAR_IDEAL_G = 25;
export const SUGAR_LIMIT_G = 50;
```

- `targetsFromEnergy` 返回值加 `sugar: SUGAR_IDEAL_G`
  （进度条画到 25；**上限 50 写进 `note`**，不引入第二档目标结构 —— 最小改动）
- `describeTargets` 加一句：
  `添加糖 ≤ 25 g（最好），上限 50 g —— 只统计标了糖的包装食品与做菜加的糖。`

**`app/components/diet/NutritionOverview.tsx`**

- 新增一行「添加糖」，走现有的 `NutrientStatus` 渲染
- 数据不足时照现有机制显示「暂无足够数据」+ 覆盖率，**绝不显示 0g 达标**
- 文案（**先 grep `browser-smoke.mjs` 的 `EXPECT` 对一遍**）：`已记录的添加糖`

---

### T3 —— 质量分：把代理升级为真数据

**`lib/nutrition/score.ts`**

- **`dims` 长度与权重一个不动**（仍是七维 100 分）
- 改「零食甜饮」这一维的 `isUltraish` 判定路径：
  - **当日有糖数据**（`totals.values.sugar !== undefined`）→ 按**真糖**算占比：
    `sugarKcal = sugar * 4` 与总热量比，复用现有的 `rampDown(share, ?, ?)` 阈值
  - **没有糖数据** → 保持现有 `SWEET_DRINK_HINTS` 代理路径（一行不改）
- `note` 必须区分两种口径：
  - 真数据：`添加糖占今天热量的 X%`
  - 代理：`占今天热量的 X%（按分类与名称估算，还没有糖数据）`
- ⚠️ 这个改动会让**同一天**在"补了糖数据"前后得分变化 —— 这是**有意**的（数据变准了），
  但要在注释里说清

---

### T4 —— 拍照识别产出添加糖

**`lib/ai/foodVision.ts`**

1. `FoodReading` 加 `sugar_g?: number`
2. JSON 结构示例加 `"sugar_g": 数字`
3. **prompt 加一条硬规则（照抄）**：
   > 8. `sugar_g` 只填标签上**单独印着的「糖」**那一行（可能写作「糖」或「其中糖」）。
   >    **绝对不要把「碳水化合物」当成糖** —— 淀粉不是添加糖，混填会让整条数据失真。
   >    标签上没有这一行就留空。

   ⚠️ 这条规则**必须**加：旧版标签不强制标糖，新版才强制。
   用户拍的那张柠檬茶标签上就有（碳水 9.0 的下一行紧跟一个 9.0）。
4. `parseFoodReading` 收 `sugar_g`（照 `sodium_mg` 的写法）

**`app/components/diet/FoodPhotoSheet.tsx`**

- `NumDraft` 加 `sugar: string`（**字符串 state**，地雷 5）
- 表单加「添加糖（可选）」字段，旁边一句：`标签上单列了「糖」才填；没印就留空`
- `save()` 组装 `FoodItem` 时**照 `sodium` 的写法**：
  ```ts
  ...(textToNum(nums.sugar) === undefined ? {} : { sugar: textToNum(nums.sugar) }),
  ```
  （`undefined` 就**不写这个键**，保持对象干净）
- `draftFrom` 同步

---

### T5 —— 自做饭菜：存储层与纯函数

**`lib/storage/keys.ts`**

```ts
/**
 * 用户的自做菜谱（`MyRecipe[]`）。
 * ⚠️ 与「我的食物库」分开：食物是"一种食材/一份成品"，菜谱是"由若干食材按克数组合而成"，
 * 前者是一行数据、后者是一张表。
 * 形状刻意照 data/foodRecipes.json，将来申请进正式库时能直接复用它的重算逻辑。
 */
myRecipes: "recipe.myRecipes.v1",
```

**`lib/storage/backup.ts`** 的 `BACKUP_GROUPS` 加一行：

```ts
{ label: "我的菜谱", match: "myRecipes", counting: "items" },
```

⚠️ 已核对：`myRecipes` 与现有全部键**无子串重叠**。

**`lib/storage/myRecipes.ts`**（新）

```ts
export type MyRecipe = { id: string; name: string; yieldG: number;
                         parts: { foodId: string; grams: number }[];
                         createdAt: number; note?: string };
export const MY_RECIPES_LIMIT = 200;
export function loadMyRecipes(): MyRecipe[];
export function addMyRecipe(r: Omit<MyRecipe, "id" | "createdAt"> & { id?: string }):
  { list: MyRecipe[]; added: MyRecipe };
export function updateMyRecipe(id: string, patch: Partial<MyRecipe>): MyRecipe[];
export function removeMyRecipe(id: string): MyRecipe[];
export function myRecipeById(id: string): MyRecipe | undefined;
```

- **照 `customFoods.ts` 的 `persist()` 写法**：`writeJSON` 之后**读回来比对长度**，
  不一致就抛错（`io.ts` 的 `writeJSON` 是**静默失败**的 —— 对数据来说那是最坏结果）
- ⚠️ **不许 import 食物库 JSON**（同 `customFoods.ts:4` 的理由：会把几百条数据带进每个页面）
- id 前缀 `recipe-`

**`lib/nutrition/recipe.ts`**（新，**纯函数**，不许 import UI / localStorage）

```ts
/** 配料总重 —— yieldG 的默认值 */
export function totalPartsGrams(r: Pick<MyRecipe, "parts">): number;

/** 按配料加权求和；找不到的 foodId 按 0 计并回报 missing */
export function recipeTotals(r: MyRecipe, byId: (id: string) => FoodItem | undefined):
  { values: NutritionValues; missing: string[] };

/** 折算每 100g。yieldG 非法（≤0）时返回 null —— 不许拿它去除 */
export function recipePer100(r: MyRecipe, byId: (id: string) => FoodItem | undefined):
  { per100: NutritionValues; missing: string[] } | null;

/** 造一个可作为记账来源的 FoodItem（id 用 recipe-xxx，source 写清来路） */
export function recipeToFoodItem(r: MyRecipe, byId: (id: string) => FoodItem | undefined):
  FoodItem | null;
```

**实现要点**：

- 加权求和**只用** `core.ts` 的 `nutritionOf` + `addNutrition`（**不写第二套乘法**）
- `source` 写：`"自做饭菜（按配料与成品重量折算）"` —— 明确它**不是**抄来的
- `missing` 供 UI 提示"有配料失效了"

---

### T6 —— 自做饭菜：UI

**新增 `app/components/diet/RecipeSheet.tsx`**（配方编辑器）

- 配料行：搜索（复用 `searchAllFoods`）+ 份量（复用 `PortionChips` / `defaultPortionOptions`）
  + 克数（字符串 state）+ 删除
- **「＋ 一勺糖」快捷按钮**：把 `{ foodId: "baitang", grams: 8 }` 加进 parts
  ⚠️ 那个 8 来自 `foodPortions.json:433` 的既有规则，**不要在组件里硬编码** —— 走 `resolvePortion`
- 实时合计：`recipeTotals` 的结果直接显示，缺数据的项要标出来
- **成品重量**：默认 `totalPartsGrams(parts)`，可改；旁边固定一句：
  > 默认等于配料总重。**改它，整道菜的每 100g 数值都会变** ——
  > 同样配料做出来 400g 和 600g，热量差一半。
- 保存 → `addMyRecipe`

**新增 `app/components/diet/RecipeCookSheet.tsx`**（记账时选展开方式）

两个按钮，二选一：

| 按钮 | 行为 |
|---|---|
| **展开成多条** | `recordDietEntries(parts.map(p => ({ date, time, mealSlot, food: byId(p.foodId), name, amount: 1, unitLabel: "克", grams: p.grams, source: "db", dishId: recipe.id })))` |
| **合成一条** | 用户填「我吃了多少克」→ `recordDietEntry({ food: recipeToFoodItem(...), name: recipe.name, grams, unitLabel: "克", source: "custom", dishId: recipe.id })` |

- 两者都要 `emitDataChanged()`
- ⚠️ 合成那条的 `source` 用 `"custom"`（它不在内置库里）；**不要用 `"ai"`**（那是模型估算专用）

**入口**：`app/components/diet/QuickAddCard.tsx` 的标题栏，
在「📷 拍照添加 / 搜索添加 / 一顿饭」之后加「**我的菜谱**」（纯本地功能，与 Key 无关）。

---

### T7 —— 闸门与测试

**`scripts/check-nutrition.mjs`**

- `LIMITS` 里加 `sugar`（照 `sodium: 40000` 的先例；纯糖约 100g/100g，取 `100`）
- 加一条校验（照 `:283` 的 sodium 写法）：是有效数字、≥0、≤ LIMITS
- ⚠️ **不要在这里抄任何匹配逻辑**（地雷 29）。这只是数值区间校验，不涉及匹配
- 跑 `YQ_SELFTEST=1` 确认六处破坏自证仍然通过

**`scripts/check-data-continuity.ts`**

- 加一项：「老记录没有 `sugar` 字段」→ 必须**不报错**（照 `dishId` 的先例）
- 加一项：「老 FoodItem 没有 `sugar`」同样正常

**新增测试文件**（⚠️ **必须加进 `package.json` 的 `test` 脚本** —— 那是**显式文件列表**，不会自动发现）：

- `lib/nutrition/recipe.test.ts`：配料折算 / yieldG 影响 / `missing` 传播 / `yieldG ≤ 0` 返回 null
- `lib/storage/myRecipes.test.ts`：增删改 / 上限 / 写不进去时抛错
- `lib/nutrition/core.test.ts` 补：
  - 糖求和：**一个配料有糖、另一个没标 → 结果 = 有糖那个**（§2.2 的核心）
  - **一个都没有 → `undefined`，不是 0**
  - `sugarCoverage` 计算正确
- `lib/nutrition/score.test.ts`（若无则并入现有）：有糖数据 / 无糖数据两条路径都走一遍

---

## 4. 边界与失败模式

| # | 情况 | 处理 |
|---|---|---|
| 1 | `yieldG` ≤ 0 或非数字 | `recipePer100` 返回 `null`；UI 拒绝保存并说明"成品重量要大于 0" |
| 2 | 配料为空 | 拒绝保存 |
| 3 | 配料里的 `foodId` 查不到（用户库那条被删了） | 该条按 0 计，`missing` 回报，UI 显示"有 N 个配料失效了，请重新选" |
| 4 | 老的 `DietEntry` 没有 `sugar` | `undefined`；**不算"有数据"**，不回填 |
| 5 | 一整天都没有糖数据 | `totals.values.sugar === undefined` → 界面「暂无足够数据」；质量分退回代理路径 |
| 6 | 一天里**只有一部分**记录有糖 | 显示「已记录的添加糖 Xg（基于 N% 的记录）」 |
| 7 | localStorage 满 / 隐私模式 | 照 `customFoods.persist` 的读回比对，抛可读的错误 |
| 8 | 同一天先后用"展开"和"合成"记同一道菜 | 允许（用户自己的选择），不去重 |
| 9 | 标签上没有「糖」行 | `sugar_g` 留空 → `sugar` 不写入 → 该条不参与糖统计 ✓ |

---

## 5. 明确不做

- ❌ **不给内置 250 条补糖**（用户明确要求"不影响现有体系"）
- ❌ **不用「碳水」估糖** —— 一碗米饭的碳水几乎全是淀粉，那是假精确
  （`lib/nutrition/score.ts:6` 的原则：算不出来的维度不许编）
- ❌ **不新增质量分维度、不重分配权重**（会与「零食甜饮」双重扣分）
- ❌ **不把自做食谱写进 `data/foodRecipes.json`**（那是构建期资产；要进正式库走申请流程）
- ❌ **不改 `addNutrition` 的代码**（它对添加糖的行为恰好正确，只补注释）
- ❌ 不为自做食谱新开 `recipeId` 字段（复用 `dishId`）

---

## 6. 开工前必做

1. **确认分支基线**：`feat-photo-ux` 当时**尚未合并进 `main`**
   （它含"主动拍照入口 + AI 优先识别商品名 + smoke 时间炸弹修复"）。
   本文档基于 **`main` @ `f0927e0`**；若先合并，行号会有小幅偏移，用**符号搜索**定位即可。
2. **备份 `.git` 到仓库外**：`cp -r .git <仓库外路径>` —— 本机唯一真正救命的动作。
3. **建扁平分支**：`feat-sugar-recipe`，建完 `git show-ref refs/heads/feat-sugar-recipe` 自证。

---

## 7. 验收契约

### 7.1 必须提交的证据（缺一项会被退回）

1. **改动清单**：每个文件一句话说明改了什么
2. **`git diff --stat` 全文**
3. **九条命令的原文输出**（粘贴，不是复述；基线 0 错 0 警）：

   ```bash
   npx eslint .
   MSYS_NO_PATHCONV=1 BASE_PATH=/yuanqi-ledger npm run build
   python scripts/verify-subpath.py
   npm run check:data
   npm run smoke                  # ⚠️ 新增文案必须先跟 EXPECT 对一遍
   npm run check:nutrition        # 含 YQ_SELFTEST=1 自证
   npm run check:reference
   npm test
   npm run check:chunks           # 需先构建
   ```

4. **破坏自证结果**（改坏 → 变红 → 改回）
5. **分支自证输出**（`git show-ref refs/heads/<名字>`）
6. **没做的事要说明**，不要留空白

### 7.2 审核人会重点验

- `addNutrition` 是否**没被改代码**、以及有没有补上那段"糖把未标当 0"的注释
- 自做饭菜的数值是否**只**经过 `nutritionOf` + `addNutrition`（grep 有没有第二处乘法）
- 质量分的维度数与权重是否**一个没动**
- 一条糖数据都没有时，界面是否**没说"0g 达标"**
- 老 `DietEntry` 缺 `sugar` 是否**不报错**
- 新文案有没有撞 `browser-smoke.mjs` 的断言词

---

## 8. 假设（实现前先确认）

1. 《中国居民膳食指南 2022》的添加糖建议为「**每天不超过 50g，最好控制在 25g 以下**」。
   本计划按此写死 `SUGAR_IDEAL_G = 25` / `SUGAR_LIMIT_G = 50`，并在 `describeTargets` 里注明出处。
2. **拍照能否稳定读出标签上的「糖」行** —— 依赖 `scripts/probe-vision.mjs` 的联网验证
   （**与上一个功能同一件未闭环的事**：需要 DeepSeek Key）。
   若读不出来，T4 的字段仍保留，只是暂时没有数据来源，**不影响 T1/T2/T3/T5/T6**。
3. 新版《预包装食品营养标签通则》强制标注糖，旧标签没有这一行 ——
   所以 `sugar` 大量缺失是**预期状态**，不是实现没做完。界面措辞必须体现这一点。
