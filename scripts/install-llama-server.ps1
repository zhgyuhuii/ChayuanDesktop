<#
.SYNOPSIS
  下载 llama-server.exe (Win64) 到 vendor/services/llama-server/<target>/。

.PARAMETER Version
  llama.cpp release tag,默认 'b4404'。

.PARAMETER Target
  vendor 平台子目录 + 对应 upstream asset。不传 = 按 PROCESSOR_ARCHITECTURE 选默认 win-x64 / win-arm64。
  支持:
    win-x64         (AVX2,Haswell 2013+,默认)
    win-x64-avx     (AVX 老 Sandy/Ivy Bridge)
    win-x64-avx512  (Skylake-X / Xeon)
    win-x64-noavx   (Pentium/Celeron / VM)
    win-arm64       (Surface Pro X / Copilot+ PC)

.EXAMPLE
  .\scripts\install-llama-server.ps1                              # 自动 host
  .\scripts\install-llama-server.ps1 -Target win-x64-noavx        # 强制 noavx
  .\scripts\install-llama-server.ps1 -Version b4500 -Target win-arm64
#>
[CmdletBinding()]
param(
    [string]$Version = 'b4404',
    [string]$Target = ''
)

try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    chcp 65001 > $null 2>&1
} catch {}

$ErrorActionPreference = 'Stop'

# Auto host detection
if (-not $Target) {
    $cpuArch = ($env:PROCESSOR_ARCHITECTURE + '').ToUpperInvariant()
    if ($cpuArch -eq 'ARM64') {
        $Target = 'win-arm64'
    } else {
        $Target = 'win-x64'  # AMD64 / EM64T → AVX2 默认
    }
}

# Target → upstream asset
$assetMap = @{
    'win-x64'        = "llama-$Version-bin-win-avx2-x64.zip"
    'win-x64-avx'    = "llama-$Version-bin-win-avx-x64.zip"
    'win-x64-avx512' = "llama-$Version-bin-win-avx512-x64.zip"
    'win-x64-noavx'  = "llama-$Version-bin-win-noavx-x64.zip"
    'win-arm64'      = "llama-$Version-bin-win-llvm-arm64.zip"
}
if (-not $assetMap.ContainsKey($Target)) {
    Write-Error "未识别的 target: $Target  (支持: $($assetMap.Keys -join ', '))"
    exit 1
}
$zipName = $assetMap[$Target]

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspaceRoot = Split-Path -Parent $here
$destDir = Join-Path $workspaceRoot ('chayuan-server\vendor\services\llama-server\' + $Target)

if (-not (Test-Path $destDir)) {
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
}

$url = "https://github.com/ggerganov/llama.cpp/releases/download/$Version/$zipName"
$tmpZip = Join-Path $env:TEMP $zipName

Write-Host "[install-llama-server] target=$Target asset=$zipName dest=$destDir"
Write-Host "[install-llama-server] 下载 $url"
Invoke-WebRequest -Uri $url -OutFile $tmpZip -UseBasicParsing
Write-Host "[install-llama-server] 下完,$([math]::Round((Get-Item $tmpZip).Length/1MB,1)) MB"

# 解压
$tmpExtract = Join-Path $env:TEMP ('llama-' + $Version + '-' + $Target + '-extract')
if (Test-Path $tmpExtract) { Remove-Item $tmpExtract -Recurse -Force }
Expand-Archive -Path $tmpZip -DestinationPath $tmpExtract -Force

# 清旧
Get-ChildItem $destDir -File | Where-Object {
    $_.Extension -in '.exe', '.dll', '.so', '.dylib'
} | Remove-Item -Force

# 拷 llama-server.exe + 所有 dll
$needed = Get-ChildItem $tmpExtract -Recurse -File | Where-Object {
    $_.Name -eq 'llama-server.exe' -or $_.Extension -eq '.dll'
}
foreach ($f in $needed) {
    Copy-Item $f.FullName (Join-Path $destDir $f.Name) -Force
    Write-Host "  $($f.Name)  ($([math]::Round($f.Length/1MB,2)) MB)"
}

# 元数据
"$Version`n$(Get-Date -Format 'yyyy-MM-dd')`n" | Set-Content -Path (Join-Path $destDir 'VERSION') -NoNewline
$licInZip = Get-ChildItem $tmpExtract -Recurse -File -Filter 'LICENSE' | Select-Object -First 1
if ($licInZip -and -not (Test-Path (Join-Path $destDir 'LICENSE'))) {
    Copy-Item $licInZip.FullName (Join-Path $destDir 'LICENSE') -Force
}

Remove-Item $tmpZip -Force
Remove-Item $tmpExtract -Recurse -Force

Write-Host ""
Write-Host "[install-llama-server] 完成 → $destDir"
Get-ChildItem $destDir -File | Format-Table Name, @{N='MB';E={$([math]::Round($_.Length/1MB,2))}}
