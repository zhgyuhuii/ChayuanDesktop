#requires -Version 5
<#
  run-tts-debug.ps1 -- Windows: run the INSTALLED sidecar in the FOREGROUND so logs print live
  to this console (packaged app is windowed and shows no console otherwise). Port of run-tts-debug.sh.
  Logs also tee to a file. After /healthz is up, open ANOTHER PowerShell and run check-tts.ps1.
  Usage (PowerShell):
    .\scripts\run-tts-debug.ps1
    .\scripts\run-tts-debug.ps1 -Bin "C:\Program Files\Chayuan\chayuan-server\chayuan-server.exe" -Root D:\chayuan-data
    $env:CHAYUAN_ROOT='D:\chayuan-data'; .\scripts\run-tts-debug.ps1
  Note: QUIT the desktop app / kill old sidecar first, else 62581 is busy and this instance health-defers.
        Ctrl-C stops this foreground sidecar. Source is 100% ASCII.
#>
param(
  [string]$Bin  = $env:CHAYUAN_BIN,
  [string]$Root = $(if ($env:CHAYUAN_ROOT) { $env:CHAYUAN_ROOT } else { "$env:USERPROFILE\work\xxx" }),
  [int]$Port    = $(if ($env:CHAYUAN_PORT) { [int]$env:CHAYUAN_PORT } else { 62581 })
)

try {
  chcp 65001 > $null 2>&1
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
  $OutputEncoding = [System.Text.UTF8Encoding]::new()
} catch {}

$Base = "http://127.0.0.1:$Port"
$Log  = Join-Path $env:TEMP 'chayuan-sidecar.log'

# 0) auto-detect the sidecar exe if -Bin not given
if (-not $Bin) {
  $cands = @(
    "$env:ProgramFiles\Chayuan\chayuan-server\chayuan-server.exe",
    "${env:ProgramFiles(x86)}\Chayuan\chayuan-server\chayuan-server.exe",
    "$env:LOCALAPPDATA\Programs\Chayuan\chayuan-server\chayuan-server.exe"
  )
  foreach ($c in $cands) { if ($c -and (Test-Path $c)) { $Bin = $c; break } }
}
if (-not $Bin -or -not (Test-Path $Bin)) {
  Write-Host "[!] sidecar exe not found. Pass -Bin <path>\chayuan-server.exe"
  Write-Host "    (usually <install>\chayuan-server\chayuan-server.exe; check where the MSI installed Chayuan)."
  exit 1
}

# 1) port busy -> an instance is already running, do not start a second
$busy = $false
try { $null = Invoke-WebRequest "$Base/healthz" -TimeoutSec 3 -UseBasicParsing; $busy = $true } catch { $busy = $false }
if ($busy) {
  Write-Host "[!] $Base already has a running instance. Quit the desktop app / kill the old sidecar first,"
  Write-Host "    otherwise this foreground instance will health-defer and exit (v2.0.114 behavior)."
  exit 1
}

Write-Host "== sidecar : $Bin"
Write-Host "== ROOT    : $Root"
Write-Host "== log     : LIVE in this console  +  saved to $Log"
Write-Host "== disk log: $Root\data\logs\   (crash.log lives there too)"
Write-Host "== NEXT    : once you see /healthz ready, open ANOTHER PowerShell and run:  .\scripts\check-tts.ps1"
Write-Host "== Starting... (Ctrl-C to stop this sidecar)"
Write-Host ""

# 2) single-machine env for a clean foreground run
$env:CHAYUAN_ROOT_IGNORE_STATE = '1'
$env:CHAYUAN_ROOT              = $Root
$env:CHAYUAN_PROFILE           = 'single-machine'
$env:CHAYUAN_AUTH             = 'anonymous'
$env:CHAYUAN_REDIS            = 'disabled'
$env:CHAYUAN_QUEUE            = 'inproc'
$env:CHAYUAN_VECTOR_STORE     = 'sqlite-vec'

# 3) foreground: stdout+stderr live to console + tee to file
#    (worker subprocess [mp-freeze]/[tts:<engine>] warnings inherit this console too)
& $Bin start -a --single-machine 2>&1 | Tee-Object -FilePath $Log
