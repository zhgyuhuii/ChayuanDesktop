<#
.SYNOPSIS
    Diagnose which vector store backend (faiss vs sqlite-vec) the user's
    actual KBs are stored in, and whether the runtime can read them.

.DESCRIPTION
    Two-track storage exists:
      Track A: SqliteVecKBService -> <root>\vectors\local.sqlite
               (all KBs share one sqlite file, requires sqlite-vec extension)
      Track B: FaissKBService     -> <root>\data\knowledge_base\<kb>\
               vector_store\models\bundled\embedding\<emb>\index.faiss

    Which one is used depends on CHAYUAN_PROFILE env + apply_single_machine().
    A mismatch (info.db says sqlite-vec but sqlite-vec extension missing in
    frozen build) causes silent "KB returns 0 hits".

    This script checks:
      1. info.db: each KB's vs_type
      2. local.sqlite exists? size? vec0 tables? row counts?
      3. each KB's FAISS file (if vs_type=faiss): ntotal
      4. running chayuan-server's effective DEFAULT_VS_TYPE
      5. CHAYUAN_PROFILE env in the running sidecar process

.PARAMETER ChayuanRoot
    Default D:\nn

.PARAMETER Sidecar
    Default http://127.0.0.1:62581

.EXAMPLE
    .\scripts\diagnose-vs-backend.ps1
#>
param(
    [string]$ChayuanRoot = "D:\nn",
    [string]$Sidecar     = "http://127.0.0.1:62581"
)

chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()

function Red    { param($m) Write-Host $m -ForegroundColor Red }
function Green  { param($m) Write-Host $m -ForegroundColor Green }
function Yellow { param($m) Write-Host $m -ForegroundColor Yellow }
function Cyan   { param($m) Write-Host $m -ForegroundColor Cyan }

$infoDb       = Join-Path $ChayuanRoot "data\knowledge_base\info.db"
$localSqlite  = Join-Path $ChayuanRoot "vectors\local.sqlite"
$kbRoot       = Join-Path $ChayuanRoot "data\knowledge_base"

Cyan "================================================"
Cyan "ChayuanRoot   : $ChayuanRoot"
Cyan "info.db       : $infoDb         (exists=$(Test-Path $infoDb))"
Cyan "local.sqlite  : $localSqlite    (exists=$(Test-Path $localSqlite))"
Cyan "Sidecar       : $Sidecar"
Cyan "================================================"

# --- STEP 1: dump info.db kb_name -> vs_type ---
Cyan "`n[STEP 1] info.db: per-KB vs_type and embed_model"
$pyFile = Join-Path $env:TEMP "chayuan-info-dump.py"
$pyCode = @'
import sys, json, sqlite3
db = sys.argv[1]
out = {"path": db}
try:
    con = sqlite3.connect(db)
    cur = con.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [r[0] for r in cur.fetchall()]
    out["tables"] = tables
    if "knowledge_base" in tables:
        cur.execute("SELECT kb_name, vs_type, embed_model FROM knowledge_base")
        out["kbs"] = [{"kb_name": r[0], "vs_type": r[1], "embed_model": r[2]} for r in cur.fetchall()]
    con.close()
except Exception as e:
    out["error"] = repr(e)
print(json.dumps(out, ensure_ascii=False, indent=2))
'@
Set-Content -Path $pyFile -Value $pyCode -Encoding ascii
if (Test-Path $infoDb) {
    $pyOut = & python $pyFile $infoDb 2>&1
    $pyOut | ForEach-Object { Write-Host "  $_" }
} else {
    Red "  info.db not found"
}

# --- STEP 2: local.sqlite content (sqlite-vec backend) ---
Cyan "`n[STEP 2] local.sqlite: vec0 tables + row counts"
$pyFile2 = Join-Path $env:TEMP "chayuan-local-sqlite-dump.py"
$pyCode2 = @'
import sys, json, sqlite3, os
db = sys.argv[1]
out = {"path": db, "exists": os.path.isfile(db)}
if not out["exists"]:
    print(json.dumps(out, ensure_ascii=False, indent=2)); sys.exit(0)
out["size_bytes"] = os.path.getsize(db)
try:
    con = sqlite3.connect(db)
    cur = con.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [r[0] for r in cur.fetchall()]
    out["tables"] = tables
    # vec0 virtual tables stored as vec_<namespace>
    vec_tables = [t for t in tables if t.startswith("vec_")]
    out["vec_tables"] = vec_tables
    counts = {}
    for t in vec_tables:
        try:
            cur.execute(f"SELECT COUNT(*) FROM {t}")
            counts[t] = cur.fetchone()[0]
        except Exception as e:
            counts[t] = f"COUNT err: {e!r}"
    out["row_counts"] = counts
    # Also check for vec_meta if present
    if "vec_meta" in tables:
        cur.execute("SELECT * FROM vec_meta LIMIT 20")
        out["vec_meta_rows"] = [list(r) for r in cur.fetchall()]
    con.close()
except Exception as e:
    out["error"] = repr(e)
print(json.dumps(out, ensure_ascii=False, indent=2))
'@
Set-Content -Path $pyFile2 -Value $pyCode2 -Encoding ascii
$pyOut2 = & python $pyFile2 $localSqlite 2>&1
$pyOut2 | ForEach-Object { Write-Host "  $_" }

# --- STEP 3: per-KB FAISS index.faiss ntotal ---
Cyan "`n[STEP 3] per-KB FAISS files: ntotal"
$pyFile3 = Join-Path $env:TEMP "chayuan-faiss-walk.py"
$pyCode3 = @'
import sys, json, os
root = sys.argv[1]
results = []
if not os.path.isdir(root):
    print(json.dumps({"error": "kb root not found", "path": root})); sys.exit(0)
try:
    import faiss
except Exception as e:
    print(json.dumps({"error": "faiss import failed: " + str(e)})); sys.exit(0)
for kb in sorted(os.listdir(root)):
    kb_dir = os.path.join(root, kb)
    if not os.path.isdir(kb_dir):
        continue
    # walk for any index.faiss under vector_store
    for dirpath, _, files in os.walk(os.path.join(kb_dir, "vector_store")):
        if "index.faiss" in files:
            fp = os.path.join(dirpath, "index.faiss")
            entry = {"kb": kb, "file": fp, "size": os.path.getsize(fp)}
            try:
                idx = faiss.read_index(fp)
                entry["ntotal"] = int(idx.ntotal)
                entry["d"] = int(idx.d)
                entry["type"] = type(idx).__name__
            except Exception as e:
                entry["error"] = repr(e)
            results.append(entry)
print(json.dumps(results, ensure_ascii=False, indent=2))
'@
Set-Content -Path $pyFile3 -Value $pyCode3 -Encoding ascii
$pyOut3 = & python $pyFile3 $kbRoot 2>&1
$pyOut3 | ForEach-Object { Write-Host "  $_" }

# --- STEP 4: live sidecar effective DEFAULT_VS_TYPE ---
Cyan "`n[STEP 4] live sidecar Settings.kb_settings.DEFAULT_VS_TYPE"
try {
    $r = Invoke-RestMethod "$Sidecar/api/v1/health/profile" -TimeoutSec 5 -ErrorAction Stop
    Write-Host "  /api/v1/health/profile = $($r | ConvertTo-Json -Compress)"
} catch {
    Yellow "  /api/v1/health/profile not available; trying /knowledge_base/list_knowledge_bases"
    try {
        $r = Invoke-RestMethod "$Sidecar/knowledge_base/list_knowledge_bases" -TimeoutSec 5
        Write-Host "  list_knowledge_bases ok, but no profile field"
    } catch {
        Red "  sidecar unreachable: $($_.Exception.Message)"
    }
}

# --- STEP 5: CHAYUAN_PROFILE env in the running chayuan-server process ---
Cyan "`n[STEP 5] CHAYUAN_PROFILE env in running chayuan-server processes"
try {
    $procs = Get-CimInstance Win32_Process -Filter "Name='chayuan-server.exe' OR Name='python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match "chayuan|sidecar" }
    if (-not $procs) {
        Yellow "  no chayuan-server.exe / sidecar python.exe found"
    } else {
        foreach ($p in $procs) {
            Write-Host "  PID=$($p.ProcessId) Name=$($p.Name)"
            Write-Host "    Cmdline: $($p.CommandLine)"
        }
        # env vars require psutil-like; PS Get-Process cannot read env of other processes natively.
        Yellow "  (env vars per-process require psutil; check sidecar launcher logs instead)"
    }
} catch {
    Red "  process query failed: $($_.Exception.Message)"
}

# --- VERDICT ---
Cyan "`n================================================"
Cyan "VERDICT (manual)"
Cyan "================================================"
Write-Host "1. Check STEP 1: are KB vs_types 'faiss' or 'sqlite-vec'?"
Write-Host "   If mixed -> some KBs created under different profile."
Write-Host "2. Check STEP 2: does local.sqlite have vec_* tables with row_counts > 0?"
Write-Host "   If yes -> sqlite-vec actually has data; need to verify search path works."
Write-Host "3. Check STEP 3: which FAISS files have ntotal > 0?"
Write-Host "   ntotal=0 means embed write never landed; ntotal>0 means FAISS branch works."
Write-Host "4. If STEP 1 says sqlite-vec but STEP 2 says local.sqlite missing"
Write-Host "   -> sqlite-vec extension missing in frozen build, or write path broken."
