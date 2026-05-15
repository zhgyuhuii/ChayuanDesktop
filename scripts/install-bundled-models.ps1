<#
.SYNOPSIS
  Windows 一键下载 vendor/bundled_models/ 的瘦身默认集。

.DESCRIPTION
  调 scripts/install-bundled-models.py。本 .ps1 只做三件事:
    1. 找 Python (优先 python,回退 python3)
    2. 设 HF_ENDPOINT(脚本内部还会再设一次,这里是为了用户看着舒服)
    3. 把所有参数透传给 .py

  下载清单(全部 < 2 GB,Windows installer 友好):
    chat       Qwen3-4B Q3_K_S   ~1.85 GB
    embedding  gte-multilingual-base       ~1.22 GB
    rerank     gte-multilingual-reranker-base ~584 MB
    asr        whisper.cpp ggml-tiny       ~74 MB

.PARAMETER Only
  只下指定 capability:chat / embedding / rerank / asr

.PARAMETER Clean
  下载前清空目标子目录(干净换装)

.PARAMETER Endpoint
  指定 HF 镜像 URL。默认 https://hf-mirror.com;
  如果它挂了试 -Endpoint https://huggingface.co 直连官方。

.EXAMPLE
  .\scripts\install-bundled-models.ps1
  # 默认 4 大件全下

.EXAMPLE
  .\scripts\install-bundled-models.ps1 -Only chat -Clean
  # 重下 chat 模型(先删旧)

.EXAMPLE
  .\scripts\install-bundled-models.ps1 -Endpoint https://huggingface.co
  # hf-mirror 挂了,改直连官方
#>
[CmdletBinding()]
param(
    [ValidateSet('chat','embedding','rerank','asr')]
    [string]$Only,
    [switch]$Clean,
    [string]$Endpoint = 'https://hf-mirror.com'
)

$ErrorActionPreference = 'Stop'

# UTF-8 控制台,避免中文 mojibake
try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    chcp 65001 > $null 2>&1
} catch {}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspace = Split-Path -Parent $here
$pyScript = Join-Path $here 'install-bundled-models.py'

if (-not (Test-Path $pyScript)) {
    Write-Host "[FAIL] 找不到 $pyScript" -ForegroundColor Red
    exit 1
}

# 找 Python:python > python3
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $python) {
    Write-Host "[FAIL] 未找到 python / python3。装 Python 3.10+ 再来:" -ForegroundColor Red
    Write-Host "       https://www.python.org/downloads/"
    exit 1
}

Write-Host "[install] Python: $($python.Source)"
Write-Host "[install] HF_ENDPOINT: $Endpoint"
Write-Host ""

# 把参数装回 .py 用的形式
$pyArgs = @($pyScript, '--workspace', $workspace, '--endpoint', $Endpoint)
if ($Only)  { $pyArgs += @('--only', $Only) }
if ($Clean) { $pyArgs += '--clean' }

# 给 .py 也喂一份 env(它内部还会 set 一次,这里是双保险)
$env:HF_ENDPOINT = $Endpoint
$env:HUGGINGFACE_HUB_ENDPOINT = $Endpoint

& $python.Source @pyArgs
exit $LASTEXITCODE
