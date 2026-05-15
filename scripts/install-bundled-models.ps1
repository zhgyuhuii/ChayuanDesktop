<#
.SYNOPSIS
  Windows 一键下载 vendor/bundled_models/ 的瘦身默认集。

.DESCRIPTION
  调 scripts/install-bundled-models.py。本 .ps1 只做三件事:
    1. 找 Python (优先 python,回退 python3)
    2. 设 HF_ENDPOINT(脚本内部还会再设一次,这里是为了用户看着舒服)
    3. 把所有参数透传给 .py

  下载清单(全部 < 2 GB,Windows installer 友好):
    chat       Qwen3-4B Q3_K_S / Qwen2.5-3B Q4_K_M 兜底  ~1.85-1.96 GB
    embedding  gte-multilingual-base                     ~1.22 GB
    rerank     gte-multilingual-reranker-base            ~584 MB
    asr        whisper.cpp ggml-tiny                     ~74 MB
    ocr        SWHL/RapidOCR PP-OCRv4                    ~16 MB
    image      openai/clip-vit-base-patch32              ~605 MB

  Skip-if-exists:目录已有同名权重 + 总尺寸 ≥ 期望 85% 时**自动跳过**,
  不重复下载。要强制重下加 -Clean。

.PARAMETER Only
  只下指定 capability:chat / embedding / rerank / asr

.PARAMETER Clean
  下载前清空目标子目录(干净换装)

.PARAMETER Endpoint
  指定 HF 镜像 URL。默认 https://hf-mirror.com;
  如果它挂了试 -Endpoint https://huggingface.co 直连官方。

.PARAMETER Source
  下载源选择:
    auto       (默认) 先 HF,失败自动 fallback 到 ModelScope (国内 Alibaba 镜像)
    hf         强制 HF,失败不 fallback
    modelscope 跳过 HF 直接走 MS — 适合已知 hf-mirror 的 Xet 不通时

.EXAMPLE
  .\scripts\install-bundled-models.ps1
  # 默认 4 大件全下,auto fallback

.EXAMPLE
  .\scripts\install-bundled-models.ps1 -Source modelscope -Clean
  # 已知 HF Xet 不通,直接走 ModelScope,先清旧

.EXAMPLE
  .\scripts\install-bundled-models.ps1 -Only chat -Source modelscope
  # 只重下 chat(走 MS)
#>
[CmdletBinding()]
param(
    [ValidateSet('chat','embedding','rerank','asr','ocr','image')]
    [string]$Only,
    [switch]$Clean,
    [string]$Endpoint = 'https://hf-mirror.com',
    [ValidateSet('auto','hf','modelscope')]
    [string]$Source = 'auto'
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
$pyArgs = @($pyScript, '--workspace', $workspace, '--endpoint', $Endpoint, '--source', $Source)
if ($Only)  { $pyArgs += @('--only', $Only) }
if ($Clean) { $pyArgs += '--clean' }

# 给 .py 也喂一份 env(它内部还会 set 一次,这里是双保险)
$env:HF_ENDPOINT = $Endpoint
$env:HUGGINGFACE_HUB_ENDPOINT = $Endpoint

& $python.Source @pyArgs
exit $LASTEXITCODE
