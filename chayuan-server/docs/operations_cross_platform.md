# 跨平台运维：start / stop / restart

察元的 `chayuan start` / `chayuan stop` / `chayuan restart` 三件套在 **Linux / macOS / Windows**
上行为一致。本文档说明各平台底层实现差异，供运维与开发排障参考。

## 统一抽象

所有进程 / 端口操作走 `chayuan.server.shared.process_utils`：

| 能力 | 函数 | Linux | macOS | Windows |
|------|------|-------|-------|---------|
| 进程活性 | `is_pid_alive(pid)` | `os.kill(pid, 0)` | 同 Linux | `OpenProcess` + `GetExitCodeProcess`（ctypes） |
| 停进程 | `terminate_pid(pid, force=...)` | `SIGTERM` → `SIGKILL` | 同 Linux | `taskkill /T` → `taskkill /T /F` |
| 查端口 | `find_pids_listening_on(port)` | psutil → `ss -tlnp` → `lsof` | psutil → `lsof` | psutil → `netstat -ano` |
| detach 启动子进程 | `detached_popen_kwargs()` | `start_new_session=True` | 同 Linux | `DETACHED_PROCESS \| CREATE_NEW_PROCESS_GROUP` |

**优先级**：任何操作先 try `psutil`（若可用）；失败再 try 各平台系统命令；都失败才降级。

## 跨平台行为说明

### `chayuan start`

- **Linux / macOS**：父进程 fork 子进程（mp spawn）；退出时 SIGTERM 级联，子进程通过 `finally: _safe_kill()` 清理。
- **Windows**：父进程用 `multiprocessing.Process(start_method="spawn")` 起 child；`DETACHED_PROCESS` 标志保证子进程脱离 console。所有子进程 pid + port 记录到 `runtime_meta.children`，后续 stop/restart 按 pid 定位。

### `chayuan stop [--api | -w | -c | -f | --dry-run]`

| 场景 | Linux / macOS | Windows |
|------|---------------|---------|
| 精确路径 | `SIGTERM` → 超时 `SIGKILL` | `taskkill /T` → 超时 `taskkill /T /F` |
| 端口兜底 | `ss -tlnp sport = :PORT` → `lsof -ti:PORT` | `netstat -ano \| findstr :PORT` |
| `-f` 强杀 | 直接 `SIGKILL` | 直接 `taskkill /T /F` |

**`/T` 标志**在 Windows 上会级联杀子进程树，对应 POSIX 的"同 session 信号传播"。

### `chayuan restart [--api | -w | -c | -f]`

两种策略：
1. **逐 role（默认）**：`stop_all` → 按 argv 推断要拉起的 role → `_spawn_service_detached`（用 `detached_popen_kwargs()`）→ 等端口监听。**最可靠，任何平台都一致。**
2. **守护脚本（`use_helper=True`，编程 API only）**：`restart_helper.py` 作为独立脚本脱离 chayuan 进程组，执行 `terminate_pid` → 原 argv `Popen` 重启。

## 运维故障排查

### 端口被占但 `chayuan stop` 说没找到进程

可能 `psutil` 和系统命令都没装：

```bash
# Linux / macOS 装 psutil
pip install psutil

# Linux 装 ss（绝大多数发行版自带 iproute2）
# Debian/Ubuntu: apt install iproute2
# RHEL/CentOS:  yum install iproute

# macOS 装 lsof（自带）——无需额外操作

# Windows：netstat 和 taskkill 是系统自带命令
```

备用：用 `chayuan stop --dry-run` 查看当前状态快照；若显示端口被占但 pid 查不到，说明系统命令不可用或权限不足，可手动：

```bash
# Linux (任一)
sudo ss -tlnp 'sport = :7861'
sudo lsof -iTCP:7861 -sTCP:LISTEN

# macOS
lsof -iTCP:7861 -sTCP:LISTEN -P

# Windows (PowerShell)
Get-NetTCPConnection -LocalPort 7861 -State Listen | Select-Object OwningProcess
```

### Windows 下 `chayuan stop` 权限不足

某些企业环境 UAC 会阻止 `taskkill` 杀非本用户进程。以管理员身份启动 PowerShell 或 CMD：

```powershell
Start-Process powershell -Verb RunAs
```

### Linux 下 Ctrl+C 没完全停

`chayuan start` 已注册 SIGINT/SIGTERM handler，会优雅级联杀子进程。若仍有残留：

```bash
chayuan stop -f   # 强制终止
```

### macOS 下 `chayuan restart --api` 后新实例没起

检查 `$CHAYUAN_ROOT/logs/restart_api.log`（`_spawn_service_detached` 专写的日志）：

```bash
tail -50 "$CHAYUAN_ROOT/logs/restart_api.log"
```

## 测试矩阵

单测文件 | 跨平台 CI |
---|---|
`test_process_utils_cross_platform.py` | ✅ 都跑真实子进程 / socket listener，无 mock |
`test_stop_command.py` | ✅ |
`test_restart_command.py` | ✅ |
`test_config_panel_api_gate.py` | ✅（纯 HTTP，无平台差异） |

GitHub Actions 建议矩阵：

```yaml
matrix:
  os: [ubuntu-latest, macos-latest, windows-latest]
  python-version: ["3.11", "3.12"]
```
