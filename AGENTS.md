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

### 分支纪律（1.0.0 起强制）

> **正式版 1.0.0 之后，任何改动都必须先开分支开发，经用户确认无误后才 merge 回 `main`。**

- 分支命名：`feat/<简短名字>` / `fix/<简短名字>` / `docs/<简短名字>`
- 一律从**最新 `main`** 切出；**一次分支只做一件事**，不把不相关的改动混进去
- 推分支 → 把结论告诉用户 → **用户确认** → 才 merge 回 `main` → 再推 `main`
- merge 用 `--no-ff`；**不改写 `main` 历史**（不 rebase、不 force push）
- **0.x 阶段仍直接推 `main`**（这条规矩明确从 1.0.0 起算）。
  也就是说现在是「做完了直接提交推 main」，等发 1.0.0 那天开始切换。

### 日常开发

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
| **`origin`** | `https://github.com/Orang1ver/yuanqi-ledger.git` | ✅ **源码推这个**（分支 `main`） |

```bash
GIT_TERMINAL_PROMPT=0 git -C "$REPO" push origin main
```

> 若报 `Could not resolve host: github.com`：用户机器上的 Steam++（Watt Toolkit）
> 没在运行。它一退出就会还原 hosts，导致 github.com 走被污染的国内 DNS 而解析失败。
> **这不是代码问题。** 两条路：
>
> 1. **让用户打开 Steam++**（最省事）。
> 2. **不想打断用户时，让 git 自己按 IP 解析。** 注意此时**只有域名解析挂了，链路是通的** ——
>    `curl --resolve github.com:443:140.82.112.3 https://github.com` 返回 200 就是证据
>    （`github.io`、`objects.githubusercontent.com` 的解析本来就是正常的）：
>
>    ```bash
>    git -c http.curloptResolve=github.com:443:140.82.112.3 \
>      ls-remote https://github.com/Orang1ver/yuanqi-ledger.git -h refs/heads/main
>    ```
>
>    **这条路走的是 GitHub 的真实证书，比 `sslVerify=false` 干净得多，优先用它。**
>    需要 git ≥ 2.36（本机 2.55 可用）。发布脚本也认：
>    `DEPLOY_GIT_CONFIG="-c http.curloptResolve=github.com:443:140.82.112.3" node scripts/deploy.mjs`

发布静态站点用一键脚本（会校验版本三处一致、注入 SW 缓存名并打 tag）：

```bash
cd "$REPO" && node scripts/deploy.mjs
```

⚠️ **构建必须在沙箱外跑**：Next.js 清理旧 `.next`（数千个文件）会撞上批量删除保护，
报 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]` —— 与代码无关，别去改构建配置。

### ⚠️ TLS：schannel 吊销检查会让 git 全挂（2026-09-18 实测）

推 `gh-pages` 时 git 报：

```
schannel: next InitializeSecurityContext failed:
CRYPT_E_NO_REVOCATION_CHECK (0x80092012) - 吊销功能无法检查证书是否吊销。
```

**成因**：用户开着 Steam++（Watt Toolkit），它把 `github.com` 指向 `127.0.0.1` 做本地反代
（响应头里有 `Server: WattToolkit`，TLS 证书是它自签的）。它此时关掉了自己的系统代理/系统证书
安装，于是 Windows schannel 去检查吊销状态 → 连不上 CA 的 OCSP/CRL 服务器 → 失败。

**判据（很重要，别误判成网络坏了）**：
- `curl` 到 `https://github.com` 返回 **HTTP 200** ⇒ **链路是通的**，只是 git 的 TLS 栈不认
- `git ls-remote` 到**别的站点**（如 gitee）正常 ⇒ 不是 git 坏了，是 github.com 这条链特有问题

**处置**（按优先级试，两种都**不改全局配置**）：

1. **先试按 IP 直连** —— 让 git 绕开反代，直接对 GitHub 真机握真证书，不牺牲任何校验：

   ```bash
   git -c http.curloptResolve=github.com:443:140.82.112.3 push \
     "https://${USER}:${TOKEN}@github.com/Orang1ver/yuanqi-ledger.git" <ref>
   ```

2. 若仍报同样的错，再退到关校验：

   ```bash
   git -c credential.helper= -c http.sslVerify=false push \
     "https://${USER}:${TOKEN}@github.com/Orang1ver/yuanqi-ledger.git" <ref>
   ```

- `credential.helper=` 是为了绕开"git 拉不起凭据助手"的老问题（见下）
- `http.sslVerify=false` **只在这一次调用里生效**，不写进任何配置文件。
  这是本机反代场景下的既有取舍：**流量并没有真的脱离 TLS，只是不校验证书链**。
  替代方案（更安全但要装东西）：把 Watt Toolkit 的根证书导进 Windows「受信任的根证书颁发机构」，
  或改用它提供的系统代理模式。**如果能不用 `sslVerify=false` 就别用。**
- **绝对不要** `git config --global http.sslVerify false` —— 那会让全机器的 git 都不校验。

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
    已落地：`lib/nutrition/`（纯函数 + 查库 + 份量解析）与 `data/foods.zh.json`（223 条）。
    该层**不许 import UI / Next / localStorage 的东西**，id 与时间戳由调用方传进来
    （不在里面 `Date.now()`）—— 换来的是它能在 Node 里被直接调用、被单测、被闸门检查。
11. **「没有数据」不等于「0」**。`sodium` / `fiber` 在库里查不到时必须保持 `undefined`，
    求和时单独报覆盖率（`sodiumCoverage` / `fiberCoverage`），**绝不悄悄按 0 计入**。
    否则"今天钠摄入 550mg"就是个假结论，而用户会照着它做判断。
12. **记录里的营养值是快照**。`DietEntry.nutrition` 存的是写入那一刻算出的值，
    事后改 `data/foods.zh.json` **不会**改写历史记录。这是有意为之，别"顺手同步一下"。
13. **份量规则的唯一来源是 `data/foodPortions.json`**，不要在 `FoodItem` 里再放一份 `portions` ——
    两份必然漂移。`match` 是**子串匹配且先命中先赢**，所以特殊条目（「大包薯片」）
    必须排在通用条目（「薯片」）前面；插新规则时位置比内容更容易出错。
14. **剥前缀噪音时，长词必须排在短词前面**。`parse.ts` 的 `LEAD_NOISE` 里
    「吃了」要排在「吃」前、「喝完了」要排在「喝」前 —— 否则「晚上吃了一包薯片」会把
    「吃了」剥成「了」，`一包` 认不出来，最后悄悄退化成按分类兜底的估算值（量级直接错）。
15. **口语解析的三种写法都得认，而且错法都是"静默算错"**（2026-09-18 一次修掉三个）：
    - **份量与克数可以同时出现**：「一包 70g 的薯片」→ `{ amount: 1, unit: "包", perUnitGrams: 70 }`。
      只取走 `70g`、把「一包」留进食物名 → 查库失败 → 兜底估算是错的（实测记成「肉包 200g」）。
      ⚠️ 「数量+量词」那一组要**成对且不可省略** —— 否则 `70克薯片` 会被回溯成「数量 7 + 克数 0」，
      或者被解释成「1 × 70g」，记录里显示成「1 克 · 70g」。
    - **切段前先粘空白**：`splitFragments` 按空白切，会把「薯片 70 克」切成三段，
      第一段没份量走兜底、后两段凑不出食物名。`glueMeasures()` 只粘「阿拉伯数字 + 度量单位」，
      纯中文量词之间的空白仍要切（「一包薯片 一杯奶茶」是两样东西）。
      ⚠️ `MEASURE_ALT` 必须**长词在前**，否则 `kg` 会被吃成「克」。
    - **量词不能当食物名**：只写「一包」时正则回溯会把「包」留作食物名，
      而模糊检索的「被查询包含」规则会把它配成**任意含该字的食物**（实测「肉包」）。
      所以量词残渣一律归位成 `unit`、食物名留空；`matchFood` 对 **1 个字**不做模糊检索
      （单字的精确命中仍放行 —— 库里有「醋」「盐」这种正名单字）。
16. **CSS transition 不会在元素"挂载"时播放**。`ProgressRing` 原本写的是
    `{pct > 0 && <circle/>}`，于是 0% 时那根弧线**压根不存在**，用户第一次点击记录时
    它才首次挂载 —— 表现就是「第一次点没动画，第二次之后才有」。
    改法是**始终挂载** + `strokeDashoffset` 过渡（`strokeDasharray` 恒等于周长），
    0% 时靠 `strokeLinecap="butt"` 消掉 12 点方向那个小圆点。
    同类写法在任何"从 0 开始"的动画上都会重犯 —— 先用 `smoke` 的定向检查确认，
    它验的就是「0% 时弧线在不在 DOM 里」+「点一下有没有采到中间值」。
17. **闸门的清理失败不能算测试失败**。`browser-smoke.mjs` 删临时浏览器目录时会撞 EBUSY
    （Edge 在 Windows 上关掉后还攥着 profile 里的 SQLite 一会儿），
    那会把一次断言全过的绿色运行变成非零退出码。一个"偶尔无故变红"的闸门比没有闸门更糟 ——
    人会学会忽略它。所以退避重试，最后仍失败只警告。
18. **检查的前置状态要自己造，不要假设数据**。冒烟的进度环检查一开始假设「今天的水是 0」，
    换成样例备份就跑挂了 —— 那份数据里"今天"的水本来就是满的（100%）。
    先一路减到 0 再开始测，检查才跟数据无关。
    这个 bug 已经犯过一次，探针里能一眼看出来：正确时输出「折算：1 ×『一包』70g」，
    退化时输出「按分类兜底 50g（估算）」。
15. **食物库只该被需要它的页面 import**。`lib/nutrition/library.ts` 会带上那份
    223 条食物、约 59KB（gzip 12.4KB）的 JSON。目前需要它的是饮食页、菜单库、
    首页的推荐；**健康小屋与周报不需要**（周报的质量分只依赖记录里的营养快照）。
    给新页面加功能时容易顺手 import 进来，构建后对比一下各页面引用的 chunk 里
    有没有食物名就知道了。相关文件里都留了这条注释，别删。
16. **估不出来就不给数字**。菜单库的菜名拆不干净时（`menu.ts` 的 `coveredRatio`
    低于 60%）必须**拒绝估算**。「黄焖鸡米饭」只命中「米饭」，算出来 232 kcal，
    而真实的是六百多 —— 连区间上沿都够不着。一个看起来精确的错数，
    比一句"估不出来"有害得多。同理，能估的也只给**区间**（±15% / ±35%），不给单一数字。
17. **不足型结论要等"今天吃得差不多了"才说**。只记了 400 kcal 的一天，
    纤维必然"不足"、蛋白必然"不够"，但用户还没吃晚饭。`advice.ts` 里
    所有"不足型"问题都要求当天热量已到目标的 60%（`daySettled`）才报；
    "超标型"（钠、热量、零食）不受此限 —— 吃超了就是吃超了。
    汇总同理：一条记录都没有时**不许**报"热量还差 2000kcal"，那是把"还没记"说成了"还差"。
18. **没记录的那天不进平均**。`summarizeWeek` 里一周只记两天就算两天，
    不按 7 天摊 —— 否则分数跟着用户的**记录习惯**走，而不是跟着**吃得好不好**走。
    同理，`available === 0` 的天（数据全都不足）也不参与平均。
    这类"缺数据"的地方一律用 `null` 表示，**不要用 0**，界面必须把"几天参与"写出来。
19. **量词绝不能写进前缀噪音表**（2026-09-18 踩过）。`LEAD_NOISE` 里曾有「吃了个」——
    本意是处理「吃了个苹果」，结果把量词「个」**一起剥掉**了，解析成"没写份量"→ 分类兜底，
    还标成「份」。份量表里明明有 `个[苹果]=200g`，**数值恰好一致**，于是只有单位和「估算」
    标签是错的 —— 界面上显示「200 份」。噪音表只放时间词/主语/动词（「吃了」「喝了」），
    量词留给 `FRAGMENT_RE`。这是"看起来对、实际错"的典型，改 `LEAD_NOISE` 前先想：这个词是不是量词。
20. **单字别名的模糊检索会被名字短者优先抢走更具体的匹配**（2026-09-18 踩过）。
    给「米饭」加别名「饭」后，「午饭吃了红烧肉」被记成了米饭 —— 因为模糊检索最弱档
    「被查询包含」同分时名字短者优先，单字藏在任何句子里都"命中"。`searchFoods` 这一档
    现在**不收单字名字**；单字仍可走精确匹配（说「饭」就是米饭）。加新的单字别名前先确认
    它不会在长句子里抢走本该命中的条目。
21. **改页面结构后，冒烟里依赖旧文案的断言必须跟着改**。饮食页从「当天总览在前」改成
    「三餐在前」后，旧断言「还没有记录」对应的空态文案变成了「今天还没记」，不改成
    grep 不到就误报。改结构时把 `browser-smoke.mjs` 里 `EXPECT` 的 `must` 一起 grep 一遍。
22. **闸门检查必须自证会失败，尤其别让它"恰好被兜底救回来"**（2026-09-18 踩过）。
    冒烟新增的「餐次」检查第一版写死「记到午餐」—— 而 `recordDietEntry` 有按时间兜底的逻辑，
    冒烟常在中午跑，兜底恰好也得出「午餐」，于是把 `mealSlot` 传参打断之后它照样全绿。
    修法：先读默认选中项（那就是按时间猜的结果）、再刻意选一个**别的**餐次做对比。
    任何"有兜底逻辑"的检查，都要让被测值 ≠ 兜底值，否则它测的是兜底、不是你想验的那层。
23. **自证"检查会失败"时，破坏点必须真的穿透到被测的那一层**（2026-09-18 踩过）。
    给「帮我挑」的四条冒烟断言逐条做破坏自证时，破坏白名单那一条把
    "名字对不上就丢弃"改成了"收下，并借一个假 id" —— 结果**检查全绿**。
    查下去才发现：那个假菜借的是候选池里**已有**的 id，于是先被**另一道**防线
    （`parsePicks` 里"同一道菜只留一次"的去重）挡掉了，压根没走到渲染那一步。
    差一点就把它当成"这条检查不灵敏"，而它其实只是被更靠前的防线保护着。
    同一个补丁改成借用**别的**候选的 id 之后，断言立刻变红。
    **做法**：破坏之后先问一句"这个改动真的会走到那条断言吗"，
    必要时让补丁刻意绕开中间的防线，并把这个"绕开"写进补丁注释里 ——
    自证失败有两种：检查不灵敏，和破坏没到位。**后者更容易被误判成前者。**
24. **按钮类断言靠文本子串定位时，同一页面的其它文案不许含那串字**（同一天顺手避开的坑）。
    首页那个按钮的文案是「帮我挑」，而卡片底部新加的提示语起草时写的是
    「想要『按你的菜单**帮你挑**』？」—— 不同字，所以侥幸没撞上；
    但要是当时写成「**帮我挑**几道？」，那条"没填 Key 时按钮不该出现"的断言
    就会被一句**提示文案**救活，报错信息还完全指不到真正的原因。
    新增界面文案时，先拿它跟 `scripts/browser-smoke.mjs` 里 `EXPECT` 与各定向检查用的
    断言词对一遍（这也是地雷 21 的另一面）。
25. **「数字 + 量词」之间的空白，和「两样东西」之间的空白长得一模一样**（2026-09-18 用户实测上报）。
    `glueMeasures` 的空白粘合原来只认**度量单位**（克 / g / ml）、不认**量词**（个 / 包 / 杯），
    于是「15 个饺子」被 `split(/\s+/)` 切成 `["15", "个饺子"]` ——
    界面上第一条是「「5」· 库里没有」，第二条只剩「1 个饺子」。用户说了 15 个，账本上记成 20g。
    加规则时要盯住反例：「一包薯片 一杯奶茶」的空白**必须**照切（那真是两样东西）。
    判据不是"有没有空白"，而是"空白后面是不是新的一份"。
    **粘合/切分规则每加一条，都要同时写一条"不该被粘"的反例测试**，否则下一次改动会把它吃掉。
26. **中文数量词不能用单字字符类匹配**（同一天挖出来的另一半）。
    `CN_UNIT_NUM = "[一二两三四五六七八九十半]"` 匹配「十五」时只吃下「十」，
    剩下的「五」落进食物名 —— 实测把 15 个饺子算成 **10 份 2000g**，比真实值大六倍多，一声不吭。
    凡是"要不要 `+`、要不要整词"的地方，写单字类之前先想一遍两位数。
    另一个坑：改成整词匹配后，**认不出来的词必须返回 `null` 并退回「整串当食物名」**，
    绝不能落到 `Number(word)` 变成 NaN —— NaN 会一路写进 `DietEntry.amount`，
    在账本里变成一个谁也解释不了的数。**"认不出来"要有一个明确的出口，不能靠默认值兜。**
27. **改数据文件时，别用 `JSON.parse` + `JSON.stringify` 整体重写**（2026-09-18 踩过）。
    往 `data/foods.zh.json` 加条目时图省事整体序列化写回，结果：`"fat": 1.0` 变成 `"fat":1`、
    每条里外层的空格也全丢了 —— diff 从「+25 行」变成「+211 / −195 行」，
    一次"只加了几条数据"的改动看起来像把整个库重写了一遍，review 时什么都看不出来。
    数字表示（`1.0` vs `1`）**不可逆**：改完再想还原，只能从 git 里取回原文件。
    **做法**：数据文件一律**按文本插入** —— 读成行数组，在目标行后面 `splice` 新行，
    其它行一个字节都不动；写完用 `git diff --stat` 确认「只增不删」。
    同一天取回原文件时还撞到 `git checkout -- <file>` 被安全策略拦下（丢弃工作区改动属高危），
    改用 `git show HEAD:<file>` 读回内容再写 —— 效果一样，且不会误伤工作区里其它改动。

---

## 5. 验证要求（用户要求讲清"怎么验证的"）

```bash
cd "$DEV"
npx eslint .
MSYS_NO_PATHCONV=1 BASE_PATH=/yuanqi-ledger npm run build      # 必须成功
python scripts/verify-subpath.py                                # 子路径点击自检
```

改了**数据层 / 食物库 / 营养层**时，上面三道之外再加这五道（含义见 README「五道闸门」）：

```bash
npm run check:data        # 既有结构的数据还读得出来吗
npm run smoke             # 真实浏览器里真的画出来了吗（5 个页面）
npm run check:nutrition   # 食物库算术自洽吗 + 每条食物有没有份量规则
npm run check:reference   # 标了外部来源的数值有没有登记台账
npm test                  # 营养层与数据层语义对吗（无数据≠0、快照、数字只能来自一次乘法）
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
- 顺手 commit + push 到 `origin`；网络不通就**说明情况等恢复**，不要静默跳过
- 拿到不确定的信息（用户偏好、外部约束）**先问再动手**，不要猜
- **1.0.0 之后：改动一律先开分支，等用户确认再 merge 回 `main`**（见第 1 节）

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
| **睡眠与心情的周聚合** | `lib/wellness.ts` |
| 体重计算（周均、距健康区间） | `lib/weight.ts` |
| **食物库（223 条，按每 100g/ml）** | `data/foods.zh.json` |
| **份量换算规则（111 条）** | `data/foodPortions.json` |
| **数值引用台账（出处，不存数值）** | `data/foodSources.json` |
| **引用台账闸门** | `scripts/check-food-reference.mjs` |
| **营养纯函数核心** | `lib/nutrition/core.ts` |
| **查库与检索** | `lib/nutrition/library.ts` |
| **口语份量解析** | `lib/nutrition/parse.ts` |
| **营养目标推导** | `lib/nutrition/targets.ts` |
| **AI 调用封装（浏览器直连 DeepSeek）** | `lib/ai/deepseek.ts` |
| **「帮我挑」prompt / 白名单 / 去数字** | `lib/ai/recommend.ts` |
| **「帮我挑」入口（首页推荐卡）** | `app/components/today/WhatToEatCard.tsx` |
| 营养层单测 | `lib/nutrition/core.test.ts` |
| 食物库质检闸门 | `scripts/check-nutrition.mjs` |
| 看一条口语输入怎么算的 | `npm run probe -- --text "晚上吃了一包薯片，一杯奶茶"` |
| 设计系统（颜色/按钮/卡片） | `app/globals.css`（`--yq-*` 令牌）+ `README.md` |
| 图标 / 启动图重新生成 | `scripts/make-icons.py` |
| 子路径自检 | `scripts/verify-subpath.py` |
| 线上站点 | <https://orang1ver.github.io/yuanqi-ledger/>（`gh-pages` 分支，`node scripts/deploy.mjs` 发布） |
| **分支纪律（1.0.0 起）** | 本文件第 1 节「分支纪律」 |
| 一键发布 | `scripts/deploy.mjs` |
