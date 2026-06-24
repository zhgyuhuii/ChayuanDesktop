#Requires -Version 5.1
<#
  Chayuan Docker cleanup + vhdx compaction (Windows / PowerShell, Docker Desktop + WSL2).

  Frees disk and (optionally) shrinks docker_data.vhdx while KEEPING the base env images
  (chayuan-base / chayuan-web-base) and the current app image (chayuan:latest / chayuan:VERSION).

  Why a script: 'docker images <name>' reference filters can 500 on the containerd image
  store; build cache silently grows to 100s of GB; and the WSL2 vhdx only shrinks when you
  compact it after the space is freed AND zeroed. This automates the safe sequence and never
  uses 'prune -a' on images (which would delete your base env images).

  Usage (from repo root or docker\):
    powershell -ExecutionPolicy Bypass -File docker\clean.ps1
    docker\clean.ps1 -DeepCache          # also remove ALL build cache (not just dangling)
    docker\clean.ps1 -Volumes            # also prune unused volumes (can delete data)
    docker\clean.ps1 -Compact            # also compact docker_data.vhdx (stops Docker; needs Admin)
    docker\clean.ps1 -Compact -ZeroFill  # zero-fill free space first (when plain compact underperforms)
    docker\clean.ps1 -DryRun             # print what would be removed, do nothing
    docker\clean.ps1 -Compact -VhdxPath "D:\soft\DockerDesktop\wsl\disk\docker_data.vhdx"

  Notes:
    - Keeps: chayuan:latest, chayuan:<VERSION>, and ALL chayuan-base* / chayuan-web-base* images.
    - Removes: other chayuan:* app tags, stopped containers, dangling images, build cache.
    - -Compact requires an elevated (Administrator) PowerShell. It stops Docker Desktop + WSL,
      compacts the vhdx with diskpart, then restarts Docker Desktop (unless -NoRestart).
    - Messages are English on purpose: PS 5.1 reads .ps1 as the system code page; keeping the
      source pure ASCII avoids mojibake / parse errors on zh-CN machines.
#>
param(
    [switch]$DeepCache,
    [switch]$Volumes,
    [switch]$Compact,
    [switch]$ZeroFill,
    [switch]$NoRestart,
    [string]$VhdxPath,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
# A native command's non-zero exit (e.g. 'docker rmi' on an in-use image) must NOT abort the
# script; we want cleanup to continue past individual failures. Disable PS7's auto-throw and
# rely on best-effort semantics. (PS 5.1 ignores this assignment harmlessly.)
$PSNativeCommandUseErrorActionPreference = $false
chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()

$Docker = if ($env:DOCKER) { $env:DOCKER } else { "docker" }

function Invoke-Docker {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$DArgs)
    if ($DryRun) { Write-Host "  [dry-run] docker $($DArgs -join ' ')"; return }
    & $Docker @DArgs
}

# List ALL local image "Repository:Tag" pairs in one call. We do NOT pass a name/reference to
# 'docker images' -- the per-reference filter can return HTTP 500 on the containerd image store.
function Get-AllImageTags {
    try {
        $out = & $Docker images --format "{{.Repository}}:{{.Tag}}" 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $out) { return @() }
        return @($out | Where-Object { $_ -and ($_ -notmatch ":<none>$") })
    }
    catch { return @() }
}

function Show-Df {
    param([string]$Tag)
    Write-Host ""
    Write-Host "[df] $Tag"
    & $Docker system df
    Write-Host ""
}

# ---- repo root + current version (to keep chayuan:<VERSION>) ----
$RepoRoot = Split-Path $PSScriptRoot -Parent
$Version = ""
$VerFile = Join-Path $RepoRoot "VERSION"
if (Test-Path $VerFile) { $Version = (Get-Content -Raw $VerFile).Trim() }

# Engine health probe (prune needs the daemon up). Warn, do not abort.
& $Docker version --format "{{.Server.Version}}" > $null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Docker engine not responding. Is Docker Desktop running and healthy? Prune steps may fail."
}

$keepMsg = "chayuan:latest"
if ($Version) { $keepMsg = "$keepMsg / chayuan:$Version" }
Write-Host "[clean] repo=$RepoRoot"
Write-Host "[clean] keep: $keepMsg + all chayuan-base* / chayuan-web-base*"
if ($DryRun) { Write-Host "[clean] DRY-RUN: nothing will be deleted." }
Show-Df "before"

# ---- 1) stopped containers (they pin old images) ----
Write-Host "[clean] removing stopped containers..."
Invoke-Docker container prune -f

# ---- 2) old chayuan app image tags (keep latest + current VERSION; keep ALL base images) ----
# '^chayuan:' matches the app image only; 'chayuan-base:' / 'chayuan-web-base:' do NOT match
# (next char after 'chayuan' is '-', not ':'), so base env images are always preserved.
Write-Host "[clean] removing old chayuan app image tags..."
$keep = @("chayuan:latest")
if ($Version) { $keep += "chayuan:$Version" }
$stale = Get-AllImageTags | Where-Object { $_ -match "^chayuan:" -and ($keep -notcontains $_) }
if (-not $stale) { Write-Host "  (none)" }
foreach ($img in $stale) {
    Write-Host "  - rmi $img"
    Invoke-Docker rmi $img
}

# ---- 3) dangling images ----
Write-Host "[clean] pruning dangling images..."
Invoke-Docker image prune -f

# ---- 4) build cache (usually the single biggest disk eater) ----
if ($DeepCache) {
    Write-Host "[clean] pruning ALL build cache (-DeepCache; next build rebuilds it)..."
    Invoke-Docker builder prune -a -f
}
else {
    Write-Host "[clean] pruning dangling build cache (use -DeepCache to remove all)..."
    Invoke-Docker builder prune -f
}

# ---- 5) volumes (opt-in; can delete data) ----
if ($Volumes) {
    Write-Host "[clean] pruning unused volumes (-Volumes)..."
    Invoke-Docker volume prune -f
}

Show-Df "after-prune"

if (-not $Compact) {
    Write-Host "[clean] done (prune only). Add -Compact to shrink docker_data.vhdx."
    return
}

# ===== compaction =====
if ($DryRun) { Write-Host "[compact] DRY-RUN: skipping compaction."; return }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    throw "Compaction needs Administrator. Re-run this script in an elevated PowerShell with -Compact."
}

function Resolve-Vhdx {
    param([string]$Override)
    if ($Override) {
        if (Test-Path $Override) { return $Override }
        throw "VhdxPath not found: $Override"
    }
    $cands = @()
    # Docker Desktop may relocate its data folder (e.g. to D:\). Read it from settings if present.
    foreach ($name in @("settings-store.json", "settings.json")) {
        $cfg = Join-Path $env:APPDATA "Docker\$name"
        if (Test-Path $cfg) {
            try {
                $df = (Get-Content -Raw $cfg | ConvertFrom-Json).dataFolder
                if ($df) {
                    $cands += (Join-Path $df "disk\docker_data.vhdx")
                    $cands += (Join-Path $df "data\ext4.vhdx")
                }
            }
            catch { }
        }
    }
    $cands += (Join-Path $env:LOCALAPPDATA "Docker\wsl\disk\docker_data.vhdx")
    $cands += (Join-Path $env:LOCALAPPDATA "Docker\wsl\data\ext4.vhdx")
    foreach ($c in $cands) { if ($c -and (Test-Path $c)) { return $c } }
    throw "Could not auto-detect docker_data.vhdx. Pass -VhdxPath '<full path>'."
}

$vhdx = Resolve-Vhdx -Override $VhdxPath
$before = [math]::Round((Get-Item $vhdx).Length / 1GB, 1)
Write-Host "[compact] target: $vhdx  (current ${before} GB)"

# Optional: zero-fill free space so diskpart can reclaim it. WSL2 ext4 does not zero blocks on
# delete, so plain 'compact vdisk' often reclaims little. Writing zeros into a throwaway
# container layer (which lives on docker_data.vhdx) then freeing it marks those blocks zeroed.
if ($ZeroFill) {
    Write-Host "[compact] zero-filling free space inside docker_data (this can take a while)..."
    & $Docker run --rm alpine sh -c "dd if=/dev/zero of=/zero.tmp bs=1M 2>/dev/null; sync; rm -f /zero.tmp; sync"
}

Write-Host "[compact] stopping Docker Desktop + WSL (releasing the vhdx lock)..."
Get-Process "Docker Desktop" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
wsl --shutdown
# wait until WSL is fully down so diskpart can attach the vhdx
for ($i = 0; $i -lt 10; $i++) {
    $running = (wsl --list --running) 2>$null
    if (-not ($running | Where-Object { $_ -match "docker" })) { break }
    Start-Sleep -Seconds 2
}
Start-Sleep -Seconds 3

$dp = Join-Path $env:TEMP "chayuan_compact_diskpart.txt"
@(
    "select vdisk file=`"$vhdx`"",
    "attach vdisk readonly",
    "compact vdisk",
    "detach vdisk",
    "exit"
) | Set-Content -Encoding ASCII -Path $dp
Write-Host "[compact] running diskpart compact..."
diskpart /s $dp
Remove-Item -Force $dp -ErrorAction SilentlyContinue

$after = [math]::Round((Get-Item $vhdx).Length / 1GB, 1)
Write-Host "[compact] done: ${before} GB -> ${after} GB"
if ($after -ge ($before - 1)) {
    Write-Host "[compact] little/no shrink. The free blocks were probably not zeroed -- re-run with -ZeroFill."
}

if (-not $NoRestart) {
    $dd = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dd) {
        Write-Host "[compact] restarting Docker Desktop..."
        Start-Process $dd
    }
    else {
        Write-Host "[compact] Docker Desktop.exe not found at default path; start it manually."
    }
}
Write-Host "[clean] all done."
