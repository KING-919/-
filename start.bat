@echo off
chcp 65001 >nul
cd /d "%~dp0"
title NOVA Agent

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [خطأ] Node.js غير مثبت. حمّله من https://nodejs.org ثم أعد المحاولة.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\express" (
  echo.
  echo [1/2] تثبيت الاعتماديات لأول مرة...
  call npm install
  if errorlevel 1 (
    echo.
    echo [خطأ] فشل تثبيت الاعتماديات. تحقق من اتصال الإنترنت.
    pause
    exit /b 1
  )
)

if not defined PORT set PORT=3456

echo.
echo [2/2] تشغيل NOVA على http://localhost:%PORT%
echo      اختر مزوّد API من الإعدادات، مثل LM Studio على المنفذ 1234.
echo      أغلق هذه النافذة لإيقاف الخادم.
echo.

start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:%PORT%'"
node server.js

echo.
echo توقف الخادم.
pause
