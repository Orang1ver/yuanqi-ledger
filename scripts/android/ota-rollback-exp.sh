#!/usr/bin/env bash
# 元气账本 · OTA 回滚保险的对照实验（一臂一跑）
#
# 为什么需要它：回滚保险在外部观察上**和"基址本来就没持久化成功"完全同形** ——
# 冷启动退回旧版，既可能是保险执行了，也可能是基址压根没写进去。
# 要区分开，必须让「坏基址确实持久化了」成为**已知条件**，再只改一个变量（标记文件）。
#
# 用法：bash scripts/android/ota-rollback-exp.sh <臂>
#   0 = 只读基线（不动任何状态）
#   A = 对照臂：坏基址已持久化、**无** .pending（预期：保险早退，什么都不发生）
#   B = 处理臂：坏基址 + .pending=1.3.2（预期：回滚到 ota/1.3.2、坏目录改名 .tmp）
#   C = 处理臂：坏基址 + .pending=0.0.0（预期：无可回退版本 → 基址置空 → 打包资源）
#   R = 还原：基址恢复 ota/1.3.2，清掉实验造的目录与标记
#
# 前置：手机连着、装着 **debuggable** 的包（否则 run-as 读不到应用私有目录）。
#   出一个可调试包的办法见 docs/HANDOFF-OTA-UPDATE.md 的「回滚保险」一节。
# ⚠️ 它会改写 SharedPreferences 与应用私有目录，**只在实验/排障时用**，别在用户机器上跑。
#
# 两个踩出来的前提，改这个脚本时别踩回去：
#  1) 写 SharedPreferences 必须**连 lastBinaryVersionName/Code 一起写**。
#     Capacitor 的 Bridge.isNewBinary() 一旦发现 APK 版本变了，就会把 serverBasePath
#     清成空串、并在本次启动跳过持久化基址 —— 不写这两个键，观察到的变化就分不清是谁干的。
#  2) 造文件内容一律走 base64。直接 printf 带 '<' 的内容，内层单引号会被外层双引号吃掉，
#     远端 shell 把 '<' 当重定向 → "syntax error: unexpected '<'"，文件根本没造出来。
set -u

ADB="${ADB:-adb}"
PKG="${PKG:-com.orang1ver.yuanqiledger}"
ACT="$PKG/.MainActivity"
DATA="/data/user/0/$PKG"
OUT_DIR="${OTA_EXP_OUT:-dist}"
ARM="${1:-}"

if [ -z "$ARM" ]; then echo "用法: $0 0|A|B|C|R"; exit 2; fi

sh_run() { "$ADB" shell "run-as $PKG sh -c '$1'"; }
shot()   { "$ADB" exec-out screencap -p > "$1" 2>/dev/null && echo "  截图: $1 ($(wc -c < "$1") 字节)"; }

# put <相对路径> <内容>：内容走 base64，避开所有引号与特殊字符
put() {
  local rel="$1" content="$2" dir b64
  dir=$(dirname "$rel")
  [ "$dir" != "." ] && sh_run "mkdir -p $dir"
  b64=$(printf '%s' "$content" | base64 -w0)
  "$ADB" shell "run-as $PKG sh -c 'printf %s $b64 | base64 -d > $rel'"
}

PKGINFO=$("$ADB" shell dumpsys package "$PKG" 2>/dev/null)
VN=$(printf '%s' "$PKGINFO" | grep -m1 -o "versionName=[^ ]*" | cut -d= -f2)
VC=$(printf '%s' "$PKGINFO" | grep -m1 -o "versionCode=[0-9]*" | cut -d= -f2)

show_state() {
  echo "  基址: $(sh_run "cat shared_prefs/CapWebViewSettings.xml" | grep -o 'serverBasePath">[^<]*' | cut -d'>' -f2)"
  echo "  .pending: [$(sh_run "cat files/ota/.pending" 2>/dev/null)]"
  echo "  ota 目录: $(sh_run "ls files/ota" | tr '\n' ' ')"
}

mkdir -p "$OUT_DIR"
echo "################ 臂 $ARM ################   (包内版本 $VN / code $VC)"

case "$ARM" in
  0)
    echo "--- 基线（只读） ---"
    sh_run "cat shared_prefs/CapWebViewSettings.xml" | sed 's/^/  /'
    sh_run "ls -la files/ota" | sed 's/^/  /'
    exit 0
    ;;
  R)
    echo "--- 还原 ---"
    "$ADB" shell am force-stop "$PKG"
    sh_run "rm -rf files/ota/9.9.9 files/ota/9.9.9.tmp files/ota/.pending"
    put "shared_prefs/CapWebViewSettings.xml" "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name=\"serverBasePath\">$DATA/files/ota/1.3.2</string>
    <string name=\"lastBinaryVersionName\">$VN</string>
    <string name=\"lastBinaryVersionCode\">$VC</string>
</map>
"
    "$ADB" shell am start -n "$ACT" >/dev/null; sleep 6
    show_state
    exit 0
    ;;
esac

echo "--- 0) 停进程、清日志 ---"
"$ADB" shell am force-stop "$PKG"
"$ADB" logcat -c

echo "--- 1) 造状态 ---"
sh_run "rm -rf files/ota/9.9.9 files/ota/9.9.9.tmp files/ota/.pending"
# 「坏版本」目录：有 index.html 才算一个完整的版本目录，白屏才像真实的失败现场
put "files/ota/9.9.9/index.html" '<!doctype html><meta charset=utf-8><h1>BROKEN 9.9.9</h1>'
# 坏基址持久化成功（连版本键一起写，避免 isNewBinary() 把基址清掉干扰观察）
put "shared_prefs/CapWebViewSettings.xml" "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name=\"serverBasePath\">$DATA/files/ota/9.9.9</string>
    <string name=\"lastBinaryVersionName\">$VN</string>
    <string name=\"lastBinaryVersionCode\">$VC</string>
</map>
"

case "$ARM" in
  A) echo "  [A 对照] 不放 .pending" ;;
  B) put "files/ota/.pending" "1.3.2"; echo "  [B 处理] .pending = 1.3.2" ;;
  C) put "files/ota/.pending" "0.0.0"; echo "  [C 处理] .pending = 0.0.0（不存在的版本）" ;;
  *) echo "未知臂: $ARM"; exit 2 ;;
esac

echo "  --- 启动前 ---"; show_state

echo "--- 2) 冷启动 ---"
"$ADB" shell am start -n "$ACT" >/dev/null
sleep 8

echo "--- 3) 证据（三重，互相独立） ---"
echo "[证据1] logcat 标签 YuanqiOta —— 只有 Java 侧会打，是决定性的"
"$ADB" logcat -d -v brief 2>/dev/null | grep "YuanqiOta" | tail -6 | sed 's/^/  /'
echo "  (以上为空 = 保险没执行任何动作)"
echo "[证据2] 启动后的持久化基址"
show_state
echo "[证据3] files/ota 目录实况 —— 坏目录改名 .tmp 只有 Java 侧会做"
sh_run "ls -la files/ota" | sed 's/^/  /'
echo "[证据4] 前台 Activity"
"$ADB" shell dumpsys activity activities 2>/dev/null | grep -m1 "ResumedActivity" | sed 's/^/  /'
shot "$OUT_DIR/ota-exp-$ARM.png"
echo ""
