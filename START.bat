@echo off
title Gold Signal Pro
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] Node.js wurde nicht gefunden.
  echo     Bitte Node.js LTS installieren: https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installiere Abhaengigkeiten ^(einmalig^)...
  call npm install
  if errorlevel 1 (
    echo [!] npm install fehlgeschlagen.
    pause
    exit /b 1
  )
)

echo.
echo Starte Gold Signal Pro auf http://localhost:5173
echo (App + Capital.com-Proxy. Proxy nur aktiv, wenn server\.env existiert.)
echo Zum Beenden dieses Fenster schliessen oder STRG+C druecken.
echo.
start "" http://localhost:5173
call npm run dev:all
