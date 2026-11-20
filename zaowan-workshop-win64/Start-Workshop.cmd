@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "runtime\node.exe" (
  echo 缺少随包 Node 运行时：runtime\node.exe
  pause
  exit /b 1
)
set "ZAOWAN_OPEN=1"
echo 正在启动造玩工坊工作台，浏览器会自动打开；关闭本窗口即停止服务。
"%~dp0runtime\node.exe" apps\server\dist\server.mjs
pause