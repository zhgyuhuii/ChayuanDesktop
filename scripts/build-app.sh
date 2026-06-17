#!/usr/bin/env bash
# 端到端:全量构建桌面 App(前端 + sidecar)-> 自动装到 /Applications。
# 这才是真·一把梭。对比:build-sidecar.sh --install 只换**后端 sidecar**;前端修复
# (data: URL 试听播放、NotSupportedError 等)是 Tauri 内嵌 JS,**必须**走这个全量构建。
#
# 用法:
#   bash scripts/build-app.sh                 # 集成版(内置模型;full=带 torch,需 torch 完整)
#   bash scripts/build-app.sh --lite          # 轻量版(不嵌模型/不带 torch)= 最快最稳,够 piper/edge/sherpa
#   CHAYUAN_APP=/path/to/X.app bash scripts/build-app.sh   # 指定要替换的 .app
#
# ⚠ 全量构建很重(sidecar + 前端 vite + Tauri 打 DMG),几分钟~十几分钟。
# ⚠ full 若 torch 半套会失败 —— 要么先 `bash scripts/build-sidecar.sh`(它会修 torch),
#   要么直接用 --lite。
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"; cd "$REPO"
APP="${CHAYUAN_APP:-/Applications/Chayuan.app}"

if [ "${1:-}" = "--lite" ]; then FLAVOR="--lite-only"; DISTDIR="$REPO/dist-lite"
else FLAVOR="--integrated-only"; DISTDIR="$REPO/dist-integrated"; fi

[ -f "$REPO/build-desktop.sh" ] || { echo "[FAIL] 没找到 build-desktop.sh,在仓库根跑本脚本"; exit 1; }

echo "== 全量构建 ($FLAVOR) —— 重,耐心等(前端+sidecar+DMG)=="
bash "$REPO/build-desktop.sh" "$FLAVOR" || {
  echo "[FAIL] build-desktop.sh 失败(看上方)。torch 半套会卡 full -> 先 build-sidecar.sh 修,或用 --lite。"; exit 1; }

DMG="$(ls -t "$DISTDIR"/*.dmg 2>/dev/null | head -1)"
[ -n "$DMG" ] || { echo "[FAIL] $DISTDIR 下没找到 .dmg —— 构建可能没出包,看上方日志。"; exit 1; }

echo "== 自动装到 $APP(源: $(basename "$DMG"))=="
osascript -e 'tell application "Chayuan" to quit' >/dev/null 2>&1 || true
pkill -f 'Chayuan.app/Contents/Resources/chayuan-server/chayuan-server' 2>/dev/null || true
sleep 1

MNT="/tmp/cy_dmg.$$"
hdiutil attach "$DMG" -nobrowse -mountpoint "$MNT" >/dev/null || { echo "[FAIL] 挂载 DMG 失败"; exit 1; }
SRC="$(ls -d "$MNT"/*.app 2>/dev/null | head -1)"
if [ -z "$SRC" ]; then echo "[FAIL] DMG 内没有 .app"; hdiutil detach "$MNT" >/dev/null 2>&1 || true; exit 1; fi
rm -rf "$APP" && cp -R "$SRC" "$APP" || { echo "[FAIL] 拷贝 .app 失败"; hdiutil detach "$MNT" >/dev/null 2>&1 || true; exit 1; }
hdiutil detach "$MNT" >/dev/null 2>&1 || true

echo "   ad-hoc 重签名..."
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 \
  && echo "   [OK] 已签" || echo "   [WARN] codesign 失败 -> 首次打开右键->打开。"

echo "[OK] 已装新 App 到 $APP。重开 Chayuan:前端(试听能播,无 NotSupportedError)+ 后端(espeak 等)全是最新。"
echo "   验证:UI 点四档试听能播;或 $APP/Contents/Resources/chayuan-server/chayuan-server diagnose-tts"
