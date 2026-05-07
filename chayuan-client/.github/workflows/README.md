# GitHub Actions 工作流

| 工作流 | 触发 | 产物 |
| :--- | :--- | :--- |
| [`ci.yml`](ci.yml) | push / PR | typecheck + lint + test;web bundle |
| [`chromatic.yml`](chromatic.yml) | push / PR | Storybook 视觉回归 |
| [`build-desktop.yml`](build-desktop.yml) | push main / tag `release/*` / 改动 desktop / 手动 | **单机版 4 平台桌面安装包** |

## `build-desktop.yml`(Phase 6)

四个矩阵格子,完全独立(`fail-fast: false`):

| label | runs-on | rust-target | installer |
| :--- | :--- | :--- | :--- |
| `macos-arm64` | macos-14 | aarch64-apple-darwin | `.dmg` / `.app.tar.gz` |
| `macos-x86_64` | macos-13 | x86_64-apple-darwin | `.dmg` / `.app.tar.gz` |
| `windows-x86_64` | windows-latest | x86_64-pc-windows-msvc | `.msi` / `.exe`(NSIS) |
| `linux-x86_64` | ubuntu-22.04 | x86_64-unknown-linux-gnu | `.deb` / `.rpm` / `.AppImage` |

每个 job 的端到端:

1. checkout `chayuan-client`(本仓库) + `chayuan-server`(同 owner / 同 ref)
2. (Linux only)装 webkit2gtk + gtk-3 + libayatana-appindicator + librsvg + patchelf
3. setup Python 3.12 + Poetry + PyInstaller
4. `cd chayuan-server && poetry install --only main`(单机版用不到 dev/test 组)
5. `poetry run python packaging/pyinstaller/build.py`
   - 输出 `chayuan-server/dist/chayuan-server/`
   - 自动按 rust target triple 拷到 `apps/desktop/src-tauri/binaries/chayuan-server-<triple>(.exe)`
6. 校验 sidecar 二进制存在(失败 fast)
7. setup Node 22 + pnpm 9 + Rust stable + 目标 target
8. cargo registry / target / pnpm 缓存(命中后第二次构建快 5-10 分钟)
9. `pnpm install --frozen-lockfile`
10. `pnpm typecheck`(``continue-on-error`` ── 已知 15 处 kb/collections 历史错误)
11. `pnpm build:desktop` → Tauri bundle 自动产出对应平台 installer
12. `actions/upload-artifact` 14 天保留;失败时再补一份 PyInstaller 诊断包

## 触发

```yaml
on:
  push:
    branches: [main]
    tags: ['release/*']
    paths: [apps/desktop/**, packages/platform-tauri/**, packages/platform-shared/**, .github/workflows/build-desktop.yml]
  pull_request:
    paths: [...同上]
  workflow_dispatch:
```

PR 时跑一遍验证不破坏构建;`release/*` tag 时跑正式一份产 release artifact。

## 不做(留给 Phase 6.x)

- macOS notarize:需要 `APPLE_CERTIFICATE` / `APPLE_API_KEY` secrets;
  `tauri-action` 内置或单独 `xcrun notarytool` 步,按 `release/*` tag 启用
- Windows EV 签名:同上,`signtool.exe` + EV 证书
- Linux ARM(aarch64):runner 较新,需要 `ubuntu-22.04-arm`(2024+ GA)
- Windows ARM:`windows-latest` 不原生 cross-compile aarch64,多走 cross-rs
- Auto-create GitHub Release 上传 installer:加一步 `softprops/action-gh-release`,
  `if: startsWith(github.ref, 'refs/tags/release/')`

## 本地复现

```bash
# 1. 服务端 PyInstaller
cd chayuan-server
poetry install
poetry run pip install "pyinstaller>=6.0"
poetry run python packaging/pyinstaller/build.py

# 2. 客户端 Tauri bundle
cd ../chayuan-client
pnpm install
pnpm build:desktop
```

产物分别在 `chayuan-server/dist/chayuan-server/` 与
`chayuan-client/apps/desktop/src-tauri/target/release/bundle/`。
