# diagnose-voice.ps1
# Voice / TTS diagnostic for Chayuan desktop (Windows, PowerShell 5.1+).
#
# What it checks:
#   1. piper / edge / sherpa / clone preview via the running sidecar
#      (detects when sherpa silently falls back to piper = sherpa NOT working)
#   2. sherpa-onnx model files on disk (the usual reason sherpa is unavailable)
#   3. clone reference-audio acoustic quality (loudness / clipping / noise / SNR)
#      + the cached ASR transcript -> tells mic problem APART from model problem
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\diagnose-voice.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\diagnose-voice.ps1 -Base http://127.0.0.1:62581
#
# NOTE (this build): the voxcpm reference-audio denoiser is DISABLED, so any
# background noise in the recording passes straight into the clone. That makes
# mic / room quality a real and amplified cause of "weird" cloned voices.

param(
    [string]$Base = "http://127.0.0.1:62581"
)

chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
$ErrorActionPreference = "Continue"

Add-Type -AssemblyName System.Net.Http | Out-Null
$Http = New-Object System.Net.Http.HttpClient
$Http.Timeout = [TimeSpan]::FromSeconds(120)

function Line($s) { Write-Host $s }
function Head($s) { Write-Host ""; Write-Host ("==== " + $s + " ====") }

function ToDbfs([double]$v) {
    if ($v -le 0) { return -120.0 }
    return [math]::Round(20.0 * [math]::Log10($v / 32768.0), 1)
}

function Get-RespHeader($resp, $name) {
    foreach ($h in $resp.Headers) {
        if ($h.Key -ieq $name) { return ($h.Value -join ",") }
    }
    foreach ($h in $resp.Content.Headers) {
        if ($h.Key -ieq $name) { return ($h.Value -join ",") }
    }
    return ""
}

function Http-GetJson($url) {
    try {
        $r = $Http.GetAsync($url).Result
        $raw = $r.Content.ReadAsByteArrayAsync().Result
        $txt = [System.Text.Encoding]::UTF8.GetString($raw)
        if (-not $r.IsSuccessStatusCode) {
            return @{ ok = $false; status = [int]$r.StatusCode; text = $txt }
        }
        return @{ ok = $true; status = [int]$r.StatusCode; obj = ($txt | ConvertFrom-Json) }
    } catch {
        return @{ ok = $false; status = 0; text = $_.Exception.Message }
    }
}

function Http-PostPreview($provider, $voiceName, $outFile) {
    $payload = @{
        video_script   = "Hello, this is a Chayuan voice test. One two three four five."
        video_language = ""
        voice_provider = $provider
        voice_name     = $voiceName
        voice_rate     = 1.2
        voice_volume   = 1.0
        bgm_type       = "none"
    } | ConvertTo-Json
    try {
        $content = New-Object System.Net.Http.StringContent($payload, [System.Text.Encoding]::UTF8, "application/json")
        $r = $Http.PostAsync(($Base + "/api/v1/video-generation/preview-audio"), $content).Result
        $bytes = $r.Content.ReadAsByteArrayAsync().Result
        $status = [int]$r.StatusCode
        if (-not $r.IsSuccessStatusCode) {
            $msg = [System.Text.Encoding]::UTF8.GetString($bytes)
            return @{ ok = $false; status = $status; detail = $msg }
        }
        $usedProvider = Get-RespHeader $r "X-Tts-Provider"
        $durMs = Get-RespHeader $r "X-Audio-Duration-Ms"
        if ($outFile) { [System.IO.File]::WriteAllBytes($outFile, $bytes) }
        return @{ ok = $true; status = $status; provider = $usedProvider; durMs = $durMs; size = $bytes.Length; file = $outFile }
    } catch {
        return @{ ok = $false; status = 0; detail = $_.Exception.Message }
    }
}

function Analyze-Wav($path) {
    $res = @{ ok = $false }
    try {
        $b = [System.IO.File]::ReadAllBytes($path)
    } catch {
        $res.err = "read failed: " + $_.Exception.Message
        return $res
    }
    if ($b.Length -lt 44) { $res.err = "file too small"; return $res }
    $riff = [System.Text.Encoding]::ASCII.GetString($b, 0, 4)
    $wave = [System.Text.Encoding]::ASCII.GetString($b, 8, 4)
    if ($riff -ne "RIFF" -or $wave -ne "WAVE") { $res.err = "not a RIFF/WAVE file"; return $res }

    $pos = 12
    $channels = 0; $sampleRate = 0; $bits = 0; $dataOff = -1; $dataLen = 0
    while ($pos + 8 -le $b.Length) {
        $cid = [System.Text.Encoding]::ASCII.GetString($b, $pos, 4)
        $csz = [System.BitConverter]::ToUInt32($b, $pos + 4)
        $body = $pos + 8
        if ($cid -eq "fmt ") {
            $channels   = [System.BitConverter]::ToUInt16($b, $body + 2)
            $sampleRate = [System.BitConverter]::ToUInt32($b, $body + 4)
            $bits       = [System.BitConverter]::ToUInt16($b, $body + 14)
        } elseif ($cid -eq "data") {
            $dataOff = $body
            $dataLen = [int]$csz
        }
        $adv = [int]$csz
        if ($adv % 2 -eq 1) { $adv = $adv + 1 }
        $pos = $body + $adv
    }

    $res.sampleRate = $sampleRate; $res.channels = $channels; $res.bits = $bits
    if ($dataOff -lt 0 -or $bits -ne 16 -or $channels -lt 1) {
        $res.err = "unsupported wav (need 16-bit PCM); bits=" + $bits + " ch=" + $channels
        return $res
    }
    if ($dataOff + $dataLen -gt $b.Length) { $dataLen = $b.Length - $dataOff }
    $frameStride = $channels * 2
    $totalFrames = [int]($dataLen / $frameStride)
    if ($totalFrames -le 0) { $res.err = "no audio frames"; return $res }
    $duration = $totalFrames / [double]$sampleRate

    $sumSq = [double]0
    $peak = 0
    $winLen = [int]($sampleRate * 0.05)
    if ($winLen -lt 1) { $winLen = 1 }
    $winRmsList = New-Object System.Collections.Generic.List[double]
    $winSumSq = [double]0
    $winCount = 0

    $i = 0
    $o = $dataOff
    while ($i -lt $totalFrames) {
        $s = [System.BitConverter]::ToInt16($b, $o)
        $a = [math]::Abs($s)
        if ($a -gt $peak) { $peak = $a }
        $sq = [double]$s * [double]$s
        $sumSq += $sq
        $winSumSq += $sq
        $winCount++
        if ($winCount -ge $winLen) {
            $winRmsList.Add([math]::Sqrt($winSumSq / $winCount))
            $winSumSq = 0; $winCount = 0
        }
        $i++
        $o += $frameStride
    }
    if ($winCount -gt 0) { $winRmsList.Add([math]::Sqrt($winSumSq / $winCount)) }

    $rms = [math]::Sqrt($sumSq / $totalFrames)
    $noise = $rms
    if ($winRmsList.Count -gt 0) {
        $sorted = $winRmsList | Sort-Object
        $idx = [int]([math]::Floor($sorted.Count * 0.1))
        if ($idx -ge $sorted.Count) { $idx = $sorted.Count - 1 }
        $noise = $sorted[$idx]
    }

    $res.ok = $true
    $res.duration = $duration
    $res.rmsDb = ToDbfs $rms
    $res.peakDb = ToDbfs $peak
    $res.noiseDb = ToDbfs $noise
    $res.snr = [math]::Round($res.rmsDb - $res.noiseDb, 1)
    return $res
}

# ---------------------------------------------------------------------------

Head "Chayuan voice diagnostic"
Line ("Base: " + $Base)

$diag = Http-GetJson ($Base + "/api/v1/runtime/diagnose")
$root = ""
if ($diag.ok) {
    $root = [string]$diag.obj.chayuan_root
    Line ("[OK] sidecar reachable; chayuan_root = " + $root)
} else {
    Line ("[WARN] /api/v1/runtime/diagnose failed (status " + $diag.status + "): " + $diag.text)
    $root = Join-Path $env:APPDATA "chayuan"
    Line ("[INFO] falling back to default root guess: " + $root)
}

$tmp = Join-Path $env:TEMP "chayuan-voice-diag"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

Head "1. Engine preview (piper=local  edge=internet  sherpa=local  clone=local)"
foreach ($p in @("piper", "edge", "sherpa")) {
    $out = Join-Path $tmp ("preview-" + $p + ".wav")
    $r = Http-PostPreview $p "" $out
    if ($r.ok) {
        $tag = "[OK]"
        $note = ""
        if ($p -eq "sherpa" -and $r.provider -and ($r.provider -ne "sherpa")) {
            $tag = "[WARN]"
            $note = "  <-- requested sherpa but engine fell back to '" + $r.provider + "' => sherpa NOT working"
        }
        Line ($tag + " " + $p + ": http " + $r.status + " provider=" + $r.provider + " dur=" + $r.durMs + "ms size=" + $r.size + "B" + $note)
        Line ("     saved: " + $out)
    } else {
        Line ("[FAIL] " + $p + ": http " + $r.status + " " + $r.detail)
        if ($p -eq "edge") { Line "       edge needs INTERNET; a failure here usually means no network / blocked / proxy." }
    }
}

$voicesResp = Http-GetJson ($Base + "/api/v1/video-generation/voices?provider=clone")
$cloneItems = @()
if ($voicesResp.ok) { $cloneItems = @($voicesResp.obj.items) }
if ($cloneItems.Count -eq 0) {
    Line "[INFO] clone: no cloned voices registered yet (skip clone preview)"
} else {
    foreach ($it in $cloneItems) {
        $cid = [string]$it.id
        $safe = ($cid -replace '[^A-Za-z0-9_.-]', '_')
        $out = Join-Path $tmp ("preview-clone-" + $safe + ".wav")
        $r = Http-PostPreview "clone" $cid $out
        if ($r.ok) {
            Line ("[OK] clone '" + $it.label + "' (" + $cid + "): provider=" + $r.provider + " dur=" + $r.durMs + "ms size=" + $r.size + "B")
            Line ("     saved: " + $out)
        } else {
            Line ("[FAIL] clone '" + $it.label + "' (" + $cid + "): http " + $r.status + " " + $r.detail)
        }
    }
}

Head "2. Sherpa model files"
$sherpaDirs = @(
    (Join-Path $root "models\bundled\tts\sherpa-onnx"),
    (Join-Path $root "models\sherpa-onnx")
)
$foundAny = $false
foreach ($d in $sherpaDirs) {
    if (Test-Path $d) {
        $subs = @(Get-ChildItem -Path $d -Directory -ErrorAction SilentlyContinue)
        foreach ($s in $subs) {
            $foundAny = $true
            $onnx = @(Get-ChildItem -Path $s.FullName -Filter *.onnx -ErrorAction SilentlyContinue)
            $tokens = Test-Path (Join-Path $s.FullName "tokens.txt")
            if (($onnx.Count -gt 0) -and $tokens) {
                Line ("[OK] " + $s.FullName + "  (*.onnx + tokens.txt present)")
            } else {
                $miss = @()
                if ($onnx.Count -eq 0) { $miss += "*.onnx" }
                if (-not $tokens) { $miss += "tokens.txt" }
                Line ("[WARN] " + $s.FullName + "  missing: " + ($miss -join ", "))
            }
        }
    }
}
if (-not $foundAny) {
    Line ("[FAIL] no sherpa-onnx model dir found under:")
    foreach ($d in $sherpaDirs) { Line ("       " + $d) }
    Line "       => this is why sherpa preview is unavailable."
    Line "       Seed a sherpa voice: python scripts\seed_sherpa_voices.py"
}

Head "3. Clone reference-audio quality (mic vs pipeline)"
$voiceDir = Join-Path $root "video_generation\storage\voice_clones"
if (-not (Test-Path $voiceDir)) {
    Line ("[INFO] no clone storage dir: " + $voiceDir)
} else {
    $wavs = @(Get-ChildItem -Path $voiceDir -Filter *.wav -ErrorAction SilentlyContinue)
    if ($wavs.Count -eq 0) { Line "[INFO] no reference wav files found." }
    foreach ($w in $wavs) {
        Line ""
        Line ("--- " + $w.Name + " ---")

        $jsonPath = [System.IO.Path]::ChangeExtension($w.FullName, ".json")
        if (Test-Path $jsonPath) {
            try {
                $meta = (Get-Content $jsonPath -Raw -Encoding utf8) | ConvertFrom-Json
                Line ("name=" + $meta.name + "  engine=" + $meta.engine)
            } catch { Line "[WARN] cannot parse json meta" }
        }

        $promptPath = $w.FullName + ".prompt.txt"
        if (Test-Path $promptPath) {
            $tx = (Get-Content $promptPath -Raw -Encoding utf8).Trim()
            Line "ASR transcript (what voxcpm thinks the sample says):"
            Line ('  "' + $tx + '"')
            Line "  -> if this does NOT match what you recorded, the clone will sound wrong (NOT a mic issue)."
        } else {
            Line "[INFO] no .prompt.txt transcript cached yet (generated on first synth)."
        }

        $a = Analyze-Wav $w.FullName
        if (-not $a.ok) {
            Line ("[WARN] wav analysis failed: " + $a.err)
            continue
        }
        Line ("format: " + $a.sampleRate + "Hz " + $a.channels + "ch  duration=" + ([math]::Round($a.duration, 2)) + "s")
        Line ("loudness RMS=" + $a.rmsDb + " dBFS  peak=" + $a.peakDb + " dBFS  noise floor=" + $a.noiseDb + " dBFS  SNR~=" + $a.snr + " dB")

        $clean = $true
        if (($a.sampleRate -ne 24000) -or ($a.channels -ne 1)) {
            Line "[WARN] unexpected format (expected 24000Hz mono after transcode) => ffmpeg transcode may have failed."
            $clean = $false
        }
        if ($a.duration -lt 3) { Line "[WARN] TOO SHORT (<3s). voxcpm clones best with 3-10s. Re-record longer."; $clean = $false }
        elseif ($a.duration -gt 30) { Line "[WARN] TOO LONG (>30s). Trim to 5-10s of clean speech."; $clean = $false }
        if ($a.peakDb -ge -1.0) { Line "[WARN] CLIPPING (peak near 0 dBFS). Mic too close / input gain too high => distorts the clone."; $clean = $false }
        if ($a.rmsDb -lt -32.0) { Line "[WARN] TOO QUIET (RMS < -32 dBFS). Mic too far / gain too low => weak, weird clone."; $clean = $false }
        if (($a.noiseDb -gt -45.0) -or ($a.snr -lt 18.0)) {
            Line "[WARN] NOISY background / low SNR. The denoiser is DISABLED in this build, so this noise"
            Line "       passes straight into the clone => a TOP cause of weird clones. Record in a quiet room."
            $clean = $false
        }
        if ($clean) {
            Line "[OK] reference audio looks clean. If the clone still sounds weird, it is the MODEL/PIPELINE"
            Line "     (CPU + voxcpm-0.5B), NOT your microphone."
        }
    }
}

Head "Summary / how to read this"
Line "- piper/edge/clone OK but sherpa fell back     => sherpa model missing (see section 2)."
Line "- edge FAIL but piper OK                        => edge needs INTERNET; check network/proxy."
Line "- clone weird + section 3 clipping/quiet/noisy  => it IS your mic/room. Re-record clean 5-10s."
Line "- clone weird + section 3 clean + transcript ok => it is the model (CPU/0.5B), not the mic."
Line "- transcript does NOT match recording           => ASR mis-heard; clone wrong regardless of mic."
Line ("Saved preview wavs in: " + $tmp)
Line ""
Line "Engine network needs:  piper=LOCAL  edge=INTERNET  sherpa=LOCAL  clone=LOCAL"
