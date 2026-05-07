#!/usr/bin/env bash
# 在 docker/dev-stack 下从 .env.example 生成 .env（本地开发默认凭据）
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if [[ -f .env && "${1:-}" != "--force" ]]; then
  echo "已存在 .env，跳过。若要覆盖请执行: $0 --force" >&2
  exit 0
fi

if [[ ! -f .env.example ]]; then
  echo "缺少 .env.example" >&2
  exit 1
fi

cp .env.example .env
chmod 600 .env 2>/dev/null || true

# 为 OnlyOffice 生成强随机 JWT secret（仅在 .env 中该字段为空时）
if grep -q '^ONLYOFFICE_JWT_SECRET=$' .env 2>/dev/null; then
  if command -v openssl >/dev/null 2>&1; then
    OO_JWT="$(openssl rand -hex 32)"
  else
    OO_JWT="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  # macOS / GNU sed 兼容
  sed -i.bak "s|^ONLYOFFICE_JWT_SECRET=$|ONLYOFFICE_JWT_SECRET=${OO_JWT}|" .env && rm -f .env.bak
  echo "已为 OnlyOffice 生成 JWT secret 并写入 .env" >&2
fi

echo "已从 .env.example 复制到 $DIR/.env。启动: docker compose up -d" >&2
