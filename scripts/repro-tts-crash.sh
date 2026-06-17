#!/usr/bin/env bash
# 一条命令复现 + 抓现场:用**源码**(非装机包)后台起 server 抓日志,起来后打 piper,
# 然后判定服务死没死并吐日志末尾。源码态无 Tauri 双拉、版本可信,能干净区分:
#   源码也崩 -> 代码/原生问题(日志有现场,贴来我改);
#   源码不崩 -> 之前的崩是**打包态专属**(SIGKILL),重建后即好。
#
# 用法(先完全退出桌面 App 腾出 62581):
#   bash scripts/repro-tts-crash.sh
#   CHAYUAN_PY="python" CHAYUAN_ROOT=/Users/zyh/work/xxx bash scripts/repro-tts-crash.sh
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$REPO/chayuan-server/libs/chayuan-server"
PY="${CHAYUAN_PY:-python}"
ROOT="${CHAYUAN_ROOT:-$HOME/work/xxx}"
BASE="http://127.0.0.1:62581"
LOG="${TMPDIR:-/tmp}"; LOG="${LOG%/}/chayuan-src.log"

if curl -s -o /dev/null --max-time 3 "$BASE/healthz" 2>/dev/null; then
  echo "[!] 62581 已被占 —— 先**完全退出桌面 App** / kill 旧 server 再来。"; exit 1
fi
if ! "$PY" -c 'import chayuan' >/dev/null 2>&1; then
  echo "[!] 当前 python ($PY) 里 import chayuan 失败。用能跑 server 的那个 env(py312),"
  echo "    或 CHAYUAN_PY=... 指定。"; exit 1
fi

echo "== 源码起 server(日志 -> $LOG),后台跑 =="
( cd "$PKG" && \
  CHAYUAN_ROOT_IGNORE_STATE=1 CHAYUAN_ROOT="$ROOT" \
  CHAYUAN_PROFILE=single-machine CHAYUAN_AUTH=anonymous CHAYUAN_REDIS=disabled \
  CHAYUAN_QUEUE=inproc CHAYUAN_VECTOR_STORE=sqlite-vec \
  "$PY" -m chayuan start -a --single-machine ) >"$LOG" 2>&1 &
SRV=$!

echo "== 等 /healthz(最多 180s)=="
ok=""
for _ in $(seq 1 180); do
  curl -s -o /dev/null --max-time 2 "$BASE/healthz" 2>/dev/null && { ok=1; break; }
  kill -0 "$SRV" 2>/dev/null || { echo "[!] server 进程提前退出。日志末尾:"; tail -50 "$LOG"; exit 1; }
  sleep 1
done
[ -z "$ok" ] && { echo "[!] 等 healthz 超时。日志末尾:"; tail -50 "$LOG"; kill "$SRV" 2>/dev/null; exit 1; }
echo "== /healthz OK,打 piper 试听 =="

curl -sS -D - -o /tmp/p.wav --max-time 60 -X POST -H 'Content-Type: application/json' \
  --data '{"video_script":"你好，测试。","voice_provider":"piper","voice_name":"","voice_rate":1.0,"voice_volume":1.0}' \
  "$BASE/api/v1/video-generation/preview-audio" 2>&1 | grep -iE '^HTTP|x-tts-provider' || true

sleep 2
echo
if curl -s -o /dev/null --max-time 3 "$BASE/healthz" 2>/dev/null; then
  echo "########## [OK] piper 后服务仍活 -> **源码态不崩** ##########"
  echo "  => 之前的崩是打包态专属(SIGKILL,crash.log 无栈印证),重建即好;"
  echo "     装机版若仍崩,是打包/Tauri 层而非代码逻辑。"
else
  echo "########## [CRASH] piper 后服务死了 -> **源码态也崩** ##########"
  echo "  => 是代码/原生问题。把下面这段日志贴给 Claude。"
fi
echo "########## $LOG 末尾 70 行 ##########"
tail -70 "$LOG"
kill "$SRV" 2>/dev/null || true
echo "########## 已停 server。完整日志: $LOG ##########"
