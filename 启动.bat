@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   元气账本 —— 本地预览
echo   ---------------------------------
echo   首次运行会先装依赖，可能要几分钟
echo.
if not exist node_modules (
  echo [1/2] 安装依赖...
  call npm install
  if errorlevel 1 (
    echo 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)
echo [2/2] 启动开发服务器...
echo.
echo   打开浏览器访问 http://localhost:3000
echo   按 Ctrl+C 可停止
echo.
call npm run dev
pause
