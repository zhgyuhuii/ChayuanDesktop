# vendor/services/llama-server

`llama.cpp` 官方 release 的 `llama-server` 二进制 + 依赖 DLL。集成版打包时由
`build.py sync_services()` 拷到 Tauri resources;装机后落在
`<install_dir>/services/llama-server/`。

## 布局(平台预编译,入 git,clone 即用)

```
llama-server/
├── linux-x64/      ← upstream llama-bXXXX-bin-ubuntu-x64.zip 解压(~5 MB,静态链接)
│   ├── llama-server
│   └── VERSION
├── macos-arm64/    ← upstream llama-bXXXX-bin-macos-arm64.zip 解压(~6 MB)
│   ├── llama-server
│   ├── ggml-metal.metal  (Metal shader,GPU 加速必备)
│   └── VERSION
└── win-x64/        ← upstream llama-bXXXX-bin-win-avx2-x64.zip 解压(~5 MB)
    ├── llama-server.exe
    ├── llama.dll / ggml-base.dll / ggml-cpu.dll / ggml.dll / ggml-rpc.dll / llava_shared.dll
    └── VERSION
```

运行时 `local_runtime.py:find_server_exe()` 按 `sys.platform` + `platform.machine()`
自动挑当前 OS 子目录里的 binary;`scripts/install-llama-server.{sh,ps1}` 现写现拉的
**扁平 layout**(`llama-server/llama-server[.exe]`)作为兜底,不入 git。

## 当前版本

`b4404`(2025-01 release;CPU AVX2,~5 MB binary)。

GLIBC 要求:Linux 二进制由 Ubuntu 22.04 编出,需要 `GLIBC >= 2.34` /
`GLIBCXX >= 3.4.32`。RHEL 8 / Alibaba Cloud Linux 3 / Anolis 等老 glibc 跑会报
`version not found`,这类 dev 机请走 WSL2 / 容器 / 源码 build。

## 升级

```bash
# Linux / Mac dev
./scripts/install-llama-server.sh -- <version>
# Win
.\scripts\install-llama-server.ps1 -Version b<N>
```

脚本拉新 zip 后默认落到**扁平**布局。要把新版本 commit 进 git,手动:

```bash
# 假设升到 b9999,把脚本下出来的扁平 binary 移到 platform subdir
mv chayuan-server/vendor/services/llama-server/llama-server* \
   chayuan-server/vendor/services/llama-server/linux-x64/
# 其它平台同理。然后 git add -f
git add -f chayuan-server/vendor/services/llama-server/linux-x64/
```
