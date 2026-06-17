#!/usr/bin/env bash
# 本地语音合成一键体检:
#   ① 先打印**运行中**构建版本(从 /openapi.json 的 info.version)—— 确认你测的不是旧包
#   ② 逐档测 piper/edge/sherpa/clone:崩了复检 /healthz、指向日志;回退则点出真实引擎
#
# 用法:
#   bash scripts/check-tts.sh                          # 默认 127.0.0.1:62581 + ~/work/xxx
#   CHAYUAN_ROOT=/Users/zyh/work/xxx bash scripts/check-tts.sh [API_BASE]
set -u

BASE="${1:-${CHAYUAN_API:-http://127.0.0.1:62581}}"; BASE="${BASE%/}"
ROOT="${CHAYUAN_ROOT:-$HOME/work/xxx}"
TEXT="你好，这是语音合成测试。"
OUT="${TMPDIR:-/tmp}"; OUT="${OUT%/}/chayuan-tts-probe"; rm -rf "$OUT"; mkdir -p "$OUT"

echo
echo "================ 察元语音合成体检 @ $BASE ================"

hz() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/healthz" 2>/dev/null || echo 000; }
if [ "$(hz)" != "200" ]; then
  echo "[FAIL] /healthz 不通 -- 服务没起/端口不对。先确认 sidecar 在跑。"
  exit 1
fi
echo "/healthz: 200  (服务在跑)"

# ---- 版本:确认是不是 >= 2.0.114 的新构建 ----
ver=$(curl -s --max-time 10 "$BASE/openapi.json" 2>/dev/null \
      | python3 -c "import sys,json;print(json.load(sys.stdin).get('info',{}).get('version',''))" 2>/dev/null)
[ -z "$ver" ] && ver=$(curl -s --max-time 10 "$BASE/openapi.json" 2>/dev/null \
      | grep -o '"version":"[^"]*"' | head -1 | sed 's/.*:"//;s/"$//')
verge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" = "$2" ]; }
echo "运行中构建版本: ${ver:-<读不到>}"
if [ -n "$ver" ] && verge "$ver" "2.0.114"; then
  echo "  -> >= 2.0.114,含『重复 start 不杀健康实例』修复  [OK]"
else
  echo "  -> [WARN] 低于 2.0.114 或读不到 —— 你很可能还在测**旧包**!"
  echo "     重建 sidecar + **完全退出再重开** App,再跑本脚本。"
fi

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
    echo "  [CRASH?] 无 HTTP 响应 (curl rc=$rc) $(head -c 140 "$err" | tr -d '\r\n')"
    if [ "$(hz)" = "200" ]; then
      echo "           但 /healthz 仍 200 -- 服务还活着,本次多半是单点超时,看日志。"
    else
      echo "           /healthz now 不通 -- **服务被 [$p] 这次合成搞挂了**。"
      echo "           查 $ROOT/data/logs/crash.log:有栈=原生段错误;空=被 SIGKILL(应已被 114 修复,确认版本!)"
    fi
  elif [ "$code" = "200" ]; then
    sz=$(wc -c < "$wav" 2>/dev/null | tr -d ' '); sz="${sz:-0}"
    if [ "$used" = "$p" ]; then
      echo "  [OK]   出声=$used  wav=$((sz/1024))KB  ($wav)"
    else
      echo "  [FAIL] 请求 $p 却由 [$used] 出声 = $p 坏了被静默回退(根因: chayuan diagnose-tts)"
    fi
  else
    echo "  [HTTP $code] $(head -c 280 "$wav" | tr -d '\0\r\n')"
  fi
}

probe piper  ""
probe edge   "zh-CN-XiaoxiaoNeural"
probe sherpa ""
probe clone  ""

echo
echo "读法:[OK]=真出声;[FAIL]=坏了回退 piper;[CRASH?]=把服务打挂。"
echo "音频: $OUT/  (afplay $OUT/sherpa.wav)。仍 [CRASH?] 且版本 >=114 -> 把 $ROOT/data/logs/crash.log + 主日志末尾贴来。"
echo "========================================================="
