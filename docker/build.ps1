#Requires -Version 5.1
<#
  Chayuan integrated docker image build (Windows / PowerShell).
  Mirrors docker/build.sh:
    - base env image (system + python deps): tagged by poetry.lock hash,
      reused when deps unchanged, auto-rebuilt when poetry.lock changes.
    - app image: FROM base, only COPY layers, so no dependency re-pull.
    - image tag == local VERSION file (image version matches system version).

  Usage (Docker Desktop, Linux containers):
    powershell -ExecutionPolicy Bypass -File docker\build.ps1
    docker\build.ps1 -RebuildBase    # force rebuild base (refresh apt / poetry)
    docker\build.ps1 -NoCache        # app image without cache (deps still from base)
#>
param(
    [switch]$RebuildBase,
    [switch]$NoCache
)

$ErrorActionPreference = "Stop"
chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()

# repo root = parent of this script's docker/ folder
$RepoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $RepoRoot
$Docker = if ($env:DOCKER) { $env:DOCKER } else { "docker" }
$Nocache = if ($NoCache) { "--no-cache" } else { $null }

# 1) version: read local VERSION (image tag == system version)
$Version = (Get-Content -Raw (Join-Path $RepoRoot "VERSION")).Trim()
if ([string]::IsNullOrWhiteSpace($Version)) { throw "VERSION is empty" }

# 2) base tag = poetry.lock content hash (deps unchanged means reuse base)
$Lock = Join-Path $RepoRoot "chayuan-server\libs\chayuan-server\poetry.lock"
if (-not (Test-Path $Lock)) { throw "poetry.lock not found: $Lock" }
$LockHash = (Get-FileHash -Algorithm SHA256 -Path $Lock).Hash.Substring(0, 12).ToLower()
$BaseTag = "chayuan-base:$LockHash"

Write-Host "[build] VERSION=$Version  BASE=$BaseTag"

# 3) base: build if missing or -RebuildBase (deps downloaded only here)
& $Docker image inspect $BaseTag 2>$null | Out-Null
$BaseExists = ($LASTEXITCODE -eq 0)
if ($RebuildBase -or (-not $BaseExists)) {
    Write-Host "[build] building base env image $BaseTag (download all deps)..."
    $BaseArgs = @("build")
    if ($Nocache) { $BaseArgs += $Nocache }
    $BaseArgs += @("-f", "docker/Dockerfile.base", "--build-arg", "LOCK_HASH=$LockHash", "-t", $BaseTag, "-t", "chayuan-base:latest", ".")
    & $Docker @BaseArgs
    if ($LASTEXITCODE -ne 0) { throw "base build failed" }
}
else {
    Write-Host "[build] reusing existing base image $BaseTag (deps unchanged, no pull)"
}

# 4) app image: FROM base, tag == VERSION + latest
Write-Host "[build] building app image chayuan-server:$Version ..."
$AppArgs = @("build")
if ($Nocache) { $AppArgs += $Nocache }
$AppArgs += @("-f", "docker/Dockerfile", "--build-arg", "BASE_IMAGE=$BaseTag", "-t", "chayuan-server:$Version", "-t", "chayuan-server:latest", ".")
& $Docker @AppArgs
if ($LASTEXITCODE -ne 0) { throw "app build failed" }

Write-Host "[build] done: chayuan-server:$Version (= latest), base=$BaseTag"
Write-Host "[build] start: cd docker; docker compose up -d"
