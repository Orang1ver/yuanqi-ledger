# 元气账本 · 安卓 SDK 安装脚本（一律装到 D 盘）
#
# 为什么不用 sdkmanager：**直连 dl.google.com 是不通的**（2026-09-19 实测本机没有代理，
# 20 秒超时；`sdkmanager` 的仓库索引也在那个域名上）。所以改成从国内镜像**手工铺目录** ——
# sdkmanager 干的事本来也就是把 zip 解开放到这几个位置。既然不用它，
# **cmdline-tools 这个 136MB 的包整个不需要**（它只有 sdkmanager/avdmanager）。
#
# 镜像上**没有** build-tools 35（只有 r33 / r34），这一条决定了整个版本组合：
#   AGP 8.7+ 硬性要求 build-tools 35.0.0 ⇒ 只能用 AGP 8.6.x（它要求 34.0.0）
#   compileSdk 35 需要 AGP ≥ 8.6 ⇒ 正好卡在 AGP 8.6.1 + build-tools 34.0.0 + platform 35
#   AGP 8.6 需要 Gradle ≥ 8.7 ⇒ 用镜像上的 Gradle 8.11.1
# 换版本之前先把这张表对一遍，否则会撞到「SDK Build Tools revision is too low」。
#
# ⚠️ 这个文件必须存成 **UTF-8 with BOM**。无 BOM 时 Windows PowerShell 会按 ANSI 解码，
# 中文注释里的字节会把换行吃掉（实测 69 行被读成 60 行），于是括号配对错位、
# 报一个指不到真因的 `Unexpected token ')'`。改完记得确认前三字节是 EF BB BF。
#
# 用法：powershell -ExecutionPolicy Bypass -File scripts/android/setup-sdk.ps1

$Sdk = "D:\Android\Sdk"
$Dl = "D:\Android\dl"
$Mirror = "https://mirrors.cloud.tencent.com/AndroidSDK"

New-Item -ItemType Directory -Force -Path $Sdk, $Dl | Out-Null

# ⚠️ 腾讯那个镜像是 Nexus，行为很不老实：
#   1) **HEAD 会撒谎** —— 报 200 还带 Content-Length，GET 却给 404 的 HTML；
#   2) 同一个地址**时好时坏**，实测连续 5 次全拿到 1497 字节的错误页。
# 所以不能相信状态码，必须**验 ZIP 魔数**；而且普通 GET 拿不到时，
# 换 `Range: bytes=0-` 再试一次 —— 实测那条路走的是另一套处理，经常能通。
function Test-ZipFile($path) {
  if (-not (Test-Path $path)) { return $false }
  if ((Get-Item $path).Length -lt 1MB) { return $false }
  $fs = [System.IO.File]::OpenRead($path)
  $magic = New-Object byte[] 2
  $fs.Read($magic, 0, 2) | Out-Null
  $fs.Close()
  return ($magic[0] -eq 0x50 -and $magic[1] -eq 0x4B)
}

function Get-ZipFile($url, $dest) {
  for ($i = 1; $i -le 6; $i++) {
    curl.exe -L --retry 2 --retry-delay 2 --silent --show-error -o $dest $url
    if (Test-ZipFile $dest) { Write-Host "  ✓ $([math]::Round((Get-Item $dest).Length / 1MB, 1)) MB"; return }
    Write-Host "  第 $i 次：普通 GET 不是 zip（$((Get-Item $dest -ErrorAction SilentlyContinue).Length) 字节），换 Range 再试"
    curl.exe -L --retry 2 --retry-delay 2 --silent --show-error -r 0- -o $dest $url
    if (Test-ZipFile $dest) { Write-Host "  ✓ $([math]::Round((Get-Item $dest).Length / 1MB, 1)) MB（走的 Range）"; return }
    Write-Host "  第 $i 次：Range 也不是 zip，整轮重来"
  }
  throw "重试 6 轮仍拿不到有效的 zip：$url"
}

# 每个包：镜像上的文件名 → SDK 里的落点（sdkmanager 的包名换成目录名）
$packages = @(
  @{ zip = "platform-35_r02.zip";               dir = "$Sdk\platforms\android-35"; probe = "android.jar" },
  # ⚠️ build-tools 的 zip 里那层目录名是老的代号（r34 → android-14），不是 34.0.0，
  # 所以必须 --strip-components=1 解到我们自己建的 34.0.0 里，不能直接就地解压
  @{ zip = "build-tools_r34-windows.zip";       dir = "$Sdk\build-tools\34.0.0";   probe = "aapt2.exe" },
  @{ zip = "platform-tools-latest-windows.zip"; dir = "$Sdk\platform-tools";       probe = "adb.exe" }
)

foreach ($p in $packages) {
  $zipPath = Join-Path $Dl $p.zip
  if (Test-Path (Join-Path $p.dir $p.probe)) { Write-Host "· 已有，跳过 $($p.dir)"; continue }
  Write-Host "↓ $($p.zip)"
  Get-ZipFile "$Mirror/$($p.zip)" $zipPath
  New-Item -ItemType Directory -Force -Path $p.dir | Out-Null
  tar.exe -xf $zipPath -C $p.dir --strip-components=1
  if ($LASTEXITCODE -ne 0) { throw "解压失败：$($p.zip)" }
  if (-not (Test-Path (Join-Path $p.dir $p.probe))) { throw "铺完之后还是找不到 $($p.probe)：$($p.dir)" }
  Write-Host "✓ $($p.dir -replace [regex]::Escape($Sdk), '')"
}

# AGP 会检查这个文件；没有它就报 "Failed to install the following SDK components"
# 让人误以为是缺包，其实是缺许可
$licenseDir = "$Sdk\licenses"
New-Item -ItemType Directory -Force -Path $licenseDir | Out-Null
$licenseFile = Join-Path $licenseDir "android-sdk-license"
if (-not (Test-Path $licenseFile)) {
  @(
    "8933bad161af4178b1185d1a37fbf41ea5269c55",
    "d56f5187479451eabf01fb78af6dfcb131a6481e",
    "24333f8a63b6825ea9c5514f83c2829b004d1fee"
  ) -join "`n" | Set-Content -Path $licenseFile -NoNewline -Encoding ascii
  Write-Host "✓ licenses\android-sdk-license"
}

Write-Host ""
Write-Host "sdk.dir = $Sdk（写进 android/local.properties）"
Get-ChildItem "$Sdk\build-tools" -Directory | ForEach-Object { Write-Host "build-tools: $($_.Name)" }
Get-ChildItem "$Sdk\platforms" -Directory | ForEach-Object { Write-Host "platforms:   $($_.Name)" }
