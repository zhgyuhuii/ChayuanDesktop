<#
.SYNOPSIS
    Real-truth probe for KB "xxx" in D:\chayuan-data.
    No wrappers, no interpretation -- dumps raw filesystem state and
    raw sidecar responses, so we can see exactly what's going on.

.DESCRIPTION
    Five steps:
      1. Filesystem: does the KB dir exist? content files? FAISS file?
         What does info.db say about vs_type / embed_model?
      2. local.sqlite: does sqlite-vec hold data for this KB?
      3. search_docs raw: POST and dump full JSON (no PS object unwrap).
      4. kb-query raw: POST /api/v1/kb-query/search and dump full JSON.
      5. list_knowledge_bases: sanity check that sidecar sees xxx at all.

    Then VERDICT spells out which backend "xxx" is on and whether
    retrieval really returned chunks.
#>
param(
    [string]$ChayuanRoot = "D:\chayuan-data",
    [string]$KbName      = "xxx",
    [string]$Sidecar     = "http://127.0.0.1:62581"
)

chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()

function Red    { param($m) Write-Host $m -ForegroundColor Red }
function Green  { param($m) Write-Host $m -ForegroundColor Green }
function Yellow { param($m) Write-Host $m -ForegroundColor Yellow }
function Cyan   { param($m) Write-Host $m -ForegroundColor Cyan }

$kbDir       = Join-Path $ChayuanRoot "data\knowledge_base\$KbName"
$infoDb      = Join-Path $ChayuanRoot "data\knowledge_base\info.db"
$localSqlite = Join-Path $ChayuanRoot "vectors\local.sqlite"
$contentDir  = Join-Path $kbDir "content"
$vsDir       = Join-Path $kbDir "vector_store"

Cyan "================================================"
Cyan "ChayuanRoot : $ChayuanRoot"
Cyan "KbName      : $KbName"
Cyan "Sidecar     : $Sidecar"
Cyan "kbDir       : $kbDir            (exists=$(Test-Path $kbDir))"
Cyan "infoDb      : $infoDb           (exists=$(Test-Path $infoDb))"
Cyan "localSqlite : $localSqlite      (exists=$(Test-Path $localSqlite))"
Cyan "================================================"

# --- STEP 1: filesystem ---
Cyan "`n[STEP 1] filesystem for $KbName"
if (Test-Path $contentDir) {
    $files = Get-ChildItem $contentDir -File -ErrorAction SilentlyContinue
    Write-Host "  content/: $($files.Count) files"
    $files | Select-Object -First 10 | ForEach-Object {
        Write-Host "    - $($_.Name) ($($_.Length) bytes)"
    }
} else {
    Yellow "  content/ dir missing -- KB has no source files"
}

if (Test-Path $vsDir) {
    $faissFiles = Get-ChildItem $vsDir -Recurse -Filter "index.faiss" -ErrorAction SilentlyContinue
    if ($faissFiles) {
        Write-Host "  vector_store/ FAISS files:"
        foreach ($f in $faissFiles) {
            Write-Host "    - $($f.FullName) ($($f.Length) bytes)"
        }
    } else {
        Yellow "  vector_store/ exists but NO index.faiss inside"
    }
} else {
    Yellow "  vector_store/ dir missing -- KB never indexed via FAISS"
}

# --- STEP 1b: info.db vs_type ---
Cyan "`n[STEP 1b] info.db row for $KbName"
$pyFile = Join-Path $env:TEMP "probe-info-db.py"
$pyCode = @'
import sys, json, sqlite3
db, kb = sys.argv[1], sys.argv[2]
out = {"db": db, "kb": kb}
try:
    c = sqlite3.connect(db)
    rows = c.execute(
        "SELECT kb_name, vs_type, embed_model, file_count, create_time "
        "FROM knowledge_base WHERE kb_name = ?", (kb,)
    ).fetchall()
    out["match_rows"] = [list(r) for r in rows]
    # list all KBs for context
    all_rows = c.execute("SELECT kb_name, vs_type FROM knowledge_base").fetchall()
    out["all_kbs"] = [list(r) for r in all_rows]
    # count knowledge_file rows for this KB
    try:
        rows2 = c.execute(
            "SELECT COUNT(*) FROM knowledge_file WHERE kb_name = ?", (kb,)
        ).fetchone()
        out["knowledge_file_rows"] = rows2[0] if rows2 else 0
    except Exception as e:
        out["knowledge_file_err"] = repr(e)
    # count file_doc rows for this KB
    try:
        rows3 = c.execute(
            "SELECT COUNT(*) FROM file_doc WHERE kb_name = ?", (kb,)
        ).fetchone()
        out["file_doc_rows"] = rows3[0] if rows3 else 0
    except Exception as e:
        out["file_doc_err"] = repr(e)
    c.close()
except Exception as e:
    out["error"] = repr(e)
print(json.dumps(out, ensure_ascii=False, indent=2))
'@
Set-Content -Path $pyFile -Value $pyCode -Encoding ascii
if (Test-Path $infoDb) {
    $pyOut = & python $pyFile $infoDb $KbName 2>&1
    $pyOut | ForEach-Object { Write-Host "  $_" }
} else {
    Red "  info.db missing"
}

# --- STEP 2: local.sqlite (sqlite-vec) ---
Cyan "`n[STEP 2] local.sqlite vec0 tables (sqlite-vec backend)"
$pyFile2 = Join-Path $env:TEMP "probe-local-sqlite.py"
$pyCode2 = @'
import sys, json, sqlite3, os
db = sys.argv[1]
out = {"db": db, "exists": os.path.isfile(db)}
if not out["exists"]:
    print(json.dumps(out, indent=2)); sys.exit(0)
try:
    out["size_bytes"] = os.path.getsize(db)
    c = sqlite3.connect(db)
    tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    out["all_tables"] = tables
    vec_tables = [t for t in tables if t.startswith("vec_")]
    out["vec_tables"] = vec_tables
    counts = {}
    for t in vec_tables:
        try:
            n = c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            counts[t] = n
        except Exception as e:
            counts[t] = f"ERR {e!r}"
    out["row_counts"] = counts
    c.close()
except Exception as e:
    out["error"] = repr(e)
print(json.dumps(out, ensure_ascii=False, indent=2))
'@
Set-Content -Path $pyFile2 -Value $pyCode2 -Encoding ascii
$pyOut2 = & python $pyFile2 $localSqlite 2>&1
$pyOut2 | ForEach-Object { Write-Host "  $_" }

# --- STEP 3: list_knowledge_bases (sidecar's view) ---
Cyan "`n[STEP 3] sidecar list_knowledge_bases (does it see $KbName?)"
try {
    $r = Invoke-WebRequest "$Sidecar/knowledge_base/list_knowledge_bases" `
        -Method GET -TimeoutSec 10 -UseBasicParsing
    $text = [System.Text.Encoding]::UTF8.GetString($r.Content)
    Write-Host "  raw body:"
    Write-Host "    $text"
} catch {
    Red "  list failed: $($_.Exception.Message)"
}

# --- STEP 4: search_docs raw ---
Cyan "`n[STEP 4] search_docs raw responses"
$queries = @(
    "Chayuan E2E frozen-KB smoke test fixture",
    "smoke",
    "test",
    "banana republic chapter 9"
)
foreach ($q in $queries) {
    $bodyHash = @{
        query                = $q
        knowledge_base_name  = $KbName
        top_k                = 5
        score_threshold      = 2.0
    }
    $body = $bodyHash | ConvertTo-Json -Compress
    Write-Host ""
    Write-Host "-- query: $q"
    try {
        $resp = Invoke-WebRequest "$Sidecar/knowledge_base/search_docs" `
            -Method POST -Body $body -ContentType "application/json" `
            -TimeoutSec 30 -UseBasicParsing
        $text = [System.Text.Encoding]::UTF8.GetString($resp.Content)
        # raw dump, no parsing
        Write-Host "   raw body ($($text.Length) chars):"
        if ($text.Length -gt 1500) {
            Write-Host "     $($text.Substring(0,1500))..."
        } else {
            Write-Host "     $text"
        }
    } catch {
        Red "   FAIL: $($_.Exception.Message)"
    }
}

# --- STEP 5: kb-query/search raw (new unified API) ---
Cyan "`n[STEP 5] kb-query/search raw (newer API)"
$kuId = "doc:$KbName"
$bodyHash2 = @{
    query   = "smoke"
    ku_ids  = @($kuId)
    top_k   = 5
}
$body2 = $bodyHash2 | ConvertTo-Json -Compress
Write-Host "  ku_ids = [$kuId]  query=smoke"
try {
    $resp = Invoke-WebRequest "$Sidecar/api/v1/kb-query/search" `
        -Method POST -Body $body2 -ContentType "application/json" `
        -TimeoutSec 30 -UseBasicParsing
    $text = [System.Text.Encoding]::UTF8.GetString($resp.Content)
    Write-Host "  raw body ($($text.Length) chars):"
    if ($text.Length -gt 2000) {
        Write-Host "    $($text.Substring(0,2000))..."
    } else {
        Write-Host "    $text"
    }
} catch {
    Yellow "  kb-query/search not available or failed: $($_.Exception.Message)"
}

# --- VERDICT ---
Cyan "`n================================================"
Cyan "VERDICT (read by hand)"
Cyan "================================================"
Write-Host "1. STEP 1: KB dir exists? content/ has files? vector_store has index.faiss?"
Write-Host "   - no content files -> KB never had uploads"
Write-Host "   - no index.faiss   -> never went through FAISS path"
Write-Host ""
Write-Host "2. STEP 1b: info.db says vs_type = ?"
Write-Host "   - faiss      -> FAISS path, our fix applies"
Write-Host "   - sqlite-vec -> SqliteVec path, fix does NOT apply (different code)"
Write-Host "   - empty match_rows -> KB not in info.db at all"
Write-Host ""
Write-Host "3. STEP 2: vec_<namespace> table with rows?"
Write-Host "   - if vs_type=sqlite-vec but no matching vec_ table -> store missing"
Write-Host ""
Write-Host "4. STEP 3: sidecar list contains $KbName ?"
Write-Host "   - if not listed -> KB exists on disk but sidecar refuses to load"
Write-Host ""
Write-Host "5. STEP 4: search_docs raw body"
Write-Host "   - if body is {`"data`":[...]} with actual chunks -> retrieval works"
Write-Host "   - if {`"value`":[...]} or {`"code`":...,`"msg`":...} with no chunks -> empty or error"
Write-Host ""
Write-Host "6. STEP 5: kb-query/search returns blocks?"
