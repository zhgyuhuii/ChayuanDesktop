<#
.SYNOPSIS
  察元 AI 单机版桌面安装包一键构建脚本(Windows / PowerShell)。

.DESCRIPTION
  按顺序执行:
    Step 1  服务端 PyInstaller            (chayuan-server -> onedir + 拷到 desktop/binaries)
    Step 2  Sidecar 二进制健康检查         (启 .exe + GET /healthz)
    Step 3  客户端 Tauri bundle           (chayuan-client -> .msi / .exe)

  自动跳过已完成的步骤;失败时给出明确诊断 + 回退建议。

.PARAMETER WorkspaceRoot
  工作区根目录(包含 chayuan-server / chayuan-client 两个子项目)。
  缺省值:本脚本所在目录。

.PARAMETER SkipServer
  跳过 Step 1。仅当 sidecar 二进制已存在且最新时使用。

.PARAMETER SkipHealthcheck
  跳过 Step 2 的 /healthz 探测。CI 上跑无头测试用。

.PARAMETER SkipFrontend
  跳过 Step 3。只想出 sidecar 不打 Tauri 包时用。

.PARAMETER SkipInstall
  跳过 Step 3 内的 ``pnpm install --frozen-lockfile``。lockfile 没动 +
  node_modules 已经齐时,能省 30s-数分钟(取决于网速 / 缓存命中)。

.PARAMETER SkipTypecheck
  跳过 Step 3 内的 ``pnpm typecheck``(几十秒到 1 分钟,取决于改动量)。
  仅在调试 build 流程 / installer.nsh / 后端时用,业务代码改动**不要**跳。

.PARAMETER BundleOnly
  最快重打:只跑 Tauri bundle 这一步(cargo + vite 走增量缓存,
  makensis 重做)。等价于
  ``-SkipServer -SkipHealthcheck -SkipInstall -SkipTypecheck`` +
  直接到 apps/desktop 跑 ``pnpm exec tauri build``。
  适合「sidecar 已经存在 + 改了 installer.nsh / 上次 makensis 报错」
  的场景,通常 1-3 分钟出包。

.PARAMETER Clean
  动手前先删 chayuan-server\dist 与 apps\desktop\src-tauri\target\release\bundle。

.PARAMETER NoColor
  禁用 ANSI 颜色码。老 Windows 10 / cmd.exe 转发场景显示乱码时用。

.PARAMETER VerboseSubprocess
  把 PyInstaller / pnpm / cargo 的完整 stdout 流到当前控制台。
  默认仅最后 50 行,失败时全量输出。

.EXAMPLE
  .\build-desktop.ps1
  # 第一次完整构建:5-20 分钟。

.EXAMPLE
  .\build-desktop.ps1 -SkipServer
  # 改了前端 React 代码,sidecar 不变,只重打 Tauri 包(约 2 分钟)。

.EXAMPLE
  .\build-desktop.ps1 -BundleOnly
  # exe 已经编译过,只是上次 makensis 出问题。直接重跑 Tauri bundle。

.EXAMPLE
  .\build-desktop.ps1 -SkipServer -SkipHealthcheck -SkipInstall
  # sidecar 已最新 + node_modules 已齐,只想重新跑 typecheck + vite + tauri。

.EXAMPLE
  .\build-desktop.ps1 -Clean -VerboseSubprocess
  # 干净重建 + 完整日志,常用于排查打包问题。
#>

[CmdletBinding()]
param(
    [string]$WorkspaceRoot,
    [switch]$SkipServer,
    [switch]$SkipHealthcheck,
    [switch]$SkipFrontend,
    [switch]$SkipInstall,
    [switch]$SkipTypecheck,
    [switch]$BundleOnly,
    [switch]$Clean,
    [switch]$NoColor,
    [switch]$VerboseSubprocess,
    [switch]$LiteOnly,
    [switch]$IntegratedOnly,
    [switch]$SkipModelCheck
)

# 互斥检查
if ($LiteOnly -and $IntegratedOnly) {
    Write-Host "[FAIL] -LiteOnly 与 -IntegratedOnly 互斥(不带 = 都打)" -ForegroundColor Red
    exit 2
}

# 决定本次要打哪些 flavor
$Flavors = @()
if ($LiteOnly) { $Flavors = @('lite') }
elseif ($IntegratedOnly) { $Flavors = @('integrated') }
else { $Flavors = @('lite', 'integrated') }

# ``-BundleOnly`` 是个组合开关:展开后等价于把 sidecar / health / install /
# typecheck 全跳过,只重做 Tauri bundle 那步(cargo + vite 走增量缓存)。
# 在所有日常逻辑判断之前就把它展开,后面就没有 BundleOnly 这个名词的味道。
if ($BundleOnly) {
    $SkipServer = $true
    $SkipHealthcheck = $true
    $SkipInstall = $true
    $SkipTypecheck = $true
}

# ====================================================================
# WorkspaceRoot 兜底:PS 5.1 + .cmd 转发 -File 时,$PSScriptRoot 偶发为空,
# 把空串带进 Resolve-Path 会抛 "Cannot bind argument to parameter 'Path'"。
# 优先级:用户显式传 > $PSScriptRoot > $MyInvocation.MyCommand.Path > 当前目录。
# ====================================================================
if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        $WorkspaceRoot = $PSScriptRoot
    } elseif ($MyInvocation.MyCommand.Path) {
        $WorkspaceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    } else {
        $WorkspaceRoot = (Get-Location).Path
    }
}

# ====================================================================
# 编码 / 控制台:Windows PowerShell 5.1 默认 ANSI(GBK),中文输出乱码。
# 强制 UTF-8 + 切 chcp 65001;还原原值放 finally。
# ====================================================================
$origOutEnc  = [Console]::OutputEncoding
$origOEMcp   = $null
try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    if ($IsWindows -or $env:OS -eq 'Windows_NT') {
        # chcp 65001 把控制台代码页切到 UTF-8;输出原值留待还原。
        $cur = (chcp) 2>$null
        if ($cur -match '(\d+)') { $origOEMcp = $matches[1] }
        chcp 65001 > $null 2>&1
    }
} catch {
    # 切不动也无所谓,继续
}

# ====================================================================
# 颜色输出:PS 5.1 + 老 Win10 不支持 ANSI 时用 -NoColor 或自动降级
# ====================================================================
$ESC = [char]27
$useColor = -not $NoColor
# 简单探测:如果 PS 版本太老或 stdout 不是 tty,关掉颜色避免乱码
if ($PSVersionTable.PSVersion.Major -lt 5) { $useColor = $false }

function Write-Step { param([string]$t)
    if ($useColor) { Write-Host "`n$ESC[36m▸ $t$ESC[0m" }
    else { Write-Host "`n>> $t" }
}
function Write-Ok { param([string]$t)
    if ($useColor) { Write-Host "$ESC[32m  [OK] $t$ESC[0m" }
    else { Write-Host "  [OK] $t" }
}
function Write-Skip { param([string]$t)
    if ($useColor) { Write-Host "$ESC[33m  [SKIP] $t$ESC[0m" }
    else { Write-Host "  [SKIP] $t" }
}
function Write-Fail { param([string]$t)
    if ($useColor) { Write-Host "$ESC[31m  [FAIL] $t$ESC[0m" }
    else { Write-Host "  [FAIL] $t" }
}
function Write-Note { param([string]$t)
    if ($useColor) { Write-Host "$ESC[90m    $t$ESC[0m" }
    else { Write-Host "    $t" }
}

$ErrorActionPreference = 'Stop'

# ====================================================================
# 杀进程树:Stop-Process 只杀指定 PID,PyInstaller onefile 启动后会派生
# Python 子进程,那些子进程会锁住 sidecar exe 文件,导致 Step 1 拷文件
# 时报 [WinError 32] PermissionError。taskkill /F /T 才会递归杀整棵树。
# ====================================================================
function Stop-ProcessTree {
    param([int]$ProcessId)
    if ($ProcessId -le 0) { return }
    try {
        # /F 强杀 /T 杀整个进程树(子孙全干掉)
        & taskkill.exe /F /T /PID $ProcessId 2>&1 | Out-Null
    } catch {}
}

function Stop-LingeringSidecars {
    # 杀任何残留的 chayuan-server* 进程(上次 Step 2 没收尾干净时常见)。
    $killed = 0
    Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessName -like 'chayuan-server*' } |
        ForEach-Object {
            Stop-ProcessTree -ProcessId $_.Id
            $killed++
        }
    if ($killed -gt 0) {
        Write-Note "清理残留 sidecar 进程:$killed 个"
        Start-Sleep -Milliseconds 500   # 等 OS 释放文件句柄
    }
}

# ====================================================================
# 还原编码(脚本结束时跑;trap 也跑)
# ====================================================================
function Restore-Console {
    try {
        [Console]::OutputEncoding = $origOutEnc
        if ($origOEMcp) { chcp $origOEMcp > $null 2>&1 }
    } catch {}
}
trap { Restore-Console; break }

# ====================================================================
# 0. 路径解析 + 工具链检查
# ====================================================================

try {
    $WorkspaceRoot = (Resolve-Path -LiteralPath $WorkspaceRoot -ErrorAction Stop).Path
} catch {
    Write-Host "[FAIL] 无法解析工作区路径: '$WorkspaceRoot'" -ForegroundColor Red
    Write-Host "       PSScriptRoot     = '$PSScriptRoot'"
    Write-Host "       MyCommand.Path   = '$($MyInvocation.MyCommand.Path)'"
    Write-Host "       Get-Location     = '$((Get-Location).Path)'"
    Write-Host "       手动指定: .\build-desktop.ps1 -WorkspaceRoot 'D:\path\to\chayuan-desktop'"
    exit 1
}
$ServerDir     = Join-Path $WorkspaceRoot 'chayuan-server'
# 真正的 Python 包(含全部第三方依赖)在 libs\chayuan-server\;
# 根目录 chayuan-server\pyproject.toml 是 monorepo 元数据(package-mode=false,无依赖),
# 在那里跑 ``poetry install`` 等于啥都没装,PyInstaller Analysis 会找不到 click / langchain。
$ServerPkgDir  = Join-Path $ServerDir 'libs\chayuan-server'
$ClientDir     = Join-Path $WorkspaceRoot 'chayuan-client'
$BinariesDir   = Join-Path $ClientDir 'apps\desktop\src-tauri\binaries'
# build.py 在 subprocess 里强制 cwd=chayuan-server/,产物固定落 chayuan-server\dist\。
$DistDir       = Join-Path $ServerDir 'dist'
$TauriBundle   = Join-Path $ClientDir 'apps\desktop\src-tauri\target\release\bundle'

$pathLen = $WorkspaceRoot.Length
if ($pathLen -gt 60) {
    if ($useColor) { Write-Host "$ESC[33m[!] 工作区路径已 $pathLen 字符。Windows MAX_PATH=260,PyInstaller 输出会再嵌套数十层。$ESC[0m" }
    else { Write-Host "[!] 工作区路径已 $pathLen 字符。Windows MAX_PATH=260,PyInstaller 输出会再嵌套数十层。" }
    Write-Host "    建议把工作区挪到 D:\chayuan 这种短路径下。继续 (y/N)? " -NoNewline
    $resp = Read-Host
    if ($resp -ne 'y' -and $resp -ne 'Y') { Restore-Console; exit 1 }
}

Write-Step '工作区'
Write-Note "WorkspaceRoot = $WorkspaceRoot"
Write-Note "ServerDir     = $ServerDir"
Write-Note "ClientDir     = $ClientDir"

if (-not (Test-Path $ServerDir)) {
    Write-Fail "找不到 chayuan-server 目录:$ServerDir"
    Restore-Console; exit 1
}
if (-not (Test-Path $ClientDir)) {
    Write-Fail "找不到 chayuan-client 目录:$ClientDir"
    Restore-Console; exit 1
}

function Test-Tool {
    param([string]$Cmd, [string]$VersionFlag = '--version', [string]$Hint)
    $exe = Get-Command $Cmd -ErrorAction SilentlyContinue
    if (-not $exe) {
        Write-Fail "未找到 $Cmd"
        if ($Hint) { Write-Note $Hint }
        return $false
    }
    try {
        $v = & $Cmd $VersionFlag 2>&1 | Select-Object -First 1
        Write-Ok "${Cmd}: $v"
        return $true
    } catch {
        Write-Fail "调用 $Cmd 失败: $_"
        return $false
    }
}

Write-Step '工具链检查'
$ok = $true
if (-not $SkipServer) {
    $ok = (Test-Tool 'python' '--version' 'https://www.python.org/downloads/  选 3.12.x') -and $ok
    $ok = (Test-Tool 'poetry' '--version' 'pip install "poetry>=1.8"') -and $ok
}
if (-not $SkipFrontend) {
    $ok = (Test-Tool 'node'  '--version' '需要 22.x: nvm install 22') -and $ok
    $ok = (Test-Tool 'pnpm'  '--version' 'corepack enable; corepack prepare pnpm@9 --activate') -and $ok
    $ok = (Test-Tool 'rustc' '--version' 'https://rustup.rs/') -and $ok
    $ok = (Test-Tool 'cargo' '--version' 'rustup install stable') -and $ok

    # MSVC 工具集是 Rust 在 Windows 上的隐藏前置条件 ── rustc / cargo
    # 自己不带链接器,要靠 Visual Studio Build Tools 提供。漏装时
    # cargo 编译到一半才报 "linker `link.exe` not found",浪费 5-15 分钟。
    #
    # 注意:Build Tools 装完**不会把 link.exe 加进 PATH** —— Rust 自己
    # 通过 vswhere.exe 查注册表找 MSVC,不靠 PATH。所以直接 Get-Command
    # link.exe 永远找不到,会误报。正确做法是用 vswhere 查 VC 组件,
    # 找不到 vswhere 时再退到搜常见安装目录的 link.exe。
    if ($IsWindows -or $env:OS -eq 'Windows_NT') {
        $msvcOk = $false
        $msvcSrc = $null
        $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
        if (Test-Path $vswhere) {
            try {
                $vsPath = & $vswhere -latest -products '*' `
                    -requires 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64' `
                    -property installationPath 2>$null | Select-Object -First 1
                if ($vsPath) {
                    $msvcOk = $true
                    $msvcSrc = "vswhere -> $vsPath"
                }
            } catch {}
        }
        # vswhere 不可用 / 未命中:扫常见 link.exe 安装路径作为兜底
        if (-not $msvcOk) {
            $candidates = @(
                "${env:ProgramFiles}\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC",
                "${env:ProgramFiles}\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC",
                "${env:ProgramFiles}\Microsoft Visual Studio\2022\Professional\VC\Tools\MSVC",
                "${env:ProgramFiles}\Microsoft Visual Studio\2022\Enterprise\VC\Tools\MSVC",
                "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC"
            )
            foreach ($c in $candidates) {
                if (Test-Path $c) {
                    $hit = Get-ChildItem -Path $c -Filter 'link.exe' -Recurse -ErrorAction SilentlyContinue |
                           Select-Object -First 1
                    if ($hit) {
                        $msvcOk = $true
                        $msvcSrc = "扫描 -> $($hit.FullName)"
                        break
                    }
                }
            }
        }
        # 最后兜底:PATH 里有 link.exe(开发命令提示符 / 手动配置 PATH)
        if (-not $msvcOk) {
            $link = Get-Command 'link.exe' -ErrorAction SilentlyContinue
            if ($link) {
                $msvcOk = $true
                $msvcSrc = "PATH -> $($link.Source)"
            }
        }
        if ($msvcOk) {
            Write-Ok "MSVC 工具集就绪 ($msvcSrc)"
        } else {
            Write-Fail '未检测到 MSVC 工具集 (Visual Studio Build Tools 的 VC.Tools.x86.x64 组件)'
            Write-Note 'Tauri 在 Windows 上需要 Visual Studio Build Tools 2022 提供 link.exe。'
            Write-Note '一键装机:'
            Write-Note '  winget install --id Microsoft.VisualStudio.2022.BuildTools \'
            Write-Note '    --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"'
            Write-Note '若已装但仍报错:Visual Studio Installer -> 修改 -> 勾"使用 C++ 的桌面开发"工作负载。'
            Write-Note '装完后无需重启;Rust 自己通过 vswhere 查注册表,不需要 PATH。'
            $ok = $false
        }

        # WebView2 Runtime:Tauri build 时查注册表确认编译机有 WebView2
        # 漏装时 ``tauri build`` 报 "RegQueryValueExW failed",同样耗时浪费。
        $wv2Paths = @(
            'HKLM:\SOFTWARE\Wow6432Node\Microsoft\EdgeUpdate\ClientState\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
            'HKCU:\Software\Microsoft\EdgeUpdate\ClientState\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
            'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\ClientState\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
        )
        $wv2Ver = $null
        foreach ($p in $wv2Paths) {
            $v = (Get-ItemProperty -Path $p -ErrorAction SilentlyContinue).pv
            if ($v) { $wv2Ver = $v; break }
        }
        if ($wv2Ver) {
            Write-Ok "WebView2 Runtime: $wv2Ver"
        } else {
            Write-Fail '未检测到 WebView2 Runtime (Edge WebView2)'
            Write-Note 'Tauri build 会在查询 WebView2 注册表时报 "RegQueryValueExW failed"。'
            Write-Note '一键装机:'
            Write-Note '  winget install Microsoft.EdgeWebView2Runtime'
            Write-Note '装完关终端再开新窗口,再跑 build-desktop.cmd。'
            Write-Note '手动:https://developer.microsoft.com/microsoft-edge/webview2/'
            $ok = $false
        }
    }
}
if (-not $ok) {
    Write-Fail '工具链不全,先装齐再来'
    Restore-Console; exit 1
}

# ====================================================================
# 0.5 Clean
# ====================================================================
if ($Clean) {
    Write-Step 'Clean(--Clean 已传)'
    foreach ($p in @($DistDir, $TauriBundle, (Join-Path $ServerDir 'build'))) {
        if (Test-Path $p) {
            Write-Note "删除 $p"
            Remove-Item -Recurse -Force $p
        }
    }
}

# ====================================================================
# 通用:跑子进程 + 失败时打日志
# ====================================================================
function Invoke-Step {
    param(
        [string]$Name,
        [string]$WorkDir,
        [string]$Command,
        [string[]]$Arguments
    )
    Write-Note "$ $Command $($Arguments -join ' ')"
    $logFile = Join-Path $env:TEMP "chayuan-build-$($Name -replace '[^\w]','_').log"

    # 局部把 ErrorActionPreference 调成 Continue:许多 native 命令(poetry / pnpm /
    # cargo)正常情况下也往 stderr 写信息行,在 Stop 模式 + 2>&1 下会被当成
    # 致命错误抛 NativeCommandError。退出码才是事实真相。
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if ($VerboseSubprocess) {
            Push-Location $WorkDir
            try {
                & $Command @Arguments 2>&1 | Tee-Object -FilePath $logFile
                $exit = $LASTEXITCODE
            } finally { Pop-Location }
        } else {
            Push-Location $WorkDir
            try {
                & $Command @Arguments 2>&1 | Out-File -FilePath $logFile -Encoding utf8
                $exit = $LASTEXITCODE
            } finally { Pop-Location }
        }
    } finally {
        $ErrorActionPreference = $prevEAP
    }

    if ($null -eq $exit) { $exit = 0 }
    if ($exit -ne 0) {
        Write-Fail "$Name 失败(exit $exit)。最近 50 行日志:"
        Get-Content $logFile -Tail 50 | ForEach-Object { Write-Host "  $_" }
        Write-Note "完整日志:$logFile"
        Restore-Console
        exit $exit
    }
    Write-Ok "$Name 完成。日志:$logFile"
}

# ====================================================================
# bundled_models 体检 (本次打包会嵌入哪些模型)
# ====================================================================
$ModelCheckOk = $false
if ($SkipModelCheck) {
    Write-Step '模型体检 [skipped]'
} else {
    Write-Step 'bundled_models 体检 (本次打包会嵌入哪些模型)'
    $checkScript = Join-Path $WorkspaceRoot 'scripts\check-bundled-models.py'
    if (Test-Path $checkScript) {
        # PS 5.1 没有 ?? 空值合并运算符,用显式 if 替代
        $pyExe = Get-Command python -ErrorAction SilentlyContinue
        if (-not $pyExe) { $pyExe = Get-Command python3 -ErrorAction SilentlyContinue }
        if ($pyExe) {
            & $pyExe.Source $checkScript
            if ($LASTEXITCODE -eq 0) { $ModelCheckOk = $true }
            else { Write-Note 'bundled_models 全空 — 集成版将退化为轻量版(都不嵌模型)' }
        } else {
            Write-Note '未找到 python,跳过体检'
        }
    } else {
        Write-Note "$checkScript 不存在,跳过"
    }
}

# 2026-05-15:sidecar 不再嵌 bundled_models(它们改走 Tauri resources),
# 所以两个 flavor 用同一份 sidecar 就够,不再强制 rebuild。flavor 切换
# 只需要重做 src-tauri/bundled_models/ 同步 + Tauri bundle。

# 把 Step 1-3 + 单 flavor 输出包成函数,主循环按 $Flavors 调一次或两次。
$AllArtifacts = @()    # 各 flavor 的产物:flavor / src / dest / sizeMB
function Invoke-FlavorBuild {
    param([string]$Flavor)
    if ($Flavor -eq 'lite') {
        $env:CHAYUAN_LITE_BUILD = '1'
        $flavorLabel = '轻量版(lite)'
    } else {
        Remove-Item Env:CHAYUAN_LITE_BUILD -ErrorAction SilentlyContinue
        $flavorLabel = '集成版(integrated)'
    }
    Write-Host ''
    Write-Step "═══ [$flavorLabel] 开始 ═══"

# ====================================================================
# Step 1: chayuan-server PyInstaller
# ====================================================================
$sidecarName = 'chayuan-server-x86_64-pc-windows-msvc.exe'
$sidecarPath = Join-Path $BinariesDir $sidecarName

if ($SkipServer) {
    Write-Step 'Step 1 [skipped]'
    if (-not (Test-Path $sidecarPath)) {
        Write-Fail "传了 -SkipServer 但 sidecar 不存在:$sidecarPath"
        Write-Note '去掉 -SkipServer 重跑'
        Restore-Console; exit 1
    }
    $size = (Get-Item $sidecarPath).Length / 1MB
    Write-Ok "复用现有 sidecar:$sidecarPath ($([math]::Round($size, 1)) MB)"
} else {
    Write-Step 'Step 1: chayuan-server PyInstaller'

    # 拷文件前先杀残留 sidecar(上次 Step 2 异常退出 / 用户中断时,
    # PyInstaller 派生的 Python 子进程会锁住 binaries 目录里的 exe)。
    Stop-LingeringSidecars

    # 全部 poetry 调用都用 $ServerPkgDir(libs\chayuan-server\),那里才有真依赖列表。
    # build.py 自己用 subprocess 把 cwd 切回 chayuan-server\,所以 PyInstaller 产物
    # 仍然在 chayuan-server\dist\,不影响后续路径。
    #
    # poetry.lock 跟 pyproject.toml 不同步时 Poetry 1.5+ 拒绝 install。
    # 先跑一次 lock 再 install。Poetry 1.x 默认会试图升所有版本,2.x 默认不升;
    # 不带 --no-update 是为了兼容 2.x(2.x 已删该 flag),1.x 多一些版本解析时间无伤。
    Invoke-Step -Name 'poetry-lock' `
        -WorkDir $ServerPkgDir `
        -Command 'poetry' -Arguments @('lock', '--no-interaction')

    Invoke-Step -Name 'poetry-install-main' `
        -WorkDir $ServerPkgDir `
        -Command 'poetry' -Arguments @('install', '--only', 'main', '--no-interaction')

    Invoke-Step -Name 'pip-install-pyinstaller' `
        -WorkDir $ServerPkgDir `
        -Command 'poetry' -Arguments @('run', 'pip', 'install', 'pyinstaller>=6.0')

    # 删过时 pathlib backport(若存在)PyInstaller 6+ 拒绝跟它共存。
    Invoke-Step -Name 'remove-stale-pathlib' `
        -WorkDir $ServerPkgDir `
        -Command 'poetry' -Arguments @('run', 'pip', 'uninstall', '-y', 'pathlib')

    # build.py 路径相对 $ServerPkgDir:..\..\packaging\pyinstaller\build.py
    Invoke-Step -Name 'pyinstaller-build' `
        -WorkDir $ServerPkgDir `
        -Command 'poetry' -Arguments @('run', 'python', '..\..\packaging\pyinstaller\build.py')

    if (-not (Test-Path $sidecarPath)) {
        Write-Fail "PyInstaller 跑完了但 sidecar 没出现在预期位置:$sidecarPath"
        Write-Note "看看 $DistDir 里实际生成了啥;build.py 应该自动拷过去"
        Restore-Console; exit 1
    }
    $size = (Get-Item $sidecarPath).Length / 1MB
    Write-Ok "sidecar 已就位:$sidecarPath ($([math]::Round($size, 1)) MB)"
}

# ====================================================================
# Step 1b: 同步 src-tauri/bundled_models/ 给 Tauri resources
# ====================================================================
# build.py --sync-bundled-only 清空 src-tauri/bundled_models/,然后按
# CHAYUAN_LITE_BUILD env 决定是清空(轻量版)还是拷整树(集成版)。
# sidecar 不嵌模型,Step 1 不必 rebuild,只这步随 flavor 切。
Write-Step "Step 1b: 同步 src-tauri/bundled_models/ ($Flavor)"
$poetryExe = Get-Command poetry -ErrorAction SilentlyContinue
if ($poetryExe) {
    Invoke-Step -Name 'sync bundled (poetry)' `
        -WorkDir $ServerDir `
        -Command 'poetry' -Arguments @('run', 'python', 'packaging\pyinstaller\build.py', '--sync-bundled-only')
} else {
    Invoke-Step -Name 'sync bundled (python)' `
        -WorkDir $ServerDir `
        -Command 'python' -Arguments @('packaging\pyinstaller\build.py', '--sync-bundled-only')
}

# ====================================================================
# Step 2: 健康探测
# ====================================================================
if ($SkipHealthcheck) {
    Write-Step 'Step 2 [skipped]'
} else {
    Write-Step 'Step 2: sidecar /healthz 探测'

    $tmpDataDir = Join-Path $env:TEMP "chayuan-health-$([guid]::NewGuid().ToString('N').Substring(0,8))"
    New-Item -ItemType Directory -Force -Path $tmpDataDir | Out-Null
    $env:CHAYUAN_ROOT = $tmpDataDir
    # chayuan 优先读 state.json.last_init_root(开发机上一次 chayuan init 写的),
    # 不设这个 env 时 $env:CHAYUAN_ROOT 会被无视(详见 chayuan/paths.py:120 注释)。
    # 漏了它会导致 healthcheck 走用户真实数据目录,占了 62581 端口的话 bootstrap
    # 会分配别的随机端口(实测 7861),后面探 62581 永远不响应。
    $env:CHAYUAN_ROOT_IGNORE_STATE = '1'
    Write-Note "临时数据目录(测完即删):$tmpDataDir"

    $stdoutLog = Join-Path $env:TEMP 'chayuan-health-stdout.log'
    $stderrLog = Join-Path $env:TEMP 'chayuan-health-stderr.log'

    $proc = Start-Process -FilePath $sidecarPath `
        -ArgumentList @('start', '-a', '--single-machine') `
        -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError  $stderrLog
    Write-Note "PID=$($proc.Id);最长等 180s 直到 /healthz 200(onefile 解压 + bootstrap 慢)"

    $deadline = (Get-Date).AddSeconds(180)
    $ready = $false
    while ((Get-Date) -lt $deadline -and -not $proc.HasExited) {
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:62581/healthz' `
                -TimeoutSec 2 -ErrorAction Stop
            if ($r.StatusCode -eq 200) {
                $ready = $true
                break
            }
        } catch {
            Start-Sleep -Milliseconds 800
        }
    }

    # 必须杀整棵进程树:onefile sidecar 父进程派生的 Python 子进程会持续持有
    # exe 文件句柄,只杀 $proc.Id 会留 zombie 子进程,后面拷 / Tauri 打包都会被
    # WinError 32 卡住。
    Stop-ProcessTree -ProcessId $proc.Id
    Stop-LingeringSidecars   # 兜底:同名 PyInstaller 子进程也清掉
    Remove-Item -Recurse -Force $tmpDataDir -ErrorAction SilentlyContinue

    if ($ready) {
        Write-Ok 'sidecar 90s 内 /healthz 返 200'
    } else {
        Write-Fail 'sidecar 启动失败或 /healthz 不响应。stderr 尾部:'
        Get-Content $stderrLog -Tail 40 -ErrorAction SilentlyContinue |
            ForEach-Object { Write-Host "  $_" }
        Write-Note "stdout 日志:$stdoutLog"
        Write-Note "stderr 日志:$stderrLog"
        Restore-Console; exit 1
    }
}

# ====================================================================
# Step 3: chayuan-client Tauri bundle
# ====================================================================
if ($SkipFrontend) {
    Write-Step 'Step 3 [skipped]'
} else {
    Write-Step 'Step 3: chayuan-client Tauri bundle'

    if ($SkipInstall) {
        Write-Skip 'Step 3a [pnpm install] (--SkipInstall)'
    } else {
        Invoke-Step -Name 'pnpm-install' `
            -WorkDir $ClientDir `
            -Command 'pnpm' -Arguments @('install', '--frozen-lockfile')
    }

    if ($SkipTypecheck) {
        Write-Skip 'Step 3b [pnpm typecheck] (--SkipTypecheck)'
    } else {
        Invoke-Step -Name 'pnpm-typecheck' `
            -WorkDir $ClientDir `
            -Command 'pnpm' -Arguments @('typecheck')
    }

    # Windows installer 双重限制:
    #   1) **单文件 < 2 GB** — NSIS makensis 32-bit mmap;WiX 3 light.exe
    #      LGHT0263 硬编码 INT32_MAX。build.py --sync-bundled-only 已加 size-guard
    #      在 sync 阶段就 abort。
    #   2) **总 payload 压缩后 < 2 GB** — 仅 NSIS 受此限,32-bit makensis 的
    #      LZMA solid 累积 offset 32-bit 寻址。3+ GB 原始 payload 压缩 ~2.6 GB
    #      就溢出报"Internal compiler error #12345 error mmapping file ... out of range"。
    #
    # 集成版 vendor 现在嵌 emb+rerank+chat+asr 总 ~3.2 GB,撞 NSIS 总尺寸限制;
    # **WiX 3 MSI 总大小可到 4 GB+,通过 CAB 分卷处理**,所以集成版改走 MSI。
    # 轻量版 vendor 是空的,sidecar ~500 MB 远低于 2 GB,继续走 NSIS 保住
    # installer.nsh 的"察元AI"中文图标 rename。
    $useMsi = ($Flavor -eq 'integrated') -and ($IsWindows -or $env:OS -eq 'Windows_NT')
    if ($BundleOnly) {
        # cargo / vite 走增量缓存,只重做 Tauri bundle(makensis / WiX 等)。
        # 不能直接调 ``pnpm --filter @chayuan/desktop build``,因为那里面带
        # ``tsc + vite build``,与本入口想跳过的 typecheck 重复。
        $DesktopDir = Join-Path $ClientDir 'apps\desktop'
        $tauriArgs = @('exec', 'tauri', 'build')
        if ($useMsi) {
            # Tauri 2 CLI 的 --bundles 只接受当前平台支持的 target;
            # Windows 上要么 msi 要么 nsis,集成版选 msi。
            $tauriArgs = @('exec', 'tauri', 'build', '--bundles', 'msi')
        }
        Invoke-Step -Name 'tauri-build (bundle-only)' `
            -WorkDir $DesktopDir `
            -Command 'pnpm' -Arguments $tauriArgs
    } else {
        $buildScript = if ($useMsi) { 'build:desktop:integrated' } else { 'build:desktop' }
        Invoke-Step -Name "pnpm-$buildScript" `
            -WorkDir $ClientDir `
            -Command 'pnpm' -Arguments @($buildScript)
    }

    # 收产物:.msi / NSIS .exe (主安装器) + .cab (外置 cabinet,集成版 EmbedCab="no" 才会有)
    #
    # cab 文件实际放在哪取决于 WiX 调 light 时的 CWD;Tauri 2 把 light 调起来后,
    # cab 既可能跟 .msi 同目录(target/release/bundle/msi/),也可能落在
    # target/release/wix/x64/(light 的 .wixobj 所在目录)。先在 .msi 旁边找,
    # 没就扩搜整个 target/release。
    $artifacts = @()
    $msiFiles = Get-ChildItem -Path (Join-Path $TauriBundle 'msi\*.msi') -ErrorAction SilentlyContinue
    $exeFiles = Get-ChildItem -Path (Join-Path $TauriBundle 'nsis\*.exe') -ErrorAction SilentlyContinue
    $artifacts += $msiFiles
    $artifacts += $exeFiles

    # cab 收集:先 .msi 旁边
    $cabFiles = @()
    foreach ($msi in $msiFiles) {
        $cabFiles += Get-ChildItem -Path (Join-Path $msi.DirectoryName 'cab*.cab') -ErrorAction SilentlyContinue
        $cabFiles += Get-ChildItem -Path (Join-Path $msi.DirectoryName '*.cab') -ErrorAction SilentlyContinue
    }
    $cabFiles = $cabFiles | Sort-Object FullName -Unique

    # 如果 .msi 旁边没找到 cab(WiX 把 cab 放别处了),扩搜 target/release
    if ($msiFiles.Count -gt 0 -and $cabFiles.Count -eq 0) {
        # $TauriBundle = chayuan-client\apps\desktop\src-tauri\target\release\bundle
        # 它的上一层 release 下面 wix\ 也可能有 cab
        $targetRelease = Split-Path -Parent $TauriBundle
        if (Test-Path $targetRelease) {
            Write-Note "msi 旁边没找到 cab*.cab,扩搜 $targetRelease ..."
            $cabFiles = Get-ChildItem -Path $targetRelease -Recurse -Filter '*.cab' -File -ErrorAction SilentlyContinue
            if ($cabFiles.Count -gt 0) {
                Write-Note "扩搜命中 $($cabFiles.Count) 个 cab,位置:$($cabFiles[0].DirectoryName)"
            }
        }
    }
    $artifacts += $cabFiles

    # 集成版 EmbedCab=no 必须出 cab,否则 .msi 装时 1311/1335 找 cab 失败
    if ($Flavor -eq 'integrated' -and $msiFiles.Count -gt 0 -and $cabFiles.Count -eq 0) {
        Write-Fail "集成版 .msi 出了但没找到任何 cab*.cab — light.exe 可能没产 cabinet"
        Write-Note "手动确认:Get-ChildItem `"$($msiFiles[0].DirectoryName)`" -Recurse | ? Name -like '*.cab'"
        Write-Note "或扩搜 target/release/ 下:Get-ChildItem `"$(Split-Path -Parent $TauriBundle)`" -Recurse -Filter '*.cab'"
        Restore-Console; exit 1
    }

    if ($artifacts.Count -eq 0) {
        Write-Fail "Tauri bundle 没产出 .msi / .exe / .cab;看 $TauriBundle"
        Restore-Console; exit 1
    }
    Write-Ok 'Tauri bundle 完成:'
    $flavorOut = Join-Path $WorkspaceRoot "dist-$Flavor"
    if (Test-Path $flavorOut) { Remove-Item $flavorOut -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $flavorOut | Out-Null
    foreach ($a in $artifacts) {
        $sz = [math]::Round($a.Length / 1MB, 1)
        $ext  = [System.IO.Path]::GetExtension($a.Name).ToLower()
        if ($ext -eq '.cab') {
            # CAB 名字保持原样(.msi 里硬编码引用 app1.cab/app2.cab/...,
            # 改名字会让 msiexec 装到 cabinet 阶段找不到文件 → 安装失败)
            $destName = $a.Name
        } else {
            $stem = [System.IO.Path]::GetFileNameWithoutExtension($a.Name)
            $destName = "$stem.$Flavor$ext"
        }
        $dest = Join-Path $flavorOut $destName
        Copy-Item -Path $a.FullName -Destination $dest -Force
        $script:AllArtifacts += [PSCustomObject]@{
            Flavor = $Flavor
            Src    = $a.FullName
            Dest   = $dest
            SizeMB = $sz
        }
        Write-Host "    $($a.FullName) -> $dest ($sz MB)"
    }
}

}   # end Invoke-FlavorBuild

# ====================================================================
# 主循环:按 $Flavors 跑一次或两次
# ====================================================================
foreach ($flav in $Flavors) {
    Invoke-FlavorBuild -Flavor $flav
}

# ====================================================================
# 总结 + 还原编码
# ====================================================================
Write-Step '完成'
Write-Note "本次构建 flavor:$($Flavors -join ', ')"
if (-not $SkipFrontend) {
    foreach ($flav in $Flavors) {
        Write-Note "$flav 产物目录:$(Join-Path $WorkspaceRoot "dist-$flav")\"
    }
}
if ($AllArtifacts.Count -gt 0) {
    Write-Host ''
    Write-Host '本次产物清单' -ForegroundColor White
    foreach ($a in $AllArtifacts) {
        $name = Split-Path -Leaf $a.Dest
        Write-Host ("  {0,-12} {1,-50} {2} MB" -f $a.Flavor, $name, $a.SizeMB)
    }
}
if ($Flavors.Count -eq 2) {
    Write-Host ''
    Write-Host '  轻量版:不嵌模型,装机包小,需联网下载或扫盘配置'
    Write-Host '  集成版:vendor\bundled_models\ 进 Tauri resources,装机即用 (模型清单见上方"模型体检"输出,'
    Write-Host '          或 chayuan-server\vendor\bundled_models\README.md)'
    Write-Host ''
    Write-Host '  ⚠ 集成版 .msi 走外置 CAB (EmbedCab="no") 绕国产杀软对 C:\Windows\Installer\ 的拦截。'
    Write-Host '    分发时把 dist-integrated\ 下的 .msi + 所有 .cab 一起打 zip 给用户,'
    Write-Host '    用户解压后再双击 .msi 安装。只发 .msi 不带 .cab 会装到一半 1311/1335 找 cab 失败。'
}
Write-Host ''
if ($useColor) { Write-Host "$ESC[32m[OK] 全部步骤通过$ESC[0m" }
else { Write-Host '[OK] 全部步骤通过' }

Restore-Console
