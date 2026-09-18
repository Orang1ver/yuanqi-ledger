# 元气账本 · 下一阶段移交文档

> 目的：把「AI 推荐外卖」这个尚未开工的成块功能，连同项目上下文、硬约束、验收标准，
> **完整**移交出去，接手方（deepseek harness）不需要回头翻聊天记录就能直接干。

---

## 0. 一句话目标

给饮食页 / 菜单库加一个 **「帮我挑外卖」** 入口：用户点一下，系统根据
**今日营养缺口 + 用户的菜单库**，用 DeepSeek 模型挑出 2~3 个候选，并各给一句理由。

**硬红线（最高优先级，违反即返工）：LLM 只做「消歧与措辞」，绝不吐出任何营养数字。**
营养数字只有一条来路：`lib/nutrition/core.ts` 的 `nutritionOf(food, grams)`（每 100g 数据 × 克数，一次乘法）。

---

## 1. 项目坐标（接手方必须先知道的）

- 仓库本体：`C:\Users\StarRiver\Desktop\code\yuanqi-ledger`，git 分支 `main`
- 公开仓库：<https://github.com/Orang1ver/yuanqi-ledger>（MIT）
- 线上站点：<https://orang1ver.github.io/yuanqi-ledger/>（Pages 源 = `gh-pages`/root，`https_enforced`）
- 技术栈：Next.js 16 App Router + TS 5 + Tailwind 4，`output: "export"`（纯静态导出），PWA
- 部署：`node scripts/deploy.mjs`（校验版本三处同步 → 构建 → 注入 SW 版本 → 强推 `gh-pages` → 打 tag）
- **当前已上线 0.3.0**：`main` = `ff4466e`，`gh-pages` = `94941fd`，tag `v0.3.0`

### 环境事实（本机专属，很容易踩）

- **必须用托管 Node**：`C:\Users\StarRiver\.workbuddy\binaries\node\versions\22.22.2-3\node.exe`（`node_modules` 是从更早项目 robocopy 来的，npm registry 不通，**别跑 `npm install`**）
- Bash 里先 `export PATH="/usr/bin:/bin:$PATH"`
- **构建必须在沙箱外跑**：沙箱内 `next build` 清理 `.next`（数千文件）会撞批量删除保护，报 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]` —— 与代码无关
- 残留预览服务占着 `out/` 或 4177 端口时 `next build` 会静默挂死，先 `netstat -ano | findstr :4177` 查杀
- 推 GitHub 网络会来回变，见第 10 节

---

## 2. 为什么要做这个（用户原话 + 已定方案）

用户此前明确提过两个诉求，其中「AI 推荐外卖」这一项**已经做了方案选择、尚未开工**：

1. （已解决，0.3.0）记录太死板 / 单位显示错 / 记不了正餐 —— **本轮已全部修完并上线，不用再碰**。
2. **（本次要做的）AI 推荐外卖** —— 用户已拍板：
   - 方案：**单任务接线**（不是完整 agent）。点一下 → 一次调用 → 返回 2~3 个候选。
   - 不要多轮对话，不要工具循环，不要会话状态机。
   - Key：**用户说「现在就填」**（设置页粘贴 DeepSeek Key，未填时入口自动隐藏、不报错）。

---

## 3. 现状盘点（已经有什么、缺什么）

### ✅ 已经就绪、直接复用的东西

1. **DeepSeek Key 的存储与设置 UI 早已存在**，只是没接线：
   - `lib/prefs.ts` → `loadApiKeys(): { deepseekKey?: string }` 读、`saveApiKeys()` 写，键 `KEYS.apikeys`
   - `app/components/shell/SettingsDialog.tsx` 里已有一个 `type="password"` 的 Key 输入框 + 保存按钮
2. **`openai` SDK 已在依赖里**：`package.json` → `"openai": "^6.7.0"`（DeepSeek 是 OpenAI 兼容协议，可直用）
3. **推荐引擎（纯函数）已存在**：`lib/nutrition/recommend.ts` → `suggestForGaps({ totals, targets, menuDishes, avoid, limit })`
   - 已按「今日缺口」打分，返回 `Suggestion[]`（含 `label / gapLabel / kcal / reason / from / dish`）
   - 已有现成的 `reason`（带数字的一句人话）、忌口剔除、菜单优先加成
   - **注意**：这是本地纯函数推的东西，本次要做的 LLM 是**另一条路径**，别混为一谈（见第 4 节）
4. **今日缺口与菜单库的读取**：`app/components/today/WhatToEatCard.tsx` 已经演示了完整取数：
   - `useDayNutrition(today)` → `totals / targets / targetsFromProfile`
   - `loadTakeoutDishes()` → `TakeoutDish[]`
   - 忌口：`verbatimAvoidLabels(profile?.allergies)`（只做逐字命中，不做同义词猜测）
5. **菜单库的数据结构**：`lib/types.ts` 的 `TakeoutDish`；读取 `lib/storage/takeout.ts`；菜名估算 `lib/nutrition/menu.ts` 的 `estimateDish()`

### ❌ 缺的东西（本次要新建的）

- 一条「浏览器直连 DeepSeek 官方 API」的调用封装
- 一个「帮我挑」入口（放饮食页或菜单库）
- 把「今日缺口 + 候选菜单」组装成 prompt、并把模型返回约束成**只挑菜、不吐数字**的逻辑
- 未配置 Key / 调用失败时的降级 UI
- 对应的测试与冒烟检查

---

## 4. 设计思路（关键，务必照做）

### 4.1 LLM 的角色边界（红线，说三遍）

- **模型输入**：今日缺口（可以给文字描述 + 缺口项，但**不要求它算数字**）、用户菜单库里的菜名列表、忌口。
- **模型输出**：从菜单库里**选** 2~3 道菜 + 给一句**不含营养数字**的理由（如「下午记了一堆油炸的，这道清淡点」）。
- **数字从哪来**：模型只返回「菜名/菜单项 id」，热量与营养一律由本地 `estimateDish()` / `nutritionOf()` 算出，再拼到界面。
- **为什么**：这是项目自始至终的红线（`AGENTS.md` 第 3 节、`lib/nutrition/core.ts` 头部注释）。模型一旦吐数字，就等于引入了一个无法审计的第二数字来源。

### 4.2 推荐两条路径的关系（别混）

- **本地纯函数** `suggestForGaps`：零成本、可离线、数字可审计 —— **保留**，作为 LLM 不可用时的降级。
- **LLM 路径**：只多一层「措辞 + 按口味/情境挑」，**结果里的菜必须能落回本地 `estimateDish` 算营养**。
- 建议交互：点「帮我挑」→ 有 Key 且缺口存在 → 调 LLM；无 Key / 失败 → 回退到本地 `suggestForGaps` 的结果，或提示去设置填 Key。

### 4.3 更早版本已验证可行（重要事实）

更早的本地副本（`C:\Users\StarRiver\Desktop\code\今天吃什么呀`，**只许查数据结构，勿写进项目任何文件**）曾实测：
**浏览器直连 DeepSeek 官方 API 可行**（官方开了 CORS）。所以本功能可以在**浏览器端直接调**，不需要自建后端代理。

---

## 5. 分步实施计划

### 步骤 1：LLM 调用封装（新建，纯 TS，无 UI 依赖）

建议新建 `lib/ai/recommend.ts`（或 `lib/nutrition/llm.ts`），遵守 `lib/` 的领域层纪律：
**用相对导入，不用 `@/` 别名；不 import UI / Next / localStorage**（Key 由调用方传入，不在这里 `loadApiKeys`）。

要点：
- 用 `openai` SDK（`OpenAI` 客户端），`baseURL` 指向 DeepSeek（`https://api.deepseek.com`），`apiKey` 由参数传入。
- 只发**一次** `chat.completions.create`，`temperature` 低一点（挑菜不需要创意，需要稳）。
- **用 JSON 模式 / 明确指令**约束返回：只返回菜名（或菜单项 id）数组，**明令禁止输出任何数字**。
- 返回结构建议：`{ dishes: string[]; note?: string }`（`dishes` 是菜单库里已有的菜名）。
- 超时、非 200、解析失败 → 抛错或返回 `null`，由上层降级。

### 步骤 2：prompt 组装（把缺口说成人话，但不给数字任务）

输入：
- `describeGaps({ totals, targets })`（`lib/nutrition/advice.ts` 已有）拿缺口描述 —— 但**别把「还差多少克」这类数字塞进 prompt 让模型复述**，只需要「哪一项偏了」的定性信息。
- 菜单库菜名列表（只给「估得出成分」的那些，`estimateDish(d).kind !== "none"`）。
- 忌口标签。

指令模板方向：
> 下面是用户今天营养上的缺口（定性描述）和他的菜单库。请从菜单库里挑 2~3 道最适合补上缺口的菜，按顺序返回菜名。不要输出任何数字、克数、热量。每个候选给一句不超过 20 字的理由。

### 步骤 3：UI 入口 + 降级

- 在 `app/components/diet/` 或 `app/components/takeout/TakeoutLibrary.tsx` 加「帮我挑」按钮。
- 状态机（本地 state 即可）：`idle → loading → result | fallback | error`。
- **无 Key**：按钮不显示，或点了提示「去设置填 DeepSeek Key」。
- **调用失败 / 无结果**：回退到 `suggestForGaps` 的本地结果（它永远可用）。
- 展示时：菜名 + 本地算出的热量区间（`estimateDish` 的 `loKcal~hiKcal`）+ 模型的理由（**只保留模型那句不含数字的话**）。

### 步骤 4：守住红线的一句话校验

写一个纯函数（可单测）把模型的返回**白名单过滤**：模型返回的菜名必须能在菜单库 / 食物库里找到，找不到的丢弃；并且**绝不把模型返回文本里出现的数字渲染到热量字段**。

### 步骤 5：测试

- 单测：prompt 组装、返回解析、白名单过滤、数字不来自模型（给模型返回里塞数字，断言界面热量仍来自本地）。
- 冒烟（`scripts/browser-smoke.mjs`）：无 Key 时入口隐藏/降级；有 Key 时（可用假 key + 拦截）流程走通。
- **所有新增检查必须自证会失败**（项目铁律，见 `AGENTS.md` 第 4 节第 22 条）。

---

## 6. 必须遵守的项目约束（`AGENTS.md` 第 3 节红线，摘要）

1. **`recipe.*` localStorage 键名与 JSON 结构逐字保留**（`lib/storage/keys.ts`），只许加字段不许改删。
2. **公开产物零来源表述**：README / AGENTS / CHANGELOG / 代码注释 / 界面文案 / 提交历史，一律中性词，**不新增「从零写起」这类反向断言**，不引入来源/许可不明的代码素材。
3. **`lib/` 领域层纯净**：相对导入、不 import UI/Next/localStorage、id 与时间戳由调用方传。
4. **页面只做编排**，跨卡刷新走 `lib/bus.ts` 的 `DATA_CHANGED`，写数据后必须 `emitDataChanged()`。
5. **数字输入一律字符串 state**（数字 state 删不掉）。
6. **「没有数据」≠「0」**：`sodium`/`fiber` 查不到必须 `undefined`，只报覆盖率，绝不按 0 计入。
7. **记录里的营养值是快照**，事后改食物库不改写历史。
8. **食物库只进需要的页面**（饮食页/菜单库/首页推荐），health/weekly 不许 import，验收对比 chunk 体积。
9. **估不出来就不给数字**：菜名拆解覆盖 < 60% 直接拒绝估算；能估也只给区间（±15%/±35%）。
10. **「不足型」建议须过 `daySettled`**（kcal ≥ 目标 × 0.6）；「超标型」不受限。

---

## 7. 验证四道闸门（改完必须全跑）

```bash
BASE_PATH=/yuanqi-ledger npm run build   # smoke 前置，必须在沙箱外跑
npm test                  # 单测（当前 123 条）
npm run check:data        # 数据层兼容（14 项）
npm run smoke             # 界面层：真实 Edge 渲染 + 截图（5 页 + 定向检查）
npm run check:nutrition   # 食物库质检
python scripts/verify-subpath.py --base /yuanqi-ledger
```

- `check:data` / `check:nutrition` 支持 `YQ_SELFTEST=1` 自证会失败
- 探针看过程：`npm run probe -- --text "晚上吃了一包薯片，一杯奶茶"`
- 样本数据唯一来源：`scripts/fixtures/legacy-v1.json`

---

## 8. 版本与发布

- **成块新功能 → MINOR**：这次做完应升到 **0.4.0**。
- 三处同步：`package.json` / `CHANGELOG.md`（顶部加 `## [0.4.0] - 日期`）/ `lib/changelog.ts`（数组最前插入）。
- 发版：`node scripts/deploy.mjs`（`deploy.mjs` 会校验三处一致，漏了不让发）。
- 发布后核对：5 页 200、`sw.js` 的 `APP_VERSION` 变成新版本（CDN 要等 1~3 分钟，轮询别急着判失败）、产物里新旧文案正反两面 grep。

---

## 9. 关键文件速查表

| 做什么 | 文件 |
|---|---|
| DeepSeek Key 读写 | `lib/prefs.ts`（`loadApiKeys` / `saveApiKeys`） |
| Key 设置 UI | `app/components/shell/SettingsDialog.tsx` |
| 本地推荐引擎（降级用） | `lib/nutrition/recommend.ts`（`suggestForGaps`） |
| 缺口描述 | `lib/nutrition/advice.ts`（`describeGaps`） |
| 营养核心（唯一数字来源） | `lib/nutrition/core.ts`（`nutritionOf`） |
| 菜名估算（区间） | `lib/nutrition/menu.ts`（`estimateDish`） |
| 首页推荐卡（取数范例） | `app/components/today/WhatToEatCard.tsx` |
| 菜单库页面 | `app/components/takeout/TakeoutLibrary.tsx` |
| 菜单库类型 | `lib/types.ts`（`TakeoutDish`）、`lib/storage/takeout.ts` |
| 饮食页编排 | `app/diet/page.tsx`、`app/components/diet/DayPanels.tsx` |
| 项目规矩 | `AGENTS.md`（第 3 节红线、第 4 节地雷） |
| 冒烟测试 | `scripts/browser-smoke.mjs` |

---

## 10. 推 GitHub 的三种姿势（网络会来回变，别复用上一次）

**每次推送前先探**：`curl -s -o /dev/null -w "%{http_code}" https://github.com`，再选姿势。

- **首选 · 按 IP 直连真机**（走真实证书、零校验牺牲，需 git ≥ 2.36）：
  ```bash
  git -c credential.helper= -c http.curloptResolve=github.com:443:140.82.112.3 \
    push "https://${USER}:${TOKEN}@github.com/Orang1ver/yuanqi-ledger.git" <ref>
  ```
  适用「域名解析失败但链路通」。可用 IP 会变，逐个试 `140.82.112.3` / `140.82.113.3` / `20.205.243.166` / `140.82.114.3` / `140.82.116.3`。
- **退路 · 反代自签证书**（`curl` 200 但 git 报 `CRYPT_E_NO_REVOCATION_CHECK`）→ 单次 `-c http.sslVerify=false`，**绝不 `--global`**。
- `credential.helper=` 是「git 拉不起凭据助手」的独立问题，三个 `-c` 互不替代。
- 取凭据：整段抓 `git credential-manager get` 再锚定正则，别逐行匹配。
- 发布脚本认 `DEPLOY_REMOTE_URL`（含凭据 URL）+ `DEPLOY_GIT_CONFIG`（空格分隔 `-c k=v`）。

---

## 11. 明确不做（边界）

- 不做完整 agent / 多轮对话 / 工具循环。
- 不让模型吐任何营养数字（这是红线，不是可选项）。
- 不扩容食物库（用户明确说先搁置，涉及数值校准）。
- 不碰 Android 壳（P5 未开工）。
