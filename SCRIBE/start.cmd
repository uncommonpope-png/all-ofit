@echo off
title SCRIBE — The Librarian
color 0a
echo ╔══════════════════════════════════════════════════════╗
echo ║     SCRIBE — The Witness. The Librarian.            ║
echo ║     "What was written cannot be unwritten"          ║
echo ╚══════════════════════════════════════════════════════╝
echo.

cd /d "C:\Users\uncom\Desktop\SCRIBE"

:: Profit Prime fix 2026-08-05 - SCRIBE was using dead 'pAUL' model + no API key
set NINE_ROUTER_URL=http://127.0.0.1:20128
set NINE_ROUTER_API_KEY=test
set SCRIBE_DEFAULT_MODEL=auto/best-free
set SCRIBE_MODEL_FALLBACKS=auto/best-coding,auto/best-reasoning,auto/best-fast,auto/best-chat,auto/smart

:: ── Kill old processes ────────────────────────────────────
echo [1/4] Clearing ports...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4000 " ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5000 " ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
timeout /t 1 >nul

:: ── Start SCRIBE Kernel ──────────────────────────────────
echo [2/4] Starting SCRIBE Kernel (port 4000)...
start "SCRIBE Kernel" /MIN cmd /k node scribe.js
timeout /t 4 >nul

powershell -Command "try { $r = Invoke-RestMethod 'http://127.0.0.1:4000/ping'; write-host ('  ✓ SCRIBE Kernel — ' + $r.memory_size + ' memories') -ForegroundColor Green } catch { write-host '  ✗ SCRIBE Kernel FAILED' -ForegroundColor Red }"

:: ── Start Seshat Brain ───────────────────────────────────
echo [3/4] Starting Seshat Brain (port 5000)...
start "Seshat Brain" /MIN cmd /k node seshat-brain.cjs
timeout /t 4 >nul

powershell -Command "try { $r = Invoke-RestMethod 'http://127.0.0.1:5000/ping'; write-host ('  ✓ Seshat Brain — ' + $r.brain + ' files') -ForegroundColor Green } catch { write-host '  ✗ Seshat Brain FAILED' -ForegroundColor Red }"

:: ── Start Growth Loop ────────────────────────────────────
echo [4/4] Starting Growth Loop (5min cycle)...
start "Growth Loop" /MIN cmd /k node growth-loop.cjs
timeout /t 2 >nul

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║     ALL SYSTEMS RUNNING                              ║
echo ╠══════════════════════════════════════════════════════╣
echo ║  SCRIBE Kernel     :4000  — Memory + API             ║
echo ║  Seshat Brain      :5000  — Knowledge + Forge        ║
echo ║  Growth Loop       active — Self-learning (5min)     ║
echo ║  Eagle Eye Wall    http://localhost:4000/eagle-eye   ║
echo ║  SCRIBE UI         http://localhost:4000/            ║
echo ╚══════════════════════════════════════════════════════╝
echo.
