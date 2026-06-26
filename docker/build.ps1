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
  (<none>) layers, while keeping the chayuan:latest / current VERSION /
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

# Combined content hash of several files (concat each file's SHA256, then hash that).
# Used so a base tag reflects BOTH the lockfile AND its Dockerfile -- editing the Dockerfile
# (e.g. adding minio to Dockerfile.base) changes the tag, so the base auto-rebuilds without
# needing -RebuildBase. Docker layer cache still hits unchanged apt/poetry layers, so only the
# changed layer runs (no full dependency re-download).
function Get-ComboHash([string[]]$Paths) {
    $acc = ""
    foreach ($p in $Paths) { $acc += (Get-FileHash -Algorithm SHA256 -Path $p).Hash }
    $ms = [System.IO.MemoryStream]::new([System.Text.Encoding]::ASCII.GetBytes($acc))
    return (Get-FileHash -InputStream $ms -Algorithm SHA256).Hash.Substring(0, 12).ToLower()
}

# 2) base tag = hash of (poetry.lock + Dockerfile.base)
$Lock = Join-Path $RepoRoot "chayuan-server\libs\chayuan-server\poetry.lock"
if (-not (Test-Path $Lock)) { throw "poetry.lock not found: $Lock" }
$DockerfileBase = Join-Path $RepoRoot "docker\Dockerfile.base"
if (-not (Test-Path $DockerfileBase)) { throw "Dockerfile.base not found: $DockerfileBase" }
$LockHash = Get-ComboHash @($Lock, $DockerfileBase)
$BaseTag = "chayuan-base:$LockHash"

# 2b) web base tag = hash of (pnpm-lock.yaml + Dockerfile.webbase)
$PnpmLock = Join-Path $RepoRoot "chayuan-client\pnpm-lock.yaml"
if (-not (Test-Path $PnpmLock)) { throw "pnpm-lock.yaml not found: $PnpmLock" }
$DockerfileWebBase = Join-Path $RepoRoot "docker\Dockerfile.webbase"
if (-not (Test-Path $DockerfileWebBase)) { throw "Dockerfile.webbase not found: $DockerfileWebBase" }
$PnpmLockHash = Get-ComboHash @($PnpmLock, $DockerfileWebBase)
$WebBaseTag = "chayuan-web-base:$PnpmLockHash"

Write-Host "[build] VERSION=$Version  BASE=$BaseTag  WEB_BASE=$WebBaseTag"

# 2.5) clean historical images (default on; -NoClean to skip). Runs after VERSION
#      and BaseTag are known and before any build, keeping latest / VERSION / BaseTag.
# List ALL local image "Repository:Tag" pairs in a single call. We deliberately do NOT pass a
# name/reference to 'docker images' -- the per-reference filter ({"reference":...}) can return
# HTTP 500 on Docker Desktop's containerd image store. Enumerating everything and filtering in
# PowerShell avoids that broken code path. Returns @() on any failure (non-fatal).
function Get-AllImageTags {
    try {
        $out = & $Docker images --format "{{.Repository}}:{{.Tag}}" 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $out) { return @() }
        return @($out | Where-Object { $_ -and ($_ -notmatch ":<none>$") })
    }
    catch { return @() }
}

# Remove historical build residue while KEEPING the current base env images (chayuan-base /
# chayuan-web-base at the current lock hashes) and the current app image (chayuan:latest /
# chayuan:$Version). Also prunes dangling layers AND build cache -- the build cache is usually
# the single largest residue and is what keeps docker_data.vhdx growing every build.
function Remove-OldImages {
    Write-Host "[build] cleaning historical images + build cache (keep :latest / :$Version / $BaseTag / $WebBaseTag)..."
    # Each step is isolated in its own try/catch: on Docker Desktop's containerd image store a
    # single step (e.g. the dangling prune below) can return HTTP 500, and we must NOT let that
    # abort the later 'builder prune' -- the build cache is the single largest disk eater and what
    # keeps docker_data.vhdx growing every build.

    # 1) Only remove OLD app image versions. Base env images (chayuan-base / chayuan-web-base)
    # are NEVER removed here: they are expensive to rebuild, and dropping them can also evict
    # the cached apt/poetry layers and force a full dependency re-download. Stale-hash bases
    # accumulate slowly (only on dep / Dockerfile.base changes); prune manually if disk matters.
    try {
        $verEsc = [regex]::Escape($Version)
        $stale = Get-AllImageTags | Where-Object {
            ($_ -match "^chayuan:" -and $_ -notmatch "^chayuan:(latest|$verEsc)$")
        }
        foreach ($img in $stale) {
            Write-Host "  - rmi $img"
            & $Docker rmi $img 2>$null | Out-Null
        }
    }
    catch { Write-Host "[build] old-image cleanup skipped (non-fatal): $($_.Exception.Message)" }

    # 2) dangling (<none>) layers left after tag replacement. NOTE: 'docker image prune -f' issues
    # a dangling-filter request that can return HTTP 500 on the containerd image store (same broken
    # filter code path as 'images -q <ref>'). Enumerate <none>:<none> images WITHOUT a filter and
    # rmi them by ID, so this step never 500s and never aborts the builder-prune below.
    try {
        $dangling = & $Docker images --format "{{.ID}} {{.Repository}}:{{.Tag}}" 2>$null |
            Where-Object { $_ -match "<none>:<none>$" } |
            ForEach-Object { ($_ -split '\s+')[0] } | Select-Object -Unique
        foreach ($id in $dangling) { & $Docker rmi $id 2>$null | Out-Null }
    }
    catch { Write-Host "[build] dangling prune skipped (non-fatal): $($_.Exception.Message)" }

    # 3) build cache -- biggest disk eater, separate from images, not touched by image prune.
    # Use --keep-storage to KEEP recent cache (incl. the large, stable base apt/poetry layers)
    # so base rebuilds do NOT re-download all deps. Plain `builder prune -f` would evict the
    # whole layer cache -> 11G re-download on every base rebuild.
    try {
        & $Docker builder prune -f --keep-storage 20GB 2>$null | Out-Null
    }
    catch { Write-Host "[build] builder prune skipped (non-fatal): $($_.Exception.Message)" }
}
if (-not $NoClean) { Remove-OldImages } else { Write-Host "[build] skip historical image cleanup (-NoClean)" }

# 3) base: build if missing or -RebuildBase (deps downloaded only here)
# Existence via a single full 'docker images' enumerate + client-side membership test. We avoid
# 'docker images -q <ref>' because the per-reference filter can return HTTP 500 on Docker
# Desktop's containerd image store; enumerating all tags once dodges that. $AllTags is reused
# for the web base check below.
$AllTags = Get-AllImageTags
$BaseExists = $AllTags -contains $BaseTag
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
$WebBaseExists = $AllTags -contains $WebBaseTag
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
Write-Host "[build] building app image chayuan:$Version (frontend + backend all-in-one single image) ..."
$AppArgs = @("build")
if ($Nocache) { $AppArgs += $Nocache }
$AppArgs += @("-f", "docker/Dockerfile", "--build-arg", "BASE_IMAGE=$BaseTag", "--build-arg", "WEB_BASE_IMAGE=$WebBaseTag", "-t", "chayuan:$Version", "-t", "chayuan:latest", ".")
& $Docker @AppArgs
if ($LASTEXITCODE -ne 0) { throw "app build failed" }

Write-Host "[build] done: chayuan:$Version (= chayuan:latest), base=$BaseTag, web-base=$WebBaseTag"
Write-Host "[build] start: cd docker; docker compose up -d"
