@echo off
REM 察元一键构建发布(Windows 双击或命令行)。参数透传给 release.mjs。
node "%~dp0release.mjs" %*
pause
