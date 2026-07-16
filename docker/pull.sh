#!/usr/bin/env bash
# 察元 镜像拉取器（Linux / macOS）
#
#   ./docker/pull.sh                 # 自动选最快的源拉 latest
#   ./docker/pull.sh --tag 2.0.336   # 拉指定版本
#   ./docker/pull.sh --source cn     # 强制阿里云 ACR
#   ./docker/pull.sh --source hub    # 强制 Docker Hub
#   ./docker/pull.sh --vpc           # 阿里云 ECS 同地域走 VPC 内网地址（免公网流量、不限速）
#
# 后台拉取（SSH 断开也继续，2GB 大镜像必备）：
#   ./docker/pull.sh --bg            # 脱离终端后台拉，立刻返回
#   ./docker/pull.sh --follow        # 实时跟看进度（Ctrl-C 只停跟看，不停拉取）
#   ./docker/pull.sh --status        # 看还在不在跑 + 最近进度
#
# 环境变量覆盖：CHAYUAN_TAG / CHAYUAN_SOURCE / CHAYUAN_IMAGE（给定则直接拉它，跳过选源）
#                CHAYUAN_PULL_LOG（日志路径，默认 /var/tmp/chayuan-pull.log）
#
# 选源策略：默认 auto —— 对两个源各做 4 秒真实带宽探测，选快的那个；失败自动回退另一个。
# ⚠ 阿里云 ACR 是个人版（personal.cr.aliyuncs.com），公网带宽被限速，实测在部分网络下
#   反而比 Docker Hub 慢 5 倍。所以这里不写死「国内优先」，而是实测决定。
set -euo pipefail

# ---- 镜像坐标（真源见 website/public/downloads/service/部署文档.md §3）----
REPO_PATH="cmdbird/chayuan"
ACR_HOST="crpi-4i9j7th8clu2wz0j.cn-beijing.personal.cr.aliyuncs.com"
ACR_VPC_HOST="crpi-4i9j7th8clu2wz0j-vpc.cn-beijing.personal.cr.aliyuncs.com"
HUB_HOST="registry-1.docker.io"

TAG="${CHAYUAN_TAG:-latest}"
SOURCE="${CHAYUAN_SOURCE:-auto}"     # auto | cn/acr | hub
USE_VPC=0
PROBE=1
LOCAL_NAME="chayuan"                 # 拉完统一 retag 成 chayuan:<tag>，compose 不用管来源

# 后台模式：日志/PID 放 /var/tmp（不像 /tmp 会被 systemd-tmpfiles 定期清）
LOG="${CHAYUAN_PULL_LOG:-/var/tmp/chayuan-pull.log}"
PIDFILE="/var/tmp/chayuan-pull.pid"
BG=0
ACTION="pull"                        # pull | follow | status
PASS_ARGS=()                         # 转发给后台子进程的参数（不含 --bg）

# ---- 输出助手 ----
c_info() { printf '\033[36m[chayuan]\033[0m %s\n' "$*"; }
c_ok()   { printf '\033[32m[OK]\033[0m %s\n' "$*"; }
c_warn() { printf '\033[33m[!]\033[0m %s\n' "$*"; }
c_err()  { printf '\033[31m[ERR]\033[0m %s\n' "$*" >&2; }
die()    { c_err "$*"; exit 1; }

usage() {
  cat <<'EOF'
察元 镜像拉取器

用法: ./docker/pull.sh [选项]

  --tag <tag>       版本，默认 latest（可选 2.0.336）
  --source <src>    auto(默认) | cn/acr(阿里云) | hub(Docker Hub)
  --vpc             用阿里云 VPC 内网地址（仅同地域 ECS 可达，免流量不限速）
  --no-probe        跳过测速，按 cn -> hub 顺序试
  --name <name>     本地 retag 名，默认 chayuan
  --bg, -d          后台拉取，脱离终端；SSH 断开/logout 也继续
  --follow, -f      跟看后台拉取进度（Ctrl-C 只退出跟看，不影响拉取）
  --status          查看后台拉取状态（在跑/已完成/失败 + 最近进度）
  -h, --help        显示本帮助

示例:
  ./docker/pull.sh                    # 前台测速选源，拉 latest
  ./docker/pull.sh --bg               # 后台拉，断线不怕
  ./docker/pull.sh --follow           # 另开窗口看进度
  ./docker/pull.sh --tag 2.0.336 --bg # 后台拉指定版本
  CHAYUAN_SOURCE=hub ./docker/pull.sh # 环境变量强制 Docker Hub
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --tag)    TAG="${2:?--tag 需要参数}";        PASS_ARGS+=("$1" "$2"); shift ;;
    --source) SOURCE="${2:?--source 需要参数}";  PASS_ARGS+=("$1" "$2"); shift ;;
    --name)   LOCAL_NAME="${2:?--name 需要参数}"; PASS_ARGS+=("$1" "$2"); shift ;;
    --vpc)    USE_VPC=1;   PASS_ARGS+=("$1") ;;
    --no-probe) PROBE=0;   PASS_ARGS+=("$1") ;;
    --bg|-d)  BG=1 ;;                          # 不转发，否则子进程无限自我 detach
    --follow|-f) ACTION="follow" ;;
    --status) ACTION="status" ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$1（-h 看帮助）" ;;
  esac
  shift
done

# ---- docker 就绪 ----
need_sudo() {
  if [ "$(id -u)" -eq 0 ]; then printf ''
  elif command -v sudo >/dev/null 2>&1; then printf 'sudo '
  else die "需要 root 权限访问 docker，但没有 sudo。请用 root 重跑，或把自己加进 docker 组。"; fi
}

DOCKER=""
ensure_docker() {
  command -v docker >/dev/null 2>&1 || die "未安装 docker。装好后重跑：curl -fsSL https://get.docker.com | sh"
  if docker info >/dev/null 2>&1; then DOCKER=""
  else
    DOCKER="$(need_sudo)"
    ${DOCKER}docker info >/dev/null 2>&1 || die "docker 守护进程不可用，检查：systemctl status docker"
  fi
  c_ok "docker 就绪：$(${DOCKER}docker --version 2>/dev/null || echo '?')"
}

# ---- 阿里云 ECS 同地域检测（走 VPC 地址最优）----
detect_aliyun_ecs() {
  local region
  region="$(curl -s --max-time 1 http://100.100.100.200/latest/meta-data/region-id 2>/dev/null || true)"
  [ -n "$region" ] || return 1
  c_info "检测到阿里云 ECS，地域：$region"
  if [ "$region" = "cn-beijing" ]; then
    c_ok "与镜像仓库同地域 —— 自动改用 VPC 内网地址（免公网流量、不限速）"
    USE_VPC=1; SOURCE="cn"
  else
    c_warn "镜像仓库在 cn-beijing，你在 $region —— VPC 内网不通，仍走公网"
  fi
}

acr_host() { if [ "$USE_VPC" = "1" ]; then printf '%s' "$ACR_VPC_HOST"; else printf '%s' "$ACR_HOST"; fi; }

image_ref() { # image_ref <src>
  case "$1" in
    cn|acr) printf '%s/%s:%s' "$(acr_host)" "$REPO_PATH" "$TAG" ;;
    hub)    printf '%s:%s' "$REPO_PATH" "$TAG" ;;
    *) die "未知源：$1" ;;
  esac
}

# ---- 测速：对两个源的最大层各拉 4 秒，比真实带宽 ----
# registry 鉴权挑战动态发现（ACR 的 service 串是实例相关的，不能写死）
probe_mbps() { # probe_mbps <host> <repo> <tag>  -> 打印 MB/s，失败打印 0
  python3 - "$1" "$2" "$3" <<'PY' 2>/dev/null || echo 0
import json, re, sys, time, urllib.error, urllib.request

host, repo, tag = sys.argv[1], sys.argv[2], sys.argv[3]
ACCEPT = ("application/vnd.oci.image.index.v1+json,"
          "application/vnd.docker.distribution.manifest.list.v2+json,"
          "application/vnd.oci.image.manifest.v1+json,"
          "application/vnd.docker.distribution.manifest.v2+json")

def token():
    try:
        urllib.request.urlopen(f"https://{host}/v2/", timeout=8)
        return None
    except urllib.error.HTTPError as e:
        wa = e.headers.get("WWW-Authenticate", "")
        realm = re.search(r'realm="([^"]+)"', wa)
        if not realm:
            return None
        svc = re.search(r'service="([^"]+)"', wa)
        url = f"{realm.group(1)}?service={svc.group(1) if svc else ''}&scope=repository:{repo}:pull"
        return json.load(urllib.request.urlopen(url, timeout=8)).get("token")

tok = token()
H = {"Accept": ACCEPT}
if tok:
    H["Authorization"] = f"Bearer {tok}"

def get(u):
    return urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=10)

m = json.load(get(f"https://{host}/v2/{repo}/manifests/{tag}"))
if "manifests" in m:
    d = next(x["digest"] for x in m["manifests"]
             if x.get("platform", {}).get("architecture") == "amd64")
    m = json.load(get(f"https://{host}/v2/{repo}/manifests/{d}"))

big = max(m["layers"], key=lambda x: x["size"])
r = get(f"https://{host}/v2/{repo}/blobs/{big['digest']}")
t0 = n = 0
t0 = time.time()
while time.time() - t0 < 4:
    b = r.read(1 << 16)
    if not b:
        break
    n += len(b)
el = time.time() - t0
print(round(n / el / 1e6, 2) if el > 0 else 0)
PY
}

choose_source() {
  if [ -n "${CHAYUAN_IMAGE:-}" ]; then
    c_info "CHAYUAN_IMAGE 已指定，跳过选源：$CHAYUAN_IMAGE"
    return
  fi
  case "$SOURCE" in
    cn|acr|hub) c_info "按指定源拉取：$SOURCE"; return ;;
  esac

  if [ "$PROBE" = "0" ] || ! command -v python3 >/dev/null 2>&1; then
    [ "$PROBE" = "1" ] && c_warn "没有 python3，跳过测速"
    c_info "按顺序尝试：阿里云 ACR -> Docker Hub"
    SOURCE="cn"
    return
  fi

  c_info "测速中（各拉 4 秒真实数据）..."
  local a h
  a="$(probe_mbps "$(acr_host)" "$REPO_PATH" "$TAG")"
  h="$(probe_mbps "$HUB_HOST" "$REPO_PATH" "$TAG")"
  printf '           阿里云 ACR : %6s MB/s\n' "$a"
  printf '           Docker Hub : %6s MB/s\n' "$h"

  # bash 不做浮点比较，交给 awk
  if awk -v a="$a" -v h="$h" 'BEGIN{exit !(a+0 >= h+0)}'; then
    SOURCE="cn";  c_ok "选用 阿里云 ACR"
  else
    SOURCE="hub"; c_ok "选用 Docker Hub（比阿里云快 $(awk -v a="$a" -v h="$h" 'BEGIN{printf "%.1f", (a+0>0)? h/a : 0}')x）"
  fi
}

# 被中断时要能把底下的 docker pull / 心跳一起带走，否则会留下孤儿进程
PULL_PID=""
TICK_PID=""
on_signal() {
  c_warn "收到中断信号 —— 停止拉取，且不回退换源"
  [ -n "$TICK_PID" ] && kill "$TICK_PID" 2>/dev/null
  [ -n "$PULL_PID" ] && kill "$PULL_PID" 2>/dev/null
  exit 130
}
trap on_signal INT TERM

# ---- 进度心跳 ----
# docker pull 在非 TTY（后台/重定向到日志）下只打状态跃迁，不打字节进度：1.85GB 的大层
# 会在 "Waiting" 和 "Verifying Checksum" 之间几分钟一行不吐 —— 后台看进度就成了盲等。
# 这里按网卡收字节数估算，每 20 秒报一次。只在非 TTY 下开：有 TTY 时 docker 自己画进度条。
NET_IF="$(ip route show default 2>/dev/null | awk '/default/{print $5; exit}')"
rx_bytes() { awk -v i="${NET_IF:-lo}:" '$1==i{print $2; exit}' /proc/net/dev 2>/dev/null || echo 0; }

progress_ticker() {
  local t0 r0 t r mb spd
  t0=$SECONDS; r0="$(rx_bytes)"
  while :; do
    sleep 20
    t=$((SECONDS - t0)); r="$(rx_bytes)"
    mb=$(( (r - r0) / 1048576 ))
    spd="$(awk -v m="$mb" -v s="$t" 'BEGIN{printf "%.1f", (s>0)? m/s : 0}')"
    # 网卡计数含其它流量，故标"约"；镜像总量约 2200MB
    printf '\033[36m[进度]\033[0m 约 %s/2200 MB，均速 %s MB/s，已用 %s 秒\n' "$mb" "$spd" "$t"
  done
}

# 返回码：0=成功 / 1=该源真的拉不动 / 2=被人为中断
do_pull() { # do_pull <src>
  local ref rc; ref="$(image_ref "$1")"
  c_info "拉取 $ref"
  c_info "（约 2.2GB，其中 Python 依赖层就占 1.85GB，进度条会长时间停在它上面，属正常）"
  # 非 TTY（后台/写日志）时 docker 不吐字节进度，开心跳补上
  if [ ! -t 1 ]; then progress_ticker & TICK_PID=$!; fi
  # 放后台 + wait：这样 trap 在 wait 期间能立刻响应信号并杀掉子进程；
  # 前台跑的话 bash 要等 docker 结束才处理信号，来不及阻止下面的回退。
  ${DOCKER}docker pull "$ref" &
  PULL_PID=$!
  wait "$PULL_PID"; rc=$?
  PULL_PID=""
  [ -n "$TICK_PID" ] && { kill "$TICK_PID" 2>/dev/null; TICK_PID=""; }
  # 128+N 是被信号杀死（130=Ctrl-C，143=TERM，137=KILL）。这是人为中断，不是源不可用 ——
  # 绝不能当成"该源失败"去换源，否则用户一按 Ctrl-C 反而跑去拉另一个（可能更慢的）源。
  case "$rc" in
    0)           return 0 ;;
    130|143|137) return 2 ;;
    *)           return 1 ;;
  esac
}

# ---- 后台模式 ----
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

bg_running() { # 后台拉取是否还活着
  [ -f "$PIDFILE" ] || return 1
  local p; p="$(cat "$PIDFILE" 2>/dev/null)"
  [ -n "$p" ] && kill -0 "$p" 2>/dev/null
}

detach() {
  # 后台无 TTY，sudo 要密码就会静默卡死 —— 提前验掉
  if ! docker info >/dev/null 2>&1; then
    command -v sudo >/dev/null 2>&1 || die "需要 root 访问 docker，但没有 sudo"
    sudo -n true 2>/dev/null || die "docker 需要 sudo 且 sudo 要密码，后台模式无法输入密码。
  先跑一次 sudo -v 再重试，或把自己加进 docker 组免 sudo：
    sudo usermod -aG docker $(id -un)   # 之后重新登录生效"
  fi
  bg_running && die "已有后台拉取在跑（PID $(cat "$PIDFILE")）。看进度：$SELF --follow"

  : > "$LOG"
  # setsid 脱离会话 + nohup 免 SIGHUP + </dev/null 断开 stdin：SSH 断开/logout 都不影响
  setsid nohup "$SELF" "${PASS_ARGS[@]}" >> "$LOG" 2>&1 < /dev/null &
  local p=$!
  echo "$p" > "$PIDFILE"
  disown "$p" 2>/dev/null || true
  sleep 1
  c_ok "已转入后台拉取（PID $p）—— 现在可以安全断开 SSH / 关终端"
  echo "  看进度: $SELF --follow"
  echo "  查状态: $SELF --status"
  echo "  日志:   $LOG"
  echo "  想停:   kill $p"
}

do_follow() {
  [ -f "$LOG" ] || die "还没有拉取日志（$LOG）—— 先跑：$SELF --bg"
  if bg_running; then
    c_info "跟看后台拉取进度（Ctrl-C 只退出跟看，拉取继续在后台跑）"
    # --pid：被跟的进程一结束，tail 自己退出，不会傻等
    tail -n 20 -f --pid="$(cat "$PIDFILE")" "$LOG"
  else
    c_warn "后台任务已结束，以下是完整日志"
    cat "$LOG"
  fi
}

do_status() {
  if bg_running; then
    c_ok "后台拉取进行中（PID $(cat "$PIDFILE")）"
  elif [ -f "$LOG" ]; then
    if grep -q '拉取完成' "$LOG" 2>/dev/null; then c_ok "上次后台拉取已完成"
    else c_warn "当前没有拉取在跑，上次未正常完成 —— 看下面日志末尾"; fi
  else
    c_info "没有后台拉取记录（$LOG 不存在）"; return 0
  fi
  echo "  日志: $LOG"
  echo "  ---- 最近 12 行 ----"
  tail -n 12 "$LOG" 2>/dev/null | sed 's/^/  /'
  bg_running && echo "  ---- 实时跟看: $SELF --follow"
  return 0
}

main() {
  c_info "察元 镜像拉取器（$(uname -s)/$(uname -m)）  tag=$TAG"
  ensure_docker
  [ "$USE_VPC" = "1" ] || detect_aliyun_ecs || true

  local pulled=""
  if [ -n "${CHAYUAN_IMAGE:-}" ]; then
    ${DOCKER}docker pull "$CHAYUAN_IMAGE" || die "拉取失败：$CHAYUAN_IMAGE"
    pulled="$CHAYUAN_IMAGE"
  else
    choose_source
    local first="$SOURCE" second rc=0
    [ "$first" = "hub" ] && second="cn" || second="hub"

    do_pull "$first" || rc=$?
    if [ "$rc" = "0" ]; then
      pulled="$(image_ref "$first")"
    elif [ "$rc" = "2" ]; then
      die "拉取已中断，未换源。已下载的层有缓存，重跑本脚本会接着下。"
    else
      c_warn "$first 源拉取失败，回退到 $second ..."
      rc=0; do_pull "$second" || rc=$?
      [ "$rc" = "2" ] && die "拉取已中断。重跑本脚本会接着下。"
      [ "$rc" = "0" ] || die "两个源都拉取失败。检查网络，或用 --source 手动指定、CHAYUAN_IMAGE 指定完整地址。"
      pulled="$(image_ref "$second")"
    fi
  fi

  # 统一本地名，compose / run 命令不用关心镜像是从哪个源来的
  ${DOCKER}docker tag "$pulled" "${LOCAL_NAME}:${TAG}"
  [ "$TAG" = "latest" ] || ${DOCKER}docker tag "$pulled" "${LOCAL_NAME}:latest"

  echo
  c_ok "拉取完成"
  ${DOCKER}docker images "${LOCAL_NAME}" --format '  {{.Repository}}:{{.Tag}}  {{.Size}}  ({{.ID}})'
  echo
  echo "  来源:     $pulled"
  echo "  本地名:   ${LOCAL_NAME}:${TAG}"
  echo
  echo "  起容器（数据/模型/配置映射到当前目录，详见 docker/DOCKERHUB.md §2）:"
  cat <<EOF
    docker run -d --name chayuan \\
      -p 8080:80 -p 62581:62581 \\
      -v "\$(pwd)/chayuan/data":/chayuan/data \\
      -v "\$(pwd)/chayuan/models":/chayuan/app/chayuan-server/vendor/bundled_models \\
      -v "\$(pwd)/chayuan/config":/chayuan/config \\
      -v "\$(pwd)/chayuan/logs":/chayuan/logs \\
      ${LOCAL_NAME}:${TAG}
EOF
  echo
  echo "  然后浏览器开 http://localhost:8080 （管理后台 /admin）"
}

# CHAYUAN_PULL_LIB=1 时只加载函数不执行（供测试 source）
if [ "${CHAYUAN_PULL_LIB:-}" != "1" ]; then
  case "$ACTION" in
    follow) do_follow; exit 0 ;;
    status) do_status; exit 0 ;;
  esac
  if [ "$BG" = "1" ]; then detach; exit 0; fi
  main "$@"
fi
