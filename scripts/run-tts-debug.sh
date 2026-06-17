#!/usr/bin/env bash
# 前台启动**已安装的** sidecar(日志直接打到终端,便于排查),起来后自动逐档调
# 语音合成接口测试 —— 这样每档失败的根因([tts:sherpa]/[mp-freeze]/worker 崩)
# 会和测试结果在同一个终端里前后脚出现,一眼对得上。
#
# 用法:
#   bash scripts/run-tts-debug.sh                 # 用默认安装路径 + $HOME/work/xxx
#   CHAYUAN_ROOT=/Users/zyh/work/xxx bash scripts/run-tts-debug.sh
#   CHAYUAN_BIN=/path/to/chayuan-server bash scripts/run-tts-debug.sh
#
# ⚠ 先**退出桌面 App**(或 kill 旧 sidecar)再跑,否则 62581 被占,本前台实例会
#   因 v2.0.114 的"健康退避"自动退出。Ctrl-C 停止本前台 sidecar。
set -u

BIN="${CHAYUAN_BIN:-/Applications/Chayuan.app/Contents/Resources/chayuan-server/chayuan-server}"
ROOT="${CHAYUAN_ROOT:-$HOME/work/xxx}"
PORT="${CHAYUAN_PORT:-62581}"
BASE="http://127.0.0.1:$PORT"
TMP="${TMPDIR:-/tmp}"; TMP="${TMP%/}"
LOG="$TMP/chayuan-sidecar.log"
OUT="$TMP/chayuan-tts-probe"; mkdir -p "$OUT"

# 0) 端口占用 -> 已有实例,别再起
if curl -s -o /dev/null --max-time 3 "$BASE/healthz" 2>/dev/null; then
  echo "[!] $BASE 已有实例在跑。先退出桌面 App / kill 旧 sidecar 再来,"
  echo "    否则本前台实例会健康退避自动退出。"
  exit 1
fi

# 1) 找 binary
if [ ! -x "$BIN" ]; then
  echo "[!] 找不到 sidecar 可执行文件: $BIN"
  echo "    用 CHAYUAN_BIN=<chayuan-server 路径> 指定;dev 源码态请改为手动跑:"
  echo "    CHAYUAN_ROOT=$ROOT CHAYUAN_PROFILE=single-machine poetry run chayuan start -a --single-machine 2>&1 | tee $LOG"
  exit 1
fi

echo "== sidecar : $BIN"
echo "== ROOT    : $ROOT"
echo "== 日志    : 终端实时 + 另存 $LOG"
echo "== 音频    : $OUT"
echo "== 启动中... (Ctrl-C 停止)"
echo

# 2) 后台 waiter:等 /healthz 再逐档测;结果与 server 日志同终端交错
(
  ok=""
  for _ in $(seq 1 180); do
    if curl -s -o /dev/null --max-time 2 "$BASE/healthz" 2>/dev/null; then ok=1; break; fi
    sleep 1
  done
  if [ -z "$ok" ]; then
    echo; echo "[probe] 等 /healthz 超时(180s),服务没起来?看上方日志。"; exit 0
  fi
  echo
  echo "########## /healthz OK,开始逐档语音合成测试 ##########"
  echo "########## (失败档看上方 server 日志里的 [tts:<engine>] / [mp-freeze] / [tts-probe] 警告)##########"
  probe() {
    p="$1"; v="$2"
    body="{\"video_script\":\"你好，这是语音合成测试。\",\"voice_provider\":\"$p\",\"voice_name\":\"$v\",\"voice_rate\":1.0,\"voice_volume\":1.0}"
    code=$(curl -s -D "$OUT/$p.h" -o "$OUT/$p.wav" -w '%{http_code}' --max-time 120 \
           -H 'Content-Type: application/json' -X POST --data "$body" \
           "$BASE/api/v1/video-generation/preview-audio" 2>/dev/null || echo 000)
    used=$(grep -i '^X-Tts-Provider:' "$OUT/$p.h" 2>/dev/null | tr -d '\r' | awk '{print $2}')
    if [ "$code" = "200" ] && [ "$used" = "$p" ]; then
      echo ">>> [OK]   $p : 出声=$used  ($OUT/$p.wav)"
    elif [ "$code" = "200" ]; then
      echo ">>> [FAIL] $p : 请求 $p 却由 [$used] 出声 = $p 坏了被回退(根因看上方日志)"
    else
      echo ">>> [FAIL] $p : HTTP $code  $(head -c 300 "$OUT/$p.wav" 2>/dev/null)"
    fi
  }
  probe piper ""; probe edge "zh-CN-XiaoxiaoNeural"; probe sherpa ""; probe clone ""
  echo "########## 测试完毕。afplay $OUT/sherpa.wav 听一耳朵。Ctrl-C 停 sidecar。##########"
) &

# 3) 前台起 sidecar:stdout+stderr 实时打终端 + tee 落盘(worker 子进程的
#    [mp-freeze] 也会继承终端输出)
CHAYUAN_ROOT_IGNORE_STATE=1 \
CHAYUAN_ROOT="$ROOT" \
CHAYUAN_PROFILE=single-machine CHAYUAN_AUTH=anonymous \
CHAYUAN_REDIS=disabled CHAYUAN_QUEUE=inproc CHAYUAN_VECTOR_STORE=sqlite-vec \
  "$BIN" start -a --single-machine 2>&1 | tee "$LOG"
