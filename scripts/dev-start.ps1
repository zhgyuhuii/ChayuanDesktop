<#
.SYNOPSIS
  一键启动 chayuan-server 开发环境(Windows)。

.DESCRIPTION
  做什么:
    1. 检测 host 架构(x86_64 / ARM64)→ 用对的 vendor/services/<engine>/<platform>/
    2. 检查 Python(poetry / venv) + chayuan-server 已 editable install
    3. 检查 vendor binary 就位,缺时给指引
    4. 检查 CHAYUAN_ROOT 数据目录可写(默认 $env:USERPROFILE\.chayuan-dev)
    5. 起 chayuan start -a --single-machine

  ⚠ 编码:
    .ps1 文件**必须 UTF-8 BOM**,否则 PowerShell 5.x 按 ANSI/GBK 解,中文乱码。
    本脚本顶部已带 BOM(看不见的 EF BB BF)。

.PARAMETER Bg
  后台运行,PID 写到 %TEMP%\chayuan-dev.pid

.PARAMETER CheckOnly
  只跑 preflight,不启动 chayuan-server

.PARAMETER VendorPlatform
  强制 vendor 子目录(win-x64 / win-x64-noavx / win-x64-avx512 / win-arm64);
  不传 = 按 PROCESSOR_ARCHITECTURE 推

.PARAMETER ChayuanRoot
  数据目录;不传 = $env:USERPROFILE\.chayuan-dev

.EXAMPLE
  .\scripts\dev-start.ps1
  .\scripts\dev-start.ps1 -CheckOnly
  .\scripts\dev-start.ps1 -VendorPlatform win-x64-noavx
  .\scripts\dev-start.ps1 -Bg -ChayuanRoot D:\chayuan-data
#>
[CmdletBinding()]
param(
    [switch]$Bg,
    [switch]$CheckOnly,
    [string]$VendorPlatform = '',
    [string]$ChayuanRoot = '',
    [int]$Port = 62581
)

# ────────────────── 编码:终端 + Python 全程 UTF-8 ──────────────────
try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
    chcp 65001 > $null 2>&1
} catch {}
$env:PYTHONIOENCODING = 'utf-8'
$env:LANG = 'en_US.UTF-8'

$ErrorActionPreference = 'Stop'

# ────────────────── 颜色辅助 ──────────────────
function Write-Ok    { param($m) Write-Host "✓ $m" -ForegroundColor Green }
function Write-Warn  { param($m) Write-Host "⚠ $m" -ForegroundColor Yellow }
function Write-Err   { param($m) Write-Host "✗ $m" -ForegroundColor Red }
function Write-Step  { param($m) Write-Host "→ $m" -ForegroundColor Cyan }

# ────────────────── 定位仓库 ──────────────────
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repo = Split-Path -Parent $ScriptDir
$Server = Join-Path $Repo 'chayuan-server'
Set-Location $Repo
Write-Step "工作目录:$Repo"

# ────────────────── 1. host 平台检测 ──────────────────
if (-not $VendorPlatform) {
    $cpuArch = ($env:PROCESSOR_ARCHITECTURE + '').ToUpperInvariant()
    if ($cpuArch -eq 'ARM64') {
        $VendorPlatform = 'win-arm64'
    } else {
        # AMD64 / EM64T → AVX2 默认
        $VendorPlatform = 'win-x64'
    }
}
Write-Ok "host: Windows $cpuArch → vendor 子目录 = $VendorPlatform"

# ────────────────── 2. Python + chayuan 包 ──────────────────
Write-Step 'Step 1/4: 检查 Python 环境'
$pythonBin = $null
$poetryExe = Get-Command poetry -ErrorAction SilentlyContinue
if ($poetryExe) {
    Push-Location $Server
    try {
        $venvPath = & poetry env info --path 2>$null
        if ($LASTEXITCODE -eq 0 -and $venvPath) {
            $pythonBin = Join-Path $venvPath 'Scripts\python.exe'
            if (-not (Test-Path $pythonBin)) {
                # Linux-style 路径,兜底
                $pythonBin = Join-Path $venvPath 'bin\python.exe'
            }
            Write-Ok "poetry venv:$pythonBin"
        }
    } finally { Pop-Location }
}
if (-not $pythonBin) {
    $pyCmd = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pyCmd) { $pyCmd = Get-Command python3 -ErrorAction SilentlyContinue }
    if ($pyCmd) {
        $pythonBin = $pyCmd.Source
        # 两种合法情况:1) pip install -e 装了;2) 源码树 + PYTHONPATH
        $libRoot = Join-Path $Server 'libs\chayuan-server'
        if ($env:PYTHONPATH) {
            $env:PYTHONPATH = "$libRoot;$env:PYTHONPATH"
        } else {
            $env:PYTHONPATH = $libRoot
        }
        & $pythonBin -c 'import chayuan' 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Python 在 ($pythonBin) 但 import chayuan 失败"
            Write-Host '    解法 1:cd chayuan-server; pip install -e libs/chayuan-server' -ForegroundColor DarkGray
            Write-Host '    解法 2:检查 chayuan-server\libs\chayuan-server\chayuan\__init__.py 存在' -ForegroundColor DarkGray
            if (-not $CheckOnly) { exit 2 }
        } else {
            Write-Ok "Python: $pythonBin (可 import chayuan,PYTHONPATH=$libRoot)"
        }
    } else {
        Write-Err '找不到 python 也找不到 poetry'
        Write-Host '    装法:winget install Python.Python.3.12;pip install poetry' -ForegroundColor DarkGray
        exit 1
    }
}

# ────────────────── 3. vendor binary ──────────────────
Write-Step 'Step 2/4: 检查 vendor 二进制'
$llamaDir   = Join-Path $Server "vendor\services\llama-server\$VendorPlatform"
$whisperDir = Join-Path $Server "vendor\services\whisper-server\$VendorPlatform"

$llamaExe = Join-Path $llamaDir 'llama-server.exe'
if (Test-Path $llamaExe) {
    Write-Ok "llama-server: $llamaExe"
} else {
    Write-Warn "llama-server.exe 不在 $llamaDir\"
    Write-Host "    解法:.\scripts\install-llama-server.ps1 -Target $VendorPlatform" -ForegroundColor DarkGray
    if (-not $CheckOnly) { exit 2 }
}

$whisperExe = Join-Path $whisperDir 'whisper-server.exe'
if (Test-Path $whisperExe) {
    Write-Ok "whisper-server: $whisperExe"
} else {
    Write-Warn "whisper-server.exe 不在 $whisperDir\(ASR 会 fallback Python faster-whisper)"
    Write-Host '    解法:.\scripts\install-whisper-server.ps1' -ForegroundColor DarkGray
}

# ────────────────── 4. CHAYUAN_ROOT ──────────────────
Write-Step 'Step 3/4: CHAYUAN_ROOT 数据目录'
if (-not $ChayuanRoot) {
    if ($env:CHAYUAN_ROOT) {
        $ChayuanRoot = $env:CHAYUAN_ROOT
    } else {
        $ChayuanRoot = Join-Path $env:USERPROFILE '.chayuan-dev'
    }
}
if (-not (Test-Path $ChayuanRoot)) {
    New-Item -ItemType Directory -Force -Path $ChayuanRoot | Out-Null
}
$env:CHAYUAN_ROOT = $ChayuanRoot
$env:CHAYUAN_VENDOR_PLATFORM = $VendorPlatform
Write-Ok "CHAYUAN_ROOT=$ChayuanRoot  (env CHAYUAN_VENDOR_PLATFORM=$VendorPlatform)"

# 首次需 chayuan init -q
$baseYaml = Join-Path $ChayuanRoot 'basic_settings.yaml'
if (-not (Test-Path $baseYaml)) {
    Write-Step '首次启动:跑 chayuan init -q 初始化数据目录'
    Push-Location $Server
    try {
        if ($poetryExe) {
            & poetry run python -m chayuan init -q --profile local
        } else {
            & $pythonBin -m chayuan init -q --profile local
        }
    } finally { Pop-Location }
    Write-Ok "基础 yaml 已生成 → $ChayuanRoot\"
}

if ($CheckOnly) {
    Write-Ok 'preflight 全部通过 (-CheckOnly)'
    exit 0
}

# ────────────────── 5. 启 chayuan-server ──────────────────
Write-Step "Step 4/4: 启 chayuan-server (port=$Port)"
$logFile = Join-Path $env:TEMP 'chayuan-dev.log'
$pidFile = Join-Path $env:TEMP 'chayuan-dev.pid'

# 清理已有进程
if (Test-Path $pidFile) {
    $oldPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
        Write-Warn "已有 dev sidecar pid=$oldPid,先停掉"
        Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}

Set-Location $Server
if ($poetryExe -and $venvPath) {
    $cmdExe = 'poetry'
    $cmdArgs = @('run', 'python', '-m', 'chayuan', 'start', '-a', '--single-machine')
} else {
    $cmdExe = $pythonBin
    $cmdArgs = @('-m', 'chayuan', 'start', '-a', '--single-machine')
}

if ($Bg) {
    $p = Start-Process -FilePath $cmdExe -ArgumentList $cmdArgs -RedirectStandardOutput $logFile -RedirectStandardError $logFile -PassThru -WindowStyle Hidden
    $p.Id | Set-Content $pidFile
    Write-Ok "spawned pid=$($p.Id),日志:$logFile"

    # health probe:60s 内每 2s curl /healthz,任一成功就退;期间检测进程还活着
    Write-Step "等 health(最多 60s):http://127.0.0.1:$Port/healthz"
    $deadline = (Get-Date).AddSeconds(60)
    $healthy = $false
    while ((Get-Date) -lt $deadline) {
        if ($p.HasExited) {
            Write-Err "chayuan-server 已退出(pid=$($p.Id), exitcode=$($p.ExitCode)),启动失败"
            Write-Host '    最后 20 行日志:' -ForegroundColor DarkGray
            Get-Content $logFile -Tail 20 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
            Remove-Item $pidFile -ErrorAction SilentlyContinue
            exit 3
        }
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/healthz" -TimeoutSec 2 -ErrorAction Stop
            if ($r.StatusCode -eq 200) { $healthy = $true; break }
        } catch { }
        Start-Sleep -Seconds 2
    }

    if ($healthy) {
        Write-Ok "ready ✓ (pid=$($p.Id) listening on :$Port)"
        Write-Host "    Get-Content -Wait $logFile   # 看日志"
        Write-Host "    Invoke-RestMethod http://127.0.0.1:$Port/healthz   # 再探活"
        Write-Host "    Stop-Process -Id (Get-Content $pidFile)   # 关掉"
    } else {
        Write-Err "60s 内 /healthz 没返 200,server 可能卡在启动中"
        Write-Host "    pid=$($p.Id) 还活着,看日志:Get-Content -Wait $logFile" -ForegroundColor DarkGray
        Write-Host "    要强制关:Stop-Process -Id $($p.Id) -Force" -ForegroundColor DarkGray
        exit 4
    }
} else {
    Write-Ok '前台启动(Ctrl+C 退出)'
    & $cmdExe @cmdArgs
}
