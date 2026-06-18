#requires -Version 5
<#
  check-tts.ps1 -- Windows local TTS (voice) one-shot health check. Port of scripts/check-tts.sh
    1. Print the RUNNING build version (/openapi.json info.version) to confirm you are not testing an old package.
    2. Probe each engine piper/edge/sherpa/clone:
       - use the X-Tts-Provider response header to catch "engine broken, silently fell back to piper"
       - on no HTTP response, recheck /healthz to see if that engine killed the service
  Usage (PowerShell):
    .\scripts\check-tts.ps1
    .\scripts\check-tts.ps1 -Base http://127.0.0.1:62581 -Root D:\chayuan-data
    $env:CHAYUAN_ROOT='D:\chayuan-data'; .\scripts\check-tts.ps1
  Note: source is 100% ASCII; the Chinese probe text is built from Unicode code points to avoid PS5.1 GBK misread.
#>
param(
  [string]$Base = $(if ($env:CHAYUAN_API) { $env:CHAYUAN_API } else { 'http://127.0.0.1:62581' }),
  [string]$Root = $(if ($env:CHAYUAN_ROOT) { $env:CHAYUAN_ROOT } else { "$env:USERPROFILE\work\xxx" })
)

# ---- console UTF-8 (3 settings; avoid mojibake of any Chinese in server responses) ----
try {
  chcp 65001 > $null 2>&1
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
  $OutputEncoding = [System.Text.UTF8Encoding]::new()
} catch {}

$ErrorActionPreference = 'Stop'
$Base = $Base.TrimEnd('/')
# Chinese probe text "Ni hao, this is a TTS test." built from Unicode code points (ASCII source):
$TEXT = -join @(0x4F60,0x597D,0xFF0C,0x8FD9,0x662F,0x8BED,0x97F3,0x5408,0x6210,0x6D4B,0x8BD5,0x3002 | ForEach-Object { [char]$_ })
$OutDir = Join-Path $env:TEMP 'chayuan-tts-probe'
if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Get-Healthz {
  try {
    $r = Invoke-WebRequest -Uri "$Base/healthz" -TimeoutSec 5 -UseBasicParsing
    return [int]$r.StatusCode
  } catch { return 0 }
}

Write-Host ''
Write-Host "================ Chayuan TTS audition check @ $Base ================"

if ((Get-Healthz) -ne 200) {
  Write-Host "[FAIL] /healthz unreachable -- sidecar not running or wrong port. Start the app/sidecar first."
  exit 1
}
Write-Host "/healthz: 200  (service up)"

# ---- running build version: confirm >= 2.0.114 ----
$ver = ''
try { $ver = (Invoke-RestMethod -Uri "$Base/openapi.json" -TimeoutSec 10).info.version } catch { $ver = '' }
Write-Host "running build version: $(if ($ver) { $ver } else { '<unreadable>' })"
$okVer = $false
try { $okVer = ([version]$ver -ge [version]'2.0.114') } catch { $okVer = $false }
if ($okVer) {
  Write-Host "  -> >= 2.0.114, has 'duplicate start wont kill healthy instance' fix  [OK]"
} else {
  Write-Host "  -> [WARN] below 2.0.114 or unreadable -- you may be testing an OLD package!"
  Write-Host "     Rebuild sidecar, FULLY quit and reopen the app, then rerun."
}

function Probe([string]$p, [string]$v) {
  $bodyObj = [ordered]@{ video_script = $TEXT; voice_provider = $p; voice_name = $v; voice_rate = 1.0; voice_volume = 1.0 }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes(($bodyObj | ConvertTo-Json -Compress))
  $wav = Join-Path $OutDir "$p.wav"
  Write-Host ''
  Write-Host "-- $p --"
  try {
    $resp = Invoke-WebRequest -Uri "$Base/api/v1/video-generation/preview-audio" -Method POST -Body $bytes `
              -ContentType 'application/json' -TimeoutSec 120 -UseBasicParsing
    $code = [int]$resp.StatusCode
    $used = $resp.Headers['X-Tts-Provider']; if ($used -is [array]) { $used = $used[0] }
    [System.IO.File]::WriteAllBytes($wav, $resp.Content)
    $kb = [int]((Get-Item $wav).Length / 1024)
    if ($code -eq 200) {
      if ($used -eq $p) {
        Write-Host "  [OK]   sounded=$used  wav=${kb}KB  -> $wav"
      } else {
        Write-Host "  [FAIL] asked '$p' but '[$used]' produced audio = '$p' broken, silently fell back to piper (root cause: chayuan diagnose-tts)"
      }
    } else {
      Write-Host "  [HTTP $code]"
    }
  } catch {
    $resp = $_.Exception.Response
    $code = 0; try { $code = [int]$resp.StatusCode } catch {}
    if ($code -ge 400) {
      Write-Host "  [HTTP $code] $($_.Exception.Message)"
    } else {
      Write-Host "  [CRASH?] no HTTP response: $($_.Exception.Message)"
      if ((Get-Healthz) -eq 200) {
        Write-Host "           but /healthz still 200 -- service alive, likely single-call timeout/exception. Check server log."
      } else {
        Write-Host "           /healthz now DOWN -- service was KILLED by this [$p] synth (the core bug)."
        Write-Host "           Check $Root\data\logs\crash.log : has stack = native segfault; empty = SIGKILL (should be fixed in v2.0.114, confirm version!)"
      }
    }
  }
}

Probe 'piper'  ''
Probe 'edge'   'zh-CN-XiaoxiaoNeural'
Probe 'sherpa' ''
Probe 'clone'  ''

Write-Host ''
Write-Host "How to read: [OK]=really sounded; [FAIL]=engine broken, fell back to piper; [CRASH?]=request killed the service."
Write-Host "Audio in $OutDir  (play with: start $OutDir\sherpa.wav)."
Write-Host "Per-engine root cause (import/model/torch/worker): run the bundled  chayuan diagnose-tts  (in the install dir)."
Write-Host "Still [CRASH?] with version >= 2.0.114 -> paste $Root\data\logs\crash.log + tail of the main log."
Write-Host "==================================================================="
