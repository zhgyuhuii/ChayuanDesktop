# 本地 Runtime 诊断 — 装机手测 Runbook

适用于:Plan 1+2+3A 全部落盘之后,真机装机验证。

## 1. 准备

- 装机前确认 chayuan-server 已包好 (sidecar exe 存在)
- 装好 .msi (Win) / .dmg (Mac) / .deb / .AppImage (Linux)
- 安装目录里能看到 `services/llama-server/llama-server(.exe)`

## 2. 跑 CLI 脚本

### Windows

打开 PowerShell,cd 到 Chayuan 安装目录,运行:

```powershell
.\scripts\diagnose.ps1
```

预期输出末尾:

```
日志已写到: C:\Users\<you>\AppData\Local\Temp\chayuan-diagnose-<ts>.md
```

退出码 0 = 全 ok/warn,1 = 至少一项 fail,2 = sidecar 不可达。

### Mac / Linux

```bash
./scripts/diagnose.sh
```

预期日志落在 `/tmp/chayuan-diagnose-<ts>.md`。

## 3. UI 按钮

桌面应用 → 头像菜单 → 设置 → AI 平台 → 「本地模型」tab → 状态区按钮组最右侧「生成诊断报告」按钮。

预期:Dialog 弹出,~1s 内显示报告 markdown;点「复制全部」复制到剪贴板。

## 4. 常见问题排查

| 现象 | 可能原因 | 诊断报告里的标记 |
|---|---|---|
| sidecar 进程没找到 | chayuan-server 启动失败 / 装机不全 | CLI 退出码 2 + 日志写「sidecar 进程未发现」 |
| `vendor.llama-server.binary fail` | 集成版打包遗漏 vendor 二进制 | 重装;或开发机跑 `scripts/install-llama-server.{ps1,sh}` |
| `vendor.bundled_models.chat fail` | bundled_models 没打进 .msi | 重装;或手动放 .gguf 到 chayuan_root/models/bundled/chat/ |
| `port.62582 warn` | 端口被其它进程占 | `_allocate_port` 自动 bump 到 62583+,不影响功能 |
| `runtime.llama.status fail` | start 失败,看 last_error | 看报告里 detail 字段,根据 error 修 (常见:AVX2 缺失 / 模型路径错) |
| `chayuan_root.writable fail` | chayuan_root 路径写不进 (权限 / 路径错) | 检查 chayuan_root 路径,确认用户有写权限 |
| `disk.chayuan_root.free_gb fail` | 磁盘剩 < 500 MB | 清理磁盘 |

## 5. 报 bug 流程

发现问题时:

1. 跑 `diagnose.{ps1,sh}` 或 UI 按钮生成报告。
2. 复制 / 上传日志文件 (路径在脚本末尾打印 / Dialog 按钮)。
3. GitHub issue 模板里贴报告 + 描述复现步骤。

报告里 `chayuan_root` / `model_id` 这类信息可能被认作敏感,贴前自己判断。

## 6. 跨平台兼容矩阵 (Plan 3A 验收点)

| 维度 | Windows | macOS | Linux |
|---|---|---|---|
| 进程探测 | `Get-Process chayuan-server` | `pgrep -f chayuan-server` | 同 |
| HTTP 调用 | `Invoke-RestMethod` | `curl` | 同 |
| JSON 解析 | PowerShell 原生 | `python3 -c` | 同 |
| 日志路径 | `%TEMP%\chayuan-diagnose-<ts>.md` | `/tmp/chayuan-diagnose-<ts>.md` | 同 |
| UTF-8 编码 | `.ps1` 必须 BOM (防 GBK) | `.sh` 无 BOM | 同 |
| 端口探测 (后端) | psutil 跨平台 | 同 | 同 |
| 防火墙 / AV 影响 | 火绒 / Defender 可能拦 llama-server.exe spawn | n/a (Mac sandbox) | n/a (大多无 AV) |
