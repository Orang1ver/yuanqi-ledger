@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   元气账本 —— 一键发布到 GitHub Pages
echo   ----------------------------------------
echo   会依次做：校验版本 → 构建 → 注入 SW 版本号 → 推送 → 打 tag
echo.
echo   [提示] 如果卡在 Could not resolve host: github.com
echo          请先打开 Steam++（Watt Toolkit），再重跑本脚本。
echo.
pause
node scripts/deploy.mjs
echo.
pause
