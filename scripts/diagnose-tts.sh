#!/usr/bin/env bash
# 测试**已安装/正在运行**的察元本地语音合成服务(免重建)。逐档打 /preview-audio:
#   - 自动清旧结果(避免读到上次的陈旧响应误判)
#   - 靠响应头 X-Tts-Provider 识破"单档失败静默回退 piper"
#   - 请求无响应(连接重置/超时)时复检 /healthz,判断是不是这档把服务搞挂了
#
# 用法:
#   bash scripts/diagnose-tts.sh                 # 默认 http://127.0.0.1:62581
#   bash scripts/diagnose-tts.sh http://127.0.0.1:62581
#
# 要每档失败的根因(import/模型/torch/worker),用安装包内 `chayuan diagnose-tts`,
# 或前台看日志的 `bash scripts/run-tts-debug.sh`。
set -u

BASE="${1:-${CHAYUAN_API:-http://127.0.0.1:62581}}"; BASE="${BASE%/}"
TEXT="你好，这是语音合成测试。"
OUT="${TMPDIR:-/tmp}"; OUT="${OUT%/}/chayuan-tts-probe"
rm -rf "$OUT"; mkdir -p "$OUT"   # 关键:清旧结果,杜绝陈旧文件误判

echo
echo "===== 察元本地语音合成自检 @ $BASE ====="

healthz() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/healthz" 2>/dev/null || echo 000; }

if [ "$(healthz)" != "200" ]; then
  echo "[FAIL] /healthz 不通 -- 服务没起/端口不对。确认 sidecar 在跑或传地址。"
  exit 1
fi
echo "/healthz: 200  (服务在跑)"

probe() {
  p="$1"; v="$2"
  body="{\"video_script\":\"$TEXT\",\"voice_provider\":\"$p\",\"voice_name\":\"$v\",\"voice_rate\":1.0,\"voice_volume\":1.0}"
  wav="$OUT/$p.wav"; hdr="$OUT/$p.h"; err="$OUT/$p.err"
  code=$(curl -sS -D "$hdr" -o "$wav" -w '%{http_code}' --max-time 120 \
         -H 'Content-Type: application/json' -X POST --data "$body" \
         "$BASE/api/v1/video-generation/preview-audio" 2>"$err")
  rc=$?
  used=$(grep -i '^X-Tts-Provider:' "$hdr" 2>/dev/null | tr -d '\r' | awk '{print $2}')
  echo
  echo "-- $p --"
  if [ "$rc" != "0" ] || [ -z "$code" ] || [ "$code" = "000" ]; then
    echo "  [CRASH?] 请求无 HTTP 响应 (curl rc=$rc, code=${code:-空}) $(head -c 160 "$err" | tr -d '\r\n')"
    hc=$(healthz)
    if [ "$hc" = "200" ]; then
      echo "           /healthz 仍 200 -- 服务还活着,本次多半是单点超时/异常,看 server 日志。"
    else
      echo "           /healthz now=$hc -- **服务被 [$p] 这次合成搞挂了**,这就是要修的核心!"
      echo "           (跑老构建会这样;先重建 sidecar 拿 v2.0.114+ 修复)"
    fi
  elif [ "$code" = "200" ]; then
    sz=$(wc -c < "$wav" 2>/dev/null | tr -d ' '); sz="${sz:-0}"
    if [ "$used" = "$p" ]; then
      echo "  [OK]   出声=$used  wav=$((sz/1024))KB  -> $wav  (afplay $wav)"
    else
      echo "  [FAIL] 请求 $p 却由 [$used] 出声 = $p 坏了被静默回退 piper(根因: chayuan diagnose-tts)"
    fi
  elif [ "$code" = "422" ]; then
    echo "  [422]  参数被拒(正常不该发生): $(head -c 300 "$wav" | tr -d '\0\r\n')"
  else
    echo "  [HTTP $code] $(head -c 300 "$wav" | tr -d '\0\r\n')"
  fi
}

probe piper  ""
probe edge   "zh-CN-XiaoxiaoNeural"
probe sherpa ""
probe clone  ""

echo
echo "读法:[OK]=该音色真出声;[FAIL 回退]=该档坏了静默回 piper;[CRASH?]=请求把服务打挂(致命)。"
echo "音频在 $OUT/  (afplay $OUT/sherpa.wav 听真假)。若全是 [CRASH?],你跑的是**老构建**,先重建 sidecar。"
echo "================================================"
