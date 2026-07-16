#!/usr/bin/env bash
# 察元 镜像拉取器（Linux / macOS）
#
#   ./docker/pull.sh                 # 自动选最快的源拉 latest
#   ./docker/pull.sh --tag 2.0.336   # 拉指定版本
#   ./docker/pull.sh --source cn     # 强制阿里云 ACR
#   ./docker/pull.sh --source hub    # 强制 Docker Hub
#   ./docker/pull.sh --vpc           # 阿里云 ECS 同地域走 VPC 内网地址（免公网流量、不限速）
#
# 环境变量覆盖：CHAYUAN_TAG / CHAYUAN_SOURCE / CHAYUAN_IMAGE（给定则直接拉它，跳过选源）
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
  -h, --help        显示本帮助

示例:
  ./docker/pull.sh                    # 测速选源，拉 latest
  ./docker/pull.sh --tag 2.0.336      # 拉指定版本
  CHAYUAN_SOURCE=hub ./docker/pull.sh # 环境变量强制 Docker Hub
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --tag)    TAG="${2:?--tag 需要参数}"; shift ;;
    --source) SOURCE="${2:?--source 需要参数}"; shift ;;
    --name)   LOCAL_NAME="${2:?--name 需要参数}"; shift ;;
    --vpc)    USE_VPC=1 ;;
    --no-probe) PROBE=0 ;;
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

do_pull() { # do_pull <src>
  local ref; ref="$(image_ref "$1")"
  c_info "拉取 $ref"
  c_info "（约 2.2GB，其中 Python 依赖层就占 1.85GB，进度条会长时间停在它上面，属正常）"
  ${DOCKER}docker pull "$ref"
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
    local first="$SOURCE" second
    [ "$first" = "hub" ] && second="cn" || second="hub"

    if do_pull "$first"; then
      pulled="$(image_ref "$first")"
    else
      c_warn "$first 源拉取失败，回退到 $second ..."
      do_pull "$second" || die "两个源都拉取失败。检查网络，或用 --source 手动指定、CHAYUAN_IMAGE 指定完整地址。"
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
  main "$@"
fi
