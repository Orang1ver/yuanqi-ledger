# 元气账本 · 打安卓 APK（release，用 D:\Android\keystore 里的密钥签名）
#
# ⚠️ 为什么要有这个脚本，而不是直接敲 gradlew：APK 这一步**有三个静默失败**，
# 每一个都能出一个"看起来打好了、装上去白屏或装不上"的包：
#
#   1) **构建 web 时带了 BASE_PATH**。子路径是给 GitHub Pages 的（/yuanqi-ledger/），
#      而 WebView 从 https://localhost 起，站点根就是 / —— 带上子路径，页面能开、
#      _next/ 全 404，表现为**纯白屏**。所以下面既清空 BASE_PATH，又**断言产物里没有子路径**。
#   2) **忘了 cap sync**。安卓壳里装的是 app/src/main/assets/public 那份**拷贝**，
#      不 sync 就等于把上一次的界面打进包里，改了半天发现手机上没变。所以 sync 必须紧跟 build。
#   3) **没有 keystore.properties**。那样 assembleRelease 照样成功，只是产出一个**未签名**的
#      APK —— 文件在、大小正常、就是装不上（INSTALL_PARSE_FAILED_NO_CERTIFICATES）。
#      所以这里先断言密钥在，再构建，最后用 apksigner 验一遍。
#
# 用法（在仓库根目录）：powershell -ExecutionPolicy Bypass -File scripts/android/build-apk.ps1
# 或 npm run android:apk
#
# ⚠️ 本文件必须存成 **UTF-8 with BOM**（无 BOM 时 Windows PowerShell 按 ANSI 读，
# 中文注释会把换行吃掉，报一个指不到真因的语法错）。改完确认前三字节是 EF BB BF。

$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Repo

$JavaHome = "D:\Android\jdk-21"
$Sdk = "D:\Android\Sdk"
$BuildTools = "$Sdk\build-tools\34.0.0"

# ---- 前置：工具链在不在 ----
$missing = @()
if (-not (Test-Path "$JavaHome\bin\java.exe")) { $missing += "JDK（$JavaHome）" }
if (-not (Test-Path "$Sdk\platforms\android-35\android.jar")) { $missing += "platform android-35" }
if (-not (Test-Path "$BuildTools\aapt2.exe")) { $missing += "build-tools 34.0.0" }
if ($missing.Count) {
  Write-Host "✗ 缺工具链：$($missing -join '、')"
  Write-Host "  先跑：pwsh -File scripts/android/setup-sdk.ps1"
  exit 1
}

$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $Sdk
$env:ANDROID_SDK_ROOT = $Sdk
$env:Path = "$JavaHome\bin;$Sdk\platform-tools;$BuildTools;$env:Path"

# ---- 前置：密钥在不在（不在就别浪费一次构建）----
if (-not (Test-Path "android/keystore.properties")) {
  Write-Host "✗ 没有 android/keystore.properties —— 那样 assembleRelease 会产出一个未签名的 APK（装不上）"
  Write-Host "  先生成密钥并写这个文件，格式见 README 的「打安卓包」一节"
  exit 1
}

# ---- 1) 构建 web（**不带** BASE_PATH）----
$env:BASE_PATH = ""
Write-Host "▶ 构建 web（无子路径）…"
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "✗ 构建失败"; exit 1 }

# 断言产物确实是按根路径出的 —— 这条是那个"白屏"的唯一防线
$html = Get-Content "out/index.html" -Raw
if ($html -notmatch '/_next/') { Write-Host "✗ out/index.html 里没有 /_next/ 资源引用，产物不对"; exit 1 }
if ($html -match '/yuanqi-ledger/') { Write-Host "✗ out/index.html 里还带着 /yuanqi-ledger/ 前缀 —— WebView 里会白屏"; exit 1 }
Write-Host "  ✓ 产物按根路径生成"

# ---- 1b) 注入 SW 版本（与 scripts/deploy.mjs 同一套替换）----
# public/sw.js 里的 __VERSION__ / __BUILD__ 是**占位符**，平时由 deploy.mjs 在发布时替换。
# 不带这一步，APK 里的 sw.js 就会带着字面量 "__VERSION__" 跑 —— 缓存名永远不变，
# 于是**装上新版 APK 之后旧缓存还在**，正是这个项目在 iOS 上踩过的那类"看不到新版"。
#
# ⚠️ 读 package.json 必须**显式指定 UTF-8**。Windows PowerShell 5.1 的 `Get-Content -Raw`
# 按 ANSI 代码页解码，而这个文件是 UTF-8 **无 BOM**（npm 的惯例）：里面的中文变成乱码，
# `ConvertFrom-Json` 直接抛 "Invalid object passed in"，而**赋值失败的变量是 $null** ——
# 于是版本号悄悄变成空字符串，一路写进 sw.js 的缓存名。这个坑真踩过（第一次跑就中了）。
$pkgJson = [System.IO.File]::ReadAllText((Resolve-Path "package.json").Path, [System.Text.Encoding]::UTF8)
$version = ($pkgJson | ConvertFrom-Json).version
if (-not $version) { Write-Host "✗ 从 package.json 里没读出 version（空值不能一路带到产物里）"; exit 1 }
$buildId = (Get-Date).ToString("yyyyMMdd.HHmm")
$swPath = "out/sw.js"
if (-not (Test-Path $swPath)) { Write-Host "✗ out/sw.js 不存在"; exit 1 }
$sw = Get-Content $swPath -Raw
if ($sw -notmatch '__VERSION__' -or $sw -notmatch '__BUILD__') {
  Write-Host "⚠ out/sw.js 里没有占位符（可能已经被注入过），跳过"
} else {
  $sw = $sw.Replace('__VERSION__', $version).Replace('__BUILD__', $buildId)
  # ⚠️ 用 .NET 写**不带 BOM** 的 UTF-8：`Set-Content -Encoding utf8` 在 Windows PowerShell 5.1 下
  # 会加 BOM，而 deploy.mjs 写出来的 sw.js 是没有 BOM 的 —— 两边产物不一致本身就是坑
  [System.IO.File]::WriteAllText(
    (Resolve-Path $swPath).Path, $sw, (New-Object System.Text.UTF8Encoding($false))
  )
  # 注入完再读回来验一遍：占位符和空值都不许留在产物里
  $after = Get-Content $swPath -Raw
  if ($after -match '__VERSION__' -or $after -match '__BUILD__' -or $after -match 'APP_VERSION = "";') {
    Write-Host "✗ sw.js 注入后仍有占位符或空版本号"; exit 1
  }
  Write-Host "  ✓ SW 缓存名：yuanqi-v$version-$buildId"
}

# ---- 2) 同步进壳 ----
Write-Host "▶ 同步进安卓壳…"
# ⚠️ 这里**不用 `npx`**：本机实测 `npx cap sync android` 会在同步完全成功之后仍返回非 0
# （cap 自己退出码是 0，是 npx 这一层的返回码不可信），于是脚本把一次成功判成失败。
# 直接调 CLI，拿到的退出码才是真的。
node node_modules/@capacitor/cli/bin/capacitor sync android
if ($LASTEXITCODE -ne 0) { Write-Host "✗ cap sync 失败"; exit 1 }
if (-not (Test-Path "android/app/src/main/assets/public/index.html")) {
  Write-Host "✗ 壳里没有 index.html —— 同步没生效"; exit 1
}

# ⚠️ 只验"index.html 在"是**抓不住**上面第 2 条静默失败的 —— 那份文件一直都在，
# 壳里是不是**这一次**的产物，看的是版本号。所以拿壳内 sw.js 与刚构建的版本对一遍。
$shellSw = Get-Content "android/app/src/main/assets/public/sw.js" -Raw
if ($shellSw -notmatch "APP_VERSION = `"$([regex]::Escape($version))`"") {
  Write-Host "✗ 壳内 assets/public/sw.js 不是 $version —— cap sync 没把这次构建的产物同步进去"; exit 1
}
Write-Host "  ✓ 壳内产物版本 = $version"

# ---- 3) 打包 ----
Write-Host "▶ assembleRelease（版本 $version）…"
Push-Location android
.\gradlew.bat assembleRelease --console=plain
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { Write-Host "✗ Gradle 构建失败"; exit 1 }

$apk = "android/app/build/outputs/apk/release/app-release.apk"
if (-not (Test-Path $apk)) { Write-Host "✗ 没有产出 $apk"; exit 1 }

# ---- 4) 验产物：包名 / 版本 / 真的签了名 ----
Write-Host "▶ 验产物…"
$badging = & "$BuildTools\aapt2.exe" dump badging $apk
$pkgLine = ($badging | Select-String '^package:').Line
$launchLine = ($badging | Select-String "launchable-activity:").Line
$labelLine = ($badging | Select-String "application-label:").Line
Write-Host "  $pkgLine"

if ($pkgLine -notmatch "versionName='$([regex]::Escape($version))'") {
  Write-Host "✗ APK 里的 versionName 和 package.json（$version）对不上 —— 版本漂了"
  exit 1
}
Write-Host "  ✓ versionName = $version（与 package.json 一致）"

# ⚠️ 输出**不能**用 `| Select-Object -First 3` 直接截断：Select -First 拿到量就停上游，
# 命令被中断、$LASTEXITCODE 变成非零 —— 一次成功的验签会被判成失败（真踩过）。
# 所以先把整份输出收进变量，再看退出码，最后才挑要显示的两行。
$signer = & "$BuildTools\apksigner.bat" verify --print-certs $apk 2>&1
$signerCode = $LASTEXITCODE
$signer | Select-Object -First 2 | ForEach-Object { Write-Host "  $_" }
if ($signerCode -ne 0) { Write-Host "✗ apksigner 验签失败 —— 这个包装不上"; exit 1 }
Write-Host "  ✓ 签名有效"
Write-Host "  $labelLine"

# ---- 5) 放到一个固定的、好找的位置 ----
$outDir = "dist"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$dest = "$outDir/yuanqi-ledger-$version.apk"
Copy-Item $apk $dest -Force
Write-Host ""
Write-Host "✓ APK：$((Resolve-Path $dest).Path)"
Write-Host "  大小 $([math]::Round((Get-Item $dest).Length / 1MB, 2)) MB"
Write-Host "  装到手机：adb install -r `"$dest`""
