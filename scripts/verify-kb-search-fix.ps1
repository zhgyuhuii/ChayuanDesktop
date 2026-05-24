<#
.SYNOPSIS
    Verify the langchain _euclidean_relevance_score_fn fix
    (faiss_cache.py inject _cosine_relevance_for_unit_l2)
    actually unblocks KB chat retrieval under default SCORE_THRESHOLD=0.3.

.DESCRIPTION
    Before fix: as_retriever(search_type="similarity_score_threshold",
                score_threshold=0.3) -> relevance < 0 for real bge-m3 chunks
                -> 0 hits.
    After fix : relevance = 1 - d^2/2 clipped to [0,1] -> typical real
                chunks get relevance ~0.4..0.9 -> hits >= 1.

    This script POSTs /knowledge_base/search_docs with:
      - the kb's own chunk text (must hit with relevance ~1.0)
      - a weakly-related word "smoke" (should now hit when before it didn't)
      - score_threshold=2.0 (server _normalize_threshold -> default 0.3,
        same path as real chat)
    Then prints VERDICT.

.PARAMETER KbName
    Default: latest e2e_smoke_*

.PARAMETER Sidecar
    Default http://127.0.0.1:62581

.PARAMETER ChayuanRoot
    Default D:\nn (for KB lookup)

.EXAMPLE
    # After rebuilding sidecar OR after restarting dev with poetry run:
    .\scripts\verify-kb-search-fix.ps1
#>
param(
    [string]$KbName       = "",
    [string]$Sidecar      = "http://127.0.0.1:62581",
    [string]$ChayuanRoot  = "D:\nn"
)

chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()

function Red    { param($m) Write-Host $m -ForegroundColor Red }
function Green  { param($m) Write-Host $m -ForegroundColor Green }
function Yellow { param($m) Write-Host $m -ForegroundColor Yellow }
function Cyan   { param($m) Write-Host $m -ForegroundColor Cyan }

if (-not $KbName) {
    $kbRoot = Join-Path $ChayuanRoot "data\knowledge_base"
    $candidates = Get-ChildItem $kbRoot -Directory -Filter "e2e_smoke_*" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending
    if (-not $candidates) {
        Red "[FAIL] No e2e_smoke_* KB under $kbRoot. Pass -KbName."
        exit 2
    }
    $KbName = $candidates[0].Name
    Yellow "Auto-picked latest KB: $KbName"
}

Cyan "================================================"
Cyan "KB     : $KbName"
Cyan "Sidecar: $Sidecar"
Cyan "================================================"

function Probe {
    param([string]$Desc, [string]$Query, [double]$ScoreThreshold)
    $body = @{
        query                = $Query
        knowledge_base_name  = $KbName
        top_k                = 5
        score_threshold      = $ScoreThreshold
    } | ConvertTo-Json -Compress
    Write-Host ""
    Write-Host "[$Desc] query=$($Query) score_threshold=$ScoreThreshold"
    try {
        $r = Invoke-RestMethod "$Sidecar/knowledge_base/search_docs" `
            -Method POST -Body $body -ContentType "application/json" -TimeoutSec 30
        $arr = if ($r.value) { $r.value } elseif ($r.data) { $r.data } else { $r }
        $hits = @($arr).Count
        Write-Host "  hits = $hits"
        $i = 0
        foreach ($d in @($arr)) {
            $i++
            $src = $d.metadata.source
            $rp  = $d.metadata.retrieval_path
            $sc  = $d.score
            $pc  = ($d.page_content -replace "`r?`n", " ")
            if ($pc.Length -gt 60) { $pc = $pc.Substring(0, 60) + "..." }
            Write-Host "  [$i] source=$src  score=$sc  retrieval_path=$rp"
            Write-Host "       content=$pc"
        }
        return $hits
    } catch {
        Red "  PROBE FAIL: $($_.Exception.Message)"
        return -1
    }
}

# probe 1: exact chunk text, hits should be >= 1 both before and after
$h1 = Probe "exact chunk text" "Chayuan E2E frozen-KB smoke test fixture" 2.0

# probe 2: single weak token, before fix=0, after fix should be >= 1
$h2 = Probe "weak token 'smoke'" "smoke" 2.0

# probe 3: another weak token
$h3 = Probe "weak token 'test'" "test" 2.0

# probe 4: completely unrelated, should be 0 in both
$h4 = Probe "unrelated 'banana'" "banana republic constitution chapter 9" 2.0

Cyan "`n================================================"
Cyan "VERDICT"
Cyan "================================================"
Write-Host "probe 1 (exact)         hits = $h1"
Write-Host "probe 2 (smoke)         hits = $h2"
Write-Host "probe 3 (test)          hits = $h3"
Write-Host "probe 4 (unrelated)     hits = $h4"
Write-Host ""

if ($h1 -lt 1) {
    Red "[ANOMALY] Even exact-text probe returns 0. KB may be empty or sidecar misrouted."
    Red "          Run scripts\diagnose-faiss-vs-keyword.ps1 to check FAISS file."
    exit 1
}

if ($h2 -ge 1 -or $h3 -ge 1) {
    Green "[FIX_WORKS] Weak-token probe now returns hits under default threshold."
    Green "            relevance_score_fn fix is loaded and effective."
    Green "            Real chat through KB should now retrieve content."
} else {
    Red "[FIX_NO_EFFECT] Weak-token probes still return 0."
    Red "                Either:"
    Red "                 (a) sidecar still running OLD code (rebuild + restart)"
    Red "                 (b) something else suppresses vector branch -- inspect"
    Red "                     sidecar log for retrieval errors."
}
if ($h4 -ge 1) {
    Yellow "[NOTE] 'banana' probe also hit -- threshold may be too permissive,"
    Yellow "       but this is harmless (top_k + rerank should reorder)."
}
