<#
.SYNOPSIS
    Bypass the desktop app, POST /chat/chat directly with the exact
    payload shape that buildRequest.ts produces. Compare server response
    against KB content to determine if the issue is client (composer
    state / buildRequest) or server (chat handler / KBHandler dispatch).

.DESCRIPTION
    From the existing probe we know:
      - KB "xxx" really has 2 chunks in FAISS
      - /knowledge_base/search_docs returns both chunks correctly
      - fix _cosine_relevance_for_unit_l2 is loaded
    Yet the desktop app's chat does NOT use the KB.

    This script tries 3 different chat request shapes:
      A. mode='kb' + ku_ids=['doc:xxx']     -- new path (MultiSourceRetriever)
      B. mode='kb' + kb_names=['xxx']       -- legacy doc search path
      C. mode='kb' + kb_name='xxx'          -- oldest single-KB path
    And dumps the raw response (no PS parsing -- writes to file).

    Compare:
      - if A returns text mentioning "deepseek sk-" / "ollama" / "apikey"
        -> KBHandler dispatched, KB content used, problem is FRONT-END
        (composer.selectedKuIds is empty or buildRequest skips ku_ids)
      - if A returns LLM saying "no knowledge provided" / generic answer
        -> KBHandler not dispatched OR chunks not injected -- SERVER bug
        in chat dispatcher / prompt template
#>
param(
    [string]$Sidecar = "http://127.0.0.1:62581",
    [string]$KbName  = "xxx",
    [string]$Query   = ""
)
if (-not $Query) {
    # default query as raw UTF-8 bytes to avoid GBK-decode mojibake
    $Query = [System.Text.Encoding]::UTF8.GetString([byte[]](
        # decodes to: "api key.txt wenjianli xiele naxie apikey?" (zh)
        0x61,0x70,0x69,0x20,0x6b,0x65,0x79,0x2e,0x74,0x78,0x74,0x20,
        0xe6,0x96,0x87,0xe4,0xbb,0xb6,0xe9,0x87,0x8c,
        0xe5,0x86,0x99,0xe4,0xba,0x86,0xe5,0x93,0xaa,0xe4,0xba,0x9b,0x20,
        0x61,0x70,0x69,0x6b,0x65,0x79,0x3f
    ))
}

chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()

function Red    { param($m) Write-Host $m -ForegroundColor Red }
function Green  { param($m) Write-Host $m -ForegroundColor Green }
function Yellow { param($m) Write-Host $m -ForegroundColor Yellow }
function Cyan   { param($m) Write-Host $m -ForegroundColor Cyan }

# Build 3 candidate payload shapes
$base = @{
    query           = $Query
    history         = @()
    stream          = $false
    top_k           = 5
    score_threshold = 2.0
    temperature     = 0.7
}

$variants = @(
    @{
        name    = "A_ku_ids_only";
        body    = $base.Clone()
        extra   = @{ mode = "kb"; ku_ids = @("doc:$KbName") }
    },
    @{
        name    = "B_kb_names_only";
        body    = $base.Clone()
        extra   = @{ mode = "kb"; kb_names = @($KbName) }
    },
    @{
        name    = "C_all_three";
        body    = $base.Clone()
        extra   = @{
            mode      = "kb"
            ku_ids    = @("doc:$KbName")
            kb_names  = @($KbName)
            kb_name   = $KbName
        }
    },
    @{
        name    = "D_no_kb_baseline";
        body    = $base.Clone()
        extra   = @{ mode = "" }
    }
)

# candidate chat endpoints (different sidecar versions expose different names)
$endpoints = @(
    "/chat/chat",
    "/chat/v2/chat",
    "/chat/chayuan_chat",
    "/api/v1/chat/chat"
)

# sanity header
Cyan "================================================"
Cyan "Sidecar : $Sidecar"
Cyan "KbName  : $KbName"
Cyan "Query   : $Query"
Cyan "================================================"

# write responses to files to avoid PS console encoding issues
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir = Join-Path $env:TEMP "chayuan-chat-probe-$ts"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
Cyan "Output dir: $outDir`n"

function SafePost {
    param([string]$Url, [string]$BodyJson, [string]$FileName)
    $outPath = Join-Path $outDir $FileName
    try {
        $resp = Invoke-WebRequest $Url -Method POST -Body $BodyJson `
            -ContentType "application/json" -TimeoutSec 120 -UseBasicParsing
        # Write bytes directly to file as UTF-8
        [System.IO.File]::WriteAllBytes($outPath, $resp.Content)
        $size = (Get-Item $outPath).Length
        return @{ ok = $true; size = $size; path = $outPath; status = $resp.StatusCode }
    } catch {
        $msg = $_.Exception.Message
        [System.IO.File]::WriteAllText($outPath + ".err", $msg, [System.Text.UTF8Encoding]::new($true))
        return @{ ok = $false; error = $msg; path = $outPath + ".err" }
    }
}

# Try each (endpoint, variant) combo, only report success on first valid 2xx
foreach ($ep in $endpoints) {
    $url = "$Sidecar$ep"
    Cyan "==== endpoint: $ep ===="
    foreach ($v in $variants) {
        $payload = $v.body + $v.extra
        $bodyJson = $payload | ConvertTo-Json -Compress -Depth 10
        $fname = "$($v.name)__$($ep -replace '/','_').json"
        $r = SafePost -Url $url -BodyJson $bodyJson -FileName $fname
        if ($r.ok) {
            Green "  [OK] $($v.name) status=$($r.status) size=$($r.size) -> $($r.path)"
            # Show first 500 chars of body in console (UTF-8 decoded)
            $bytes = [System.IO.File]::ReadAllBytes($r.path)
            $text = [System.Text.Encoding]::UTF8.GetString($bytes)
            $preview = if ($text.Length -gt 500) { $text.Substring(0, 500) + "..." } else { $text }
            Write-Host "     preview: $preview"
        } else {
            Yellow "  [--] $($v.name) FAIL: $($r.error -split '`n' | Select-Object -First 1)"
        }
    }
    Write-Host ""
}

Cyan "================================================"
Cyan "READ THE FILES"
Cyan "================================================"
Write-Host "All responses saved to $outDir as UTF-8 .json / .err"
Write-Host ""
Write-Host "Look at variant 'A_ku_ids_only' or 'C_all_three' response in any working endpoint:"
Write-Host "  - If body contains 'deepseek' / 'ollama' / 'apikey' (real chunk content)"
Write-Host "    -> SERVER chain works. Problem is CLIENT (buildRequest / composer state)."
Write-Host "  - If body says 'no knowledge provided' / pure generic LLM answer"
Write-Host "    -> SERVER bug. Chat dispatcher not routing to KBHandler, or chunks"
Write-Host "       not injected into prompt template."
Write-Host ""
Write-Host "Open all responses:"
Write-Host "  notepad ${outDir}\A_ku_ids_only__*.json"
