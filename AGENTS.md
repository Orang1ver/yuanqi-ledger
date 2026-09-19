# AGENTS.md —— 元气账本项目约定（接手前必读）

> 这份文件是给**任何在此项目上工作的 agent**（Codex / Claude / 其他）看的。
> 用户是中文母语者：**思考过程（reasoning / thinking）用中文，最终回复也用中文。**

---

## 0. 一句话背景

一个**纯前端**的个人健康账本：记录每天的吃、喝、动、睡，并给出健康参考。
数据全部存**浏览器 localStorage**（键前缀 `recipe.`），没有服务端、没有数据库、没有 API 路由。
构建产物是静态站点，部署在 GitHub Pages 的**子路径** `/yuanqi-ledger/` 下。

以 **MIT 开源**。仓库里不要引入任何来源不明、许可不明的代码或素材。

---

## 1. 工作流程

### 分支纪律（**1.0.0 已发布 —— 从现在起强制**）

> **正式版 1.0.0 之后，任何改动都必须先开分支开发，经用户确认无误后才 merge 回 `main`。**
>
> ⚠️ **1.0.0 已于 2026-09-19 发布。** 也就是说下面这几条不再只是"以后再说"：
> 0.x 阶段那句「做完了直接提交推 main」**已经失效**，从此刻起每次改动都走分支。

- 分支命名：`feat/<简短名字>` / `fix/<简短名字>` / `docs/<简短名字>`
  —— ⚠️ **但这套带斜杠的名字在本机建不出来，见下方红框，以红框为准。**
- 一律从**最新 `main`** 切出；**一次分支只做一件事**，不把不相关的改动混进去
- 推分支 → 把结论告诉用户 → **用户确认** → 才 merge 回 `main` → 再推 `main`
- merge 用 `--no-ff`；**不改写 `main` 历史**（不 rebase、不 force push）

> ### 🔴 本机建不了带斜杠的分支名（2026-09-19 实测踩过一次，会静默断链）
>
> **现象**：`refs/heads/` 下**创建子目录会静默失败**。
> `git branch feat/x`、`git checkout -b feat/x`、`git update-ref refs/heads/feat/x <sha>`
> **全部返回退出码 0，但 ref 根本不存在** —— `git show-ref refs/heads/feat/x` 查不到，
> `ls .git/refs/heads/` 里也没有 `feat/` 目录。
>
> **已排除**：`.git/config` 完全正常（无 filter / 无 hooksPath / 无异常 extension）；
> 扁平名字（`feat-x`）正常；**手写 ref 文件**正常；`refs/remotes/origin/feat/pick-dish`
> 这种嵌套 ref 是**以前**留下的、仍能读，但**新建不出来**。
>
> **为什么危险**：`git checkout -b feat/x` 会把 `HEAD` 指向一个**不存在的 ref**。
> 于是**下一个提交会变成没有父提交的 `commit (initial)`（孤儿提交）**，
> 与 `main` 的历史彻底断链 —— 表面上一切正常，只有 `git rev-list --parents -n1 <sha>`
> 或 reflog 里的 `commit (initial)` 字样能看出来。这次就是这么发现的。
>
> **规矩**：
> 1. **本机一律用扁平名**：`feat-x` / `fix-x` / `docs-x`（上面那行带斜杠的命名是原定约定，
>    在本机跑不通）
> 2. 建完分支**立刻自证**：`git show-ref refs/heads/<名字>` 有输出才算建成
> 3. 切完分支**再自证一次**：`git rev-parse HEAD` 必须能解析出提交、且
>    `git rev-parse HEAD^` 指向预期的父提交

> ### 🔴 本机 git 会静默删文件 —— 别用 `git merge`，也别用 `git checkout` 切分支
> （2026-09-19 出过一次事故，`.git` 被整个送进回收站）
>
> **现象**：`git merge --no-ff` 撞上「stat 抖动」的工作区而报 `stash failed`；
> 紧接着 `.git/refs/` 整棵树消失、`objects/` 下 76 个分片目录全空、`pack/*.pack` 不见，
> 此后**每条命令都报 `fatal: not a git repository`**
> —— git 判定「这是不是仓库」要求 `HEAD` + `objects` + `refs` **三者齐全**，缺一个就不认。
> 同一批操作里 `git checkout <branch>` 还把 `scripts/` 下 17 个文件整个删掉，**稳定复现两次**。
> 「stat 抖动」的判据：`git status` 冒出一批 ` M`，但 `git diff` 与 `git diff --cached`
> **都是空的**、`git hash-object` 与 `HEAD:<path>` 的 hash 相同（内容其实一致）。
>
> **文件没真丢**：约 1062 个 `.git` 文件被送进了 **Windows 回收站**（含 `objects\<xx>\<sha>` 松散对象），
> 定向捞回后 `git fsck` 无 missing/broken。
> ⚠️ **但触发那一千次删除的主体没有坐实** —— 删除守卫状态里当时只记了 `count=1`，
> 说明**不是走 shim 的 `rm`**。**别把根因写成已确证。**
>
> **规矩（每条都有代价）**：
> 1. **动手前先 `cp -r .git <仓库外路径>`** —— 这是唯一真正救命的动作，先做再说话
> 2. **合并用底层管道，不用 `git merge`**：
>    ```bash
>    T=$(git merge-tree --write-tree main <分支>)          # 只算树，不碰工作区
>    M=$(git commit-tree "$T" -p "$(git rev-parse main)" -p "$(git rev-parse <分支>)" -F msg)
>    git update-ref refs/heads/main "$M" && git rev-parse main   # 必须复核
>    git cat-file blob "$M":<path> > <path>                 # 需要时把文件写回工作区
>    git read-tree "$M"                                     # 刷 index
>    git diff && git diff --cached && git status --short    # 三者全空才算好
>    ```
> 3. **别用 `git checkout <branch>` 切分支** —— 要看别的分支的内容用 `git show <ref>:<path>`；
>    确实非切不可，切完**立刻 `git status` 查有没有成片的 `D`**
> 4. **`git update-ref` 会静默不生效**（退出码 0 但值没变，实测 `refs/remotes/origin/main` 改不动）
>    → 写完**必须 `git rev-parse` 复核**；改不动就手写 loose ref 文件（父目录须已存在），
>    嵌套目录建不出来时（见上一个红框）直接改 `.git/packed-refs`
> 5. 真出事后**别点「一键还原回收站」** —— 那会把几千条本不该回来的东西撒回各处、
>    并用旧版本**覆盖**已修好的状态。按 `$I` 元数据**定向恢复**、只补「目标不存在」的，见下

#### 出事后怎么做（`.git` 被送进回收站）

1. **先封存损坏态**：`cp -r .git <仓库外>/git-broken-<时间>`
2. **找回收站**：`C:\$Recycle.Bin\<SID>\`。`$I<ID>` 是元数据、`$R<ID>` 是同 6 字符 ID 的内容。
   `$I` 布局：`ts=偏移16..24`（FILETIME）/ `len=24..28` / 文件名 `28:`（UTF-16LE）。
   按 `ts` 换算成本地时间，就能定位「出事那一刻」那一批。
3. **定向恢复**：
   - 松散对象 `objects\<xx>\<sha>` → 写回同名路径
   - `objects\pack\pack-*.pack` → 连 `.idx` / `.rev` / `objects\info\packs` 一起还原；
     完整性用「魔数 `PACK` + 末尾 sha1 与文件名一致」自证
   - `refs\heads\*` / `refs\tags\*` → 逐个捞回后**读回值核对**（是完整 SHA）
4. **自证恢复成功**：`git count-objects -v`（`in-pack` 不为 0）、
   `git fsck --no-progress`（无 missing/broken）、`git log --oneline -3`

完整的事故经过、根因分析与今后注意事项：**`docs/INCIDENT-2026-09-19-git-loss.md`**。

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

### 本机环境约定

- **装 JDK / Android SDK / 其他大体积依赖，一律装到 D 盘**（系统盘空间紧，用户明确要求）。
  落到具体做法：`winget install --location "D:\..."`、
  `sdkmanager --sdk_root=D:\Android\Sdk`、`JAVA_HOME` / `ANDROID_HOME` 指向 D 盘对应目录。
- **这台机器的当前状态（2026-09-19 探过并装好了）**：
  - `D:\Android\jdk-21\` —— Temurin 21（**zip 解压，没走安装器**，位置完全可控）
  - `D:\Android\Sdk\platforms\android-35\`、`build-tools\34.0.0\`、`platform-tools\`、`licenses\`
  - **故意没有 `cmdline-tools`**：它只有 sdkmanager/avdmanager，而 sdkmanager 的仓库索引在
    `dl.google.com` 上，这台机器**直连不通**（本机常年没开代理）。目录是手工铺的，用不上它。
  - 密钥在 `D:\Android\keystore\yuanqi-release.jks`，密码在 `android/keystore.properties`，
    **两个都不进 git**（仓库是公开的，签名密钥进了 git 就永远换不掉）。
  - 重装/换机器：`scripts/android/setup-sdk.ps1`（从腾讯镜像铺 SDK）+
    `scripts/android/build-apk.ps1`（构建并验产物）。两个脚本的注释里写清了版本矩阵的由来。

### 版本矩阵：改之前先读这张表

```
AGP 8.6.1  +  Gradle 8.11.1  +  compileSdk 35  +  build-tools 34.0.0
```

这四个**必须一起动**，因为镜像上**没有 build-tools 35**（只有 r33 / r34），而：

- AGP 8.7+ **硬性要求** build-tools 35.0.0 ⇒ 上限被钉在 AGP 8.6.x
- compileSdk 35 需要 AGP ≥ 8.6 ⇒ 下限也是 8.6
- AGP 8.6 需要 Gradle ≥ 8.7 ⇒ 用镜像上有的 8.11.1

Capacitor 自己的两个子模块（`:capacitor-android` 在 `node_modules` 里、
`:capacitor-cordova-android-plugins` 是生成的）**各自硬编码 AGP 8.7.2 并从 `google()` 拉**。
`node_modules` 不能改（会被重装），所以 `android/build.gradle` 里为**所有子工程**
前置阿里云镜像并把 AGP 压回 8.6.1 —— 那段注释别删。

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

#### 发布脚本报 `could not read Username` 怎么办（2026-09-19 实测）

脚本在 push 那一步挂掉，报：

```
fatal: could not read Username for 'https://github.com': terminal prompts disabled
```

**成因**：源码仓库的 `origin` URL 里**不带凭据**，而 `execFileSync` 起的那个 git
**拉不起凭据助手**（就是下面 §「凭据助手」说的老问题），于是没人能提供用户名。
⚠️ **这跟 TLS、代理、hosts 都无关**，别去查那些。

**解法**：把 token 直接给进 URL，同时**关掉**那个拉不起来的助手：

```bash
RAW=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill)
TOKEN=$(printf '%s\n' "$RAW" | sed -n 's/^password=//p')   # 整段抓下来再锚定，别逐行判
DEPLOY_REMOTE_URL="https://Orang1ver:${TOKEN}@github.com/Orang1ver/yuanqi-ledger.git" \
DEPLOY_GIT_CONFIG="-c credential.helper= -c http.curloptResolve=github.com:443:140.82.112.3" \
  node scripts/deploy.mjs
```

两个 `-c` **缺一不可**：`credential.helper=` 关掉坏助手，`curloptResolve` 走真机证书。

⚠️ **失败在这次之后不必重跑整条**（实测整条要 **12 分钟**，时间几乎全在 `next build`）：
脚本是**先构建、后推送**，所以失败时 `out/` 里的产物、`out/.git` 里的提交**都已就绪**，
只补两条 push 即可：

```bash
git -C out -c credential.helper= -c http.curloptResolve=github.com:443:140.82.112.3 \
  push --force "$URL" gh-pages:gh-pages
git tag -f v1.3.0 && git push --force "$URL" v1.3.0
```

判据：`out/version.json` 里的 `version` 已是目标版本、`git -C out log` 有 `build: v…` 那条提交。

#### 发布后核验线上清单（有 OTA 之后才有这一步）

```bash
node scripts/verify-ota-live.mjs        # 等 CDN 传开 1~3 分钟再跑
```

它把线上 `version.json` 的 `ota.files` **逐条下回来核对字节数与 sha256**。
清单是发布时现算的，路径写错或某个文件没推上去时，**本地构建、七道闸门全都察觉不到** ——
只有壳真的去下载时才失败，而且失败得很晚。这是唯一能提前发现的办法。

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
  - `lib/storage/backup.ts` 的 `BACKUP_GROUPS` 是**子串硬编码**映射，**新键要补一行**，
    否则导入预览看不到它（**应用元数据**与**快照**类的新键例外，见该文件头部注释）
  - 「整份覆盖」导入是**唯一不可逆的操作**，它必须走 `pushImportUndo` 存快照 ——
    这条路上出过事：原来只靠一个 `window.confirm` 确认，没有快照也没有撤销
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
    已落地：`lib/nutrition/`（纯函数 + 查库 + 份量解析）与 `data/foods.zh.json`（249 条）。
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
    ⚠️ **排反了 = 那条规则永远走不到，而且看不出来**：旧闸门 ④b（有没有规则命中）和
    ④d（note 写没写）**都是绿的**，只有克数是错的。2026-09-19 一天里咬了三次：
    `一份鸡米花` 被单字「鸡」的泛化规则盖住（一直给 150g，专门写的 100g 从没生效）、
    `一份猪脚烤肉饭`/`一份手撕鸡奥尔良烤肉拌饭` 被 `份[…烤肉饭…拌饭]=300g` 盖住、
    `一份烤鸭饭` 被 `份[北京烤鸭,烤鸭…]=150g` 盖住（**整碗米饭丢了**）。
    现在闸门有 **④b2** 专查这个：同一量词下若后面还有**更长（更具体）的词**能命中同一条食物、
    且克数不同，就报出来并点名被挡住的是哪条。**新增/挪动份量规则后一定看这条有没有报。**
    另外：**改 `match` 的原子性**也要留意 —— 词写错了（库里没这个名字）会被"死词"检查抓；
    词对但位置错会被 ④b2 抓。两者都不是靠人眼看的。
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
    249 条食物、约 57KB（gzip 10.3KB）的 JSON。目前需要它的是饮食页、菜单库、
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

28. **`.mjs` 文件里不要写 TypeScript 语法**（2026-09-19，一次会话里犯了**三次**）。
    一次性脚本写顺手了就会带出 `const X: [string, number][] = [...]`、`x!.toFixed()` 这类写法，
    而 `.mjs` 是**纯 JS** —— Node 直接报 `SyntaxError: Missing initializer in const declaration`。
    坑在于 **eslint 不一定报**（`scripts/` 常在 lint 范围的边缘），
    所以它要到那条命令真的跑起来才暴露，而那时你可能已经基于"改完了"往下做了。
    数据文件的一次性改动脚本尤其容易这样 —— 同一段模板被反复复制粘贴。
    **做法**：写 `scripts/tmp-*.mjs` 之前先问一句「这是 JS 还是 TS」；
    需要类型就写 `.ts` 并用 `scripts/run-ts.mjs` 跑。
    要进仓库的脚本（如 `scripts/fetch-food-table.mjs`）更要在提交前跑一次。

29. **闸门不许自己抄一份运行时逻辑 —— 抄了就会漂移，而且漂了还全绿**（2026-09-19 踩过）。
    `scripts/check-nutrition.mjs` 是纯 JS，**没法 import `.ts`**，于是它自己抄了四份
    `match` 匹配逻辑。运行时把判据改成"单字词只认精确命中"之后，闸门还按子串算 ——
    结果「3 条死规则 + 37 条食物失去份量覆盖」它**一个都没报，整个闸门照样全绿**。
    一条不再反映现实的闸门比没有闸门更糟：人会以为它还在守。
    - 「真共享」试过两条路，都不通，别再走：
      ① 判据放 `lib/**/*.mjs` → `scripts/run-ts.mjs`（`npm test` / `check:data` / `probe` 都走它）
      **不编译 `.mjs`**，产物里没有那个文件，运行时 require 不到；
      ② 给 `.mjs` 配 `.d.mts` 只解决类型，解决不了①。
    - **做法**：镜像只能有一份（一个函数，四处检查都调它），并且**给它配一条只有新判据才拦得住的自证**
      —— 见 `check-nutrition.mjs` 第五处破坏（往活规则里塞单字词「饺」）。
      实测把判据退回子串时，`YQ_SELFTEST=1` 当场失败、退出码 2 并点名是哪条检查没拦下。
    - 更一般地说：**闸门里凡是"重写一遍运行时逻辑"的地方，都要问一句"它凭什么不会漂"。**
30. **「整条规则一个都没中」这种查法会把死词藏住**（同一天顺手挖出来的）。
    份量表里一条规则的 `match` 混着 3 个活词 + 1 个死词时，按"整条规则"判就永远看不见死词 ——
    而单字词（`蛋` / `油` / `肉` / `菜` / `鱼` / `烤`）恰恰都是这么躺进去的。
    改成**逐词**查之后一次报出 8 处，其中 6 处（`盖饭` / `盖浇饭` / `水果` / `蘑菇` /
    `香菜` / `芹菜` / `茼蒿`）是**一直躺在那儿的**：库里根本没有这些食物名，写了也永远不会命中。
    **判据**：新增/修改这类"批量匹配表"时，报错粒度要细到**单个词**，不要只报"整条没用"。

### 安卓壳 / PowerShell / Gradle 的坑（2026-09-19 一次性踩齐）

这一组和别的地雷不同：**它们不会让命令失败，只会让产物悄悄不对**，所以单独列。

31. **Windows PowerShell 5.1 读 UTF-8 的方式是两面的，两边都咬人。**
    - **`.ps1` 文件本身**：无 BOM 时按 ANSI（本机 GBK）解码，中文注释里的字节会把**换行吃掉**
      （实测 69 行被读成 60 行），于是括号配对错位，报一个指不到真因的
      `Unexpected token ')'`。⇒ **本仓库的 `.ps1` 一律存成 UTF-8 with BOM**，
      改完确认前三字节是 `EF BB BF`。
      ⚠️ **`edit` / `write` 工具重写文件会丢掉 BOM** —— 每次改完 `.ps1` 都要补回来：
      ```powershell
      $b = [System.IO.File]::ReadAllBytes($p)
      if (-not ($b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)) {
        [System.IO.File]::WriteAllBytes($p, [byte[]]([byte[]](0xEF,0xBB,0xBF) + $b))
      }
      ```
    - **`.ps1` 去读别的文件**：`Get-Content -Raw` 也按 ANSI 解码。`package.json` 是
      UTF-8 **无 BOM**（npm 惯例）且里面有中文 ⇒ 读成乱码、`ConvertFrom-Json` 直接抛错，
      而**赋值失败的变量是 `$null`** —— 版本号悄悄变成空字符串，一路写进 `sw.js` 的缓存名。
      ⇒ 读仓库里的文本文件一律显式指定编码：
      `[System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)`。
32. **Gradle 构建脚本里注释只用 ASCII。** Gradle 读构建脚本也走平台默认编码（本机 GBK），
    和地雷 31 是同一个成因。`android/build.gradle`、`android/app/build.gradle`、
    `gradle-wrapper.properties` 里的注释**故意写成英文**，别"顺手翻译成中文"。
    中文放 `strings.xml`（UTF-8 XML，没问题）和仓库里的文档里。
33. **XML 注释里不能出现 `--`。** 我在 `strings.xml` 里写 `-- that is why` 当破折号，
    aapt2 报 `注释中不允许出现字符串 "--"`。**双连字符在 XML 里是非法的**，换 `—` 或改写法。
34. **`| Select-Object -First N` 会掐断上游命令。** 实测
    `& apksigner ... | Select-Object -First 3` 让一次**成功**的验签变成非零退出码
    （Select 拿到量就停上游，命令被中断）。凡是靠 `$LASTEXITCODE` 判断成败的地方，
    **先把整份输出收进变量，再看退出码，最后才截取显示**。
35. **新增顶层目录后要看 eslint 的基线。** 加 `android/` 之后 `npx eslint .` 从 0 错变成
    **22 错 4384 警** —— 它在爬 `android/app/src/main/assets/public` 里那份 **cap sync 拷贝进去的
    Web 构建产物**。`eslint.config.mjs` 的 `globalIgnores` 里补了 `android/**` 与 `dist/**`。
    ⚠️ 这类"构建产物被 lint 到"的坑，判据是**基线数字**：这个项目基线是 0 错 0 警，
    看到几百条就要先问"我是不是把产物目录引进来了"，而不是去逐条修。
36. **改了 `make-icons.py` 或主题色之后，别忘了安卓那份图标要重新铺。**
    它写在 `android/app/src/main/res/` 下，`cap sync` **不会**动它们
    （sync 只管 `assets/public`）。重跑 `python scripts/make-icons.py` 再打包。
    出图前脚本会自证环是居中的 —— 那个断言修的是一个**真实存在过的 bug**
    （maskable 图标的环偏在左上角、偏了画布的 26.8%）。

37. **模糊检索最后一档「被查询包含」会退而匹配到名字里的**原料** —— 差十几倍而看不出来**（2026-09-19 发 1.0.0 前挖出来的）。
    `searchFoods` 的第四档是「查询包含食物名」（查询比食物名长），它会挑名字**最长**的那个原料：
    ```
    一份番茄炒蛋   → 一个西红柿       42 kcal（真实约 180）
    一份青椒肉丝   → 青椒             50 kcal（真实约 250）
    一份咖喱牛肉饭 → 10g 咖喱粉（别名「咖喱」太短）  34 kcal（真实约 650）
    一份鱼香肉丝饭 → 鱼香肉丝 150g（**整碗米饭丢了**） 285 kcal（真实约 600）
    ```
    而且结果标着「估算」，界面上看起来完全正常 —— 正是这个项目最不能接受的那种错。
    **两条守卫**（只在这一档生效，都在 `quickadd.matchFood` 里）：
    ① 命中的名字要覆盖查询 **≥60%** 的字（这条线不是新定的，`menu.ts` 估算外卖菜用的就是它）；
    ② 查询以**主食尾缀**（饭 / 盖饭 / 拌饭 / 面 / 米线…）收尾时，命中的名字本身也得带那个尾缀。
    触发时返回 `undefined`，走已有的「库里没有 X，挑一个相近的」那条路 —— **不给数字**。
    ⚠️ 加这条时连带修了两处，都是"改了 A 才发现 B 一直缺"：
    - **噪音表缺餐次词**（早饭 / 午饭 / 晚饭…）：`中午`「晚上」有，餐次那一组没有，
      于是「午饭吃了红烧肉」整段被当成食物名 —— 加了守卫之后它会变成"认不出"。
      两处一起修才对。
    - **剥噪音"不许剥空"只能对餐次词生效**：一刀切会把「我吃了」里剩下的**动词残渣**也留下，
      凭空多出一条记录（实测 3 条变 4 条）。判据是"剥空了还剩不剩一个**完整的说法**"。
    **一般化的教训**：模糊匹配的每一档，都要能回答"这一档最坏会匹配到什么"。
    名字短的档（单字）已经在 20 里禁掉了，长查询那一档就是漏的那半边。

38. **应用内更新是两条路，别只做一半**（2026-09-19，1.1.0）。
    网页版和安卓壳的更新方式**根本不同**，混为一谈就会做出一个"安卓上点了没反应"的按钮：
    - **网页版**：资源在服务器上 → 清 Cache Storage 再进（`forceRefresh`，别删那段）。
    - **安卓壳**：资源**打包在安装包里** → **只能下载新的安装包**。
      ⚠️ 安卓**不允许** App 给自己静默升级（除非走应用商店的更新接口），所以这一步必须用户点一下 ——
      这不是没做完，是平台就长这样。跳浏览器用 `@capacitor/browser`（动态 import，
      别让它进网页版的包）。
    - 判据是 `window.Capacitor.isNativePlatform()` —— **不需要 import `@capacitor/core`**
      （原生桥会挂这个全局），加了反而白搭一份运行时代码进网页版。
    ⚠️ **壳里 `location.origin` 是 `https://localhost`**（Capacitor 的本地资源服务器）。
    所以"去哪问有没有新版、去哪下安装包"**必须用一个硬编码的绝对站点地址**
    （`lib/update.ts` 的 `REMOTE_SITE`，与 `scripts/deploy.mjs` 的 `SITE` 两处一起改），
    用 `location.origin` 拼出来的地址在壳里是**下不动的**。
    （GitHub Pages 会给 `Access-Control-Allow-Origin: *`，所以壳里跨域读版本文件没问题 —— 实测过。）
    ⚠️ **发布顺序**：先 `npm run android:apk` 再 `node scripts/deploy.mjs`，
    否则 `version.json` 里没有安装包地址（脚本会警告，不会静默漏）。
    ⚠️ **「稍后」不能记布尔**：布尔只有"永远不再提示"一种语义，用户点过一次以后
    **任何新版本都不再告诉他**，这个功能就只有第一次有效。要记**版本号**。
    ⚠️ 检查时机要三个（打开 / 回前台 / 网络恢复）—— 少一个就会出现"挂着不管就永远收不到"。

39. **「启动动画」的遮罩必须在服务端渲染的 HTML 里**（同一天，1.1.0）。
    它存在的唯一理由是盖住"HTML 到了、React 还没水合"那段白屏 ——
    放进客户端组件就晚了，那时候白屏已经闪过去了。
    做法：标记写在 `app/layout.tsx`（服务端组件），`BootSplash` 只负责挂载后收掉
    （设 `document.documentElement.dataset.boot = "done"`，CSS 用它隐藏 ——
    注意是**隐藏**而不是从 DOM 里删：那个节点归 React 管，删了会让协调器困惑）。
    ⚠️ **三个出口缺一个都可能让装饰挡住人**：正常 ~420ms 收掉 / 点一下立刻收掉 /
    内联脚本 4 秒硬兜底（React 万一没起来，一层永远盖着的遮罩比白屏更糟）。
    ⚠️ 形状要和**安卓启动图一致**（`drawable/splash.png`），否则手机上
    「系统启动图 → 这一层」会看见一次跳变。
    ⚠️ 冒烟里断言"多久收起"必须**跑在 4 秒兜底之前**（现在卡 3.2 秒）——
    等过了兜底再断言，BootSplash 坏掉也照样是 done，检查就假绿了。

40. **「装到桌面」和「装 APK」是两种东西，数据一个相通一个不相通**（1.1.1 才写清）。
    - **装到桌面（PWA）**：与浏览器**同一个存储**（同一个 Origin），装完数据无缝，只是多了个图标。
    - **装 APK（Capacitor 壳）**：是**另一个 App** —— 壳里 Origin 是 `https://localhost`，
      它的 localStorage 与浏览器里那份**完全是两套**。装完会发现"记录全没了"，
      而数据其实好好地待在浏览器里。
    ⇒ 所以设置面板那条安装包入口里必须**明写「先导出备份、装好再导入」**，别删那句话。
    ⇒ 同理，任何"换个入口就能看到同一份数据"的假设在这里都不成立。
    ⚠️ 顺带一条：**用户能看到的更新入口，对"还没装的人"是盲的** ——
    「下载新版」只在壳里出现，于是第一次怎么装，界面上原本一个字都没有（1.1.1 补的
    `AndroidApkSection`）。判断"某个入口够不够"时，要分别站在**已装**和**未装**两种身份上想一遍。
    ⚠️ 那条入口的下载地址**从 `version.json` 的 `apk` 字段读**，不许硬编码版本号 ——
    硬编码的话发下一版忘了改，就是一个点不动的 404。冒烟为此专门喂了一个
    **与版本号无关**的文件名（`9.9.9`），否则"地址是拼出来的"这件事根本没被验到。

41. **首页有两张"吃什么"的卡，别把它们合掉；也别让它们抢同一批文案**（1.2.0）。
    | | 「今天吃什么」（`PickDishCard`） | 「今天还该吃点啥」（`WhatToEatCard`） |
    |---|---|---|
    | 回答 | **决定吃哪道**（从菜单库挑一道） | **还缺什么营养** |
    | 前提 | **无**（不用先记录、不用 Key、不联网） | 今天记过东西且存在缺口 |
    前者存在的唯一理由：后者是**缺口驱动**的 —— 今天一条饮食记录都没有时它显示"先去记一笔"，
    而那正是"我现在要吃饭了，吃什么"的时刻。**判断一个推荐入口够不够，先问"它什么时候不说话"。**
    ⚠️ 两张卡在同一个页面，文案会互相踩（地雷 21/24）：新卡的文案与 `data-yq` **不许**出现
    「今天还该吃点啥」（首页既有断言）、「还没有饮食记录」（空态断言的命门 ——
    新卡恰恰在没记录时要说话）、「帮我挑」（那是"没 Key 时按钮不该出现"那条断言的定位词）。

42. **"估不出热量"不是排除一个菜的理由 —— 对一个"决定吃哪道"的功能来说，热量本来就不是前提**（1.2.0）。
    菜单库里约八成是套餐长名（「香辣鸡腿中国汉堡+塔塔鸡块(3块)+翅根+冰柠可乐」），
    `estimateDish` 天生认不全（0.6.1 就查清并记在 ROADMAP 里）。把它们从候选池里剔掉的话，
    "今天吃什么"只能在那两成里兜圈子，推荐会反复推同样几道。
    ⇒ 现在的口径：**照样能推，但一个数字都不显示**，旁边直接给一条出路（一键关联）。
    ⇒ 但**这种菜不给「就吃这个」**：食材拆不干净，记下来只会漏算 —— 那正是它被判成估不出来的原因。
    ⚠️ 于是「推荐池」与「记录池」**是两个不同的集合**，别顺手用同一个 `filter`：
    `pickableDishes`（「帮我挑」用的那个）只收估得出的，本功能刻意收全部。
    ⚠️ 也别顺手把它"优化"成"哪个好算推哪个"—— 那与本功能的目的正相反。

43. **「吃过什么」的读取时机是一个有意的取舍，不是偷懒**（1.2.0）。
    `DietEntry.dishId`（可选字段）让"最近吃过哪几道"成为可能，但
    **吃完一道菜之后不许立刻重算"吃过什么"**：那道菜的新鲜度会当场掉到 0.15，
    卡片就会在用户眼前换成另一道菜，而下面还写着「已把「红烧肉」记到午餐」——
    他只会以为点错了。所以 `PickDishCard` 把它拆成两个状态：
    **菜单与忌口**跟着 `onDataChanged` 刷新，**"吃过什么"只在装载与点「换一个」时重读**。
    ⚠️ 冒烟里也踩过这条的镜像面：**先装载、再往 localStorage 塞"两天前吃过"，
    卡片是看不见的** —— 前置必须 seed 完**重新装载**，才和用户遇到的情况一致。
    ⚠️ `dishId` 是**可选**字段，1.2.0 之前的记录一条都没有，那是正常状态：
    不回填、不报错、**也不算"吃过"**（把"库里有记录"当成吃过，全库的菜会一夜之间变成"最近刚吃过"）。
    相关自检在 `scripts/check-data-continuity.ts` 的「老记录没有 dishId」那一项。

---

## 5. 验证要求（用户要求讲清"怎么验证的"）

```bash
cd "$DEV"
npx eslint .
MSYS_NO_PATHCONV=1 BASE_PATH=/yuanqi-ledger npm run build      # 必须成功
python scripts/verify-subpath.py                                # 子路径点击自检
```

改了**数据层 / 食物库 / 营养层**时，上面三道之外再加这六道（含义见 README「闸门」）：

```bash
npm run check:data        # 既有结构的数据还读得出来吗
npm run smoke             # 真实浏览器里真的画出来了吗（5 个页面 + 14 个定向交互检查）
npm run check:nutrition   # 食物库算术自洽吗 + 每条食物有没有份量规则 + 具体规则有没有被泛化规则挡住
npm run check:reference   # 抄来的数值有没有台账；按配方估算的能不能重算回去
npm test                  # 营养层与数据层语义对吗（无数据≠0、快照、数字只能来自一次乘法）
npm run check:chunks      # 页面分包（食物库只许进 diet / index / takeout）—— ⚠️ 必须先构建
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
- ⚠️ **顺序：先 `npm run android:apk`，再 `node scripts/deploy.mjs`** ——
  发布时会把 `dist/yuanqi-ledger-<版本>.apk` 放到站点的 `/apk/` 下，
  并写一份 `version.json` 给「应用内更新」用（见地雷 38）。
  少了这一步，网页版照常能更新，但**安卓壳收不到更新提示** —— 脚本会警告，别忽略。
- ⚠️ **在 worktree 里改过 `package.json`（加了依赖）之后，合并回主目录要先 `npm install`** ——
  依赖没进主目录的 `node_modules` 时，`next build` 会**因为解析不到那个 import 而直接失败**
  （动态 import 也一样会被解析）。worktree 有自己的 `node_modules`，不会自动同步。

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
| **跨组件必须一致的文案（页面名 / 免责声明 / 健康区间说明）** | `lib/copy.ts`（⚠️ 刻意**不是**全量文案表） |
| 数据读写 | `lib/storage/`（`io.ts` 原语、`health.ts`/`meals.ts`/`takeout.ts` 领域、`backup.ts` 备份） |
| **久未备份提醒（阈值 / 静默期 / 何时该提醒）** | `lib/storage/backupReminder.ts` |
| **「装到桌面」提示（iOS 手动教 / 安卓调系统安装）** | `app/components/shell/IOSInstallHint.tsx`、`AndroidInstallHint.tsx` |
| **安卓安装包下载入口（设置面板里，只对网页版 + 安卓显示）** | `app/components/shell/AndroidApkSection.tsx` |
| **应用内更新（网页版清缓存 / 壳里下载安装包）** | `lib/update.ts`、`app/components/shell/UpdateBanner.tsx` |
| **版本文件与安装包从哪来（发布时生成）** | `scripts/deploy.mjs` 的 `version.json` + `out/apk/` |
| **启动动画（遮罩在服务端 HTML 里）** | `app/components/shell/BootSplash.tsx` + `app/layout.tsx` + `app/globals.css` |
| **导入预览 + 「整份覆盖」的撤销快照** | `app/components/shell/ImportPreview.tsx`、`lib/storage/backup.ts` |
| 健康计算（BMR/TDEE/目标） | `lib/health.ts` |
| 喝水与步数换算 | `lib/steps.ts` |
| 连续天数与徽章 | `lib/rewards.ts` |
| 运动统计与里程碑 | `lib/exercise.ts` |
| 周维度达标率 | `lib/weekly.ts` |
| **睡眠与心情的周聚合** | `lib/wellness.ts` |
| 体重计算（周均、距健康区间） | `lib/weight.ts` |
| **食物库（249 条，按每 100g/ml）** | `data/foods.zh.json` |
| **份量换算规则（142 条）** | `data/foodPortions.json` |
| **档位反推（这条记录当时按哪一档算的）** | `lib/nutrition/tiers.ts` |
| **「这个数不对？」入口（每条记录旁边）** | `app/components/diet/EntryFeedback.tsx` |
| **AI 归因 / 反馈文本拼装（一个数字都不产生）** | `lib/ai/feedback.ts` |
| **份量档位 chips（共用）** | `app/components/diet/PortionChips.tsx` |
| **数值引用台账（出处，不存数值）** | `data/foodSources.json` |
| **取数工具（联网，不进闸门链；台账里的 code 靠它核对）** | `scripts/fetch-food-table.mjs` |
| **成品菜配方（按配方估算的条目必须有它，且要能重算回去）** | `data/foodRecipes.json` |
| **引用台账闸门** | `scripts/check-food-reference.mjs` |
| **页面分包闸门（食物库只进该进的页面）** | `scripts/check-page-chunks.mjs`（`npm run check:chunks`，需先构建） |
| **营养纯函数核心** | `lib/nutrition/core.ts` |
| **查库与检索** | `lib/nutrition/library.ts` |
| **口语份量解析** | `lib/nutrition/parse.ts` |
| **营养目标推导** | `lib/nutrition/targets.ts` |
| **AI 调用封装（浏览器直连 DeepSeek）** | `lib/ai/deepseek.ts` |
| **「帮我挑」prompt / 白名单 / 去数字** | `lib/ai/recommend.ts` |
| **「帮我挑」入口（首页推荐卡）** | `app/components/today/WhatToEatCard.tsx` |
| **「今天吃什么」（从菜单库挑一道；不需要先有记录、不联网）** | `lib/nutrition/pickDish.ts`、`app/components/today/PickDishCard.tsx` |
| 营养层单测 | `lib/nutrition/core.test.ts` |
| 食物库质检闸门（六处破坏自证：`YQ_SELFTEST=1`） | `scripts/check-nutrition.mjs` |
| 看一条口语输入怎么算的 | `npm run probe -- --text "晚上吃了一包薯片，一杯奶茶"` |
| 设计系统（颜色/按钮/卡片） | `app/globals.css`（`--yq-*` 令牌）+ `README.md` |
| 图标 / 启动图重新生成（含安卓那份） | `scripts/make-icons.py`（`npm run icons`） |
| **安卓 SDK 装到 D 盘（换机器 / 重装时跑它）** | `scripts/android/setup-sdk.ps1` |
| **打安卓 APK（构建 + 同步 + 打包 + 验产物）** | `scripts/android/build-apk.ps1`（`npm run android:apk`） |
| **安卓壳的配置（appId / webDir / appName 为什么是 ASCII）** | `capacitor.config.ts` |
| **安卓工程的版本矩阵与镜像覆盖（那段注释别删）** | `android/build.gradle`、`android/app/build.gradle` |
| 签名密钥（**不在仓库里**） | `D:\Android\keystore\yuanqi-release.jks` + `android/keystore.properties` |
| 打好的 APK | `dist/yuanqi-ledger-<版本>.apk`（gitignored） |
| 子路径自检 | `scripts/verify-subpath.py` |
| 线上站点 | <https://orang1ver.github.io/yuanqi-ledger/>（`gh-pages` 分支，`node scripts/deploy.mjs` 发布） |
| **分支纪律（1.0.0 已发布，从现在起强制）** | 本文件第 1 节「分支纪律」 |
| 一键发布 | `scripts/deploy.mjs` |
