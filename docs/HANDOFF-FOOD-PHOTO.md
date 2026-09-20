# 元气账本 · 食物库缺口闭环 · 实施移交文档

> **状态：✅ 已实现（1.4.0，2026-09-20）。**
> 这份文档保留下来当作**当时的方案记录**，不要再照着它判断当前版本 ——
> 下面 §3 里那些「待做」、以及本节末尾那句「一行代码都没写」，都是撰写时的状态。
>
> 落地情况、验收结论与已知缺口见 `docs/DELIVERY-FOOD-PHOTO.md`（实施方的交付报告）。
> **唯一未实测的一环**是 `scripts/probe-vision.mjs` 的联网部分（需要 Key）：
> `json_object` 与图片块能否同用、`deepseek-flash` 的 thinking 怎么关、
> 以及 `deepseek-chat` 是否仍可用 —— 这三条目前仍是**按官方文档写的假设**。
>
> 实际实现与本方案的三处偏差（都已在实现中处理，记在这里免得后人困惑）：
> ① `library.ts` 的 `normalize` 由私有改为**导出** —— 为了让合并检索复用同一套归一化，判据仍然只有一份；
> ② 视觉多了一层**代码层兜底**：`kind === "dish"` 时直接抹掉全部数值字段，不只靠 prompt 约束；
> ③ `verify.ts` 的闭合校验用的是 **kcal 口径的 Atwater**（蛋白×4+脂肪×9+碳水×4），
> 而本文档 §5.4 举的 1067% 那例是 kJ 口径（1785/153）—— 两个都对，只是基准不同。

> **状态：待实施（方案已定稿，一行代码都没写）** —— 2026-09-19
>
> **读法**：§1–§2 是接手前必须知道的坐标与红线；**§3 是逐任务工单（T0–T7）**，
> 每项都带涉及文件、具体步骤、可执行的验收命令；**§4 是验收契约**（做完交回审核人）；
> **§5 是已核实的技术事实附录 —— 不需要重新探查代码，需要的事实都抄在里面了**。
>
> 本文档里所有 `文件:行` 对应 `main` @ `380ca2e`。
>
> **起因**：用户想在 app 里加一个入口，把"食物库里没有、给不出结论"的食物拍张照片，
> 由 AI 读出（或估出）营养数值并加进去。原话是
> 「在 app 中做一个入口……用户能上传那些食物库里没有无法给出结论的食物，
> 然后 AI 识图或者分析得出结论给用户并添加进去」。
>
> **关联**：`docs/HANDOFF-AI-RECOMMEND.md`（AI 推荐，已实现）与本任务同属"AI 接线"这一类，
> 它的 §3「现状盘点」写法可以直接参考。

---

## 0. 一句话目标

**记账时遇到库里没有的食物 → 拍一张照片 → app 用 DeepSeek 的视觉能力读出每 100g 数值 →
经校验后存进本机的「我的食物库」→ 立刻能搜、能记账。**
若用户认为这个食物值得沉淀，再一键生成结构化申请，提交到 GitHub Issue 或指定邮箱。

---

## 1. 项目坐标与硬约束

### 1.1 仓库与分支纪律

| 项 | 值 |
|---|---|
| 仓库本体 | `C:\Users\StarRiver\Desktop\code\yuanqi-ledger` |
| 公开仓库 | <https://github.com/Orang1ver/yuanqi-ledger>（MIT） |
| 线上站点 | <https://orang1ver.github.io/yuanqi-ledger/> |
| 技术栈 | Next.js 16 App Router + TS 5 + Tailwind 4，`output: "export"`，PWA |
| 当前版本 | `1.3.3`（`package.json`） |
| 部署 | `node scripts/deploy.mjs` |

**接手前必读 `AGENTS.md`**（项目约定与地雷清单）。以下是本任务最相关的三条本机 git 陷阱，
每一条都有事故代价，**不要自己试**：

1. **带斜杠的分支名在本机建不出来**。`git branch feat/x`、`git checkout -b feat/x` 都返回 0
   但 ref 不存在；后者会让 HEAD 指向不存在的 ref，**下一个提交变成孤儿提交**（与 `main` 断链）。
   → **一律用扁平名**：`feat-food-photo`。建完立刻自证：
   ```bash
   git show-ref refs/heads/feat-food-photo    # 有输出才算建成
   ```
2. **不许 `git merge`，不许 `git checkout <branch>`**。2026-09-19 出过 `.git` 被整个送进回收站
   的事故（`.git/refs/` 整棵树消失、`objects/` 76 个分片目录全空，此后每条命令都报
   `fatal: not a git repository`）；同一批操作里 `git checkout <branch>` 还把 `scripts/` 下
   17 个文件整个删掉，**稳定复现两次**。
   → 合并只走底层管道：
   ```bash
   T=$(git merge-tree --write-tree main <分支>)
   M=$(git commit-tree "$T" -p "$(git rev-parse main)" -p "$(git rev-parse <分支>)" -F msg)
   git update-ref refs/heads/main "$M" && git rev-parse main    # 必须复核，update-ref 会静默不生效
   ```
   隔离开发用 `git worktree add`（不是 checkout），路径**必须绝对路径**，否则会建到仓库内部。
3. **动手前先 `cp -r .git <仓库外路径>`**。这是唯一真正救命的动作，**先做再说话**。

完整事故经过见 `docs/INCIDENT-2026-09-19-git-loss.md`。

### 1.2 红线（违反即返工）

| 红线 | 出处 | 对本任务的含义 |
|---|---|---|
| **模型不许产生热量数字** | AGENTS 地雷 10 | 视觉模型**只做转录**（读图上印的数）。凡是模型"估"出来的，必须显式标注且**默认路径不含估算**（见 T5.2） |
| **「没有数据」≠ 0** | 地雷 11 | 图上读不到钠 → `sodium` 保持 `undefined`，**不许填 0** |
| **数字只能有一次乘法** | `lib/nutrition/core.ts` 头注释 | 用户食物落库必须走 `recordDietEntry({ food })` → `makeDietEntry` → `nutritionOf`。**不许自己写 `per100 * k`** |
| **估不出来就不给数字** | 地雷 16 | 校验 `reject` 时**不产出任何数值** |
| **数据文件按文本插行** | 地雷 27 | 改 `data/*.json` **禁止 `JSON.parse` + `JSON.stringify` 整体重写**（`1.0`→`1` 不可逆，diff 会从 +1 行变成 +200 行，review 时什么都看不出来） |
| **数字输入框用字符串 state** | 地雷 5 | `value={number}` + `Number(v)\|\|0` 会导致**删不掉、永远留个 0** |
| **新文案要跟冒烟断言对一遍** | 地雷 21 / 24 | 新界面文案可能"救活"旧的 grep 断言，让检查假绿 |

### 1.3 环境事实（本会话实测，省得你踩）

- **`python` 是 Microsoft Store 的占位 stub**：`--version` 返回空、退出码 0、**什么都不做**。
  → **必须用 `python3`**（真实 Python 3.14.3，Pillow 12.1.1 可用）。这与地雷 44（`npx` 返回码不可信）同类：**退出码 0 不等于真干活了**。
- **`image_edit` 工具在本机不可用**（它要 `C:\Users\Administrator\image_venv`，不存在）。
  图像处理直接用 `python3` + Pillow。
- **Windows OCR（`image_ocr` 的 windows 引擎）的坑**（若你要用它交叉验证）：
  - 必须传**原始尺寸整图**；裁成小块（1291×984）或放大 2x/3x 会让识别率崩到 0~1 行，
    **现象稳定复现 4 次，与 PNG/JPEG 编码无关**
  - **不能传 `language` 参数** —— pwsh 7 无 WinRT 投影，报 `找不到类型 [Windows.Globalization.Language]` 直接失败
  - 照片偏暗时 `PIL.ImageOps.equalize` 效果最好；**锐化与 gamma 反而更差**
- **`web_search` 端点未配通**（直接 `fetch failed`）；`web_fetch` 可用。
  `api.github.com` 被本机 DNS 解析到私有 IP，`web_fetch` 会拒绝（GitHub 相关的网络查询走不通）。
- `node` v24.9.0 可用。

---

## 2. 现状盘点

### 2.1 ✅ 已经就绪、直接复用

| 东西 | 位置 | 说明 |
|---|---|---|
| **DeepSeek Key 存储 + 设置 UI** | `lib/prefs.ts` `loadApiKeys()` / `saveApiKeys()`；`app/components/shell/SettingsDialog.tsx` ~L211 | 键 `recipe.apikeys.v1`，值 `{ deepseekKey?: string }`。**注意 `saveApiKeys` 是整体覆盖，不是合并** |
| **DeepSeek 调用封装** | `lib/ai/deepseek.ts` | 浏览器直连、`fetch` 而非 SDK、报错翻成中文、`response_format: json_object` |
| **"AI 记录"这个来源值已存在** | `lib/nutrition/types.ts:165` `DietEntrySource = "db" \| "custom" \| "ai"` | **不需要改类型** |
| **手输自定义食物的先例** | `lib/storage/diet.ts:195` `recordCustomEntry` | ⚠️ **不要用它**（见 2.3） |
| **食物匹配的唯一判据** | `lib/nutrition/library.ts:82` `nameMatchScore` / `:103` `bestNameMatch` | 4 档 100/80/60/40，最后一档拒收单字 |
| **落库唯一入口** | `lib/storage/diet.ts:113` `recordDietEntry` → `core.ts:419` `makeDietEntry` → `core.ts:42` `nutritionOf` | 数字唯一的来路 |
| **食物类型** | `lib/nutrition/types.ts:104` `FoodItem` | `id / name / alias? / category / unit / kcal / protein / fat / carb / sodium? / fiber? / source` |
| **分类表** | `lib/nutrition/types.ts:35` `FOOD_CATEGORIES` | 10 个分类 |
| **备份分组表** | `lib/storage/backup.ts:216` `BACKUP_GROUPS` | 子串硬编码，新键必须补一行 |
| **冒烟闸门** | `scripts/browser-smoke.mjs`（`npm run smoke`） | 真实浏览器 5 个页面 + 14 个定向交互检查 |

### 2.2 ❌ 缺的（本任务要新建）

1. **视觉调用**：`deepseek.ts` 现在只支持纯文本（`content: string`），不支持图片块
2. **图片预处理**：没有任何压缩代码
3. **数值校验**：没有任何"闭合校验 / NRV 核对"的纯函数
4. **用户食物库**：没有任何存"用户自己加的食物"的地方（`recordCustomEntry` 只落单条记录，**不持久化食物本身**）
5. **合并检索**：所有检索都只认静态库
6. **入口与 UI**：`QuickAddCard` 的「库里没有」那一行只能点「自己搜一个」
7. **反馈渠道**：没有任何把"这个食物该进正式库"交出去的途径

### 2.3 ⚠️ 不能动的（都写明了理由，不要"顺手优化"）

| 东西 | 为什么不能动 |
|---|---|
| `lib/nutrition/library.ts` 的静态库语义 | 它是纯层：不碰 localStorage、无全局可变状态。塞用户库进去会破坏这个约束 |
| `lib/nutrition/quickadd.ts` 的口语解析核心 | `matchFood` 深度依赖 `library.ts`，接用户库会牵动 parse/quickadd 的核心判据。**改用 UI 层补匹配**（见 T4.2） |
| `lib/storage/diet.ts` 不许 import 食物库 | 文件头 `:4` 写明了：数据层被首页等页面共用，牵进那份 50KB JSON 会让**每个页面**都带上它（`check:chunks` 闸门守着这件事） |
| `recordCustomEntry` | 它自己算 `per100 * k`，**等于复制了"数字的唯一来路"**。保留不删，但**新功能不走它** |
| `data/foods.zh.json` 的运行时写入 | 静态 JSON 是**构建期资产**，app 运行时改不了它 |

---

## 3. 逐任务工单

| ID | 名称 | 依赖 | 可并行 | 验收命令 |
|---|---|---|---|---|
| **T0** | 正式库入库「统一双萃鸭屎香风味柠檬茶」 | 无 | — | `check:nutrition` + `check:reference` |
| **T1** | 视觉能力（`deepseek.ts` 扩展 + `foodVision` + 图片压缩） | 无 | 与 T0 并行 | `eslint` + T1.4 probe |
| **T2** | 数值校验纯函数 `verify.ts` | 无 | 与 T0/T1 并行 | `npm test` |
| **T3** | 我的食物库（localStorage 层 + 备份分组） | 无 | 与 T0–T2 并行 | `npm test` |
| **T4** | 合并检索 `lookup.ts` + 调用点改造 | T3 | — | `check:chunks` |
| **T5** | UI：拍照入口 + 结果确认页 | T1,T2,T3,T4 | — | `npm run smoke` |
| **T6** | 申请进正式库（GitHub Issue / 邮件） | T5 | — | 手工点两个链接 |
| **T7** | 设置面板文案 + 隐私告知 | 无 | 任意 | `eslint` |

**建议顺序**：T0（可立即验收）→ T1 ∥ T2 ∥ T3 → T4 → T5 → T6 ∥ T7。

---

### T0 —— 正式库入库那条已确认的饮料

**背景**：用户拍了 500ml 瓶身营养成分表照片，经 OCR + 两条独立校验确认，**用户已回复"数据没错全对的上"**。
数值见 §5.4，**不要再改动**。

#### T0.1 `data/foods.zh.json`

在 drink 组内（锚点：`"id": "yezhi"` 那一行，`main` @ 380ca2e 的第 228 行）**之后**插入一行：

```json
    { "id": "lemontea-yashixiang", "name": "统一双萃鸭屎香风味柠檬茶", "alias": ["鸭屎香柠檬茶", "双萃柠檬茶", "统一柠檬茶", "柠檬茶"], "category": "drink", "unit": "ml", "kcal": 36.6, "protein": 0, "fat": 0, "carb": 9.0, "sodium": 10, "source": "包装营养成分表（标示 153 kJ/100ml 换算，2026-09-19 拍照读取）" },
```

- **kcal 换算**：153 kJ ÷ 4.184 = 36.57 → `36.6`。原始标示值（153 kJ）写进 `source` 以便追溯。
- **`source` 的措辞是刻意的**：**不许**出现「中国食物成分表」（会要求台账）或「按配方估算」（会要求配方且能重算）。
  判据见 §5.3。
- ⚠️ **按文本插行**：读成行数组 → 在目标行后 `splice` → 写回，其它字节一个不动。
  写完用 `git diff --stat` 确认**只增不删**。

#### T0.2 `data/foodPortions.json`

在 `杯` 组（锚点：`{ "unit": "杯", "match": ["可乐", "雪碧", "冰红茶", "饮料", "苏打水"]` 那一组附近）插入：

```json
    { "unit": "杯", "match": ["柠檬茶", "鸭屎香"], "portions": [
      { "label": "一杯", "grams": 500, "range": [330, 600], "isDefault": true, "note": "按用户实际喝的 500ml 瓶装" }
    ] },
```

在 `瓶` 组插入：

```json
    { "unit": "瓶", "match": ["柠檬茶", "鸭屎香"], "portions": [
      { "label": "一瓶", "grams": 500, "range": [330, 700], "isDefault": true, "note": "常见塑料瓶装 500ml" }
    ] },
```

- **为什么单列而不并进现有饮料规则**：这条食物的默认杯量是 500（整瓶），与通用饮料的 330 不同。
- ⚠️ **必须过闸门 ④b2**「同一量词下若后面还有更长（更具体）的词能命中同一条食物、且克数不同，就报出来」。
  已核对：`杯`/`瓶` 两组现有 `match` 词**没有一个能在「统一双萃鸭屎香风味柠檬茶」或其别名里命中**，
  所以这条应是唯一命中的规则。**但插入后必须实跑确认** —— 这条闸门就是为"排反了看不出来"而设的。

#### T0.3 `data/foodSources.json` —— **不需要改**

已核实闸门判据（§5.3），本条 `source` 不含两个标记词，所以**台账与配方两个文件都不用动**。

**验收**：
```bash
npm run check:nutrition     # 0 问题；重点看 ④b / ④b2 有没有报这条
npm run check:reference     # 通过
npm run check:data          # 既有结构仍读得出来
git diff --stat             # 两个数据文件应"只增不删"
```

---

### T1 —— 视觉能力

#### T1.1 改 `lib/ai/deepseek.ts`

**现状**（已核实）：
```ts
export type ChatMessage = { role: "system" | "user"; content: string };
const BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_MODEL = "deepseek-chat";
export type ChatJSONInput = { apiKey; messages; temperature?; timeoutMs?; fetchImpl? };
// body 里写死 model: DEEPSEEK_MODEL
```

**改动**：

1. 放宽 `content`：
   ```ts
   export type ContentBlock =
     | { type: "text"; text: string }
     | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "original" | "auto" } };
   export type ChatMessage = { role: "system" | "user"; content: string | ContentBlock[] };
   ```
   **向后兼容**：`lib/ai/recommend.ts`、`lib/ai/feedback.ts` 都传 `string`，不受影响。
2. 新增 `export const VISION_MODEL = "deepseek-flash";`
3. `ChatJSONInput` 增加可选 `model?: string`，body 用 `input.model ?? DEEPSEEK_MODEL`。
4. **顺带核实 `DEEPSEEK_MODEL = "deepseek-chat"` 是否还有效** —— 官方当前主推名是
   `deepseek-flash` / `deepseek-v4-pro`（见 §5.1）。用 T1.4 的 probe 验证；
   若已失效，一并改掉，并确认 `lib/ai/recommend.test.ts` / `feedback.test.ts` 仍过。

#### T1.2 新增 `lib/ai/imageInput.ts`

- 用浏览器 `canvas` 把 File 压到**长边 ≤1600px**、JPEG 质量 0.85，输出 `data:image/jpeg;base64,...`
- **不引入任何新依赖**
- 依据 §5.1：单图 ≤32MiB、请求体 ≤48MiB、每图自动缩到约 1300×1300、≤1024 tokens/图。
  压缩既省 token 也让上传更快。
- 边界：**EXIF 旋转**（手机竖拍照片常带 orientation）—— 用
  `createImageBitmap(file, { imageOrientation: "from-image" })` 或读 EXIF 后旋转。
  ⚠️ **iOS 真机必须验方向**（用户家人用 iPhone，AGENTS 第 5 节要求界面改动真机点一遍）。

#### T1.3 新增 `lib/ai/foodVision.ts`

```ts
export type FoodReading = {
  kind: "label" | "dish" | "unknown";
  name: string;
  basis: "per100ml" | "per100g" | "per_serving";
  energy_kj?: number;
  energy_kcal?: number;
  protein_g?: number;
  fat_g?: number;
  carb_g?: number;
  sodium_mg?: number;
  nrv?: { energy?: number; protein?: number; fat?: number; carb?: number; sodium?: number };
  serving_grams?: number;
  readable: boolean;
  notes?: string;
};

export async function readFoodPhoto(input: {
  apiKey: string;
  imageDataUrl: string;
  hintName?: string;
  detail?: "high" | "original";
}): Promise<FoodReading>;
```

- 走 `chatJSON`，`model: VISION_MODEL`，`response_format: { type: "json_object" }`
- **system prompt 硬约束（照抄，不要软化）**：
  > 你只负责**转录**，不负责估计。只填你在图上**确实看到**的数字；看不清、被遮挡、
  > 反光导致不确定的字段一律**留空**，不要推测、不要补全、不要用常识填。
  > 若图里没有营养成分表，`kind` 填 `dish`，并且**不要填任何数值字段**。
- ⚠️ **图片只能放在 `user` 消息里** —— 放 `system` / `assistant` 会返回 **400**（见 §5.1）
- `detail` 默认 `"high"`。⚠️ **绝不用 `"low"`**：low 会把图缩到 **512×512**，
  营养成分表的小字必糊。

#### T1.4 一次性验证脚本 `scripts/probe-vision.mjs`

用真实 Key 跑一张样本图，确认三件**官方文档没写明**的事：

1. `response_format: json_object` 与图片**能否同时用**
2. `deepseek-flash` 默认是 **thinking 模式**，**如何关闭**
   （见 <https://api-docs.deepseek.com/guides/thinking_mode>）
3. `deepseek-chat` 是否仍可用

样本图自己造（`python3` + Pillow 画一张模拟营养成分表，含
「能量 153 千焦 / 蛋白质 0 克 / 脂肪 0 克 / 碳水化合物 9.0 克 / 钠 10 毫克」+ NRV 列）。
**期望它至少读对能量、碳水、钠三项。**

> ⚠️ **这是本任务最大的未知**：这三条我在本机无法预先验证（没有可用 Key 做调用实验）。
> **先做 T1.4，再写 T1.3 的解析逻辑。**
> 这个脚本不进闸门链（它要联网），验证完可以保留在 `scripts/` 下，照 `scripts/fetch-food-table.mjs` 的先例。

---

### T2 —— 数值校验（纯函数）

**新增 `lib/nutrition/verify.ts`**
（⚠️ 不许 import UI / Next / localStorage / 食物库 JSON —— 与 `core.ts` 同款纪律）

```ts
export type VerifyVerdict = "ok" | "suspect" | "reject";
export type VerifyResult = { verdict: VerifyVerdict; reasons: string[]; closurePct?: number };

/** Atwater 闭合：蛋白×4 + 脂肪×9 + 碳水×4 (kcal/g) */
export function energyClosure(v: { kcal: number; protein: number; fat: number; carb: number }):
  { expected: number; diffRatio: number; ok: boolean };

/** 用国标 NRV 基准核对图上标的 NRV% */
export const NRV_BASE = { energyKj: 8400, protein: 60, fat: 60, carb: 300, sodium: 2000 };
export function nrvCheck(v: {...}, nrv: {...}): { mismatches: string[] };

/** 每 100g/ml 的合理区间（超出即 reject） */
export function sanityRanges(v: {...}): string[];

export function verifyLabelReading(r: FoodReading): VerifyResult;
```

**容差**：沿用 `scripts/check-food-reference.mjs:55` 的既有口径 —— kcal ±1、三大营养素 ±0.15。

**判据**：
- `ok`：闭合一致 **且** NRV 无冲突 **且** 区间合理
- `suspect`：闭合在宽松档内（如 ±20%）或 NRV 有一项对不上
  → 数字**可以给**，但必须标「存疑」
- `reject`：闭合离谱、或数值超出物理区间 → **不产出任何数字**

**测试锚点（本次会话已确证的三个真实案例，直接写成单测）**：

| 输入 | 期望 |
|---|---|
| 能量 153 kJ、蛋白 0、脂肪 0、碳水 9.0 | 闭合 9.0×17 = 153 kJ，差 **0%** → `ok` |
| 能量 153 kJ、碳水 **105**（小数点被 OCR 丢掉） | 闭合 1785 kJ，差 **1067%** → `reject` |
| NRV 能量 2%（153/8400=1.82%）、碳水 3%（9/300=3%）、钠 1%（10/2000=0.5%） | 三条全对得上 → `ok` |

---

### T3 —— 我的食物库

#### T3.1 `lib/storage/keys.ts` 新增

放在 `dietLog` 附近：

```ts
  /**
   * 用户自己加的食物（拍照识别 / 手输）。
   * 与内置库分开存 —— 内置库是构建期资产（data/foods.zh.json），运行时改不了。
   */
  customFoods: "recipe.customFoods.v1",
```

已核对：`customFoods` 与现有全部键**无子串重叠**（否则会被 `describeBackup` 的 `has(...)` 误判）。

#### T3.2 新增 `lib/storage/customFoods.ts`

```ts
export function loadCustomFoods(): FoodItem[];
export function addCustomFood(food: Omit<FoodItem, "id"> & { id?: string }):
  { list: FoodItem[]; added: FoodItem };
export function updateCustomFood(id: string, patch: Partial<FoodItem>): FoodItem[];
export function removeCustomFood(id: string): FoodItem[];
```

- 复用 `FoodItem` 类型，**不新增字段** —— 数值来源靠 `source` 字符串表达
- id 前缀 `user-`（`uuid()` 由已装的 `uuid` 包生成，与 `diet.ts` 同款）
- 按名字归一化（去空白 + 小写，照 `library.ts:29` 的 `normalize`）去重；
  命中时返回"已存在"信号，由 UI 决定是否覆盖
- 上限保护（建议 500 条）+ 捕获 `QuotaExceededError`
- ⚠️ **不许 import `../../data/foods.zh.json`**（理由见 §2.3）

#### T3.3 `lib/storage/backup.ts` 的 `BACKUP_GROUPS` 补一行

```ts
  { label: "我的食物库", match: "customFoods", counting: "items" },
```

⚠️ 这块是**子串硬编码映射**（`backup.ts:216` 的注释明写"新增键时必须在这里补一行"），
不补 → 导入预览里看不到它。

---

### T4 —— 合并检索 + 调用点改造

#### T4.1 新增 `lib/nutrition/lookup.ts`

纯函数，外部数组由调用方传入，**不碰 localStorage**：

```ts
import { bestNameMatch } from "./library";   // ⚠️ 必须复用，不许新写匹配判据

export function searchAllFoods(query: string, extra: readonly FoodItem[], limit = 20): FoodItem[];
export function findFoodByIdIn(id: string | undefined, extra: readonly FoodItem[]): FoodItem | undefined;
export function allFoodsIn(extra: readonly FoodItem[]): FoodItem[];
```

- 打分 / 排序 / 去重规则**与 `searchFoods` 完全一致**
  （分数降序 → 同分短名优先 → 按 id 定序，见 `library.ts:122-137`）
- ⚠️ **AGENTS 地雷 29**：判据只能有一份。`nameMatchScore` 的注释明写
  "两边各写一遍必然漂移"，历史上已经因此让整个食物库闸门**全绿却失效**过一次。

#### T4.2 调用点改造（下表是**已 grep 的全量**，不要漏）

| 文件:行 | 现状 | 改成 |
|---|---|---|
| `app/components/diet/FoodSearchDialog.tsx:41` | `searchFoods(q,20)` / `foodsByCategory(c)` | 合并用户库（**主入口**）；分类浏览时用户库食物按 `category` 一并列出 |
| `app/components/diet/QuickAddCard.tsx:108` | `.map(f => foodById(f.foodId))` 最近常吃 | `findFoodByIdIn` —— **否则用户库食物静默消失** |
| `app/components/diet/DietDayList.tsx:95` | `foodById(e.foodId)` | `findFoodByIdIn` —— 否则已记录的用户库食物在日列表里查不到 |
| `app/components/diet/QuickAddCard.tsx` 的 `not-found` 行 | 只能点「自己搜一个」 | **先用用户库再匹配一次**（UI 层调 `bestNameMatch`），命中就直接变成可用行 |
| `lib/nutrition/tiers.ts:38` | `foodById(entry.foodId)` | 保持现有 `undefined` 降级，**不要抛错**（用户库食物查不到是正常状态） |
| `lib/nutrition/menu.ts` / `recommend.ts` / `quickadd.ts` | 只用内置库 | **不动**（见下方说明） |

**关于口语解析的取舍（要在交付报告里如实说明）**：`quickadd.ts` 的 `matchFood` 深度依赖
`library.ts`，把用户库接进去会牵动 parse/quickadd 的核心判据（风险大、收益小）。
折中就是上表最后一行：**解析报 `not-found` 之后，在 UI 层用用户库补一次匹配**。
这样用户说「一杯鸭屎香柠檬茶」仍能被认出来。

**其余用过 `foodById` 的地方**（`app/components/takeout/DishNutrition.tsx:73`、
`app/components/today/PickDishCard.tsx:165`）都属于菜单库，"帮我挑"那条路，**不需要改**。

---

### T5 —— UI

#### T5.1 入口两处（同一组件复用）

- `app/components/diet/QuickAddCard.tsx`：`MISSING_BADGE["not-found"]`（文案「库里没有」，
  见 `:55`）那一行，在「自己搜一个」旁加一个「📷 拍照让 AI 读一下」
- `app/components/diet/FoodSearchDialog.tsx`：搜索结果为空时的空态
  （现文案「没搜到。换个说法试试，或者用「一句话记」直接说。」，见 `:107`）加同一个入口
- **没配 Key 时不显示**（`loadApiKeys().deepseekKey`）—— 照 `WhatToEatCard` 的既有做法

#### T5.2 新增 `app/components/diet/FoodPhotoSheet.tsx`

流程：拍照/选图 → 压缩（T1.2）→ 识别中 → 结果确认 → 保存到用户库 → 立刻进入记账。

- 状态机：`idle | compressing | reading | done | error`
- 结果页展示：**读到的原始表格** + **校验结论**
  - `ok` → 「✓ 与标示值一致」
  - `suspect` → 「⚠ 存疑」+ 具体原因
  - `reject` → **不给数字**，只显示读到的原始值 + 「读不出来，重拍一张」
- 用户可逐字段修改：分类（复用 `FOOD_CATEGORIES`）、单位 g/ml、名称、别名、五个数值
  - ⚠️ **数字输入框必须用字符串 state**（地雷 5）
- **估算的强标注**（用户明确要求"强调估算的不严谨性"）：
  - `kind === "dish"` 或 `verdict === "suspect"` 时，页面顶部显示醒目警告：
    > **这是估算，不是标示值。** 仅凭外观推测，误差可能很大
    > （餐馆菜品的油量、份量都看不出来），**不要当成精确值**。
  - 保存时 `source` 分别写：
    - 包装读取：`"包装营养成分表（拍照读取，已过闭合校验）"`
    - AI 估算：`"AI 估算（仅凭外观推测，不可核对）"`
- 保存 → `addCustomFood`（T3）→ 记一条 `DietEntry`：

  ```ts
  recordDietEntry({
    date, time, mealSlot,
    food: customFood,           // ⚠️ 必须传 FoodItem，营养值由 nutritionOf 算
    name: customFood.name,
    amount: 1, unitLabel: "克", grams,
    source: /* 见下 */,
  });
  ```

  - **`source` 的选择**：包装读取 → `"custom"`；**AI 估算 → `"ai"`**
  - 这样当日汇总能说清"其中 N 条是估算"（`DietEntrySource` 已含 `"ai"`，**不需要改类型**）
  - ⚠️ **不要调 `recordCustomEntry`**（理由见 §2.3）

**验收**：`npm run smoke`。
⚠️ **地雷 21 / 24**：新增文案要用 grep 跟 `scripts/browser-smoke.mjs` 里 `EXPECT` 的断言词对一遍，
别让新文案救活了旧断言（那会让检查假绿）。

---

### T6 —— 申请进正式库

#### T6.1 新增 `lib/ai/contribute.ts`（纯函数：只生成文本和 URL）

```ts
export function buildFoodRequest(food: FoodItem, meta: { appVersion: string; verdict?: string }): string;
export function githubIssueUrl(req: string): string;   // https://github.com/Orang1ver/yuanqi-ledger/issues/new?title=…&body=…
export function mailtoUrl(req: string, to: string): string;
```

**申请模板（按用户要求预设好，已含入库所需的全部字段）**：

```
【食物入库申请】
食物名：            别名：
分类：              单位：g / ml
每 100 的数值：热量 __ kcal（原始标示 __ kJ）、蛋白 __ g、脂肪 __ g、碳水 __ g、钠 __ mg
数值来源：包装营养成分表拍照读取 / AI 估算
校验结果：算术闭合 __% · NRV 核对 __
常见份量：（可选，用于补份量表）
备注：              app 版本：
```

#### T6.2 新增 `app/components/diet/ContributeSheet.tsx`

- 三个动作：「在 GitHub 上提一个 Issue」/「发邮件给开发者」/「复制完整文本」
- **技术真相要写清**（否则用户以为点了就发出去了）：
  - `mailto:` 只是**打开邮件草稿**，需要用户自己按发送
  - GitHub Issue 预填是官方支持的链接形式，也需要用户**亲手点 Submit**
- **URL 长度保护**：超限（浏览器与 GitHub 各有上限）时降级为「复制文本 + 打开空白新建页」
- **照片说明**：两条渠道都无法自动带图，提示"如需附图，请在打开后的页面里手动拖入"
- **收件人**：`1843842330@qq.com`（用户本人提供）
- ⚠️ **隐私**：申请内容**不含任何个人数据**（无饮食记录、无 Key、无照片）。
  但**邮箱地址会写进公开仓库**，可能被爬虫抓取 —— 这是用户主动提供的，照做，
  但要在 UI 上提示一句（同 T7）。

---

### T7 —— 设置面板文案与隐私告知

`app/components/shell/SettingsDialog.tsx`：

- ~L211 的标题「AI 接口 Key（推荐与建议用，可留空）」
  → 改为「AI 接口 Key（推荐、建议与**拍照识别**用，可留空）」
- ~L239 那段隐私说明要**加一句**：拍照识别时**照片会上传到 DeepSeek**用于读取
  （其余数据仍只在本机）。

  > 这个项目主打"数据只存在本地"，这是**第一个例外** —— 必须写明，不能默默上传。

---

## 4. 验收契约（完成后交回审核人）

### 4.1 必须提交的证据（缺一项会被退回）

1. **改动清单**：每个任务涉及的文件路径 + 一句话说明改了什么
2. **`git diff --stat` 全文**（T0 的两个数据文件必须"只增不删"）
3. **全部验证命令的原文输出**（粘贴，不是复述）：

   ```bash
   npx eslint .
   MSYS_NO_PATHCONV=1 BASE_PATH=/yuanqi-ledger npm run build
   python scripts/verify-subpath.py
   npm run check:data
   npm run smoke
   npm run check:nutrition
   npm run check:reference
   npm test
   npm run check:chunks          # 必须先构建
   ```

   基线是 **0 错 0 警**。任何报错都要说明是不是你引入的 ——
   判断方法：`git stash` 后在干净工作区跑同一条对比。
4. **T1.4 probe 的原始输出**（三件未知事实的结论）
5. **破坏自证的结果**（故意改坏 → 检查确实变红 → 改回）
6. **分支自证**：`git show-ref refs/heads/<你的分支>` 的输出
7. **没做的事也要说**：某项未完成或跳过，直接说明原因，不要留空白

### 4.2 审核人会重点验的地方

- T0 的数值是否与 §5.4 一致（153 kJ / 0 / 0 / 9.0 / 10mg → 36.6 kcal），
  `source` 措辞有没有误触台账闸门
- T0 的份量规则有没有被 ④b2 挡（闸门输出里 ④b 系列必须干净）
- **T4 是否真的复用了 `bestNameMatch`** —— 会去 `lookup.ts` 里找有没有第二套匹配判据
- **T5 的落库是否只走 `recordDietEntry({ food })`** —— 有没有人偷偷又算了一遍乘法
- **AI 估算是否在三处都被标记**（库条目 `source`、确认页警告、`DietEntry.source === "ai"`）
- 新增文案有没有撞上 `browser-smoke.mjs` 的既有断言词（地雷 21 / 24）
- 新增 localStorage 键有没有 `recipe.` 前缀 + 有没有补 `BACKUP_GROUPS`

### 4.3 反馈格式

审核人按 `文件:行 / 问题 / 为什么错 / 必须怎么改 / 严重度` 逐条给出。
修复后重新提交 §4.1 的全部证据。

---

## 5. 附录：已核实的技术事实（**不必重新探查**）

### 5.1 DeepSeek 视觉 API（官方文档，本会话已逐条核实）

来源：<https://api-docs.deepseek.com/guides/vision>、<https://api-docs.deepseek.com/quick_start/pricing>

- **模型**：`deepseek-flash`（DeepSeek-V4.1-Flash）**支持图片**；
  `deepseek-v4-pro` **不支持**。旧名 `deepseek-v4-flash-vision-exp` 仍被接受但已退役
- **格式**：OpenAI 兼容 Chat Completions，`content` 为**块数组**：

  ```json
  { "role": "user", "content": [
      { "type": "text", "text": "…" },
      { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,…", "detail": "high" } } ] }
  ```

- **图片格式按文件内容检测**，不信文件名与声明的 MIME（与本项目 `check-nutrition` 的魔数思路一致）
- **限制**（⚠️ **与 `AGENTS.md` 地雷 6 逐字吻合** —— 说明那条地雷就是照这份文档写的，
  项目当初就规划了这条路，只是没接线）：

  | 项 | 值 |
  |---|---|
  | 支持格式 | JPEG / PNG / GIF / WebP |
  | 外部 URL 长度 | ≤ 8192 字符 |
  | 请求体 | ≤ 48 MiB |
  | 单图（base64 / URL） | ≤ 32 MiB |
  | 单边像素 | ≤ 8192；**请求含 ≥15 张图时降到 4096** |
  | 每请求图片数 | ≤ 600 |
  | 每图 token | **≤ 1024**（自动缩到约 **1300×1300** 等效） |

- **`detail`**：`low` = 缩到 **512×512**（小字必糊，**不许用**）/ `high` = 原图 /
  `original` = 原图 / `auto` ≈ original
- ⚠️ **图片只允许出现在 `user` 消息里**；放 `system` / `assistant` 会 **400**
- 另有 Anthropic 兼容端点 `https://api.deepseek.com/anthropic`（本任务不用）
- ⚠️ `deepseek-flash` **默认 thinking 模式**（Models 页写明），需按 `/guides/thinking_mode`
  显式设置 —— 影响延迟与成本，**T1.4 要验**

### 5.2 现有代码的关键约束（源码已读）

| 事实 | 位置 | 对本任务的含义 |
|---|---|---|
| `searchFoods` 直接遍历静态 `LIBRARY.items` | `lib/nutrition/library.ts:122` | 用户库不能塞进去，必须另起一层 |
| `nameMatchScore` 是**唯一**匹配判据（4 档，末档拒收单字） | `library.ts:82` | `lookup.ts` 必须复用 |
| `diet.ts` 头部明写**不许 import 食物库** | `lib/storage/diet.ts:4` | `customFoods.ts` 同样不许 |
| `makeDietEntry` 无 `food` 时 nutrition **全 0** | `lib/nutrition/core.ts:434` | 用户食物**必须**作为 `FoodItem` 传进去 |
| `recordCustomEntry` 自己算 `per100 * k` | `lib/storage/diet.ts:195` | 遗留路径，新功能不走它 |
| `DietEntrySource = "db" \| "custom" \| "ai"` | `lib/nutrition/types.ts:165` | `"ai"` 已存在，可直接用 |
| `FoodItem.source` 是**必填**字符串 | `types.ts:124` | 数值来源靠它表达 |
| `QuickAddCard` 用 `foodById` 过滤"最近常吃" | `QuickAddCard.tsx:108` | 用户库食物会静默消失，必须改 |
| `BACKUP_GROUPS` 是子串硬编码 | `lib/storage/backup.ts:216` | 新键必须补一行 |
| `npm test` 是**显式文件列表** | `package.json:15` | 新测试文件必须手动加进去 |
| 测试用 `node:test` + `node:assert`，不引框架 | `lib/nutrition/core.test.ts:14` | 照它写 |
| 食物库只许进 `index` / `diet` / `takeout` 三个页面 | `scripts/check-page-chunks.mjs:35` | 新代码在 diet 页，不破坏 |

### 5.3 台账闸门的确切判据（不必猜）

`scripts/check-food-reference.mjs`：

- `REF_MARK = "中国食物成分表"`（`:45`）→ `source` 含它就**必须**在
  `data/foodSources.json` 登记（含正整数 `code` + `retrieved`）
- `RECIPE_MARK = "按配方估算"`（`:48`）→ `source` 含它就**必须**有
  `data/foodRecipes.json` 配方，且要能重算回去
- 本轮 T0 两条都不含 → **两个文件都不用改**
- 该脚本还跑 `YQ_SELFTEST=1` 自证（两处故意破坏必须被拦下）

### 5.4 用户已确认的数值（T0 的唯一事实来源）

用户拍摄的 500ml 瓶身照片，经 OCR + 两条独立校验后，用户回复"**数据没错全对的上**"：

| 项目 | 每 100ml | NRV% |
|---|---|---|
| 能量 | **153 千焦** | 2% |
| 蛋白质 | 0 克 | 0% |
| 脂肪 | 0 克 | 0% |
| 碳水化合物 | 9.0 克 | 3% |
| 钠 | 10 毫克 | 1% |

**两条互相独立的校验同时吻合**：

1. **算术闭合**：碳水 9.0 × 17 kJ/g = **153 kJ** = 标示能量，**差 0%**
   （蛋白、脂肪都是 0，不贡献）
2. **NRV 三条同时自洽**（基准：能量 8400 kJ、碳水 300 g、钠 2000 mg）：
   - 能量 153 ÷ 8400 = 1.82% → 标 **2%** ✓
   - 碳水 9.0 ÷ 300 = 3.0% → 标 **3%** ✓
   - 钠 10 ÷ 2000 = 0.5% → 标 1% ✓（国标容差内）

> 这是把"OCR 噪声"与"真值"分开的依据：单看任何一次 OCR 输出都不可信
> （实测同一条 `10.5 g` 在低分辨率下会被读成 **105 g**，十倍错误且长得完全正常）。
> **两条独立校验同时对上，不是巧合能凑出来的。**

---

## 6. 明确的非目标

- ❌ **不做 app 直连本机 agent**。三个理由：
  1. **手机场景不通** —— app 部署在 GitHub Pages（https），要调本机 `http://127.0.0.1`；
     手机上那个地址是手机自己。换局域网 IP 也不行：https 页面请求 http 资源会被浏览器按
     **混合内容**拦掉
  2. **安全** —— 让一个公网页面能驱动"能读文件、改代码、跑命令"的本机 agent，
     等于开一个远程执行面
  3. **不必要** —— 识图 app 自己就能闭环；agent 不可替代的只剩"把食物写进正式库并发布"，
     而那一环用"一键复制 / 打开预填好的 Issue"就能交接，不需要端口和桥
- ❌ 不把用户库写进 `data/foods.zh.json`（静态 JSON 是构建期资产）
- ❌ 不存照片原图（localStorage 上限 5–10MB，一张手机照片 base64 后约 5.5MB 会撑爆）
- ❌ 不改 `quickadd.ts` 的口语解析核心（改用 UI 层补匹配，见 T4.2）
- ❌ 不做食物的编辑 UI（确认页可改即可）

---

## 7. 遇到不确定时怎么办

**停下来问，不要猜。** 尤其是：

- **T1.4 的三件未知事实**（§5.1 末尾）。若 probe 失败，**贴原始报错**，
  不要自己编一个降级方案
- 若 `deepseek-chat` 已失效，会影响 `lib/ai/recommend.ts` / `feedback.ts` ——
  **报告后再动**
- 若闸门 ④b2 报了 T0 的份量规则 —— **把闸门原文贴出来**，不要自己挪位置试探

> **宁可交一份"做完了 5 个任务、2 个卡住并说明原因"的报告，
> 也不要交一份"全绿但某处偷偷降级"的报告。**
> 这个项目在 `AGENTS.md` 里反复写同一件事：**一个不再反映现实的闸门比没有闸门更糟**
> （地雷 29 就是这么吃了一次亏 —— 闸门全绿，而它守的判据早就漂了）。
