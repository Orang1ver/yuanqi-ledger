# 元气账本 · 完整计划（0.4.0 → 1.0.0）

> 这是「接下来做什么」的**唯一权威来源**，也是**交给接手方直接执行的计划**。
> 每项带编号、目标、版本、改动文件、验收标准、依赖关系。
> 红线与发布纪律见 `AGENTS.md`；AI 推荐外卖的细化方案见 `docs/HANDOFF-AI-RECOMMEND.md`。

**当前版本：0.5.0（P5.1 已完成，见第一节）** · 最后更新：2026-09-18

---

## 零、立即清理（已完成，**不单独发版本**）

这些是上一轮 0.4.0 遗留的「文档与代码脱节」，先清掉再往下走，否则接手方会被误导。

| # | 事项 | 说明 |
|---|---|---|
| C1 | ✅ 孤儿测试挂入 `npm test` | `lib/mealPresets.test.ts`（3 条用例）已存在但没挂进 `package.json` 的 test 脚本，从未被执行。**已修复**并随 `b53746d` 提交。 |
| C2 | ✅ 同步本文件版本与状态 | 0.3.0 → 0.4.0；P5.2「一顿饭一键记」标记完成；P5.1「AI 推荐外卖」改为未做（升 0.5.0）。 |
| C3 | ✅ 修正 `docs/HANDOFF-AI-RECOMMEND.md` 版本号 | 文档里「当前 0.3.0」「做完升 0.4.0」已过期 → 已改为「当前 0.4.0」「做完升 0.5.0」。 |

> **决定：不发 0.4.1 这个 PATCH 版本。** 理由是本仓库自己的递增规则
> （见 `CHANGELOG.md` 开头）：「只改文档 / 注释 / 构建脚本 → 不升版本」。
> C1 动的是 test 脚本、C2/C3 只动文档，**用户看不到任何变化** ——
> 为一个用户看不见的改动发一版，只会让 App 里的「更新了什么」多一条废话。
> 三件事已全部落在 `main` 上，直接进 0.5.0。

---

## 一、✅ P5.1 AI 推荐外卖 → **0.5.0（已上线）**

> 完整方案见 `docs/HANDOFF-AI-RECOMMEND.md`。**已按该方案实现**，落地情况与三处刻意的偏差见本节末尾。

- **目标**：饮食页/菜单库加「帮我挑外卖」——点一下 → 一次 DeepSeek 调用 → 返回 2~3 个候选 + 各一句理由。
- **红线（最高优先级）**：LLM 只做消歧与措辞，**绝不吐营养数字**；数字唯一来源 `nutritionOf` / `estimateDish`。
- **落地**：
  - `lib/ai/deepseek.ts` —— 浏览器直连的调用封装（超时、状态码翻译成能照做的话）。Key 由调用方传入，这一层不碰 localStorage，所以能在 Node 里被单测。
  - `lib/ai/recommend.ts` —— `pickableDishes`（候选池）/ `gapHints` / `buildPickMessages` / `sanitizeReason` / `parsePicks` / `pickDishesForGaps`。
  - `lib/ai/recommend.test.ts` —— 15 条用例，重点全在「让模型越权」：编菜单外的菜、理由里塞热量、多带一个 `kcal` 字段。
  - `app/components/today/WhatToEatCard.tsx` —— 「✨ 帮我挑」按钮 + `idle → loading → done | error` 状态机；失败/挑不出来**自动退回本地推荐**。
  - `scripts/browser-smoke.mjs` —— 新增 `checkAiPick`：无 Key 隐藏 / 有 Key 走通 / 模型编的菜不上屏 / 模型嘴里的数字不上屏（**四条都自证过会失败**）。
- **三处与计划的偏差**（都是刻意的，理由如下）：
  1. **入口放在首页的「今天还该吃点啥」卡上，不是饮食页/菜单库。**
     那张卡本来就是"下一口吃什么"的唯一出口，且已经握有今日缺口 + 菜单库 + 忌口三样数据；
     换到别的页面等于把同一件事拆成两处，用户要在两个页面之间找"到底哪个在推荐"。
  2. **用 `fetch` 而不是 `openai` SDK。** 依赖里那个 `openai` 是 9.6MB（1.29MB JS），
     而这里真正需要的只是"一次 POST，读一个 JSON 字段"。为一次调用背上一整个 SDK 不划算。
     （`openai` 目前仍是未使用的依赖，**没有删**——删依赖不在本次范围内，留待后续决定。）
  3. **模型回答用序号而不是菜名。** 序号必须落在候选范围内，白名单过滤就退化成一次下标越界检查，
     没有"名字长得像"的模糊空间；菜名那一路只作为"模型不听话"时的兜底（要求精确匹配）。
- **版本**：0.5.0（MINOR），三处已同步。
- **验收**：四道闸门全绿 + 冒烟四条新检查逐条自证会失败（见第 4 节第 23 条地雷）。

---

## 二、P5.3 份量档位点选 → 0.5.x / 0.6.0（PATCH 或 MINOR）

> **现状关键发现**：档位点选 UI **已经存在**（`app/components/diet/PortionPicker.tsx`，含「小包/一包/大包」chip 组），但它**只接在「搜索添加」流程**（`FoodSearchDialog.tsx:64`）。缺的是把它接入 `QuickAddCard` 文本解析行的克数编辑处（现在是裸 `<input type="number">`）。

- **目标**：文本解析出的每条记录，克数旁除手输外，还能点档位（小包/一包/大包）快速改克数。
- **数据源**：现成 `defaultPortionOptions(food)`（跨量词）或死代码 `portionOptions(food, unit)`（限定量词）。
- **改动**：
  - `app/components/diet/QuickAddCard.tsx`：在克数 `<input>`（约 :333）旁，若 `defaultPortionOptions(r.food)` 非空则渲染档位 chips，点选 `update(i, { gramsText: String(grams), unitLabel })`。
  - 复用 `PortionPicker` 的 chip 渲染逻辑（可抽成小组件，或直接内联）。
- **注意**：`portionOptions(food, unit)` 目前是**死代码**（无调用点），接入后顺带激活它，或删掉避免误导。
- **版本**：这是体验改进、非成块新功能 → PATCH（若顺带重构出共享组件可 MINOR，交给接手方判断）。
- **验收**：冒烟「点档位改克数 → 落库克数正确」，自证会失败。

**依赖**：无。

---

## 三、P5.4 口语解析边界补强 → 0.5.x / 0.6.0（PATCH）

> **现状关键发现**（`lib/nutrition/parse.ts`）：
> - `CN_NUM`（:43）只有 一~十 + 半，**没有「零」，也不支持「十一/十二」连写**。
> - `CN_UNIT_NUM`（:49）只认单字，**「两三」「三四」这类约数连写会静默算错**（「两三个鸡蛋」→ 只取「两」=2，「三」落进食物名）。
> - **「一打」不支持**（「打」不在 `PORTION_UNITS` 21 个量词里，也不是数字）。
> - `splitFragments`（:126）只按标点/空白切，**不切「和」「跟」「还有」**——「米饭和红烧肉」会整段进 parseFragment，只解析出「米饭」。

- **目标**（按优先级）：
  1. **「和/跟/还有/加/以及」切分**：让「米饭和红烧肉」解析成两条（最高频、最痛）。
  2. **约数连写**：「两三」「三四」→ 取中值或保守值（「两三」≈2，「三四」≈3），**宁低不高**，并标「估算」。
  3. **「一打」**：`打` 加进量词表，一份量规则里补 `打`（=12）或至少能解析成「打」量词（若食物库没「打」份量规则就按分类兜底并标估算）。
  4. **「十一/十二」**：`CN_NUM` 支持两位数（优先级低，口语少）。
- **红线**：守 `AGENTS.md` 第 15 条——静默算错是重罪，估不准就标「估算」、给区间，**绝不假装精确**。
- **改动**：`lib/nutrition/parse.ts`（`splitFragments`、`CN_NUM`、`CN_UNIT_NUM`、`PORTION_UNITS`）+ 对应单测 + 探针验证。
- **版本**：PATCH。
- **验收**：单测覆盖「米饭和红烧肉→两条」「两三→2 且标估算」「一打→解析不误配」；探针复现；冒烟不必（纯解析，单测够，但可加一条端到端）。

**依赖**：无。

---

## 四、P6.1 食物库扩容 + 数值校准 → 0.6.0（MINOR，工作量最大）

> **已定决策**（用户确认）：参照集 = **《中国食物成分表》标准版（第 6 版）**；**成品菜不新增分类**（按主料塞 `meat`/`veg`）。

### 现状（关键发现）

- 食物库 184 条（staple28/meat28/veg18/protein17/fruit20/snack21/drink19/soup13/seasoning16/alcohol4）。
- **`source` 字段全是模糊口径**（「通用成分值」117 条、「按标准菜谱估算」48 条），**无任何可复核出处**（无表号/版次）。
- **成品菜几乎没有**，菜单识别率约四成。
- `check-nutrition.mjs` 只证「算术自洽」（闭合校验/物理上限/死规则），**证不了「数值全对」**。
- **份量表联动校验目前不存在**（脚本只查死规则，不查「食物有没有对应份量规则」）。

### 分三批（先小后大、先钠后热量）

1. **第一批 · 数据源对照表**（`data/foodSources.json` 新增）：给已存在的 184 条中**高频主食 + 高钠成品菜**补「参照表号」，跑参照校核抽检钠。
2. **第二批 · 新增成品菜条目**（10~20 条，如黄焖鸡/麻辣烫/鱼香茄子/水煮鱼/酸辣汤/番茄炒蛋）：每条严格走「列原料→查表→折算熟重→出油率→加权和」的估算规范（关键参数：生熟比肉0.75/禽0.8/鱼0.75/叶菜0.7/根茎0.85、出油率清炒0.5/红烧0.7/油炸0.85、米→饭2.4倍），`source` 标「按配方估算（参照《中国食物成分表》第6版）」，**钠偏高标不低估**。同时补 `foodPortions.json` 的 `match` 规则（否则报死规则或份量命中不了）。
3. **第三批 · 回填结构化 source**：把 117 条「通用成分值」逐步换成「表号」形式，`FoodItem` 加可选 `ref?: { std; code? }` 字段。

### 第二道参照校核（P6 与 P8 共用，必建）

- **新增 `scripts/check-food-reference.mjs`** + package.json script `check:reference`：
  输入 `data/foodSources.json`（foodId → 参照表号 + 标准值），对已核对的条目抽检关键项（优先钠、热量），偏差超阈值（钠 ±30%、热量 ±20%）报错。
  与 `check:nutrition` 分工：前者证「算术自洽」，本脚本证「和权威表对得上」。支持 `YQ_SELFTEST=1` 自证会失败。

- **红线**：宁可少加不可错加。数值拿不准的条目**不加**，而不是硬凑。

### 版本

- 0.6.0（MINOR）。**验收**：`check:nutrition` + `check:reference` 全过且自证失败；新增条目逐条有人工核对记录。

**依赖**：无（可与 P5.1 并行）。

---

## 五、P6.2 条码扫描 → 0.6.x / 或跳过

- 从 P2 转入。涉及联网查库 + 数据源许可。
- **先定数据源与许可**（浏览器直连某开放库 vs 离线内置条码表），**不干净就跳过**，别为凑功能引入许可风险。
- 若无干净数据源，**明确不做**（在 CHANGELOG/ROADMAP 里标注原因即可）。

---

## 六、P7 覆盖维度深化 → 0.7.0（MINOR）

> **现状关键发现**：睡眠/心情字段已存在（`DailyCheckin.sleepHours/mood`），但周报页（`app/weekly/page.tsx`）**对它们零分析**——只算水和步数达标率（`readinessOfWeek`）。体重有 `lib/weight.ts`（sortWeights/deltaVsPrevious 等）和周报「±X kg」显示，但**无趋势/周均/目标进度**。

- **目标**：
  1. **睡眠趋势**：补周均睡眠、睡眠与「次日精力/心情」的简单对照。
  2. **心情与饮食/运动关联**：把 `mood` 与当天的饮食质量分、运动量做一个轻量关联展示（如「心情好的日子运动更规律」这类观察，不强行下因果结论）。
  3. **体重趋势**：补「周均体重」「距目标体重进度」。
- **改动**：
  - 新建纯函数（仿 `lib/exercise.ts` 的 `weekStats` / `lib/weekly.ts` 的 `readinessOfWeek` 范式）：`lib/wellness.ts`（睡眠/心情周聚合）或扩展 `lib/weekly.ts`、`lib/weight.ts`。
  - `app/weekly/page.tsx` 加「睡眠/心情」板块。
  - 单测 + 冒烟（自证会失败）。
- **注意**：跨维度关联是**观察性**展示，不许下因果结论、不许伪造相关性。
- **版本**：0.7.0（MINOR）。

**依赖**：无（原始数据字段已齐）。

---

## 七、P8 数据可信度加固 → 0.7.x（PATCH）

- **数值人工校核**：与 P6.1 的 `check-food-reference.mjs` 共用（见第四节）。1.0.0 及格线的一部分。
- **份量表与食物库联动校验**：扩展 `check-nutrition.mjs`，新增条目自动查「有没有对应份量规则、match 能否命中」（目前缺，正是 P6.1 第二批要防的坑）。
- **版本**：PATCH。

**依赖**：P6.1 的参照校核脚本（可先建脚本、后补数据）。

---

## 八、P9 体验与收尾 → 0.8.0 / 0.9.0（PATCH 或 MINOR）

> **现状关键发现**：
> - 备份/导出**已存在**（`lib/storage/backup.ts` 的 `exportBackup`/`importBackup`/`downloadBackup` + `SettingsDialog` 的导入导出 UI），但**「久未备份提醒」完全缺失**（无时间戳键、无触发入口）。
> - 文案散在各组件，无文案表。
> - 性能复查需在食物库扩容（P6）后做。

- **目标**：
  1. **久未备份提醒**：新增持久化键（`recipe.*` 前缀）记录上次备份时间戳，超 N 天（如 30 天）在设置页/启动时提示。
  2. **导入预览更友好**：`describeBackup`（:128）已能预览，可优化提示文案。
  3. **文案表统一**：抽 `lib/copy.ts`（或类似）集中界面文案。
  4. **更多冒烟检查**：每新增一类「只能靠交互/时间看出来的 bug」，补一条自证失败的检查。
  5. **性能复查**：P6 扩容后核对 chunk 体积（食物库只进饮食页/菜单库/首页，health/weekly 不许 import）。
- **版本**：PATCH（若文案表是大重构可 MINOR）。

**依赖**：性能复查依赖 P6.1。

---

## 九、分版本规划（一眼看顺序）

| 版本 | 内容 | 类型 |
|---|---|---|
| ~~0.4.1~~ | C1 孤儿测试挂入 + C2/C3 文档同步（已落在 `main`，**不单独发版本**，理由见第零节） | — |
| **0.5.0** ✅ | P5.1 AI 推荐外卖（**已完成**） | MINOR |
| 0.5.x / 0.6.0 | P5.3 份量档位 + P5.4 口语解析 | PATCH |
| 0.6.0 | P6.1 食物库扩容 + 数值校准（含 P8 参照校核脚本） | MINOR |
| 0.6.x | P6.2 条码（若数据源干净） | 视情况 |
| 0.7.0 | P7 睡眠/心情/体重深化 | MINOR |
| 0.7.x | P8 联动校验 + 校核回填 | PATCH |
| 0.8.0 / 0.9.0 | P9 导出提醒/文案表/性能 | PATCH/MINOR |
| 1.0.0 | 及格线达成后发正式版 | — |

**1.0.0 及格线**（不变）：P5、P6 全部完成；P8 关键数据人工校核达标；P9 导出体验落地；用户实际用顺无「一上手就撞到」的问题。

---

## 十、红线与发布纪律（每次都要遵守）

- 版本号唯一来源 `package.json`，三处同步：`package.json` / `CHANGELOG.md` / `lib/changelog.ts`。
- 成块新功能 → MINOR；修 bug / 文案 / 样式 → PATCH；只改文档不升。
- 用户还看不到的成块工作，先记 `CHANGELOG.md` 的 `## [未发布]`，不动版本号。
- **1.0.0 起**：每次改动先开分支，用户确认后才 `--no-ff` merge 回 `main`。0.x 直接推 `main`。
- 红线摘要（完整见 `AGENTS.md` 第 3、4 节）：`recipe.*` 键名逐字保留；公开产物零来源表述；
  `lib/` 领域层纯净；数字只有一条来路；「没有数据」≠「0」；快照语义；估不出来就不给数字；
  新增检查自证会失败。

---

## 十一、验证四道闸门（每项改完必须全跑）

```bash
BASE_PATH=/yuanqi-ledger npm run build   # 沙箱外
npm test                  # 当前 144 条（含 mealPresets 与 AI 推荐）
npm run check:data        # 数据层兼容（15 项）
npm run smoke             # 真实 Edge 渲染 + 4 个定向交互检查（含「帮我挑」）
npm run check:nutrition   # 食物库质检
npm run check:reference   # （P6/P8 新增）数值参照校核
python scripts/verify-subpath.py --base /yuanqi-ledger
```

- `check:data` / `check:nutrition` / `check:reference` 均支持 `YQ_SELFTEST=1` 自证会失败。
- 探针看过程：`npm run probe -- --text "晚上吃了一包薯片，一杯奶茶"`。
- 样本数据唯一来源：`scripts/fixtures/legacy-v1.json`。

---

## 十二、关键文件速查（未做项用到的）

| 事项 | 文件 |
|---|---|
| AI 推荐外卖方案（已实现） | `docs/HANDOFF-AI-RECOMMEND.md` |
| **DeepSeek 调用封装（浏览器直连）** | `lib/ai/deepseek.ts` |
| **「帮我挑」prompt 组装 / 白名单 / 去数字** | `lib/ai/recommend.ts` |
| **「帮我挑」入口（首页推荐卡）** | `app/components/today/WhatToEatCard.tsx` |
| DeepSeek Key 读写 | `lib/prefs.ts` |
| 本地推荐引擎（降级） | `lib/nutrition/recommend.ts`（`suggestForGaps`） |
| 份量档位 UI（已存在，待接入） | `app/components/diet/PortionPicker.tsx`、`quickadd.ts`（`defaultPortionOptions`） |
| 口语解析 | `lib/nutrition/parse.ts` |
| 食物库 / 份量表 | `data/foods.zh.json`、`data/foodPortions.json` |
| 食物库质检 | `scripts/check-nutrition.mjs` |
| 睡眠/心情原始数据 | `lib/types.ts`（`DailyCheckin`）、`lib/storage/health.ts` |
| 体重计算 | `lib/weight.ts` |
| 周报页 | `app/weekly/page.tsx` |
| 备份/导出 | `lib/storage/backup.ts`、`app/components/shell/SettingsDialog.tsx` |
| 冒烟测试 | `scripts/browser-smoke.mjs` |
| 项目规矩 | `AGENTS.md` |
