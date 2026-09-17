# AGENTS.md —— 元气账本项目约定（接手前必读）

> 这份文件是给**任何在此项目上工作的 agent**（Codex / Claude / 其他）看的。
> 用户是中文母语者，请用**中文**汇报。

---

## 0. 一句话背景

一个**纯前端**的个人健康账本：记录每天的吃、喝、动、睡，并给出健康参考。
数据全部存**浏览器 localStorage**（键前缀 `recipe.`），没有服务端、没有数据库、没有 API 路由。
构建产物是静态站点，部署在 GitHub Pages 的**子路径** `/yuanqi-ledger/` 下。

以 **MIT 开源**。仓库里不要引入任何来源不明、许可不明的代码或素材。

---

## 1. 工作流程

用户**平时就在用这个程序**，所以不要直接改他正在用的目录。

```bash
REPO="C:/Users/StarRiver/Desktop/code/yuanqi-ledger"
DEV="C:/Users/StarRiver/Desktop/code/yuanqi-ledger.dev"

# 1) 开分支 + 独立 worktree（路径必须是绝对路径）
git -C "$REPO" worktree add "$DEV" -b feat/<简短名字>

# 2) 所有编辑、构建、测试都在 worktree 里做（先 npm install）
cd "$DEV" && npm install

# 3) 自检全绿后才回主目录合并
git -C "$REPO" merge --no-ff feat/<名字>

# 4) 收尾：清 worktree + 分支，然后推送
git -C "$REPO" worktree remove "$DEV" && git -C "$REPO" branch -d feat/<名字>
```

踩过的坑：
- worktree 路径传相对路径会被建到仓库**内部**，后续命令找不到
- 报 `Device or resource busy` 时，先把 shell 的 cwd 切出该目录再删
- 自检：`npm run lint` + 构建 + 子路径检查（见第 4 节）

---

## 2. 推送目标

| remote | 地址 | 能否推 |
|---|---|---|
| **`mine`** | `https://github.com/Orang1ver/yuanqi-ledger.git` | ✅ **源码推这个**（分支 `main`） |

```bash
GIT_TERMINAL_PROMPT=0 git -C "$REPO" push mine main
```

> 若报 `Could not resolve host: github.com`：用户机器上的 Steam++（Watt Toolkit）
> 没在运行。它一退出就会还原 hosts，导致 github.com 走被污染的国内 DNS 而解析失败。
> **这不是代码问题**，让用户打开 Steam++ 即可，说明清楚后等恢复再推。

发布静态站点用一键脚本（会校验版本三处一致、注入 SW 缓存名并打 tag）：

```bash
cd "$REPO" && node scripts/deploy.mjs
```

---

## 3. 数据安全（红线 · 最高优先级）

- **用户的数据全在浏览器 localStorage**，键前缀 `recipe.`。
  ⚠️ **这些键名是对外契约：改一个，就等于那部分数据在用户眼里消失。**
  键名总表在 `lib/storage/keys.ts`，动它之前先想清楚迁移方案。
- 曾经踩过：种子函数用「库为空」当条件重新灌示例数据，
  导致用户把商家全删光后一刷新示例库又回来了（像"删不掉"）。
  **正确写法是一次性标记**，且顺序不能错：
  已有标记 → 返回；库里已有数据（老用户）→ 只补标记、**绝不动数据**；真正首次 → 播种 + 标记。
  **顺序写错就会覆盖用户数据。** 参考 `lib/storage/takeout.ts` 的 `seedTakeoutMockIfEmpty`。
- 新增 localStorage 键时：
  - 必须用 `recipe.` 前缀 → 才会被备份导出/导入/清空覆盖
  - `lib/storage/backup.ts` 的 `describeBackup` 是**子串硬编码**映射，**新键要补一行**，
    否则导入预览看不到它
  - 键名**不要**与既有键产生子串重叠（例如别叫 `recipe.takeoutMock.snapshot.v1`，
    会被 `has("takeoutMock")` 误判成菜单库）
- 破坏性操作（删商家、改名合并、批量导入）之前先 `pushTakeoutUndo` 存快照。
- 不要提交或覆盖这些（都在 `.gitignore` 里）：`out/`、`node_modules/`、`.next/`。
- **测试时不要用 `tabs[0]` 之类的模糊定位去操作浏览器**：曾误把测试数据写进用户
  线上站点的标签页，覆盖了他的 API Key。要**按 URL 精确匹配**标签页，只操作本地测试页。

---

## 4. 已知地雷（都踩过，改之前先读）

1. **站内跳转必须用 `next/link` 的 `<Link>`**。
   Next.js 只给 `<Link>` 自动加 `basePath`，原生 `<a href="/health">` 在子路径下会
   **跳到站点根、404**。lint 的 `no-html-link-for-pages` 报的就是这个，**不要忽略**。
   注意这坑的阴险之处：直接访问路由是 200，**点击才 404**，所以"访问一遍路由"测不出来 ——
   用 `python scripts/verify-subpath.py` 测。
2. **`public/.nojekyll` 不能删**。GitHub Pages 默认跑 Jekyll，会忽略下划线开头的 `_next/` 目录 ——
   缺了它页面能打开但所有 JS/CSS 404（白屏）。
3. **不要动 `public/sw.js` 的版本机制**：`__VERSION__` / `__BUILD__` 由 `scripts/deploy.mjs`
   发布时注入，缓存名形如 `yuanqi-v0.1.0-20260917.1234`。手改会破坏更新链路。
4. **不要改 iOS 更新机制**：`updateViaCache: "none"` + 回前台 `reg.update()` + 版本化缓存名
   + `forceRefresh()`（清 Cache Storage + 带时间戳重进）是专门为解决
   「iOS 主屏 App 看不到新版」修的。看似多余，删了就会复发。
   ⚠️ 注意：清的是 **Cache Storage**，用户数据在 **localStorage**，两者无关。
5. **数字输入框必须用字符串 state**。用 `value={number}` + `onChange(Number(v) || 0)`
   会导致**删不掉、永远留个 0**（这个 bug 修过一次）。
   参考 `app/components/health/WeightCard.tsx`：`useState<string>("")`，保存时才 `Number()` 并校验。
6. **图片有尺寸硬限制**（接 AI 识图时）：接口要求单边 ≤ 8192 像素（一次 15+ 张时降到 4096）、
   单张 ≤ 32 MiB、请求体 ≤ 48 MiB；进模型前每张图会被自动缩到「约 1300×1300 等效」。
   所以**长截图必须切段**（每段 ≤ 170 万像素、单边 ≤ 4096、重叠 80px）。
   **直接把长图缩小是错的** —— 文字会糊到识别不出来。
7. **页面文件必须保持"一眼能读完"**。每张卡自管状态、通过回调通知父级，
   **不要往页面里堆顶级 state**。状态堆在页面里的写法一旦铺开，改一处就要通读八百行 ——
   不要重犯。
8. **奖励是两套独立命名空间**：`recipe.rewards.v1` 的 `badges`（打卡徽章）与
   `recipe.exerciseAwards.v1`（运动里程碑）**不能混用**，
   否则运动成就会污染打卡徽章墙（显示成"还差 N 天"）。
9. **`out/` 会被每次构建清空**（含里面的 `.git`），所以发布时每次都要重新 `git init`。
10. **不要输出假精确的营养数字**。饮食模块的红线是：
    **LLM 只负责「听懂」与「措辞」，数值一律回库里查表**，且要过 schema 校验
    （食物必须在候选集内、克数在合理区间）。校验失败就降级为「追问用户一句」。
    让模型直接吐热量数字，数据很快会变成幻觉垃圾。

---

## 5. 验证要求（用户要求讲清"怎么验证的"）

```bash
cd "$DEV"
npx eslint .
MSYS_NO_PATHCONV=1 BASE_PATH=/yuanqi-ledger npm run build      # 必须成功
python scripts/verify-subpath.py                                # 子路径点击自检
```

**基线是 0 错 0 警。** 项目当前没有"预期内"的报错，所以任何报错都值得看一眼。
要判断某条是不是你引入的：`git stash` 后在干净工作区跑同一条命令，对比数量。

**部署后要轮询确认，不要只看脚本输出**：GitHub Pages 构建 + CDN 传播可能**要 1~3 分钟**
（曾因只等 60 秒就误判"发布失败"）：

```bash
curl -s "https://orang1ver.github.io/yuanqi-ledger/sw.js?cb=$(date +%s)" | grep -o 'const APP_VERSION = "[^"]*"'
```

界面类改动**要在浏览器里真点一遍**（含 iOS 相关改动——用户家人用 iPhone）。

---

## 6. 版本与发布

- **版本号唯一来源 = `package.json` 的 `version`**，递增规则见 `CHANGELOG.md` 开头。
- 每次发版**必须同步改三处**：`package.json`、`CHANGELOG.md`（顶部加 `## [x.y.z] - 日期`）、
  `lib/changelog.ts`（数组**最前面**插入）。`scripts/deploy.mjs` 会校验前两者与第三处。
- 发布：`node scripts/deploy.mjs`。

---

## 7. 汇报习惯

- **中文**，讲清三件事：**改了什么 / 为什么这么改 / 怎么验证的**
- 有副作用或取舍要主动说明（例如"改商家名会把同名的两家合并，但有快照可撤销"）
- 顺手 commit + push 到 `mine`；网络不通就**说明情况等恢复**，不要静默跳过
- 拿到不确定的信息（用户偏好、外部约束）**先问再动手**，不要猜

---

## 8. 快速索引

| 想做什么 | 看哪里 |
|---|---|
| 功能与技术栈 | `README.md` |
| 各版本改了什么 | `CHANGELOG.md`（权威）、`lib/changelog.ts`（App 内展示） |
| **localStorage 键名契约** | `lib/storage/keys.ts` |
| 数据读写 | `lib/storage/`（`io.ts` 原语、`health.ts`/`meals.ts`/`takeout.ts` 领域、`backup.ts` 备份） |
| 健康计算（BMR/TDEE/目标） | `lib/health.ts` |
| 喝水与步数换算 | `lib/steps.ts` |
| 连续天数与徽章 | `lib/rewards.ts` |
| 运动统计与里程碑 | `lib/exercise.ts` |
| 周维度达标率 | `lib/weekly.ts` |
| 设计系统（颜色/按钮/卡片） | `app/globals.css`（`--yq-*` 令牌）+ `README.md` |
| 图标 / 启动图重新生成 | `scripts/make-icons.py` |
| 子路径自检 | `scripts/verify-subpath.py` |
| 一键发布 | `scripts/deploy.mjs` |
