#!/usr/bin/env bash
# 打包 chayuan-server sidecar,**打包前先体检 torch**,杜绝「半套 torch 打进 bundle
# → 装机 import torch 加载 libtorch_global_deps.dylib 失败 → 服务起不来」。
#
#   full(默认):要 torch(克隆音色 voxcpm / 数字人 / full 内置 chat)。
#                torch 半套或缺 -> 自动重装完整版再打;装不全则中止(绝不打残包)。
#   --lite     :不打 torch(音色试听 piper/edge/sherpa 都不需要;chat 改运行时下载)。
#
# 用哪个 python:默认用**当前激活**的 python(你现在是 conda py312)。要换:
#   CHAYUAN_PY="poetry run python" bash scripts/build-sidecar.sh
#
# 用法:
#   bash scripts/build-sidecar.sh                       # full(带 torch)
#   bash scripts/build-sidecar.sh --lite                # lite(不带 torch)
#   bash scripts/build-sidecar.sh --lite --install      # 构建后自动替进 /Applications/Chayuan.app
#   FORCE_TORCH_REINSTALL=1 bash scripts/build-sidecar.sh
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_PY="$REPO/chayuan-server/packaging/pyinstaller/build.py"
PY="${CHAYUAN_PY:-python}"          # 当前激活的 python;可 CHAYUAN_PY 覆盖
LITE=""; INSTALL=""
for _a in "$@"; do
  case "$_a" in
    --lite) LITE="--lite" ;;
    --install) INSTALL=1 ;;
    *) echo "[WARN] 未知参数: $_a (支持 --lite / --install)" ;;
  esac
done

if [ ! -f "$BUILD_PY" ]; then
  echo "[FAIL] 找不到 $BUILD_PY —— 在仓库根目录跑本脚本。"; exit 1
fi
echo "== 用 python: $PY ($($PY -c 'import sys;print(sys.version.split()[0])' 2>/dev/null || echo '?'))"
if ! $PY -c 'import PyInstaller' >/dev/null 2>&1; then
  echo "[FAIL] 这个 python 里没装 PyInstaller(构建依赖不全)。确认你在能跑 server 的那个 env(py312),"
  echo "       或 CHAYUAN_PY=... 指定正确 python。"; exit 1
fi

torch_state() {
  $PY - <<'PY' 2>/dev/null
import os, sys
try:
    import torch
except Exception:
    print("MISSING"); sys.exit(0)
p = os.path.join(os.path.dirname(torch.__file__), "lib", "libtorch_global_deps.dylib")
print("COMPLETE" if os.path.exists(p) else "HALF")
PY
}

reinstall_torch() {
  # 克隆框架(voxcpm)安装常把 torch 搞成半套/重复条目 —— 仅 --force-reinstall 清不掉
  # 残留。先彻底卸(两遍清重复),再干净装一套配套的 torch/vision/audio。
  echo "   -> 先彻底卸残破 torch(清半套/重复条目)..."
  $PY -m pip uninstall -y torch torchvision torchaudio >/dev/null 2>&1 || true
  $PY -m pip uninstall -y torch torchvision torchaudio >/dev/null 2>&1 || true
  if [ "$(uname -s)" = "Darwin" ]; then src=""    # macOS 默认 PyPI 才有 arm64 wheel
  else src="--index-url https://download.pytorch.org/whl/cpu"; fi
  echo "   -> 干净装完整 torch ($([ -n "$src" ] && echo "$src" || echo "默认 PyPI"))..."
  $PY -m pip install --no-cache-dir torch torchvision torchaudio $src
}

if [ -z "$LITE" ]; then
  echo "== full 构建:体检 torch =="
  st="$(torch_state)"; echo "   torch 状态: ${st:-读取失败}"
  if [ "$st" != "COMPLETE" ] || [ "${FORCE_TORCH_REINSTALL:-0}" = "1" ]; then
    echo "   ($st / 或强制) -> 重装 torch"
    reinstall_torch
    st="$(torch_state)"; echo "   重装后 torch 状态: ${st:-读取失败}"
    if [ "$st" != "COMPLETE" ]; then
      echo "[FAIL] torch 仍非 COMPLETE。**别 full 打包**(会出起不来的残包)。"
      echo "       继续修 torch,或改用:  bash scripts/build-sidecar.sh --lite"
      exit 1
    fi
  fi
  echo "   torch COMPLETE [OK]"
else
  echo "== lite 构建:跳过 torch(piper/edge/sherpa 不需要;chat 运行时下载)=="
fi

echo "== 运行: $PY $BUILD_PY $LITE --offline =="
$PY "$BUILD_PY" $LITE --offline
rc=$?
[ "$rc" != "0" ] && { echo "[FAIL] build.py 退出码 $rc,看上方报错。"; exit "$rc"; }
echo "== 构建完成。 =="

if [ -n "$INSTALL" ]; then
  APP="${CHAYUAN_APP:-/Applications/Chayuan.app}"
  SRC="$REPO/chayuan-server/dist/chayuan-server"
  DST="$APP/Contents/Resources/chayuan-server"
  echo "== --install: 把新 sidecar 替进 $APP =="
  [ -d "$SRC" ] || { echo "[FAIL] 没找到构建产物 $SRC"; exit 1; }
  [ -d "$APP" ] || { echo "[FAIL] 没找到已安装 App $APP(用 CHAYUAN_APP=/path/to/X.app 指定)"; exit 1; }
  echo "   退出 App + 杀旧 sidecar(免占文件/端口)..."
  osascript -e 'tell application "Chayuan" to quit' >/dev/null 2>&1 || true
  pkill -f 'Chayuan.app/Contents/Resources/chayuan-server/chayuan-server' 2>/dev/null || true
  sleep 1
  echo "   rsync 替换 $DST ..."
  mkdir -p "$DST"
  rsync -a --delete "$SRC"/ "$DST"/ || { echo "[FAIL] rsync 失败"; exit 1; }
  echo "   ad-hoc 重签名(改过内容签名会失效,否则 macOS 可能拒启)..."
  codesign --force --deep --sign - "$APP" >/dev/null 2>&1     && echo "   [OK] 已签"     || echo "   [WARN] codesign 失败 —— 首次打开右键->打开 绕过 Gatekeeper 即可。"
  echo "[OK] sidecar 已替进 App。重开 Chayuan 即用新后端。"
  echo "   ⚠ 只换了 **sidecar/后端**;前端(data: URL 等 UI 修复)要整包重建(tauri build)才有。"
fi

echo
echo "== 验证:重开 App 后 ->  ./scripts/check-tts.sh"
