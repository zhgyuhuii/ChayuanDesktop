#!/usr/bin/env bash
# 测试**已安装**的察元本地语音合成服务(免重建,现在就能跑)。
# 逐档打 /preview-audio,靠响应头 X-Tts-Provider 识破"单档失败静默回退 piper":
#   请求 piper 回 piper = 正常;请求 sherpa 却回 piper = sherpa 坏了。
#
# 用法:
#   bash scripts/diagnose-tts.sh                 # 默认 http://127.0.0.1:62581
#   bash scripts/diagnose-tts.sh http://127.0.0.1:62581
#   CHAYUAN_API=http://127.0.0.1:62581 bash scripts/diagnose-tts.sh
#
# 只用 curl,macOS(bash 3.2)/Linux 都能跑。要看每档失败的**根因**(import/模型/
# torch/worker),用安装包内的 `chayuan diagnose-tts`(frozen 环境逐档隔离测)。
set -u

BASE="${1:-${CHAYUAN_API:-http://127.0.0.1:62581}}"
BASE="${BASE%/}"
TEXT="你好，这是语音合成测试。"
OUT="${TMPDIR:-/tmp}"; OUT="${OUT%/}/chayuan-tts-probe"
mkdir -p "$OUT"

echo
echo "===== 察元本地语音合成自检 @ $BASE ====="

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/healthz" 2>/dev/null || echo 000)
if [ "$code" != "200" ]; then
  echo "[FAIL] /healthz=$code -- 服务没起/端口不对?确认安装版 sidecar 在跑,"
  echo "       或显式传地址: bash $0 http://127.0.0.1:62581"
  exit 1
fi
echo "/healthz: 200  (服务在跑)"

probe() {
  provider="$1"; voice="$2"
  # voice_name 是必填 string,后端用 `body.voice_name or None` 把空串当默认音色;
  # 传 null 会被 pydantic 422 拒(string_type)。无音色时一律传空串。
  body="{\"video_script\":\"$TEXT\",\"voice_provider\":\"$provider\",\"voice_name\":\"$voice\",\"voice_rate\":1.0,\"voice_volume\":1.0}"
  hdr="$OUT/$provider.h"; wav="$OUT/$provider.wav"
  code=$(curl -s -D "$hdr" -o "$wav" -w '%{http_code}' --max-time 120 \
         -H 'Content-Type: application/json' -X POST \
         --data "$body" "$BASE/api/v1/video-generation/preview-audio" 2>/dev/null || echo 000)
  used=$(grep -i '^X-Tts-Provider:' "$hdr" 2>/dev/null | tr -d '\r' | awk '{print $2}')
  dur=$(grep -i '^X-Audio-Duration-Ms:' "$hdr" 2>/dev/null | tr -d '\r' | awk '{print $2}')
  echo
  echo "-- $provider --"
  if [ "$code" = "200" ]; then
    sz=$(wc -c < "$wav" | tr -d ' ')
    if [ "$used" = "$provider" ]; then
      echo "  [OK]   出声引擎=$used dur=${dur}ms wav=$((sz/1024))KB  -> $wav"
    else
      echo "  [FAIL] 请求 $provider 却由 [$used] 出声 -- $provider 坏了、被静默回退 piper。"
      echo "         根因看: chayuan diagnose-tts   音频: $wav"
    fi
  elif [ "$code" = "401" ]; then
    echo "  [AUTH] 401 需鉴权 -- 单机版应是 anonymous;确认 profile/CHAYUAN_AUTH"
  else
    echo "  [FAIL] HTTP $code"
    echo "  detail: $(head -c 500 "$wav" 2>/dev/null)"
  fi
}

probe piper  ""
probe edge   "zh-CN-XiaoxiaoNeural"
probe sherpa ""
probe clone  ""

echo
echo "说明:'请求 X 却由 piper 出声' = X 坏了被静默回退;200+出声 != 该音色 OK。"
echo "音频已存到 $OUT/  (macOS 可直接听:  afplay $OUT/sherpa.wav )"
echo "================================================"
