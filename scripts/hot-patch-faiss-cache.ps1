<#
.SYNOPSIS
    Hot-patch the langchain relevance_score_fn fix into an already-installed
    desktop bundle without rebuilding the whole sidecar exe.

.DESCRIPTION
    PyInstaller --onedir mode keeps user-package code as separate .pyc files
    under <install>\chayuan-server\_internal\chayuan\... (not inside the PYZ).
    So we can:
      1. Locate the installed bundle
      2. Compile the patched source faiss_cache.py to .pyc with the matching
         Python (must be 3.12; PyInstaller pins it)
      3. Backup the old .pyc -> .pyc.bak
      4. Drop in the new .pyc
      5. Kill chayuan-server.exe (Tauri respawns it, picking up the new code)

    Saves ~10 minutes vs running build-desktop.cmd end-to-end.

    Limitations:
      - ONLY works if the changed file's module sits as a loose .pyc.
        chayuan/* always does (collect_submodules pulls them, but PyInstaller
        keeps user-package files loose in _internal/).
      - Python version on the host must match (3.12). Default `python` in
        a conda py312 / poetry-managed venv is fine.
      - If the file is inside base_library.zip or PYZ-00.pyz, hot-patch
        fails and we tell you to do a full rebuild.

.PARAMETER InstallDir
    Path of the installed desktop bundle, e.g.
    `C:\Program Files\Chayuan`,
    `$env:LOCALAPPDATA\Chayuan`,
    or wherever your MSI / NSIS installer dropped it.
    If omitted, the script searches a few common roots.

.PARAMETER SourcePy
    Path to the patched .py file in the repo. Default:
    chayuan-server\libs\chayuan-server\chayuan\server\knowledge_base\kb_cache\faiss_cache.py

.PARAMETER PythonExe
    Path to a Python 3.12 interpreter to compile the .pyc with.
    Default: `python` on PATH.

.PARAMETER DryRun
    Show what would be done without modifying anything.

.EXAMPLE
    .\scripts\hot-patch-faiss-cache.ps1                    # auto locate
    .\scripts\hot-patch-faiss-cache.ps1 -InstallDir "C:\Program Files\Chayuan"
    .\scripts\hot-patch-faiss-cache.ps1 -DryRun
#>
param(
    [string]$InstallDir = "",
    [string]$SourcePy   = "",
    [string]$PythonExe  = "python",
    [switch]$DryRun
)

chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()

function Red    { param($m) Write-Host $m -ForegroundColor Red }
function Green  { param($m) Write-Host $m -ForegroundColor Green }
function Yellow { param($m) Write-Host $m -ForegroundColor Yellow }
function Cyan   { param($m) Write-Host $m -ForegroundColor Cyan }

# --- 1. Resolve source .py ---
if (-not $SourcePy) {
    $repoRoot = Split-Path -Parent $PSScriptRoot
    $SourcePy = Join-Path $repoRoot "chayuan-server\libs\chayuan-server\chayuan\server\knowledge_base\kb_cache\faiss_cache.py"
}
if (-not (Test-Path $SourcePy)) {
    Red "[FAIL] source .py not found: $SourcePy"
    exit 2
}
Cyan "source .py : $SourcePy"

# Quick sanity: does the patched source actually contain the fix marker?
$srcContent = Get-Content $SourcePy -Raw -Encoding utf8
if ($srcContent -notmatch "_cosine_relevance_for_unit_l2") {
    Red "[FAIL] source does not contain `_cosine_relevance_for_unit_l2`. Are you on the right branch / commit?"
    exit 2
}
Green "       contains _cosine_relevance_for_unit_l2 marker [OK]"

# --- 2. Resolve install dir ---
function Find-InstallDir {
    $candidates = @(
        "C:\Program Files\Chayuan",
        "C:\Program Files\chayuan",
        "C:\Program Files\Chayuan Desktop",
        "C:\Program Files (x86)\Chayuan",
        "$env:LOCALAPPDATA\Chayuan",
        "$env:LOCALAPPDATA\Programs\Chayuan",
        "$env:LOCALAPPDATA\chayuan-desktop"
    )
    foreach ($c in $candidates) {
        if (Test-Path (Join-Path $c "chayuan-server\chayuan-server.exe")) { return $c }
    }
    return $null
}
if (-not $InstallDir) {
    $InstallDir = Find-InstallDir
}
if (-not $InstallDir -or -not (Test-Path (Join-Path $InstallDir "chayuan-server\chayuan-server.exe"))) {
    Red "[FAIL] cannot find installed desktop bundle. Pass -InstallDir explicitly."
    Red "       Looking for: <InstallDir>\chayuan-server\chayuan-server.exe"
    exit 2
}
Cyan "InstallDir : $InstallDir"

# --- 3. Locate the target .pyc ---
$pycRel = "chayuan-server\_internal\chayuan\server\knowledge_base\kb_cache\faiss_cache.pyc"
$pycAbs = Join-Path $InstallDir $pycRel
if (-not (Test-Path $pycAbs)) {
    # Try .py instead (some builds keep .py loose)
    $pyAbs = $pycAbs -replace "\.pyc$", ".py"
    if (Test-Path $pyAbs) {
        Yellow "no .pyc found, but .py is loose at:"
        Yellow "  $pyAbs"
        $pycAbs = $pyAbs
    } else {
        Red "[FAIL] target .pyc not found: $pycAbs"
        Red "       Bundle may be PYZ-only (full rebuild required)."
        Red "       Run a quick grep to locate:"
        Red "         Get-ChildItem '$InstallDir' -Recurse -Filter faiss_cache* -ErrorAction SilentlyContinue"
        exit 3
    }
}
Cyan "target     : $pycAbs"
$fileInfo = Get-Item $pycAbs
Write-Host "             (size=$($fileInfo.Length) bytes, lastWrite=$($fileInfo.LastWriteTime))"

# --- 4. Verify python version ---
$pyVer = & $PythonExe -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>&1
if ($LASTEXITCODE -ne 0) {
    Red "[FAIL] cannot run '$PythonExe -c ...': $pyVer"
    exit 2
}
Cyan "python ver : $pyVer (need 3.12)"
if ($pyVer -ne "3.12") {
    Red "[FAIL] PyInstaller pinned python 3.12; host python is $pyVer."
    Red "       Switch interpreter (-PythonExe path\to\python.exe) and retry."
    exit 2
}

# --- 5. Compile .py -> .pyc with the matching magic ---
$tmpPyc = Join-Path $env:TEMP "faiss_cache_patched.pyc"
$compileCmd = @"
import py_compile, sys
py_compile.compile(r'$SourcePy', cfile=r'$tmpPyc', doraise=True)
print('compiled OK:', r'$tmpPyc')
"@
$tmpPy = Join-Path $env:TEMP "do_compile_faiss_cache.py"
Set-Content -Path $tmpPy -Value $compileCmd -Encoding ascii
$compileOut = & $PythonExe $tmpPy 2>&1
if ($LASTEXITCODE -ne 0) {
    Red "[FAIL] py_compile failed: $compileOut"
    exit 2
}
Write-Host "  $compileOut"
$newPycInfo = Get-Item $tmpPyc
Write-Host "             (new .pyc size=$($newPycInfo.Length) bytes)"

if ($DryRun) {
    Yellow "`n[DryRun] would now:"
    Yellow "  1. backup $pycAbs -> $pycAbs.bak"
    Yellow "  2. copy   $tmpPyc -> $pycAbs"
    Yellow "  3. taskkill /IM chayuan-server.exe /F"
    Yellow "Run without -DryRun to apply."
    exit 0
}

# --- 6. Backup + replace ---
$bakPath = "$pycAbs.bak"
if (Test-Path $bakPath) {
    Yellow "  backup already exists, overwriting: $bakPath"
}
Copy-Item -Path $pycAbs -Destination $bakPath -Force
Green "  backup -> $bakPath"
Copy-Item -Path $tmpPyc -Destination $pycAbs -Force
Green "  replaced: $pycAbs"

# --- 7. Kill sidecar so Tauri respawns it with new code ---
Write-Host ""
Cyan "killing chayuan-server.exe (Tauri should auto-respawn) ..."
$killed = 0
try {
    Get-Process -Name "chayuan-server" -ErrorAction SilentlyContinue | ForEach-Object {
        Stop-Process -Id $_.Id -Force -ErrorAction Stop
        $killed++
    }
} catch {
    Yellow "  stop-process error: $($_.Exception.Message)"
}
Write-Host "  killed $killed chayuan-server.exe process(es)"

Write-Host ""
Green "==============================================="
Green " HOT-PATCH APPLIED"
Green "==============================================="
Write-Host "Wait ~5s for sidecar to come back, then verify:"
Write-Host "  .\scripts\verify-kb-search-fix.ps1"
Write-Host ""
Write-Host "To rollback:"
Write-Host "  Copy-Item '$bakPath' '$pycAbs' -Force"
Write-Host "  Stop-Process -Name chayuan-server -Force"
