<#
.SYNOPSIS
    Diagnose why uploaded files into a knowledge base never get vectorized
    (KB visible in UI but search returns nothing). Generates a single UTF-8
    markdown report safe to paste to a developer.

.DESCRIPTION
    All source is ASCII / English -- PowerShell 5.1 on zh-CN Windows decodes
    BOM-less .ps1 files as GBK, which mojibake-s Chinese string literals and
    breaks parsing. The output .md uses [System.IO.File]::WriteAllText with
    explicit UTF-8 BOM so Notepad / VSCode / PS render correctly.

    Sections collected:
      1. tiktoken runtime-hook log lines (verifies cl100k_base patch is live)
      2. KB on-disk layout (content/ + vector_store/ files + sizes)
      3. /knowledge_base/list_files response (what backend believes is there)
      4. /knowledge_base/recreate_vector_store call (forces backend to redo
         chunking + embedding; this is the one that surfaces the real error)
      5. Direct /knowledge_base/search_docs probe with a test query
      6. server.log tail 300 (where the traceback lives)
      7. server.log filtered for KB-relevant keywords (tiktoken, vector_store,
         embed, upload_docs, recreate, search_docs, exceptions)
      8. embedding sidecar reachability (curl /v1/models on 62583)

.PARAMETER KbName
    The knowledge base name to diagnose. Default "bb" matches the user's
    current test KB.

.PARAMETER SidecarBase
    chayuan-server base URL. Default http://127.0.0.1:62581.

.PARAMETER TestQuery
    Test query string to use for the /search_docs probe.
    Default: "deepseek apikey".

.EXAMPLE
    bash scripts\diagnose-kb-vectorize.ps1
    bash scripts\diagnose-kb-vectorize.ps1 -KbName my_kb
    bash scripts\diagnose-kb-vectorize.ps1 -KbName bb -TestQuery "apikey"
#>
param(
    [string]$KbName = "bb",
    [string]$SidecarBase = "http://127.0.0.1:62581",
    [string]$TestQuery = "deepseek apikey"
)

# Force UTF-8 console end-to-end so child commands and Get-Content
# do not GBK-decode UTF-8 bytes.
chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()

$ts  = Get-Date -Format "yyyyMMdd-HHmmss"
$out = Join-Path $env:TEMP "chayuan-kb-diag-$ts.md"

$utf8Bom = [System.Text.UTF8Encoding]::new($true)
$header = "# KB vectorize diagnostic for KB='${KbName}' at ${ts}`n`n" +
          "- Sidecar: ${SidecarBase}`n" +
          "- Test query: ${TestQuery}`n`n"
[System.IO.File]::WriteAllText($out, $header, $utf8Bom)

function Append-Section {
    param([string]$Title, [string]$Body)
    $block = "`n## $Title`n``````n$Body`n```````n"
    [System.IO.File]::AppendAllText($out, $block, $utf8Bom)
}

function Try-Invoke {
    param([scriptblock]$Block)
    try { & $Block | Out-String }
    catch { "FAIL: $($_.Exception.Message)`n$($_.ErrorDetails.Message)" }
}

# Resolve chayuan_root from the running server (single source of truth -- the
# user may have CHAYUAN_ROOT pointing at D: or default %APPDATA%; whichever
# the running server uses is what we need).
$chayuanRoot = $null
$rootErr = $null
try {
    $chayuanRoot = (Invoke-RestMethod "${SidecarBase}/runtime/diagnose" -TimeoutSec 10).data.chayuan_root
} catch {
    $rootErr = $_.Exception.Message
}

$logPath = $null
if ($chayuanRoot) {
    $cand = @(
        (Join-Path $chayuanRoot "logs\server.log"),
        (Join-Path $chayuanRoot "logs\chayuan.log"),
        "$env:APPDATA\chayuan\logs\server.log",
        "$env:APPDATA\chayuan\logs\chayuan.log"
    ) | Where-Object { Test-Path $_ }
    if ($cand) { $logPath = $cand[0] }
} else {
    $logPath = "$env:APPDATA\chayuan\logs\server.log"
    if (-not (Test-Path $logPath)) { $logPath = $null }
}

$envSummary = @"
chayuan_root          : $chayuanRoot
chayuan_root resolve  : $(if ($rootErr) { "FAIL: $rootErr" } else { "OK" })
log path picked       : $logPath
"@
Append-Section "0. environment resolution" $envSummary

# ----------------------------------------------------------------------
# 1. tiktoken hook trace -- confirms the cl100k_base patch ran inside the
# API-server mp child (the process where KB chunking actually happens).
# ----------------------------------------------------------------------
$tikLines = Try-Invoke {
    if (-not $logPath) { return "(no log path; chayuan-server not running or log missing)" }
    $hits = Get-Content $logPath -Encoding utf8 | Select-String "tiktoken-rthook"
    if (-not $hits) {
        "(no [tiktoken-rthook] lines found in $logPath)`n" +
        "This means commit 94b3e6a / 77c80ac is NOT in the running build.`n" +
        "You must rebuild PyInstaller and copy dist/chayuan-server/* into the install dir."
    } else {
        ($hits | Select-Object -Last 10 | ForEach-Object { $_.Line }) -join "`n"
    }
}
Append-Section "1. tiktoken hook trace (expect 'patched _available_plugin_modules')" $tikLines

# ----------------------------------------------------------------------
# 2. KB on-disk layout
# ----------------------------------------------------------------------
$disk = Try-Invoke {
    if (-not $chayuanRoot) { return "(chayuan_root unresolved)" }
    $kbDir = Join-Path $chayuanRoot "knowledge_base\$KbName"
    if (-not (Test-Path $kbDir)) { return "(KB dir does not exist: $kbDir)" }
    $sb = [System.Text.StringBuilder]::new()
    $sb.AppendLine("KB dir: $kbDir") | Out-Null
    Get-ChildItem $kbDir -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object FullName |
        Select-Object @{N='Rel';E={$_.FullName.Substring($kbDir.Length + 1)}},
                      @{N='Bytes';E={$_.Length}},
                      @{N='KB';E={[math]::Round($_.Length / 1KB, 1)}} |
        Format-Table -AutoSize |
        Out-String |
        ForEach-Object { $sb.AppendLine($_) | Out-Null }
    $sb.ToString()
}
Append-Section "2. KB on-disk layout (look for vector_store/<embed_model>/index.faiss with non-zero size)" $disk

# ----------------------------------------------------------------------
# 3. /knowledge_base/list_files
# ----------------------------------------------------------------------
$listFiles = Try-Invoke {
    (Invoke-RestMethod "${SidecarBase}/knowledge_base/list_files?knowledge_base_name=$KbName" -TimeoutSec 15) | ConvertTo-Json -Depth 8
}
Append-Section "3. /knowledge_base/list_files" $listFiles

# ----------------------------------------------------------------------
# 4. recreate_vector_store -- the bombshell call. Forces backend to redo
# chunking + embedding for all files. Whatever blows up here is THE bug.
# ----------------------------------------------------------------------
$recreate = Try-Invoke {
    $body = @{
        knowledge_base_name = $KbName
        allow_empty_kb = $false
    } | ConvertTo-Json
    Invoke-RestMethod "${SidecarBase}/knowledge_base/recreate_vector_store" `
        -Method POST -Body $body -ContentType "application/json" -TimeoutSec 600 |
        ConvertTo-Json -Depth 6
}
Append-Section "4. /knowledge_base/recreate_vector_store (forces re-chunk + re-embed)" $recreate

# ----------------------------------------------------------------------
# 5. /knowledge_base/search_docs probe
# ----------------------------------------------------------------------
$search = Try-Invoke {
    $body = @{
        query = $TestQuery
        knowledge_base_name = $KbName
        top_k = 5
        score_threshold = 2.0
    } | ConvertTo-Json
    Invoke-RestMethod "${SidecarBase}/knowledge_base/search_docs" `
        -Method POST -Body $body -ContentType "application/json" -TimeoutSec 30 |
        ConvertTo-Json -Depth 6
}
Append-Section "5. /knowledge_base/search_docs probe (query='$TestQuery')" $search

# ----------------------------------------------------------------------
# 6. server.log tail 300 -- the traceback is here
# ----------------------------------------------------------------------
$tail = Try-Invoke {
    if (-not $logPath) { return "(no log path)" }
    (Get-Content $logPath -Tail 300 -Encoding utf8) -join "`n"
}
Append-Section "6. server.log tail 300 lines (traceback lives here)" $tail

# ----------------------------------------------------------------------
# 7. server.log filtered for KB-relevant keywords (last 80 hits)
# ----------------------------------------------------------------------
$filtered = Try-Invoke {
    if (-not $logPath) { return "(no log path)" }
    $hits = Get-Content $logPath -Encoding utf8 -ErrorAction SilentlyContinue |
        Select-String -Pattern "tiktoken|cl100k|vector_store|embedding|embed_documents|upload_docs|recreate_vector|search_docs|kb_doc_api|splitter|image_source|infinity|Traceback|ERROR|Exception"
    if (-not $hits) { return "(no matching lines)" }
    ($hits | Select-Object -Last 80 | ForEach-Object { $_.Line }) -join "`n"
}
Append-Section "7. server.log filtered (tiktoken/vector_store/embed/upload/search/exceptions, last 80)" $filtered

# ----------------------------------------------------------------------
# 8. embedding sidecar reachability
# ----------------------------------------------------------------------
$emb = Try-Invoke {
    (Invoke-RestMethod "http://127.0.0.1:62583/v1/models" -TimeoutSec 5) | ConvertTo-Json -Depth 6
}
Append-Section "8. embedding sidecar /v1/models @ 62583" $emb

# ----------------------------------------------------------------------
# Done
# ----------------------------------------------------------------------
Write-Host ""
Write-Host "OK -- KB vectorize diagnostic written to:" -ForegroundColor Green
Write-Host "  $out"
Write-Host ""
Write-Host "View:" -ForegroundColor Cyan
Write-Host "  notepad '$out'"
Write-Host "  Get-Content '$out' -Encoding utf8"
Write-Host ""
Write-Host "Paste the entire file contents back to the developer." -ForegroundColor Cyan
