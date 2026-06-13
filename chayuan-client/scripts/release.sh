#!/usr/bin/env bash
# 察元一键构建发布(mac/Linux)。参数透传给 release.mjs。
exec node "$(cd "$(dirname "$0")" && pwd)/release.mjs" "$@"
