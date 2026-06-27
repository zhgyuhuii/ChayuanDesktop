#Requires -Version 5.1
<#
  Chayuan Docker cleanup + diagnostics + vhdx compaction (Windows / PowerShell, Docker Desktop + WSL2).

  Frees disk and (optionally) shrinks docker_data.vhdx while KEEPING the in-use images
  (current-hash chayuan-base / chayuan-web-base, chayuan:latest / chayuan:VERSION, and the
  current slim release tags). Built for the "every build the disk only grows, no idea where"
  problem -- it first SHOWS you where the space went, then cleans the right things.

  Why a script: 'docker images <name>' reference filters can 500 on the containerd image store;
  build cache silently grows to 100s of GB; stale-hash base images (one per poetry.lock /
  Dockerfile.base change, 4-11GB each) accumulate forever; and the WSL2 vhdx only shrinks when
  you compact it after the freed space is zeroed. This automates the safe sequence and never
  uses image 'prune -a' (which would delete ALL your base env images, forcing a full re-download).

  The four real sources of "only grows" (shown by -Diagnose / printed every run):
    1. stale-hash base/web-base images   -> -PruneOldBase (keeps current-hash + :latest)
    2. BuildKit build cache              -> -DeepCache (removes ALL, not just dangling)
    3. docker_data.vhdx free blocks not reclaimed -> -Compact (wsl --shutdown + diskpart compact)
    4. dangling images / stopped containers / anon volumes -> default prune (+ -Volumes)

  Usage (from repo root or docker\):
    powershell -ExecutionPolicy Bypass -File docker\clean.ps1
    docker\clean.ps1 -Diagnose           # ONLY show where the space went (no deletion)
    docker\clean.ps1 -DeepCache          # also remove ALL build cache (not just dangling)
    docker\clean.ps1 -PruneOldBase       # also remove stale-hash base/web-base (keep current + latest)
    docker\clean.ps1 -Volumes            # also prune unused volumes (can delete data)
    docker\clean.ps1 -Compact            # also compact docker_data.vhdx (stops Docker; needs Admin)
    docker\clean.ps1 -Deep               # = -DeepCache -PruneOldBase -Volumes -Compact (one-shot)
    docker\clean.ps1 -DryRun             # print what would be removed, do nothing
    docker\clean.ps1 -Compact -VhdxPath "D:\soft\DockerDesktop\wsl\disk\docker_data.vhdx"

  Recommended one-shot for a bloated vhdx (elevated PowerShell, Docker Desktop running):
    docker\clean.ps1 -Deep
    docker\clean.ps1 -Deep -ZeroFill     # add -ZeroFill only if the above under-shrinks

  Compact TRIMs freed blocks via fstrim by default (safe, never grows the file). -ZeroFill is an
  opt-in STRONGER fallback (zero-fills then frees) for when fstrim+compact does not reclaim
  enough; it briefly fills the disk to 100% and grows the dynamic vhdx, so use it only if needed.

  Notes:
    - Keeps: chayuan:latest, chayuan:<VERSION>, chayuan:<VERSION>-slim, chayuan:latest-slim,
      the CURRENT-hash chayuan-base / chayuan-web-base, and chayuan-base:latest / chayuan-web-base:latest.
    - -PruneOldBase removes only OTHER (stale-hash) chayuan-base* / chayuan-web-base* tags.
    - -Compact requires an elevated (Administrator) PowerShell.
    - Messages are English on purpose: PS 5.1 reads .ps1 as the system code page; keeping the
      source pure ASCII avoids mojibake / parse errors on zh-CN machines.
#>
param(
    [switch]$Diagnose,
    [switch]$DeepCache,
    [switch]$PruneOldBase,
    [switch]$Volumes,
    [switch]$Compact,
    [switch]$ZeroFill,
    [switch]$Deep,
    [switch]$NoRestart,
    [string]$VhdxPath,
    [switch]$DryRun
)

# -Deep is a convenience that expands to the full set. Done here so the rest of the script just
# reads the individual switches.
if ($Deep) { $DeepCache = $true; $PruneOldBase = $true; $Volumes = $true; $Compact = $true }

# Continue (not Stop): a native docker stderr line (e.g. daemon down, or 'rmi' on an in-use
# image) must NOT abort the script -- cleanup is best-effort and we check $LASTEXITCODE
# ourselves. Our own 'throw' statements still terminate regardless of this setting.
$ErrorActionPreference = "Continue"
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
    $out = & $Docker images --format "{{.Repository}}:{{.Tag}}" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $out) { return @() }
    return @($out | Where-Object { $_ -and ($_ -notmatch ":<none>$") })
}

function Test-EngineUp {
    & $Docker version --format "{{.Server.Version}}" > $null 2>&1
    return ($LASTEXITCODE -eq 0)
}

# Combo content hash (same as build.ps1 / build-release.ps1) so we can identify the CURRENT-hash
# base/web-base and treat every other chayuan-base*/chayuan-web-base* tag as stale.
function Get-ComboHash([string[]]$Paths) {
    $acc = ""
    foreach ($p in $Paths) {
        if (-not (Test-Path $p)) { return $null }
        $acc += (Get-FileHash -Algorithm SHA256 -Path $p).Hash
    }
    $ms = [System.IO.MemoryStream]::new([System.Text.Encoding]::ASCII.GetBytes($acc))
    return (Get-FileHash -InputStream $ms -Algorithm SHA256).Hash.Substring(0, 12).ToLower()
}

# ---- repo root + current version (to keep chayuan:<VERSION>) ----
$RepoRoot = Split-Path $PSScriptRoot -Parent
$Version = ""
$VerFile = Join-Path $RepoRoot "VERSION"
if (Test-Path $VerFile) { $Version = (Get-Content -Raw $VerFile).Trim() }

# ---- current-hash base / web-base tags (best-effort; null if lockfiles missing) ----
$Lock = Join-Path $RepoRoot "chayuan-server\libs\chayuan-server\poetry.lock"
$DockerfileBase = Join-Path $RepoRoot "docker\Dockerfile.base"
$PnpmLock = Join-Path $RepoRoot "chayuan-client\pnpm-lock.yaml"
$DockerfileWebBase = Join-Path $RepoRoot "docker\Dockerfile.webbase"
$BaseHash = Get-ComboHash @($Lock, $DockerfileBase)
$WebBaseHash = Get-ComboHash @($PnpmLock, $DockerfileWebBase)
$CurBaseTag = if ($BaseHash) { "chayuan-base:$BaseHash" } else { $null }
$CurWebBaseTag = if ($WebBaseHash) { "chayuan-web-base:$WebBaseHash" } else { $null }

# Tags we always preserve.
$KeepImages = @("chayuan:latest", "chayuan:latest-slim", "chayuan-base:latest", "chayuan-web-base:latest")
if ($Version) { $KeepImages += @("chayuan:$Version", "chayuan:$Version-slim") }
if ($CurBaseTag) { $KeepImages += $CurBaseTag }
if ($CurWebBaseTag) { $KeepImages += $CurWebBaseTag }

# ---- vhdx locate + size (read-only; works whether engine is up or down) ----
# Defined up here (not in the compaction section) because Show-Diagnostics calls it; PowerShell
# does not hoist functions, so it must exist before the diagnostics run.
function Resolve-Vhdx {
    param([string]$Override)
    if ($Override) {
        if (Test-Path $Override) { return $Override }
        throw "VhdxPath not found: $Override"
    }
    # Roots to search: Docker Desktop's configured dataFolder (may be relocated to D:\ etc.)
    # plus the default LOCALAPPDATA location.
    $roots = @()
    foreach ($name in @("settings-store.json", "settings.json")) {
        $cfg = Join-Path $env:APPDATA "Docker\$name"
        if (Test-Path $cfg) {
            try {
                $df = (Get-Content -Raw $cfg | ConvertFrom-Json).dataFolder
                if ($df) { $roots += $df }
            }
            catch { }
        }
    }
    $roots += (Join-Path $env:LOCALAPPDATA "Docker")
    $roots = $roots | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

    # Known relative layouts first (fast, exact). Newer Docker Desktop uses wsl\disk\,
    # older uses wsl\data\ext4.vhdx; relocated data folders keep the same sub-layout.
    $rels = @(
        "wsl\disk\docker_desktop_data.vhdx",
        "wsl\disk\docker_data.vhdx",
        "wsl\data\ext4.vhdx",
        "disk\docker_desktop_data.vhdx",
        "disk\docker_data.vhdx",
        "data\ext4.vhdx",
        "docker_desktop_data.vhdx",
        "docker_data.vhdx"
    )
    foreach ($r in $roots) {
        foreach ($rel in $rels) {
            $p = Join-Path $r $rel
            if (Test-Path $p) { return $p }
        }
    }
    # Last resort: bounded recursive search under each root.
    foreach ($r in $roots) {
        foreach ($fn in @("docker_desktop_data.vhdx", "docker_data.vhdx", "ext4.vhdx")) {
            $hit = Get-ChildItem -Path $r -Recurse -Filter $fn -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($hit) { return $hit.FullName }
        }
    }
    throw "Could not auto-detect the Docker WSL data disk (docker_desktop_data.vhdx / docker_data.vhdx / ext4.vhdx). Pass -VhdxPath '<full path>'."
}

function Get-VhdxInfo {
    param([string]$Override)
    try { $p = Resolve-Vhdx -Override $Override } catch { return $null }
    try { return [pscustomobject]@{ Path = $p; GB = [math]::Round((Get-Item $p).Length / 1GB, 1) } }
    catch { return $null }
}

function Show-Diagnostics {
    Write-Host ""
    Write-Host "==================== DISK DIAGNOSTICS ===================="
    Write-Host "[df] docker engine accounting (RECLAIMABLE column = what prune can free):"
    & $Docker system df
    Write-Host ""

    # Base / web-base inventory: this is the usual hidden hog -- one stale image per
    # poetry.lock / Dockerfile.base change, 4-11GB each, that the old script never deleted.
    Write-Host "[base] chayuan-base* / chayuan-web-base* images (CURRENT = in use, STALE = -PruneOldBase removes):"
    $rows = & $Docker images "--format" "{{.Repository}}:{{.Tag}}|{{.ID}}|{{.Size}}" 2>$null |
        Where-Object { $_ -match "^chayuan-base:" -or $_ -match "^chayuan-web-base:" }
    if (-not $rows) { Write-Host "  (none)" }
    foreach ($r in $rows) {
        $parts = $r -split '\|'
        $tag = $parts[0]; $size = $parts[2]
        $isCur = ($KeepImages -contains $tag)
        $mark = if ($isCur) { "CURRENT" } else { "STALE  " }
        Write-Host ("  [{0}] {1,-42} {2}" -f $mark, $tag, $size)
    }
    Write-Host ""

    $v = Get-VhdxInfo -Override $VhdxPath
    if ($v) {
        Write-Host "[vhdx] $($v.Path)"
        Write-Host "[vhdx] physical file size on disk: $($v.GB) GB"
        Write-Host "[vhdx] NOTE: this only shrinks via -Compact. If it is much larger than the"
        Write-Host "       'docker system df' total above, that gap is unreclaimed free space -> run -Compact."
    }
    else {
        Write-Host "[vhdx] could not locate docker_data.vhdx (pass -VhdxPath to enable -Compact)."
    }
    Write-Host "=========================================================="
    Write-Host ""
}

$engineUp = Test-EngineUp

Write-Host "[clean] repo=$RepoRoot"
Write-Host "[clean] keep: $($KeepImages -join ', ')"
if ($DryRun) { Write-Host "[clean] DRY-RUN: nothing will be deleted." }
Write-Host "[clean] docker engine: $(if ($engineUp) { 'running' } else { 'NOT running' })"
if (-not $CurBaseTag) { Write-Warning "Could not compute current base hash (poetry.lock / Dockerfile.base missing) -- -PruneOldBase will keep only :latest base tags." }

# ===== diagnostics (needs the engine running for 'system df'/'images') =====
if ($engineUp) { Show-Diagnostics }
elseif ($Diagnose) {
    Write-Warning "Docker engine not running -- only the vhdx physical size is available."
    $v = Get-VhdxInfo -Override $VhdxPath
    if ($v) { Write-Host "[vhdx] $($v.Path) : $($v.GB) GB (start Docker Desktop for full diagnostics)" }
}

if ($Diagnose) { Write-Host "[clean] -Diagnose: report only, nothing deleted."; return }

# ===== prune phase (needs the engine running) =====
if ($engineUp) {
    Write-Host "[clean] removing stopped containers..."
    Invoke-Docker container prune -f

    # Remove old app image tags (anything chayuan:* not in the keep list, incl. stale -slim).
    Write-Host "[clean] removing old chayuan app image tags..."
    $staleApp = Get-AllImageTags | Where-Object {
        $_ -match "^chayuan:" -and ($KeepImages -notcontains $_)
    }
    if (-not $staleApp) { Write-Host "  (none)" }
    foreach ($img in $staleApp) {
        Write-Host "  - rmi $img"
        Invoke-Docker rmi $img
    }

    # Stale-hash base / web-base images: the hidden hog. Opt-in (-PruneOldBase) because removing
    # the wrong one forces a multi-GB rebuild. We keep the CURRENT-hash tag + :latest, drop the rest.
    if ($PruneOldBase) {
        Write-Host "[clean] removing STALE-hash base/web-base images (keep current + :latest)..."
        $staleBase = Get-AllImageTags | Where-Object {
            ($_ -match "^chayuan-base:" -or $_ -match "^chayuan-web-base:") -and ($KeepImages -notcontains $_)
        }
        if (-not $staleBase) { Write-Host "  (none)" }
        foreach ($img in $staleBase) {
            Write-Host "  - rmi $img"
            Invoke-Docker rmi $img
        }
    }
    else {
        Write-Host "[clean] keeping ALL base/web-base images (-PruneOldBase to drop stale-hash ones)."
    }

    Write-Host "[clean] pruning dangling images..."
    Invoke-Docker image prune -f

    if ($DeepCache) {
        Write-Host "[clean] pruning ALL build cache (-DeepCache; next build rebuilds it)..."
        Invoke-Docker builder prune -a -f
    }
    else {
        Write-Host "[clean] pruning dangling build cache (use -DeepCache to remove all)..."
        Invoke-Docker builder prune -f
    }

    if ($Volumes) {
        Write-Host "[clean] pruning unused volumes (-Volumes)..."
        Invoke-Docker volume prune -f
    }

    Write-Host ""
    Write-Host "[df] after prune:"
    & $Docker system df
    Write-Host ""
}
else {
    Write-Warning "Docker engine not running -- skipping prune. Start Docker Desktop to prune."
    if (-not $Compact) {
        Write-Host "[clean] nothing to do (engine down, no -Compact). Start Docker Desktop, or pass -Compact to just shrink the vhdx."
        return
    }
}

if (-not $Compact) {
    Write-Host "[clean] done (prune only). Add -Compact to shrink docker_data.vhdx, or -Deep for the full sweep."
    return
}

# ===== compaction (works whether the engine is up or already down) =====
if ($DryRun) { Write-Host "[compact] DRY-RUN: skipping compaction."; return }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    throw "Compaction needs Administrator. Re-run this script in an elevated PowerShell with -Compact (or -Deep)."
}

# Resolve-Vhdx is defined near the top (Show-Diagnostics needs it before this point).
$vhdx = Resolve-Vhdx -Override $VhdxPath
$before = [math]::Round((Get-Item $vhdx).Length / 1GB, 1)
Write-Host "[compact] target: $vhdx  (current ${before} GB)"

# Reclaim freed space so diskpart can compact it. Two mechanisms:
#  1) fstrim (default, always): TRIM/discard the freed ext4 blocks inside the WSL VM. Safe --
#     never grows the vhdx.
#  2) -ZeroFill (opt-in, stronger fallback): write zeros into the free space then free it, which
#     also lets diskpart reclaim it. Use only if fstrim+compact did not reclaim enough -- it
#     briefly fills the disk to 100% (the dd 'no space' / 'unexpected EOF' is EXPECTED) and
#     momentarily grows the dynamic vhdx before compact shrinks it back.
Write-Host "[compact] trimming freed blocks inside the Docker WSL VM (fstrim)..."
# best-effort: docker-desktop distro may differ / lack fstrim; ignore failures.
wsl -d docker-desktop sh -c "fstrim -av 2>/dev/null || true" 2>$null
Start-Sleep -Seconds 2
if ($ZeroFill) {
    if ($engineUp) {
        Write-Host "[compact] zero-fill fallback (-ZeroFill): fills free space briefly; 'no space' is expected..."
        & $Docker run --rm alpine sh -c "dd if=/dev/zero of=/zero.tmp bs=1M 2>/dev/null; sync; rm -f /zero.tmp; sync"
    }
    else {
        Write-Warning "-ZeroFill needs the engine running; skipped."
    }
}

Write-Host "[compact] stopping Docker Desktop + WSL (releasing the vhdx lock)..."
Get-Process "Docker Desktop" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
wsl --shutdown
# wait until the docker WSL distro is fully down so diskpart can attach the vhdx
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
    Write-Host "[compact] little/no shrink. The free blocks were probably not zeroed -- start Docker and re-run with -ZeroFill."
}

if (-not $NoRestart) {
    $ddCands = @(
        (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Docker\Docker\Docker Desktop.exe"),
        (Join-Path $env:ProgramW6432 "Docker\Docker\Docker Desktop.exe"),
        (Join-Path $env:LOCALAPPDATA "Docker\Docker Desktop.exe")
    )
    $dd = $ddCands | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if (-not $dd) {
        $cmd = Get-Command "Docker Desktop.exe" -ErrorAction SilentlyContinue
        if ($cmd) { $dd = $cmd.Source }
    }
    if ($dd) {
        Write-Host "[compact] restarting Docker Desktop..."
        Start-Process $dd
    }
    else {
        Write-Host "[compact] Docker Desktop.exe not found; start Docker Desktop manually."
    }
}
Write-Host "[clean] all done."
