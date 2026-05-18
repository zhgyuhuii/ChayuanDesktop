#requires -Version 5.1
<#
.SYNOPSIS
    察元桌面端"装机即用本地模型服务自启"链路诊断。

.DESCRIPTION
    自动发现安装目录 / 数据目录,把以下信息收齐成 markdown,直接复制粘贴
    给 Claude 排查:

      1. 安装包版本(chayuan-server.exe mtime / 大小)
      2. bundled_models 源(install dir) + 目标(data dir)布局
      3. sidecar_settings.json + local_runtime.yaml 内容
      4. /runtime/llama/registry + /runtime/diagnose HTTP 探针
      5. chayuan-server 进程 + 端口 + tail 200 行日志
      6. (可选)直接命令行重启 chayuan-server,抓 [bootstrap-preload] /
         [auto-start] 完整 stdout 链路(最关键的一步)

.PARAMETER InstallDir
    显式指定 chayuan-desktop 安装目录(含 chayuan-server.exe)。
    省略时按常见路径自动探测。

.PARAMETER DataDir
    显式指定 CHAYUAN_ROOT 数据目录。省略时读 desktop.json,再退默认。

.PARAMETER Port
    chayuan-server API 端口,默认 62581。

.PARAMETER CaptureStdout
    Switch:跑这步会先 kill 现有 chayuan-server.exe,然后命令行重启它,
    抓 30 秒 stdout 看 [bootstrap-preload] / [auto-start] 链路 ——
    会临时打断 app 内的服务。默认 off。

.PARAMETER OutFile
    把诊断结果同时写到这个文件。默认只打到终端。

.EXAMPLE
    .\diagnose-auto-start.ps1

.EXAMPLE
    .\diagnose-auto-start.ps1 -CaptureStdout -OutFile diag.md
#>
[CmdletBinding()]
param(
    [string]$InstallDir = '',
    [string]$DataDir    = '',
    [int]$Port          = 62581,
    [switch]$CaptureStdout,
    [string]$OutFile    = ''
)

$ErrorActionPreference = 'Continue'

# 输出走 StringBuilder,最后一次性打出来 + (可选)落盘
$sb = [System.Text.StringBuilder]::new()
function Out-Section { param([string]$Title) [void]$sb.AppendLine(""); [void]$sb.AppendLine("## $Title"); [void]$sb.AppendLine("") }
function Out-Code { param([string]$Lang = '', [string]$Text)
    [void]$sb.AppendLine("``````$Lang")
    [void]$sb.AppendLine($Text)
    [void]$sb.AppendLine("``````")
}
function Out-Line { param([string]$Text) [void]$sb.AppendLine($Text) }
function Out-KV   { param([string]$K, $V) [void]$sb.AppendLine("- **$K**: $V") }

# 截断超长输出,避免粘贴给 Claude 时炸窗口
function Limit-Text {
    param([string]$Text, [int]$MaxLines = 200)
    if (-not $Text) { return '(空)' }
    $lines = $Text -split "`r?`n"
    if ($lines.Count -le $MaxLines) { return $Text }
    $head = $lines[0..[int]([math]::Min(50, $lines.Count - 1))]
    $tail = $lines[($lines.Count - $MaxLines + $head.Count)..($lines.Count - 1)]
    return (($head -join "`n") + "`n... (中间 $($lines.Count - $MaxLines) 行省略) ...`n" + ($tail -join "`n"))
}

# ───────── 0. 头部 + 环境 ─────────
$now = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
Out-Line "# 察元自启诊断报告"
Out-Line ""
Out-KV '生成时间' $now
Out-KV 'Host'      $env:COMPUTERNAME
Out-KV 'User'      $env:USERNAME
Out-KV 'OS'        ([System.Environment]::OSVersion.VersionString)
Out-KV 'PSVersion' $PSVersionTable.PSVersion.ToString()

# ───────── 1. 探测 InstallDir ─────────
Out-Section '1. 探测安装目录'

if ($InstallDir -and (Test-Path "$InstallDir\chayuan-server.exe")) {
    Out-Line ('用户显式指定:`{0}`' -f $InstallDir)
} else {
    # Tauri 2 WiX MSI / NSIS 装机后,Windows 安装目录的命名变体太多 ——
    # tauri.conf.json productName / publisher / wix.* 改动都影响最终目录名。
    # 这里穷举常见组合 + 用 Get-CimInstance 通过监听 62581 端口的进程反推
    # 真实 exe 路径(最稳的兜底)。
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\chayuan-desktop",
        "$env:LOCALAPPDATA\Programs\Chayuan",
        "$env:LOCALAPPDATA\Programs\Chayuan Desktop",
        "$env:ProgramFiles\chayuan-desktop",
        "$env:ProgramFiles\Chayuan",
        "$env:ProgramFiles\Chayuan Desktop",
        "${env:ProgramFiles(x86)}\chayuan-desktop",
        "${env:ProgramFiles(x86)}\Chayuan",
        "${env:ProgramFiles(x86)}\Chayuan Desktop"
    )
    $InstallDir = $null
    foreach ($c in $candidates) {
        if ($c -and (Test-Path "$c\chayuan-server.exe")) {
            $InstallDir = $c
            break
        }
    }
    # 兜底:从监听 62581 端口的进程拿真实 exe 路径
    if (-not $InstallDir) {
        try {
            $owner = (Get-NetTCPConnection -LocalPort 62581 -State Listen -ErrorAction Stop |
                      Select-Object -First 1).OwningProcess
            if ($owner) {
                $p = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction Stop
                if ($p -and $p.ExecutablePath) {
                    $exeDir = Split-Path -Parent $p.ExecutablePath
                    if (Test-Path "$exeDir\chayuan-server.exe") {
                        $InstallDir = $exeDir
                        Out-Line ('从监听 62581 的进程反推到:`{0}`' -f $InstallDir)
                    }
                }
            }
        } catch {}
    }
    if (-not $InstallDir) {
        Out-Line "**自动探测失败** — 没在以下路径找到 chayuan-server.exe,62581 端口也没探到进程:"
        $candidates | ForEach-Object { Out-Line "  - $_" }
        Out-Line ""
        Out-Line '请重跑:`.\diagnose-auto-start.ps1 -InstallDir ''C:\path\to\chayuan-desktop''`'
    }
}
$installDirDisp = if ($InstallDir) { $InstallDir } else { '(未找到)' }
Out-KV 'InstallDir' $installDirDisp

if ($InstallDir) {
    $exe = Join-Path $InstallDir 'chayuan-server.exe'
    if (Test-Path $exe) {
        $fi = Get-Item $exe
        Out-KV 'chayuan-server.exe size'  ("{0:N0} bytes ({1:N1} MB)" -f $fi.Length, ($fi.Length / 1MB))
        Out-KV 'chayuan-server.exe mtime' ($fi.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))
    }
    $appExe = Get-ChildItem -Path $InstallDir -Filter '*.exe' -ErrorAction SilentlyContinue |
              Where-Object { $_.Name -ne 'chayuan-server.exe' -and $_.Name -notlike 'uninstall*' } |
              Select-Object -First 1
    if ($appExe) { Out-KV '主程序 exe' "$($appExe.Name) ($($appExe.LastWriteTime))" }
}

# ───────── 2. 探测 DataDir(读 desktop.json) ─────────
Out-Section '2. 探测数据目录'

$desktopJson = Join-Path $env:APPDATA 'chayuan\desktop.json'
Out-KV 'desktop.json 路径' $desktopJson

if ($DataDir -and (Test-Path $DataDir)) {
    Out-Line ('用户显式指定 `{0}`' -f $DataDir)
} elseif (Test-Path $desktopJson) {
    try {
        $cfg = Get-Content $desktopJson -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($cfg.data_dir) {
            $DataDir = $cfg.data_dir
            Out-KV 'desktop.json data_dir'         $cfg.data_dir
            Out-KV 'desktop.json version'          $cfg.version
            $linkedId = if ($cfg.linked_install_id) { $cfg.linked_install_id } else { '(空)' }
            Out-KV 'desktop.json linked_install_id' $linkedId
        }
    } catch {
        Out-Line "**读 desktop.json 失败**:$_"
    }
}
if (-not $DataDir) {
    $DataDir = Join-Path $env:APPDATA 'chayuan'
    Out-Line "回退到默认数据目录"
}
Out-KV 'DataDir(实际生效)' $DataDir
$envRoot     = if ($env:CHAYUAN_ROOT)                { $env:CHAYUAN_ROOT }                else { '(未设)' }
$envBundled  = if ($env:CHAYUAN_BUNDLED_MODELS_DIR)   { $env:CHAYUAN_BUNDLED_MODELS_DIR }   else { '(未设)' }
Out-KV 'CHAYUAN_ROOT env'                $envRoot
Out-KV 'CHAYUAN_BUNDLED_MODELS_DIR env'  $envBundled

# ───────── 3. bundled_models 源 / 目标布局 ─────────
Out-Section '3. bundled_models 布局'

function Dump-BundledTree {
    param([string]$Root, [string]$Label)
    if (-not (Test-Path $Root)) {
        Out-Line ('**{0}**:不存在 `{1}`' -f $Label, $Root)
        return
    }
    Out-Line ('**{0}**(`{1}`):' -f $Label, $Root)
    $caps = Get-ChildItem -Path $Root -Directory -ErrorAction SilentlyContinue
    if (-not $caps) {
        Out-Line '  (空目录)'
        return
    }
    $lines = foreach ($cap in $caps) {
        $files = Get-ChildItem -Path $cap.FullName -File -Recurse -ErrorAction SilentlyContinue
        $nonHidden = $files | Where-Object { -not $_.Name.StartsWith('.') }
        $total = ($nonHidden | Measure-Object -Property Length -Sum).Sum
        $totalMB = if ($total) { '{0:N1} MB' -f ($total / 1MB) } else { '0 MB' }
        "  - $($cap.Name)/  files=$($nonHidden.Count)  size=$totalMB"
    }
    Out-Line ($lines -join "`n")
}

if ($InstallDir) { Dump-BundledTree (Join-Path $InstallDir 'bundled_models') '源(install dir)' }
if ($DataDir)    { Dump-BundledTree (Join-Path $DataDir    'models\bundled') '目标(data dir 已 seed)' }

# ───────── 4. 关键配置文件 ─────────
Out-Section '4. 关键配置文件'

$cfgFiles = @(
    @{ Path = (Join-Path $DataDir 'data\sidecar_settings.json'); Title = 'sidecar_settings.json'; Lang = 'json' }
    @{ Path = (Join-Path $DataDir 'model_registry\local_runtime.yaml'); Title = 'local_runtime.yaml'; Lang = 'yaml' }
    @{ Path = (Join-Path $DataDir 'runtime.json'); Title = 'runtime.json'; Lang = 'json' }
    @{ Path = (Join-Path $DataDir 'model_registry\local_models.json'); Title = 'local_models.json (前 80 行)'; Lang = 'json' }
)
foreach ($f in $cfgFiles) {
    Out-Line ""
    Out-Line "### $($f.Title)"
    Out-Line "**path**: $($f.Path)"
    if (-not (Test-Path $f.Path)) {
        Out-Line '**(文件不存在)**'
        continue
    }
    $raw = Get-Content $f.Path -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    # local_models.json 可能很大,只取头
    if ($f.Title -like '*local_models.json*') {
        $raw = ($raw -split "`r?`n")[0..80] -join "`n"
    }
    Out-Code -Lang $f.Lang -Text (Limit-Text $raw 120)
}

# ───────── 5. 进程 / 端口 ─────────
Out-Section '5. 进程 / 端口'

# 1) 按进程名找(installer 装机后的常态);dev 模式跑的是 python.exe,这种命名匹配不到
$nameProcs = Get-Process -ErrorAction SilentlyContinue |
             Where-Object { $_.ProcessName -in @('chayuan-server','chayuan-desktop','llama-server','whisper-server','rapidocr_server','piper') }

# 2) 按命令行找(dev 模式 python.exe 跑 -m chayuan / poetry run chayuan-server)
#    Win32_Process.CommandLine 含 chayuan / chayuan-server / chayuan_runtime 字样的进程
$cmdProcs = @()
try {
    $cmdProcs = Get-CimInstance -ClassName Win32_Process -ErrorAction Stop |
                Where-Object {
                    $_.CommandLine -and
                    $_.CommandLine -match '(chayuan-server|chayuan_runtime|\bchayuan\b|llama-server|whisper-server|rapidocr|piper)' -and
                    $_.CommandLine -notmatch 'diagnose-auto-start'
                }
} catch {
    # PS / WMI 取不到 cmdline 时(用户权限/旧 Win)就忍着,nameProcs 兜底
}

$seen = @{}
$rows = @()
foreach ($p in $nameProcs) {
    if ($seen.ContainsKey([int]$p.Id)) { continue }
    $seen[[int]$p.Id] = $true
    $startTime = try { $p.StartTime.ToString('HH:mm:ss') } catch { '?' }
    $rows += ('  - {0,-22} pid={1,-6} RSS={2,7:N1} MB  started={3}' -f $p.ProcessName, $p.Id, ($p.WorkingSet64 / 1MB), $startTime)
}
foreach ($p in $cmdProcs) {
    if ($seen.ContainsKey([int]$p.ProcessId)) { continue }
    $seen[[int]$p.ProcessId] = $true
    $cmd = $p.CommandLine
    if ($cmd.Length -gt 110) { $cmd = $cmd.Substring(0, 107) + '...' }
    $rows += ('  - {0,-22} pid={1,-6} cmd={2}' -f $p.Name, $p.ProcessId, $cmd)
}

if ($rows.Count -gt 0) {
    Out-Line '相关进程(进程名 + 命令行匹配):'
    Out-Line ($rows -join "`n")
} else {
    Out-Line '**没有任何察元相关进程在跑(进程名 / 命令行都没匹配到)**'
}

Out-Line ""
$listen = & netstat -ano 2>$null | Where-Object { $_ -match ':(62581|62582|62583|62584|62585|62586|18380)\s' -and $_ -match 'LISTENING' }
if ($listen) {
    Out-Line '监听端口(自启相关):'
    Out-Code -Lang '' -Text ($listen -join "`n")
    # 再 resolve 每个端口的进程名(对照 Section 5 的 pid)
    $listenRows = @()
    foreach ($line in $listen) {
        if ($line -match ':(\d+)\s.*LISTENING\s+(\d+)') {
            $port  = $matches[1]
            $owner = [int]$matches[2]
            $proc  = Get-Process -Id $owner -ErrorAction SilentlyContinue
            $pname = if ($proc) { $proc.ProcessName } else { '(进程已退)' }
            $listenRows += ('  - :{0,-5} pid={1,-6} name={2}' -f $port, $owner, $pname)
        }
    }
    if ($listenRows.Count -gt 0) {
        Out-Line ''
        Out-Line '端口 → 进程映射:'
        Out-Line ($listenRows -join "`n")
    }
} else {
    Out-Line '**没有 62581-62586 / 18380 任一端口在 LISTENING** — server 没起或自启失败'
}

# ───────── 6. HTTP 探针 ─────────
Out-Section "6. HTTP 探针 (port=$Port)"

$base = "http://127.0.0.1:$Port"

function Probe-Endpoint {
    param([string]$Path, [string]$Method = 'GET', [hashtable]$Body)
    $url = "$base$Path"
    try {
        if ($Method -eq 'POST') {
            $json = if ($Body) { $Body | ConvertTo-Json -Compress } else { '{}' }
            $r = Invoke-WebRequest -Uri $url -Method POST -Body $json -ContentType 'application/json' -TimeoutSec 8 -ErrorAction Stop
        } else {
            $r = Invoke-WebRequest -Uri $url -Method GET -TimeoutSec 8 -ErrorAction Stop
        }
        return @{ ok = $true; status = $r.StatusCode; body = $r.Content }
    } catch {
        return @{ ok = $false; error = $_.Exception.Message }
    }
}

$endpoints = @(
    @{ P = '/runtime/llama/registry'; T = '5 capability registry 状态' }
    @{ P = '/runtime/diagnose';       T = 'runtime/diagnose 综合健康' }
    @{ P = "/runtime/llama/chat/status";            T = 'chat status' }
    @{ P = "/runtime/llama/embedding/status";       T = 'embedding status' }
    @{ P = "/runtime/llama/rerank/status";          T = 'rerank status' }
    @{ P = "/runtime/llama/asr/status";             T = 'asr status' }
    @{ P = "/runtime/llama/image-embedding/status"; T = 'image-embedding status' }
    @{ P = '/modality/sidecar/ocr/status'; T = 'RapidOCR sidecar status' }
)
foreach ($e in $endpoints) {
    Out-Line ""
    Out-Line "### GET $($e.P) — $($e.T)"
    $r = Probe-Endpoint -Path $e.P
    if ($r.ok) {
        Out-Code -Lang 'json' -Text (Limit-Text $r.body 60)
    } else {
        Out-Line "**失败**:$($r.error)"
    }
}

# ───────── 7. 日志 tail ─────────
Out-Section '7. chayuan-server 日志 tail'

# chayuan-server 实际把日志写到 <CHAYUAN_ROOT>/data/logs/(因为 LOG_PATH = DATA_PATH/logs
# 而 DATA_PATH = CHAYUAN_ROOT/data,不是 CHAYUAN_ROOT/logs 直接)。
#
# 关键陷阱:chayuan/startup.py 在启动 uvicorn 前 dictConfig 把日志 redirect 到
#   <logs>/run_api_server_<ts>/...
# 子目录,所以所有 FastAPI startup hook 的日志(包括 [bootstrap-preload] /
# [auto-start-rapidocr] / [auto-start])都在子目录里。顶层 chayuan.log 只有
# uvicorn 之前的 bootstrap 输出。两层都扫,优先取子目录最新一份。
$logDirCandidates = @(
    (Join-Path $DataDir 'data\logs'),
    (Join-Path $DataDir 'logs')
)
$logDir = $null
foreach ($c in $logDirCandidates) {
    if (Test-Path $c) { $logDir = $c; break }
}
if ($logDir) {
    Out-KV '日志目录' $logDir
    # 优先找 run_api_server_* 子目录里最新的 .log(FastAPI 启动后的日志)
    $apiSub = Get-ChildItem -Path $logDir -Directory -Filter 'run_api_server_*' -ErrorAction SilentlyContinue |
              Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $allLogs = @()
    if ($apiSub) {
        $allLogs += Get-ChildItem -Path $apiSub.FullName -Filter '*.log' -File -Recurse -ErrorAction SilentlyContinue
        Out-KV '最新 run_api_server 子目录' $apiSub.FullName
    }
    # 再扫顶层 .log(uvicorn 之前的 bootstrap 输出)
    $allLogs += Get-ChildItem -Path $logDir -Filter '*.log' -File -ErrorAction SilentlyContinue
    $latest = $allLogs | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latest) {
        Out-KV '最新日志' ('{0} (mtime={1})' -f $latest.FullName, $latest.LastWriteTime)
        $tail = Get-Content $latest.FullName -Tail 200 -ErrorAction SilentlyContinue
        if ($tail) {
            # 简单脱敏:Bearer / api_key / secret 后跟 16+ 字符全部 *** 掉
            $masked = ($tail -join "`n") -replace '(?i)(bearer|api[_-]?key|secret|token)["= :]+[A-Za-z0-9._\-]{12,}', '$1=***MASKED***'
            Out-Code -Lang '' -Text (Limit-Text $masked 200)
        }
    } else {
        Out-Line '日志目录为空'
    }
    # 同时把 [auto-start] / [bootstrap-preload] 关键字 grep 出来一并展示
    Out-Line ''
    Out-Line '### grep 关键字:[bootstrap-preload] / [auto-start] / [auto-start-rapidocr]'
    $matches2 = @()
    foreach ($lf in $allLogs) {
        try {
            $matches2 += Select-String -Path $lf.FullName -Pattern '\[bootstrap-preload\]|\[auto-start\]|\[auto-start-rapidocr\]' -ErrorAction SilentlyContinue |
                         Select-Object -Last 50 |
                         ForEach-Object { '{0}:{1}: {2}' -f (Split-Path -Leaf $_.Path), $_.LineNumber, $_.Line }
        } catch {}
    }
    if ($matches2.Count -gt 0) {
        Out-Code -Lang '' -Text (Limit-Text ($matches2 -join "`n") 80)
    } else {
        Out-Line '**没有任何 [bootstrap-preload] / [auto-start] 行** — 说明这两个 startup hook 根本没 emit log,跟 _audit_prompt_templates 一对比应该是异常。'
    }
} else {
    Out-Line '**日志目录都不存在**,扫了以下路径:'
    $logDirCandidates | ForEach-Object { Out-Line ('  - `{0}`' -f $_) }
}

# ───────── 8. 可选:抓 sidecar 完整 stdout ─────────
if ($CaptureStdout) {
    Out-Section '8. sidecar 完整 stdout 抓取(30 秒)'

    if (-not $InstallDir) {
        Out-Line '**InstallDir 未知,跳过 stdout 抓取**'
    } else {
        Out-Line "Kill 现有 chayuan-server.exe..."
        try { Get-Process chayuan-server -ErrorAction SilentlyContinue | Stop-Process -Force } catch {}
        Start-Sleep -Seconds 2

        $serverExe = Join-Path $InstallDir 'chayuan-server.exe'
        $tmpStdout = New-TemporaryFile
        $tmpStderr = New-TemporaryFile
        $sidecarBundled = Join-Path $InstallDir 'bundled_models'

        Out-Line ('spawn: `{0}` --host 127.0.0.1 --port {1}' -f $serverExe, $Port)
        Out-Line "CHAYUAN_ROOT=$DataDir"
        Out-Line "CHAYUAN_BUNDLED_MODELS_DIR=$sidecarBundled"
        Out-Line ""

        $env:CHAYUAN_ROOT = $DataDir
        $env:CHAYUAN_BUNDLED_MODELS_DIR = $sidecarBundled
        $p = Start-Process -FilePath $serverExe `
            -ArgumentList @('--host','127.0.0.1','--port',$Port) `
            -RedirectStandardOutput $tmpStdout.FullName `
            -RedirectStandardError  $tmpStderr.FullName `
            -PassThru -NoNewWindow

        Start-Sleep -Seconds 30

        try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
        # 给子进程留点时间退,把 buffer flush 完
        Start-Sleep -Seconds 1

        $outText = if (Test-Path $tmpStdout) { Get-Content $tmpStdout.FullName -Raw } else { '' }
        $errText = if (Test-Path $tmpStderr) { Get-Content $tmpStderr.FullName -Raw } else { '' }

        Out-Line '### stdout (前 30 秒)'
        Out-Code -Lang '' -Text (Limit-Text $outText 250)
        Out-Line ''
        Out-Line '### stderr (前 30 秒)'
        Out-Code -Lang '' -Text (Limit-Text $errText 200)

        @($tmpStdout, $tmpStderr) | Where-Object { $_ } | Remove-Item -ErrorAction SilentlyContinue

        Out-Line ''
        Out-Line '**注意**:这步杀掉了 app 当前用的 chayuan-server 实例。重新打开 app 让它自动重启,或手动 `Start-Process $serverExe`。'
    }
} else {
    Out-Section '8. sidecar stdout 抓取(已跳过)'
    Out-Line '若 Step 6 的 status 都是 stopped/failed,建议重跑加 `-CaptureStdout` 看完整链路:'
    Out-Code -Lang 'powershell' -Text ".\diagnose-auto-start.ps1 -CaptureStdout"
}

# ───────── 落盘 + 输出 ─────────
$final = $sb.ToString()
Write-Host $final
if ($OutFile) {
    [System.IO.File]::WriteAllText($OutFile, $final, [System.Text.UTF8Encoding]::new($false))
    Write-Host ""
    Write-Host "[ok] 报告已写到:$OutFile"
}
