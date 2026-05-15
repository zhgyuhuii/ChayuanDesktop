# vendor/services/llama-server

放 `llama.cpp` 官方 release 的 `llama-server` 二进制 + 依赖 dll。
集成版打包时由 `build.py sync_services()` 拷到 Tauri resources,
装机后落在 `<install_dir>/services/llama-server/llama-server.exe`。

## 当前版本

来源:https://github.com/ggerganov/llama.cpp/releases
Build:`llama-bin-win-cpu-x64.zip` (Windows CPU only,~25 MB)
版本记录:`VERSION` 文件,内容是 commit hash + 下载日期。

## 获取方式

二进制不入 git。开发 / CI 跑下载脚本:

````powershell
# Windows
.\scripts\install-llama-server.ps1
````

````bash
# Linux / Mac dev
./scripts/install-llama-server.sh
````

## 升级

1. 跑下载脚本指定新版本:`.\scripts\install-llama-server.ps1 -Version b<N>`
2. 跑装机测试 `.\scripts\test-local-runtime.ps1` 验证兼容性
3. 提 PR 时 `VERSION` 文件改动 + 上一行 changelog
