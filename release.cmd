@echo off
REM One-click release wrapper (ASCII-only; reuses build-desktop for env/dep checks).
REM Usage:
REM   release.cmd                  bump version + offline pkg (standard) + publisher + installer
REM   release.cmd --tier lite      lite|standard|pro
REM   release.cmd --set 2.0.5      set explicit version
REM   release.cmd --offline-only   only offline package
REM   release.cmd --clients-only   only publisher + installer
REM   release.cmd --version-only   only write version numbers
setlocal
cd /d "%~dp0"
chcp 65001 >NUL 2>&1

set "NODE_EXE="
where node.exe >NUL 2>&1 && set "NODE_EXE=node.exe"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE (
  echo [FAIL] node not found on PATH. Install Node.js 18+ first.
  pause
  exit /b 127
)

"%NODE_EXE%" "%~dp0release.mjs" %*
set ERR=%ERRORLEVEL%
if %ERR% NEQ 0 (
  echo.
  echo [FAIL] release failed with exit code %ERR%
  pause
)
exit /b %ERR%
