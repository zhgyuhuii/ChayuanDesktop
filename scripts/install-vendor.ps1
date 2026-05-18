#requires -Version 5.1
<#
.SYNOPSIS
    一站式装齐 chayuan-server/vendor/ 下的所有打包资源 — 模型、服务 binary、torch wheels。

.DESCRIPTION
    打包前的 prerequisite。按 -Flavor(lite / full)+ -Components 决定要装哪些:

      模型:scripts\install-bundled-models.py (--lite / 全量)
          → 装到 vendor\bundled_models\<cap>\<repo>\
          LITE_CAPS  = embedding / rerank / asr / ocr / tts (~1.4 GB)
          FULL_CAPS  = LITE_CAPS + chat / image (~3.5 GB)

      服务 binary:install-llama-server.ps1 + install-whisper-server.ps1
          → 装到 vendor\services\<engine>\<platform>\<exe>
          (lite/full 都要,没 launcher binary sidecar 起不来)

      torch wheels:chayuan-server\packaging\preflight_torch.py
          → 装到 vendor\torch_wheels\<platform_py_var>\
          (chayuan-server.exe 启动时离线 pip install torch + torchvision 兜底)

    所有子步骤都幂等:已下载过的会跳过,失败的局部重试。

.PARAMETER Flavor
    模型范围:lite(default,~1.4 GB)或 full(~3.5 GB,含 chat 主力 + image)。

.PARAMETER Components
    要装哪些组件,逗号分隔。默认 'models,services,torch'。
    可选:models / services / torch / all / none。
    例:仅装 services 用 ``-Components services``。

.PARAMETER Source
    模型下载源,透传给 install-bundled-models.py:
      auto(default)= HF (hf-mirror) 优先 → 失败降级 ModelScope
      hf           = 强制 HF
      modelscope   = MS 优先(已知 hf-mirror 卡 Xet 时切这个)

.PARAMETER LlamaVersion / WhisperVersion
    指定 vendor binary 版本,透传给对应 install-*.ps1。默认值同子脚本。

.PARAMETER SkipNetTest
    Switch:跳过开头的网络可达性检测。CI / 已知联网 OK 时用。

.PARAMETER DryRun
    Switch:只打印将要执行的命令,不真跑。验证逻辑用。

.EXAMPLE
    # 装齐 lite 打包所需(模型 lite 子集 + services + torch CPU)
    .\install-vendor.ps1

.EXAMPLE
    # full 装齐(chat 大模型 + image-embedding 全套)
    .\install-vendor.ps1 -Flavor full

.EXAMPLE
    # 只补 tts(piper)
    .\install-vendor.ps1 -Components models  # 之后跑 install-bundled-models.py --only tts

.EXAMPLE
    # MS 优先(内网 hf-mirror 不通时)
    .\install-vendor.ps1 -Source modelscope

.EXAMPLE
    # 装 services + torch wheels(模型已经装过)
    .\install-vendor.ps1 -Components services,torch
#>
[CmdletBinding()]
param(
    [ValidateSet('lite','full')]
    [string]$Flavor = 'lite',

    [string]$Components = 'models,services,torch',

    [ValidateSet('auto','hf','modelscope')]
    [string]$Source = 'auto',

    [string]$LlamaVersion   = '',
    [string]$WhisperVersion = '',

    [switch]$SkipNetTest,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# ───────── 路径 ─────────
$here          = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkspaceRoot = Split-Path -Parent $here
$ServerDir     = Join-Path $WorkspaceRoot 'chayuan-server'
$VendorDir     = Join-Path $ServerDir 'vendor'

function Write-Step  { param([string]$Msg) Write-Host ''; Write-Host ('=== ' + $Msg + ' ===') -ForegroundColor Cyan }
function Write-Note  { param([string]$Msg) Write-Host ('  ' + $Msg) -ForegroundColor DarkCyan }
function Write-Ok    { param([string]$Msg) Write-Host ('  [OK] ' + $Msg) -ForegroundColor Green }
function Write-Warn  { param([string]$Msg) Write-Host ('  [WARN] ' + $Msg) -ForegroundColor Yellow }
function Write-Fail  { param([string]$Msg) Write-Host ('  [FAIL] ' + $Msg) -ForegroundColor Red }

Write-Host ('install-vendor.ps1 — Flavor={0}  Components={1}  Source={2}' -f $Flavor, $Components, $Source)
Write-Host ('  Workspace: ' + $WorkspaceRoot)
Write-Host ('  Vendor:    ' + $VendorDir)

# 解析 -Components
$wantedComponents = @($Components -split ',' | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ })
if ($wantedComponents -contains 'all')  { $wantedComponents = @('models','services','torch') }
if ($wantedComponents -contains 'none') { $wantedComponents = @() }
$doModels   = $wantedComponents -contains 'models'
$doServices = $wantedComponents -contains 'services'
$doTorch    = $wantedComponents -contains 'torch'

if (-not ($doModels -or $doServices -or $doTorch)) {
    Write-Warn '-Components 没启用任何阶段,直接退出'
    exit 0
}

# ───────── 0. 网络可达性 ─────────
function Test-Net {
    param([string]$Url, [int]$TimeoutSec = 5)
    try {
        $resp = Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing -TimeoutSec $TimeoutSec -ErrorAction Stop
        return $true
    } catch [System.Net.WebException] {
        # 4xx/5xx 也算"网络通了,只是 HEAD 不支持"
        $code = $null
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        if ($code -and $code -ge 400 -and $code -lt 600) { return $true }
        return $false
    } catch { return $false }
}

if (-not $SkipNetTest) {
    Write-Step '0. 网络可达性检测'
    # 按"哪个 component 用哪个域名"列表
    $hosts = New-Object System.Collections.Generic.List[hashtable]
    if ($doModels) {
        $hosts.Add(@{ Url='https://hf-mirror.com/';     Use='models (HF 镜像 — 主路径)';     Critical=$true })
        $hosts.Add(@{ Url='https://huggingface.co/';     Use='models (HF 直连 — 海外兜底)';    Critical=$false })
        $hosts.Add(@{ Url='https://modelscope.cn/';      Use='models (ModelScope — 内网兜底)'; Critical=$false })
    }
    if ($doServices) {
        $hosts.Add(@{ Url='https://github.com/';                       Use='services (GitHub release API)';   Critical=$true })
        $hosts.Add(@{ Url='https://objects.githubusercontent.com/';    Use='services (GitHub asset CDN)';     Critical=$false })
    }
    if ($doTorch) {
        $hosts.Add(@{ Url='https://download.pytorch.org/';   Use='torch wheels (PyTorch 官方索引)'; Critical=$true })
    }

    $netOk = $true
    foreach ($h in $hosts) {
        $ok = Test-Net -Url $h.Url -TimeoutSec 8
        if ($ok) {
            Write-Ok ('{0,-45} ← {1}' -f $h.Url, $h.Use)
        } else {
            if ($h.Critical) {
                Write-Fail ('{0,-45} ← {1} (CRITICAL)' -f $h.Url, $h.Use)
                $netOk = $false
            } else {
                Write-Warn ('{0,-45} ← {1} (备用,不致命)' -f $h.Url, $h.Use)
            }
        }
    }
    if (-not $netOk) {
        Write-Host ''
        Write-Host '[FAIL] 关键域名不可达,继续装会卡在下载阶段。处理:' -ForegroundColor Red
        Write-Host '  · 检查公司代理 / VPN 是否生效'                       -ForegroundColor DarkYellow
        Write-Host '  · 若只是 hf-mirror 不通,加 -Source modelscope 走 MS' -ForegroundColor DarkYellow
        Write-Host '  · 内网完全无外网 → 拿外网机器跑此脚本,把 vendor\ 整目录拷过来' -ForegroundColor DarkYellow
        Write-Host '  · 想强行继续(自担风险),加 -SkipNetTest'              -ForegroundColor DarkYellow
        exit 2
    }
}

# ───────── 1. Python 解释器 ─────────
# PS 5.1 没 ?? 空值合并;显式 if 兼容
$pyExe = Get-Command python -ErrorAction SilentlyContinue
if (-not $pyExe) { $pyExe = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $pyExe -and ($doModels -or $doTorch)) {
    Write-Fail 'PATH 找不到 python / python3 — models / torch 阶段需要。先装 Python 3.10+ 再重跑。'
    exit 3
}

function Invoke-Sub {
    param([string]$Title, [string]$Cmd, [string[]]$Args)
    Write-Host ''
    Write-Host ('  $ ' + $Cmd + ' ' + ($Args -join ' ')) -ForegroundColor DarkGray
    if ($DryRun) {
        Write-Warn ('[DRY-RUN] 跳过 ' + $Title)
        return $true
    }
    & $Cmd @Args
    $rc = $LASTEXITCODE
    if ($rc -eq 0) {
        Write-Ok ($Title + ' 完成')
        return $true
    } else {
        Write-Fail ($Title + " 失败 (exit=$rc)")
        return $false
    }
}

# ───────── 2. 装模型 ─────────
$results = New-Object System.Collections.Generic.List[hashtable]

if ($doModels) {
    Write-Step ('1. 装模型 (Flavor=' + $Flavor + ', Source=' + $Source + ')')
    $modelArgs = @((Join-Path $here 'install-bundled-models.py'), '--source', $Source)
    if ($Flavor -eq 'lite') { $modelArgs += '--lite' }
    $ok = Invoke-Sub -Title 'install-bundled-models' -Cmd $pyExe.Source -Args $modelArgs
    $results.Add(@{ Stage='models'; Ok=$ok })
}

# ───────── 3. 装 services binary ─────────
if ($doServices) {
    Write-Step '2. 装 services binary (llama-server + whisper-server)'

    $llamaPs1   = Join-Path $here 'install-llama-server.ps1'
    $whisperPs1 = Join-Path $here 'install-whisper-server.ps1'

    if (Test-Path $llamaPs1) {
        $llArgs = @('-File', $llamaPs1)
        if ($LlamaVersion) { $llArgs += @('-Version', $LlamaVersion) }
        $ok = Invoke-Sub -Title 'install-llama-server' -Cmd 'powershell.exe' -Args $llArgs
        $results.Add(@{ Stage='llama-server'; Ok=$ok })
    } else {
        Write-Fail "install-llama-server.ps1 不存在: $llamaPs1"
        $results.Add(@{ Stage='llama-server'; Ok=$false })
    }

    if (Test-Path $whisperPs1) {
        $wsArgs = @('-File', $whisperPs1)
        if ($WhisperVersion) { $wsArgs += @('-Version', $WhisperVersion) }
        $ok = Invoke-Sub -Title 'install-whisper-server' -Cmd 'powershell.exe' -Args $wsArgs
        $results.Add(@{ Stage='whisper-server'; Ok=$ok })
    } else {
        Write-Fail "install-whisper-server.ps1 不存在: $whisperPs1"
        $results.Add(@{ Stage='whisper-server'; Ok=$false })
    }
}

# ───────── 4. 装 torch wheels ─────────
if ($doTorch) {
    Write-Step '3. 装 torch wheels (CPU,~250 MB)'
    $preflight = Join-Path $ServerDir 'packaging\preflight_torch.py'
    if (-not (Test-Path $preflight)) {
        Write-Fail "preflight_torch.py 不存在: $preflight"
        $results.Add(@{ Stage='torch'; Ok=$false })
    } else {
        # 用 poetry run 优先(确保跟 PyInstaller spec 用同一个 Python ABI)
        $poetryExe = Get-Command poetry -ErrorAction SilentlyContinue
        if ($poetryExe) {
            $cwd = Get-Location
            Set-Location $ServerDir
            try {
                $ok = Invoke-Sub -Title 'preflight-torch (poetry)' `
                                 -Cmd 'poetry' `
                                 -Args @('run','python','packaging\preflight_torch.py','--variants','cpu','--py-versions','312')
            } finally {
                Set-Location $cwd
            }
        } else {
            $ok = Invoke-Sub -Title 'preflight-torch (python)' `
                             -Cmd $pyExe.Source `
                             -Args @($preflight, '--variants','cpu','--py-versions','312')
        }
        $results.Add(@{ Stage='torch'; Ok=$ok })
    }
}

# ───────── 5. 最终体检 ─────────
Write-Step '4. 最终体检 (vendor/ 完整性)'
$checkM = Join-Path $here 'check-bundled-models.py'
$checkS = Join-Path $here 'check-services.py'
$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -eq 'ARM64') { $hostVendorPlat = 'win-arm64' } else { $hostVendorPlat = 'win-x64' }

if ($pyExe -and (Test-Path $checkM)) {
    & $pyExe.Source $checkM
}
if ($pyExe -and (Test-Path $checkS)) {
    & $pyExe.Source $checkS --target $hostVendorPlat
}

# ───────── 6. 总结 ─────────
Write-Step '总结'
$anyFail = $false
foreach ($r in $results) {
    if ($r.Ok) {
        Write-Ok ('{0,-16} OK' -f $r.Stage)
    } else {
        Write-Fail ('{0,-16} FAILED' -f $r.Stage)
        $anyFail = $true
    }
}

if ($anyFail) {
    Write-Host ''
    Write-Host '[FAIL] 至少一个阶段失败。常见处理:' -ForegroundColor Red
    Write-Host '  models 失败  → 加 -Source modelscope 切镜像;或在外网机器跑 install-bundled-models.py 拷 vendor\bundled_models\ 过来' -ForegroundColor DarkYellow
    Write-Host '  services 失败 → 看子脚本 stdout (GitHub release 限速 / 网线);或外网机器跑 install-llama-server.ps1 拷 vendor\services\ 过来' -ForegroundColor DarkYellow
    Write-Host '  torch 失败   → 加 --skip-torch-preflight 跳过整个 torch wheel preflight(代价:装机用户得在线装 torch)' -ForegroundColor DarkYellow
    exit 1
}

Write-Host ''
Write-Host '[OK] vendor/ 完整,可以跑 .\build-desktop.ps1 -LiteOnly' -ForegroundColor Green
exit 0
