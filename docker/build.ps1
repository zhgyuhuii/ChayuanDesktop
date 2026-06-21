#Requires -Version 5.1
<#
  Chayuan integrated docker image build (Windows / PowerShell).
  Mirrors docker/build.sh:
    - base env image (system + python deps): tagged by poetry.lock hash,
      reused when deps unchanged, auto-rebuilt when poetry.lock changes.
    - web base image (chayuan-web-base): tagged by pnpm-lock.yaml hash; pnpm fetch
      bakes node deps in, app image installs offline -> no network re-pull on code change.
    - app image: FROM base, only COPY layers, so no dependency re-pull.
    - image tag == local VERSION file (image version matches system version).

  Usage (Docker Desktop, Linux containers):
    powershell -ExecutionPolicy Bypass -File docker\build.ps1
    docker\build.ps1 -RebuildBase    # force rebuild base (refresh apt / poetry)
    docker\build.ps1 -NoCache        # app image without cache (deps still from base)
    docker\build.ps1 -NoClean        # skip pre-build cleanup of historical images

  By default this cleans historical images before building: removes old
  chayuan-server version tags, stale-hash chayuan-base images, and dangling
  (<none>) layers, while keeping the chayuan-server:latest / current VERSION /
  current BASE_TAG that this build needs (frees disk without breaking base
  reuse or deleting the in-use latest).
#>
param(
    [switch]$RebuildBase,
    [switch]$NoCache,
    [switch]$NoClean
)

$ErrorActionPreference = "Stop"
# PowerShell 7.4+ defaults $PSNativeCommandUseErrorActionPreference=$true, which turns a
# native command's non-zero exit (e.g. 'docker image inspect' on a missing image, or docker
# build writing progress to stderr) into a TERMINATING error under -Stop, aborting the script.
# Disable it and check $LASTEXITCODE explicitly instead. (PS 5.1 has no such var; assign is harmless.)
$PSNativeCommandUseErrorActionPreference = $false
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

# 2b) web base tag = pnpm-lock.yaml content hash (frontend deps cached/reused; pnpm fetch not re-pulled)
$PnpmLock = Join-Path $RepoRoot "chayuan-client\pnpm-lock.yaml"
if (-not (Test-Path $PnpmLock)) { throw "pnpm-lock.yaml not found: $PnpmLock" }
$PnpmLockHash = (Get-FileHash -Algorithm SHA256 -Path $PnpmLock).Hash.Substring(0, 12).ToLower()
$WebBaseTag = "chayuan-web-base:$PnpmLockHash"

Write-Host "[build] VERSION=$Version  BASE=$BaseTag  WEB_BASE=$WebBaseTag"

# 2.5) clean historical images (default on; -NoClean to skip). Runs after VERSION
#      and BaseTag are known and before any build, keeping latest / VERSION / BaseTag.
function Remove-OldImages {
    Write-Host "[build] cleaning historical images (keep :latest / :$Version / $BaseTag)..."
    $verEsc  = [regex]::Escape($Version)
    $hashEsc = [regex]::Escape($LockHash)
    # old chayuan-server version tags (not latest, not current VERSION)
    (& $Docker images chayuan-server --format "{{.Repository}}:{{.Tag}}" 2>$null) |
        Where-Object { $_ -and ($_ -notmatch ":(latest|$verEsc)$") -and ($_ -notmatch "<none>") } |
        ForEach-Object { Write-Host "  - rmi $_"; & $Docker rmi $_ 2>$null | Out-Null }
    # stale-hash chayuan-base (not current lock hash, not latest)
    (& $Docker images chayuan-base --format "{{.Repository}}:{{.Tag}}" 2>$null) |
        Where-Object { $_ -and ($_ -notmatch ":($hashEsc|latest)$") -and ($_ -notmatch "<none>") } |
        ForEach-Object { Write-Host "  - rmi $_"; & $Docker rmi $_ 2>$null | Out-Null }
    # stale-hash chayuan-web-base (not current pnpm-lock hash, not latest)
    $pnpmEsc = [regex]::Escape($PnpmLockHash)
    (& $Docker images chayuan-web-base --format "{{.Repository}}:{{.Tag}}" 2>$null) |
        Where-Object { $_ -and ($_ -notmatch ":($pnpmEsc|latest)$") -and ($_ -notmatch "<none>") } |
        ForEach-Object { Write-Host "  - rmi $_"; & $Docker rmi $_ 2>$null | Out-Null }
    # dangling (<none>) layers left after tag replacement -- the biggest disk eater
    & $Docker image prune -f 2>$null | Out-Null
}
if (-not $NoClean) { Remove-OldImages } else { Write-Host "[build] skip historical image cleanup (-NoClean)" }

# 3) base: build if missing or -RebuildBase (deps downloaded only here)
# 'docker images -q <ref>' prints the image id if present, empty if not, and exits 0 either way
# (unlike 'image inspect' which errors on a missing image). Avoids aborting on first run.
$BaseId = (& $Docker images -q $BaseTag 2>$null | Select-Object -First 1)
$BaseExists = -not [string]::IsNullOrWhiteSpace($BaseId)
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

# 3b) web base: build if missing or -RebuildBase (frontend deps pnpm-fetched only here)
$WebBaseId = (& $Docker images -q $WebBaseTag 2>$null | Select-Object -First 1)
$WebBaseExists = -not [string]::IsNullOrWhiteSpace($WebBaseId)
if ($RebuildBase -or (-not $WebBaseExists)) {
    Write-Host "[build] building web base image $WebBaseTag (pnpm fetch all deps)..."
    $WebArgs = @("build")
    if ($Nocache) { $WebArgs += $Nocache }
    $WebArgs += @("-f", "docker/Dockerfile.webbase", "--build-arg", "PNPM_LOCK_HASH=$PnpmLockHash", "-t", $WebBaseTag, "-t", "chayuan-web-base:latest", ".")
    & $Docker @WebArgs
    if ($LASTEXITCODE -ne 0) { throw "web base build failed" }
}
else {
    Write-Host "[build] reusing existing web base image $WebBaseTag (deps unchanged, no pull)"
}

# 4) app image: FROM base + web base, tag == VERSION + latest
Write-Host "[build] building app image chayuan-server:$Version ..."
$AppArgs = @("build")
if ($Nocache) { $AppArgs += $Nocache }
$AppArgs += @("-f", "docker/Dockerfile", "--build-arg", "BASE_IMAGE=$BaseTag", "--build-arg", "WEB_BASE_IMAGE=$WebBaseTag", "-t", "chayuan-server:$Version", "-t", "chayuan-server:latest", ".")
& $Docker @AppArgs
if ($LASTEXITCODE -ne 0) { throw "app build failed" }

Write-Host "[build] done: chayuan-server:$Version (= latest), base=$BaseTag, web-base=$WebBaseTag"
Write-Host "[build] start: cd docker; docker compose up -d"
