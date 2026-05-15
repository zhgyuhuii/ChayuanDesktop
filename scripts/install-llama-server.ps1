﻿<#
.SYNOPSIS
  下载 llama-server.exe (CPU only build) 到 vendor/services/llama-server/。

.PARAMETER Version
  llama.cpp release tag，默认 'b4404' (2025-12 LTS-ish build)。
  改时同步更新 vendor/services/llama-server/VERSION 文件。

.EXAMPLE
  .\scripts\install-llama-server.ps1
#>
[CmdletBinding()]
param(
    [string]$Version = 'b4404'
)

try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    chcp 65001 > $null 2>&1
} catch {}

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspaceRoot = Split-Path -Parent $here
$destDir = Join-Path $workspaceRoot 'chayuan-server\vendor\services\llama-server'

if (-not (Test-Path $destDir)) {
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
}

$zipName = "llama-$Version-bin-win-cpu-x64.zip"
$url = "https://github.com/ggerganov/llama.cpp/releases/download/$Version/$zipName"
$tmpZip = Join-Path $env:TEMP $zipName

Write-Host "[install-llama-server] 下载 $url"
Invoke-WebRequest -Uri $url -OutFile $tmpZip -UseBasicParsing
Write-Host "[install-llama-server] 下完,$([math]::Round((Get-Item $tmpZip).Length/1MB,1)) MB"

# 解压到临时目录,挑 llama-server.exe + 必需 dll
$tmpExtract = Join-Path $env:TEMP "llama-$Version-extract"
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

# 写 VERSION 文件
"$Version`n$(Get-Date -Format 'yyyy-MM-dd')`n" | Set-Content -Path (Join-Path $destDir 'VERSION') -NoNewline

Remove-Item $tmpZip -Force
Remove-Item $tmpExtract -Recurse -Force

Write-Host ""
Write-Host "[install-llama-server] 完成。 $destDir 内容:"
Get-ChildItem $destDir -File | Format-Table Name, @{N='MB';E={$([math]::Round($_.Length/1MB,2))}}
