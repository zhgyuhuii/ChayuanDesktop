# vendor/services/whisper-server

放 `whisper.cpp` 官方 release 的 `whisper-server` 二进制 + 依赖 dll。
集成版打包时由 `build.py sync_services()` 拷到 Tauri resources,
装机后落在 `<install_dir>/services/whisper-server/whisper-server.exe`。

## 当前版本

来源:https://github.com/ggerganov/whisper.cpp/releases
Build:`whisper-bin-x64.zip` (Win) / `whisper-bin-linux-x64.tar.gz` /
`whisper-bin-macos-arm64.tar.gz`
版本记录:`VERSION` 文件,内容是 release tag + 下载日期。

## 获取方式

二进制不入 git。开发 / CI 跑下载脚本:

````powershell
# Windows
.\scripts\install-whisper-server.ps1
````

````bash
# Linux / Mac dev
./scripts/install-whisper-server.sh
````

## 升级

1. 跑下载脚本指定新版本:`.\scripts\install-whisper-server.ps1 -Version v1.7.x`
2. 跑 ASR smoke 测试验证兼容性
3. 提 PR 时 `VERSION` 文件改动 + 上一行 changelog
