#Requires -Version 5.1
<#
  Chayuan release (slim) docker image build + push to Aliyun ACR (Windows / PowerShell).
  PowerShell port of docker/build-release.sh. Linux containers via Docker Desktop.

  What "slim" means (it does NOT delete runtime deps -- Python imports ARE the program):
    - base image already uses CPU-only torch (Dockerfile.base), dropping ~7GB of CUDA.
    - npm deps are NOT in the image: only apps/web/dist is COPYed, node_modules stays
      in the web-builder stage and is discarded.
    - Dockerfile.release runtime stage is FROM python:3.12-slim (NOT the fat base), and
      only COPYs the strip-cleaned site-packages -> drops build-essential / poetry / pip
      cache; tests/ __pycache__/ static libs removed and .so stripped.
    - Expected ~2-2.5GB (vs dev ~4GB / old CUDA ~11.6GB). Full functionality kept.

  Usage (repo root or anywhere; script cd's to repo root):
    powershell -ExecutionPolicy Bypass -File docker\build-release.ps1 -NoPush
    docker\build-release.ps1                       # build + push (REGISTRY/NAMESPACE from .env.release)
    docker\build-release.ps1 -NoPush               # local-only chayuan:<ver>-slim, no login/push
    docker\build-release.ps1 -RebuildBase          # first run after base torch+cpu change
    docker\build-release.ps1 -Registry r -Namespace n
    $env:REGISTRY="..."; $env:NAMESPACE="..."; docker\build-release.ps1

  Registry/namespace precedence: command line > environment variable > docker\.env.release.
  ACR credentials: ACR_USERNAME / ACR_PASSWORD env (or .env.release), else interactive
  'docker login'. Never written to disk by this script.
#>
param(
    [switch]$NoPush,
    [switch]$NoCache,
    [switch]$RebuildBase,
    [string]$Registry,
    [string]$Namespace
)

$ErrorActionPreference = "Stop"
# PowerShell 7.4+ turns a native command's non-zero exit into a terminating error under -Stop
# (docker writes progress to stderr, 'image inspect' on a missing image exits non-zero). Disable
# it and check $LASTEXITCODE explicitly. (PS 5.1 lacks this var; the assignment is harmless.)
$PSNativeCommandUseErrorActionPreference = $false
chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()

$RepoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $RepoRoot
$Docker = if ($env:DOCKER) { $env:DOCKER } else { "docker" }
$Nocache = if ($NoCache) { "--no-cache" } else { $null }

# --- load docker\.env.release (KEY=VALUE) if present; resolved below with proper precedence ---
$EnvFile = @{}
$EnvPath = Join-Path $RepoRoot "docker\.env.release"
if (Test-Path $EnvPath) {
    foreach ($line in Get-Content -Path $EnvPath -Encoding UTF8) {
        $t = $line.Trim()
        if (-not $t -or $t.StartsWith("#") -or ($t -notmatch "=")) { continue }
        $k = $t.Substring(0, $t.IndexOf("=")).Trim()
        $v = $t.Substring($t.IndexOf("=") + 1).Trim().Trim('"').Trim("'")
        if ($k) { $EnvFile[$k] = $v }
    }
}
# precedence: command line > environment variable > .env.release
function Resolve-Setting([string]$Cli, [string]$EnvName) {
    if ($Cli) { return $Cli }
    $ev = [Environment]::GetEnvironmentVariable($EnvName)
    if ($ev) { return $ev }
    if ($EnvFile.ContainsKey($EnvName)) { return $EnvFile[$EnvName] }
    return $null
}
$Registry  = Resolve-Setting $Registry  "REGISTRY"
$Namespace = Resolve-Setting $Namespace "NAMESPACE"
$AcrUser   = Resolve-Setting $null       "ACR_USERNAME"
$AcrPass   = Resolve-Setting $null       "ACR_PASSWORD"

# --- version ---
$Version = (Get-Content -Raw (Join-Path $RepoRoot "VERSION")).Trim()
if ([string]::IsNullOrWhiteSpace($Version)) { throw "VERSION is empty" }

# --- combo content hash (mirrors build.ps1): tag reflects lockfile AND its Dockerfile so the
#     base auto-rebuilds when either changes; docker layer cache still hits unchanged layers. ---
function Get-ComboHash([string[]]$Paths) {
    $acc = ""
    foreach ($p in $Paths) { $acc += (Get-FileHash -Algorithm SHA256 -Path $p).Hash }
    $ms = [System.IO.MemoryStream]::new([System.Text.Encoding]::ASCII.GetBytes($acc))
    return (Get-FileHash -InputStream $ms -Algorithm SHA256).Hash.Substring(0, 12).ToLower()
}

$Lock = Join-Path $RepoRoot "chayuan-server\libs\chayuan-server\poetry.lock"
if (-not (Test-Path $Lock)) { throw "poetry.lock not found: $Lock" }
$DockerfileBase = Join-Path $RepoRoot "docker\Dockerfile.base"
if (-not (Test-Path $DockerfileBase)) { throw "Dockerfile.base not found: $DockerfileBase" }
$LockHash = Get-ComboHash @($Lock, $DockerfileBase)
$BaseTag = "chayuan-base:$LockHash"

$PnpmLock = Join-Path $RepoRoot "chayuan-client\pnpm-lock.yaml"
if (-not (Test-Path $PnpmLock)) { throw "pnpm-lock.yaml not found: $PnpmLock" }
$DockerfileWebBase = Join-Path $RepoRoot "docker\Dockerfile.webbase"
if (-not (Test-Path $DockerfileWebBase)) { throw "Dockerfile.webbase not found: $DockerfileWebBase" }
$PnpmLockHash = Get-ComboHash @($PnpmLock, $DockerfileWebBase)
$WebBaseTag = "chayuan-web-base:$PnpmLockHash"

Write-Host "[release] VERSION=$Version  BASE=$BaseTag  WEB_BASE=$WebBaseTag"

# --- list ALL local tags in one call; we deliberately do NOT pass a name/reference to
#     'docker images' -- the per-reference filter can return HTTP 500 on Docker Desktop's
#     containerd image store. $null => engine failed (do NOT treat as "missing"). ---
function Get-AllImageTags {
    try {
        $out = & $Docker images --format "{{.Repository}}:{{.Tag}}" 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        if (-not $out) { return @() }
        return @($out | Where-Object { $_ -and ($_ -notmatch ":<none>$") })
    }
    catch { return $null }
}

# --- ensure base (CPU torch) + web base exist; build if missing or -RebuildBase. We tag both the
#     hash tag and :latest, so Dockerfile.release can reference chayuan-base:latest below. ---
$AllTags = Get-AllImageTags
if ($null -eq $AllTags) {
    throw "[release] 'docker images' failed (engine 500 / _ping timeout) -- Docker engine looks unhealthy. Fully quit Docker Desktop, run 'wsl --shutdown', restart it, confirm 'docker images' lists cleanly, then re-run. Refusing to proceed: a failed list looks like 'base missing' and would trigger a full base rebuild."
}

if ($RebuildBase -or (-not ($AllTags -contains $BaseTag))) {
    Write-Host "[release] building base env image $BaseTag (CPU torch, all deps)..."
    $BaseArgs = @("build")
    if ($Nocache) { $BaseArgs += $Nocache }
    $BaseArgs += @("-f", "docker/Dockerfile.base", "--build-arg", "LOCK_HASH=$LockHash", "-t", $BaseTag, "-t", "chayuan-base:latest", ".")
    & $Docker @BaseArgs
    if ($LASTEXITCODE -ne 0) { throw "base build failed" }
}
else {
    Write-Host "[release] reusing base image $BaseTag (deps unchanged); refreshing :latest tag"
    & $Docker tag $BaseTag chayuan-base:latest 2>$null | Out-Null
}

if ($RebuildBase -or (-not ($AllTags -contains $WebBaseTag))) {
    Write-Host "[release] building web base image $WebBaseTag (pnpm fetch all deps)..."
    $WebArgs = @("build")
    if ($Nocache) { $WebArgs += $Nocache }
    $WebArgs += @("-f", "docker/Dockerfile.webbase", "--build-arg", "PNPM_LOCK_HASH=$PnpmLockHash", "-t", $WebBaseTag, "-t", "chayuan-web-base:latest", ".")
    & $Docker @WebArgs
    if ($LASTEXITCODE -ne 0) { throw "web base build failed" }
}
else {
    Write-Host "[release] reusing web base image $WebBaseTag (deps unchanged); refreshing :latest tag"
    & $Docker tag $WebBaseTag chayuan-web-base:latest 2>$null | Out-Null
}

# --- build slim release image (local tag carries -slim so it does not collide with dev) ---
$LocalTag = "chayuan:$Version-slim"
Write-Host "[release] building $LocalTag (slim runtime, FROM python:3.12-slim + stripped site-packages)..."
$RelArgs = @("build")
if ($Nocache) { $RelArgs += $Nocache }
$RelArgs += @("-f", "docker/Dockerfile.release",
    "--build-arg", "BASE_IMAGE=chayuan-base:latest",
    "--build-arg", "WEB_BASE_IMAGE=chayuan-web-base:latest",
    "-t", $LocalTag, "-t", "chayuan:latest-slim", ".")
& $Docker @RelArgs
if ($LASTEXITCODE -ne 0) { throw "release build failed" }
& $Docker images $LocalTag

if ($NoPush) {
    Write-Host "[release] -NoPush: built $LocalTag locally, skipping login/push."
    Write-Host "[release] verify CPU torch: $Docker run --rm $LocalTag python -c `"import torch;print(torch.__version__, torch.version.cuda)`""
    exit 0
}

# --- push to ACR ---
if (-not $Registry)  { throw "[release] REGISTRY missing (command line -Registry / env REGISTRY / docker\.env.release)" }
if (-not $Namespace) { throw "[release] NAMESPACE missing (command line -Namespace / env NAMESPACE / docker\.env.release)" }
$Remote = "$Registry/$Namespace/chayuan"
Write-Host "[release] tagging remote ${Remote}:$Version / :latest"
& $Docker tag $LocalTag "${Remote}:$Version"
if ($LASTEXITCODE -ne 0) { throw "remote tag failed" }
& $Docker tag $LocalTag "${Remote}:latest"
if ($LASTEXITCODE -ne 0) { throw "remote tag failed" }

Write-Host "[release] logging in to $Registry ..."
if ($AcrUser -and $AcrPass) {
    $AcrPass | & $Docker login $Registry -u $AcrUser --password-stdin
}
else {
    & $Docker login $Registry
}
if ($LASTEXITCODE -ne 0) { throw "docker login failed" }

Write-Host "[release] pushing..."
& $Docker push "${Remote}:$Version"
if ($LASTEXITCODE -ne 0) { throw "push :$Version failed" }
& $Docker push "${Remote}:latest"
if ($LASTEXITCODE -ne 0) { throw "push :latest failed" }
Write-Host "[release] done: ${Remote}:$Version (= :latest)"
