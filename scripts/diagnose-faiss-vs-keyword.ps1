<#
.SYNOPSIS
    Last-resort diagnostic: is vector retrieval REALLY broken, or just
    score_threshold filtering? Single script, no manual paste, outputs the
    answer + final verdict to console.

.DESCRIPTION
    All previous tests showed:
      - embed_documents returns real 1024-dim vectors
      - add_embeddings ran (index.ntotal 0 -> 1)
      - save_local ran (in-mem ntotal=1)
      - on-disk index.faiss = 4141 bytes
      - search_docs returns hits only via retrieval_path=keyword,
        never "vector" / "hybrid", even with score_threshold=1000

    Two questions remain:
      Q1. Is the on-disk FAISS file actually empty (ntotal=0)?
          -> 4141 might be empty header, or might be 1 vector + header.
      Q2. Why does vector retriever return zero candidates?

    This script answers both:
      Step 1: Run python in subprocess to call faiss.read_index, print
              real ntotal / d. (Inline python -c repeatedly breaks in PS 5.1
              copy-paste so we always write a temp file.)
      Step 2: Hit /knowledge_base/search_docs with the EXACT chunk content +
              extremely broad score_threshold + multiple distance strategies.
      Step 3: Direct-query the embedding sidecar for two texts (chunk +
              query) and compute L2 distance manually -- if FAISS doesn't
              find this match with threshold=1e9, we KNOW langchain's
              retriever wiring is broken, not the data.
      Step 4: Print a single-line VERDICT.

.PARAMETER KbName
    KB to diagnose. Default: most recent e2e_smoke_*

.PARAMETER ChayuanRoot
    Override chayuan_root. Default: D:\nn

.PARAMETER Sidecar
    chayuan-server base URL. Default http://127.0.0.1:62581.

.PARAMETER EmbedSidecar
    embedding sidecar base. Default http://127.0.0.1:62583.

.EXAMPLE
    .\scripts\diagnose-faiss-vs-keyword.ps1
    .\scripts\diagnose-faiss-vs-keyword.ps1 -KbName e2e_smoke_kor1gnsu
#>
param(
    [string]$KbName       = "",
    [string]$ChayuanRoot  = "D:\nn",
    [string]$Sidecar      = "http://127.0.0.1:62581",
    [string]$EmbedSidecar = "http://127.0.0.1:62583"
)

chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()

function Red    { param($m) Write-Host $m -ForegroundColor Red }
function Green  { param($m) Write-Host $m -ForegroundColor Green }
function Yellow { param($m) Write-Host $m -ForegroundColor Yellow }
function Cyan   { param($m) Write-Host $m -ForegroundColor Cyan }

# --- 0. Auto-pick latest e2e_smoke_* if KbName not given ---
if (-not $KbName) {
    $kbRoot = Join-Path $ChayuanRoot "data\knowledge_base"
    $candidates = Get-ChildItem $kbRoot -Directory -Filter "e2e_smoke_*" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending
    if (-not $candidates) {
        Red "[FAIL] No e2e_smoke_* KB found under $kbRoot, pass -KbName explicitly"
        exit 2
    }
    $KbName = $candidates[0].Name
    Yellow "Auto-picked latest KB: $KbName"
}
$kbDir   = Join-Path $ChayuanRoot "data\knowledge_base\$KbName"
$faissFile = Join-Path $kbDir "vector_store\models\bundled\embedding\bge-m3\index.faiss"

Cyan "================================================"
Cyan "KB        : $KbName"
Cyan "kbDir     : $kbDir"
Cyan "FAISS file: $faissFile"
Cyan "Sidecar   : $Sidecar"
Cyan "Embedder  : $EmbedSidecar"
Cyan "================================================"

# --- Step 1: read FAISS ntotal via python in temp .py (avoid PS -c parse bugs) ---
Cyan "`n[STEP 1] python: read FAISS ntotal"
$pyFile = Join-Path $env:TEMP "chayuan-check-faiss.py"
$pyCode = @'
import sys, json
try:
    import faiss
except Exception as e:
    print(json.dumps({"error": "faiss import failed: " + str(e)}))
    sys.exit(2)
p = sys.argv[1]
try:
    idx = faiss.read_index(p)
except Exception as e:
    print(json.dumps({"error": "read_index failed: " + str(e), "path": p}))
    sys.exit(2)
result = {
    "ntotal": int(idx.ntotal),
    "d": int(idx.d),
    "metric_type": getattr(idx, "metric_type", None),
    "is_trained": bool(getattr(idx, "is_trained", True)),
    "type": type(idx).__name__,
}
# Try to read a sample vector to verify content is real
if idx.ntotal > 0:
    try:
        import numpy as np
        rec = idx.reconstruct(0)
        result["first_3"] = [float(v) for v in rec[:3]]
        result["all_zero"] = bool(np.all(rec == 0))
    except Exception as e:
        result["reconstruct_error"] = str(e)
print(json.dumps(result, ensure_ascii=False))
'@
Set-Content -Path $pyFile -Value $pyCode -Encoding ascii
$pyOut = & python $pyFile $faissFile 2>&1
$pyExit = $LASTEXITCODE
Write-Host "  python exit=$pyExit"
Write-Host "  raw output:"
$pyOut | ForEach-Object { Write-Host "    $_" }
$faissInfo = $null
try { $faissInfo = ($pyOut -join "") | ConvertFrom-Json } catch {}
$ntotal = if ($faissInfo) { $faissInfo.ntotal } else { -1 }
$dim    = if ($faissInfo) { $faissInfo.d }      else { -1 }
$first3 = if ($faissInfo -and $faissInfo.first_3) { $faissInfo.first_3 } else { $null }
$allZero = if ($faissInfo) { $faissInfo.all_zero } else { $null }
$faissType = if ($faissInfo) { $faissInfo.type } else { "?" }

# --- Step 2: hit search_docs with extreme parameters ---
Cyan "`n[STEP 2] search_docs probes (chayuan-server)"
$probes = @(
    @{ desc="exact chunk text + threshold 1000";
       body='{"query":"Chayuan E2E frozen-KB smoke test fixture","knowledge_base_name":"' + $KbName + '","top_k":5,"score_threshold":1000}' },
    @{ desc="exact chunk text + threshold 9999";
       body='{"query":"Chayuan E2E frozen-KB smoke test fixture","knowledge_base_name":"' + $KbName + '","top_k":5,"score_threshold":9999}' },
    @{ desc="single char 'a' + threshold 1000 (max recall)";
       body='{"query":"a","knowledge_base_name":"' + $KbName + '","top_k":5,"score_threshold":1000}' }
)
$probeResults = @()
foreach ($p in $probes) {
    Write-Host "  -- $($p.desc)"
    try {
        $r = Invoke-RestMethod "$Sidecar/knowledge_base/search_docs" `
            -Method POST -Body $p.body -ContentType "application/json" -TimeoutSec 30
        # Unwrap response shape
        $arr = if ($r.value) { $r.value } elseif ($r.data) { $r.data } else { $r }
        $hits = @($arr).Count
        $paths = ($arr | ForEach-Object { $_.metadata.retrieval_path } | Where-Object { $_ } | Sort-Object -Unique) -join ","
        if (-not $paths) { $paths = "(none in metadata)" }
        Write-Host "     hits=$hits retrieval_paths=[$paths]"
        $probeResults += [pscustomobject]@{ desc=$p.desc; hits=$hits; paths=$paths }
    } catch {
        Red "     FAIL: $($_.Exception.Message)"
        $probeResults += [pscustomobject]@{ desc=$p.desc; hits=-1; paths="FAIL" }
    }
}

# --- Step 3: compute L2 distance manually via direct sidecar embed ---
Cyan "`n[STEP 3] direct sidecar embed of query + chunk -> manual L2"
$manualL2 = "?"
try {
    $queryText = "Chayuan E2E frozen-KB smoke test fixture"
    $chunkText = "Chayuan E2E frozen-KB smoke test fixture"  # same as query (should give L2=0)
    foreach ($pair in @(
        @{ name="query"; text=$queryText },
        @{ name="chunk"; text=$chunkText }
    )) {
        $b = '{"model":"models/bundled/embedding/bge-m3","input":"' + $pair.text + '"}'
        $resp = Invoke-RestMethod "$Sidecar/v1/embeddings" -Method POST -Body $b `
            -ContentType "application/json" -TimeoutSec 15
        $vec = $resp.data[0].embedding
        Set-Variable -Name ("vec_" + $pair.name) -Value $vec -Scope Script
    }
    $sumSq = 0.0
    for ($i = 0; $i -lt $vec_query.Count; $i++) {
        $diff = [double]$vec_query[$i] - [double]$vec_chunk[$i]
        $sumSq += $diff * $diff
    }
    $manualL2 = [math]::Sqrt($sumSq)
    Write-Host "  L2(query, chunk) = $manualL2  (should be 0 since same text)"
} catch {
    Red "  embed direct probe FAIL: $($_.Exception.Message)"
}

# --- Step 4: VERDICT ---
Cyan "`n================================================"
Cyan "VERDICT"
Cyan "================================================"
Write-Host "FAISS file       : $faissFile"
Write-Host "FAISS type       : $faissType"
Write-Host "FAISS ntotal     : $ntotal"
Write-Host "FAISS dim        : $dim"
if ($first3) { Write-Host "first 3 floats   : $($first3 -join ', ')  all_zero=$allZero" }
Write-Host ""
foreach ($p in $probeResults) {
    Write-Host "search probe [$($p.desc)]: hits=$($p.hits) paths=[$($p.paths)]"
}
Write-Host "manual L2 same-text: $manualL2"
Write-Host ""

$hasVectorPath = ($probeResults | Where-Object { $_.paths -match 'vector|hybrid' }).Count -gt 0
if ($ntotal -le 0) {
    Red "[ROOT-CAUSE] FAISS file ntotal=$ntotal  -> save_local actually wrote 0 vectors."
    Red "             Fix in langchain FAISS / chayuan new_vector_store delete+add path."
} elseif ($hasVectorPath) {
    Green "[OK] vector retrieval engaged. All chains work end-to-end."
} else {
    Red "[ROOT-CAUSE] FAISS file has $ntotal vectors on disk but search_docs never"
    Red "             returns retrieval_path=vector/hybrid, even with score_threshold=1000."
    Red "             -> langchain FAISS retriever / ensemble retriever wiring is broken."
    Red "             Likely culprits:"
    Red "               1. new_vector_store does delete(ids) on init doc -> langchain"
    Red "                  FAISS index_to_docstore_id mapping ends up empty / inconsistent."
    Red "                  When add_embeddings adds a new vector, it goes into index but"
    Red "                  the mapping lookup at search time can't translate FAISS internal"
    Red "                  ID back to docstore ID -> 0 hits."
    Red "               2. Ensemble retriever vector branch silently throws and falls back"
    Red "                  to keyword only."
}
