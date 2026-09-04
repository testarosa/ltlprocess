@echo off
setlocal
set "APP_ROOT=%~dp0\..\.."
cd /d "%APP_ROOT%"

if not exist ".env" (
  echo Missing production environment file: %APP_ROOT%\.env
  exit /b 1
)

"C:\Program Files\nodejs\node.exe" "apps\backend\dist\index.js"
exit /b %errorlevel%
