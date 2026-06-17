#!/usr/bin/env bash
# 打包 chayuan-server sidecar,**打包前先体检 torch**,杜绝「半套 torch 打进 bundle
# → 装机 import torch 加载 libtorch_global_deps.dylib 失败 → 服务起不来」。
#
#   full(默认):要 torch(克隆音色 voxcpm / 数字人 / full 内置 chat)。
#                torch 半套或缺 -> 自动重装完整版再打;装不全则中止(绝不打残包)。
#   --lite     :不打 torch(音色试听 piper/edge/sherpa 都不需要;chat 改运行时下载)。
#
# 用法:
#   bash scripts/build-sidecar.sh                       # full(带 torch)
#   bash scripts/build-sidecar.sh --lite                # lite(不带 torch)
#   FORCE_TORCH_REINSTALL=1 bash scripts/build-sidecar.sh   # 强制重装 torch 再打
set -u

cd "$(cd "$(dirname "$0")/.." && pwd)"   # 仓库根
LITE=""
[ "${1:-}" = "--lite" ] && LITE="--lite"

torch_state() {
  # 输出 COMPLETE / HALF / MISSING
  poetry run python - <<'PY' 2>/dev/null
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
  if [ "$(uname -s)" = "Darwin" ]; then
    src=""   # macOS(arm64/x86)默认 PyPI 就是对的 wheel,**不要**用 /whl/cpu(没 mac arm64)
  else
    src="--index-url https://download.pytorch.org/whl/cpu"
  fi
  echo "   -> 装完整 CPU torch ($([ -n "$src" ] && echo "$src" || echo "默认 PyPI"))..."
  poetry run pip install --force-reinstall --no-cache-dir torch torchvision torchaudio $src
}

if [ -z "$LITE" ]; then
  echo "== full 构建:体检 torch =="
  st="$(torch_state)"; echo "   torch 状态: ${st:-未知}"
  if [ "$st" != "COMPLETE" ] || [ "${FORCE_TORCH_REINSTALL:-0}" = "1" ]; then
    echo "   ($st / 或强制) -> 重装 torch"
    reinstall_torch
    st="$(torch_state)"; echo "   重装后 torch 状态: ${st:-未知}"
    if [ "$st" != "COMPLETE" ]; then
      echo "[FAIL] torch 仍非 COMPLETE。**别 full 打包**(会出起不来的残包)。"
      echo "       要么继续修 torch,要么改用:  bash scripts/build-sidecar.sh --lite"
      exit 1
    fi
  fi
  echo "   torch COMPLETE [OK]"
else
  echo "== lite 构建:跳过 torch(piper/edge/sherpa 不需要;chat 运行时下载)=="
fi

echo "== 运行: poetry run python packaging/pyinstaller/build.py $LITE --offline =="
poetry run python packaging/pyinstaller/build.py $LITE --offline
rc=$?
if [ "$rc" != "0" ]; then
  echo "[FAIL] build.py 退出码 $rc,看上方报错。"
  exit "$rc"
fi
echo
echo "== 构建完成。下一步:用新产物替换/重装 App -> **完全退出再重开** -> 验证 =="
echo "   ./scripts/check-tts.sh        # 先看版本是否 >=2.0.114,再看四档"
