<#
.SYNOPSIS
    一次性收齐 Chayuan 本地 runtime 所有诊断信息,落一个 .md 直接贴给开发。

.DESCRIPTION
    包含 9 段:
      1. 标准 diagnose(/runtime/diagnose 后端聚合检查)
      2. 进程列表(chayuan / llama-server / whisper-server / rapidocr 等)
      3. OCR sidecar 状态(/v1/modality/sidecar/ocr/status)
      4. OCR health(/runtime/ocr/health,footer 灯用)
      5. KB 创建烟雾测(faiss + bge-m3,临时名,失败时打真错)
      6. server.log 尾 100 行(扫 %APPDATA%\chayuan 和 D:\chayuan-data)
      7. <chayuan_root>/models/bundled 目录树(看模型真有没有在位)
      8. rapidocr sidecar 自己日志尾 50 行(%TEMP%/chayuan_rapidocr.log)
      9. 安装 exe 大小 + mtime(对版本)

    UTF-8 + BOM 写入,Windows Notepad / PS 5.1 / PS 7 / VSCode / 命令行 cat 都能正确显示中文。

.EXAMPLE
    bash scripts\diagnose-all.ps1          # 默认 sidecar = http://127.0.0.1:62581
    bash scripts\diagnose-all.ps1 -SidecarBase http://127.0.0.1:7861
#>
param(
    [string]$SidecarBase = "http://127.0.0.1:62581"
)

# UTF-8 强制:console + 文件两头都要,不然中文乱码(用户已经踩过)
chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()

$ts  = Get-Date -Format "yyyyMMdd-HHmmss"
$out = Join-Path $env:TEMP "chayuan-diag-all-$ts.md"

# UTF-8 BOM 写,避免 PS5.1 Get-Content 默认 GBK 解码乱码
$utf8Bom = [System.Text.UTF8Encoding]::new($true)
[System.IO.File]::WriteAllText($out, "# Chayuan 一键诊断 $ts`n`n", $utf8Bom)

function Append-Section {
    param([string]$Title, [string]$Body)
    $block = "`n## $Title`n``````n$Body`n```````n"
    [System.IO.File]::AppendAllText($out, $block, $utf8Bom)
}

function Try-Invoke {
    param([scriptblock]$Block)
    try { & $Block | Out-String } catch { "FAIL: $($_.Exception.Message)`n$($_.ErrorDetails.Message)" }
}

# ----------------------------------------------------------------------
# 1. 标准 diagnose
# ----------------------------------------------------------------------
$diagOut = Try-Invoke {
    $script = Join-Path $PSScriptRoot "diagnose.ps1"
    if (Test-Path $script) {
        # 用同进程内 dot-source 跑,避免子进程编码再丢一遍
        $captured = & powershell -NoProfile -ExecutionPolicy Bypass -File $script -SidecarBase $SidecarBase 2>&1
        $captured | Out-String
    } else {
        "scripts\diagnose.ps1 不存在,跳过"
    }
}
Append-Section "1. 标准 diagnose" $diagOut

# ----------------------------------------------------------------------
# 2. 进程列表
# ----------------------------------------------------------------------
$proc = Try-Invoke {
    Get-CimInstance Win32_Process |
        Where-Object { $_.Name -like '*chayuan*' -or $_.CommandLine -match '(chayuan|llama-server|whisper-server|rapidocr|paddleocr|funasr|voxcpm)' } |
        Select-Object ProcessId, ParentProcessId, Name, @{N='Cmd';E={$_.CommandLine}} |
        Format-Table -AutoSize -Wrap
}
Append-Section "2. 进程列表" $proc

# ----------------------------------------------------------------------
# 3. OCR sidecar 状态
# ----------------------------------------------------------------------
$ocrStatus = Try-Invoke {
    (Invoke-RestMethod "$SidecarBase/v1/modality/sidecar/ocr/status" -TimeoutSec 5) | ConvertTo-Json -Depth 10
}
Append-Section "3. OCR sidecar 状态 /v1/modality/sidecar/ocr/status" $ocrStatus

# ----------------------------------------------------------------------
# 4. OCR health(footer 灯逻辑用的真源)
# ----------------------------------------------------------------------
$ocrHealth = Try-Invoke {
    (Invoke-RestMethod "$SidecarBase/runtime/ocr/health" -TimeoutSec 5) | ConvertTo-Json -Depth 10
}
Append-Section "4. OCR health /runtime/ocr/health" $ocrHealth

# ----------------------------------------------------------------------
# 5. KB 创建烟雾测
# ----------------------------------------------------------------------
$smoke = Try-Invoke {
    $body = @{
        knowledge_base_name = "_diag_smoke_$ts"
        vector_store_type   = "faiss"
        embed_model         = "bge-m3"
    } | ConvertTo-Json
    Invoke-RestMethod "$SidecarBase/knowledge_base/create_knowledge_base" `
        -Method POST -Body $body -ContentType "application/json" -TimeoutSec 30 |
        ConvertTo-Json -Depth 6
}
Append-Section "5. KB 创建烟雾测(临时 KB,失败也能看真错)" $smoke

# ----------------------------------------------------------------------
# 6. server.log 尾 100 行
# ----------------------------------------------------------------------
$logs = Try-Invoke {
    $candidates = @(
        "$env:APPDATA\chayuan\logs\server.log",
        "D:\chayuan-data\logs\server.log",
        "$env:APPDATA\chayuan\logs\chayuan.log",
        "D:\chayuan-data\logs\chayuan.log",
        "C:\chayuan-data\logs\server.log"
    ) | Where-Object { Test-Path $_ }
    if (-not $candidates) { return "(找不到 server log)" }
    $sb = [System.Text.StringBuilder]::new()
    foreach ($p in $candidates) {
        $sb.AppendLine("--- $p ---") | Out-Null
        Get-Content $p -Tail 100 -Encoding utf8 | ForEach-Object {
            $sb.AppendLine($_) | Out-Null
        }
    }
    $sb.ToString()
}
Append-Section "6. server.log 尾 100 行" $logs

# ----------------------------------------------------------------------
# 7. bundled_models 目录树
# ----------------------------------------------------------------------
$bundled = Try-Invoke {
    $candidates = @(
        "$env:APPDATA\chayuan\models\bundled",
        "D:\chayuan-data\models\bundled",
        "C:\chayuan-data\models\bundled"
    ) | Where-Object { Test-Path $_ }
    if (-not $candidates) { return "(找不到 bundled 目录)" }
    $sb = [System.Text.StringBuilder]::new()
    foreach ($p in $candidates) {
        $sb.AppendLine("--- $p ---") | Out-Null
        $files = Get-ChildItem $p -Recurse -File |
            Select-Object @{N='Rel';E={$_.FullName.Substring($p.Length + 1)}}, @{N='MB';E={[math]::Round($_.Length/1MB, 1)}}
        ($files | Format-Table -AutoSize | Out-String).Split([Environment]::NewLine) | ForEach-Object {
            $sb.AppendLine($_) | Out-Null
        }
    }
    $sb.ToString()
}
Append-Section "7. bundled_models 目录(<chayuan_root>/models/bundled)" $bundled

# ----------------------------------------------------------------------
# 8. rapidocr sidecar 日志尾
# ----------------------------------------------------------------------
$ocrLog = Try-Invoke {
    $p = "$env:TEMP\chayuan_rapidocr.log"
    if (Test-Path $p) { Get-Content $p -Tail 50 -Encoding utf8 | Out-String }
    else { "(没这文件,sidecar 从来没起过)" }
}
Append-Section "8. rapidocr sidecar 日志尾 50 行" $ocrLog

# ----------------------------------------------------------------------
# 9. 安装 exe 信息
# ----------------------------------------------------------------------
$exeInfo = Try-Invoke {
    $exes = @(
        "C:\Program Files\Chayuan\chayuan-server\chayuan-server.exe",
        "$env:LOCALAPPDATA\Programs\Chayuan\chayuan-server\chayuan-server.exe"
    ) | Where-Object { Test-Path $_ }
    if (-not $exes) { return "(找不到 chayuan-server.exe)" }
    $sb = [System.Text.StringBuilder]::new()
    foreach ($e in $exes) {
        $info = Get-Item $e
        $sb.AppendLine("$e") | Out-Null
        $sb.AppendLine("  SizeMB:   $([math]::Round($info.Length / 1MB, 1))") | Out-Null
        $sb.AppendLine("  Modified: $($info.LastWriteTime)") | Out-Null
    }
    $sb.ToString()
}
Append-Section "9. 安装位置 + Build 信息" $exeInfo

# ----------------------------------------------------------------------
# 完成
# ----------------------------------------------------------------------
Write-Host ""
Write-Host "✓ 诊断写到 $out (UTF-8 with BOM)" -ForegroundColor Green
Write-Host ""
Write-Host "查看(任选其一):" -ForegroundColor Cyan
Write-Host "  Get-Content '$out' -Encoding utf8       # 强制 UTF-8 读"
Write-Host "  notepad '$out'                          # Notepad 自动识 BOM"
Write-Host "  code '$out'                             # VSCode"
Write-Host ""
Write-Host "整个文件粘贴给开发即可。" -ForegroundColor Cyan
