//! 单机模式 chayuan-server sidecar 启停管理(Phase 3)。
//!
//! 流程:
//!
//! 1. **不在 Tauri ``setup`` 里立刻 spawn** —— 用户首启动向导(``data_dir.rs``)
//!    必须先选定数据目录,我们才知道往子进程注入什么 ``CHAYUAN_ROOT``。
//!    所以 spawn 入口是前端命令 ``chayuan_sidecar_start`` ── FirstRunSetup
//!    确认后由 Shell 调用一次。
//! 2. spawn 时通过 ``tauri-plugin-shell::ShellExt::shell().sidecar()`` 启起
//!    ``chayuan-server-<rust-target-triple>``;参数:``start -a --single-machine``;
//!    env 注入:``CHAYUAN_ROOT`` + 单机 profile 系列(详见 ``chayuan/startup.py``)。
//! 3. 后台线程监听 ``CommandEvent::{Stdout, Stderr, Terminated}`` ──
//!    日志逐行追加到 last_log_line(诊断用);Terminated 时把 state 切到
//!    ``failed`` / ``stopped``。
//! 4. 另一后台线程 polling ``http://127.0.0.1:<port>/healthz`` 直到 200 OK,
//!    把 state 切到 ``ready``。前端调 ``chayuan_sidecar_status`` 取最新。
//! 5. Tauri ``RunEvent::ExitRequested`` / ``WindowEvent::CloseRequested`` 由
//!    ``lib.rs`` 触发 ``chayuan_sidecar_kill`` ── 子进程 SIGTERM(plugin-shell
//!    内部用 ``kill_on_drop`` + 显式 kill)。
//!
//! 开发态(``cfg!(debug_assertions)``)默认**不 spawn**:开发者自己跑
//! ``poetry run chayuan start -a``。前端探测到 dev 时直接走 62581。
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// 子进程状态机。前端据此渲染 banner / 错误覆盖层。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub enum SidecarState {
    /// 未启动(等 FirstRunSetup 确认后调 ``chayuan_sidecar_start``)
    #[serde(rename = "idle")]
    Idle,
    /// 已 spawn,但 ``/healthz`` 还没返 200
    #[serde(rename = "starting")]
    Starting,
    /// ``/healthz`` 200,业务请求可发
    #[serde(rename = "ready")]
    Ready,
    /// 启动失败 / 健康探测超时 / 进程异常退出
    #[serde(rename = "failed")]
    Failed,
    /// 用户主动停(关窗 / chayuan_sidecar_kill)
    #[serde(rename = "stopped")]
    Stopped,
    /// dev 模式跳过 spawn(开发者自己跑 server)
    #[serde(rename = "disabled")]
    Disabled,
}

#[derive(Debug, Clone, Serialize)]
pub struct SidecarStatus {
    pub state: SidecarState,
    pub port: u16,
    /// 业务侧直接拿这个填 ``configureClient({ baseURL })``
    pub base_url: String,
    /// 重启次数(自动重启 Phase 4 接;v0 不重启)
    pub restarts: u32,
    /// 失败时的诊断信息(stdout / stderr 最后一行 / 退出码 etc.)
    pub error: Option<String>,
    /// 最后一行 log,前端展示在 banner 里(便于用户看到启动进度)
    pub last_log_line: Option<String>,
    /// 当前数据目录(用于"切换数据目录"向导回显)
    pub data_dir: String,
}

impl SidecarStatus {
    fn idle(port: u16) -> Self {
        Self {
            state: SidecarState::Idle,
            port,
            base_url: format!("http://127.0.0.1:{port}"),
            restarts: 0,
            error: None,
            last_log_line: None,
            data_dir: String::new(),
        }
    }
}

/// 由 ``lib.rs`` 注入到 Tauri State 的句柄。
pub struct SidecarManager {
    inner: Mutex<ManagerInner>,
}

struct ManagerInner {
    status: SidecarStatus,
    child: Option<CommandChild>,
}

impl SidecarManager {
    pub fn new(default_port: u16) -> Self {
        Self {
            inner: Mutex::new(ManagerInner {
                status: SidecarStatus::idle(default_port),
                child: None,
            }),
        }
    }

    pub fn snapshot(&self) -> SidecarStatus {
        self.inner.lock().unwrap().status.clone()
    }

    /// 切状态;``error`` = ``None`` 时清掉历史 error(转 ready / idle 用)。
    fn set_state(&self, state: SidecarState, error: Option<String>) {
        let mut g = self.inner.lock().unwrap();
        g.status.state = state;
        g.status.error = error;
    }

    fn set_log_line(&self, line: String) {
        self.inner.lock().unwrap().status.last_log_line = Some(line);
    }

    fn store_child(&self, child: CommandChild) {
        self.inner.lock().unwrap().child = Some(child);
    }

    fn take_child(&self) -> Option<CommandChild> {
        self.inner.lock().unwrap().child.take()
    }

    fn set_data_dir(&self, dir: String) {
        self.inner.lock().unwrap().status.data_dir = dir;
    }

    /// 应用退出前的清理钩子(``lib.rs`` 在 ``RunEvent::ExitRequested`` 调用)。
    pub fn kill_on_exit(&self) {
        if let Some(child) = self.take_child() {
            let _ = child.kill();
        }
    }
}

/// 默认端口与 ``Settings.basic_settings.API_SERVER["port"]`` 对齐。
/// 实际端口由 ``SidecarManager::new(port)`` 在 ``lib.rs`` 注入,这里仅作
/// 文档锚点 + 给手动测试用,不会被 import,加 ``#[allow(dead_code)]``。
#[allow(dead_code)]
const DEFAULT_PORT: u16 = 62581;

/// 健康探测超时与轮询间隔。``healthz`` 已经包含 DB ping,2s 超时够用。
const HEALTH_TIMEOUT: Duration = Duration::from_secs(2);
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(800);
/// 启动总等待:60s(冷启动 PyInstaller 解压 + alembic upgrade,留富裕)。
const HEALTH_TOTAL_DEADLINE: Duration = Duration::from_secs(60);

fn poll_healthz_once(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{port}/healthz");
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(HEALTH_TIMEOUT)
        .timeout_read(HEALTH_TIMEOUT)
        .build();
    match agent.get(&url).call() {
        Ok(resp) => resp.status() == 200,
        Err(_) => false,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarStartArgs {
    pub data_dir: String,
    /// 可选:vendor 平台子目录强制覆盖(对齐 chayuan-server 的 CHAYUAN_VENDOR_PLATFORM env)。
    /// 用户在「本地模型」设置页选了 win-x64-noavx / win-x64-avx512 等 CPU 变体时填这个;
    /// 不传 = sidecar 走自动检测(_platform_subdir_candidates)。
    #[serde(default)]
    pub vendor_platform: Option<String>,
}

/// 前端 FirstRunSetup 确认后调用一次。已 ready 时是 no-op。
#[tauri::command]
pub fn chayuan_sidecar_start<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, Arc<SidecarManager>>,
    args: SidecarStartArgs,
) -> Result<SidecarStatus, String> {
    // 已 ready / starting 直接返当前快照,不重复 spawn
    {
        let g = state.inner.lock().unwrap();
        if matches!(
            g.status.state,
            SidecarState::Starting | SidecarState::Ready
        ) {
            return Ok(g.status.clone());
        }
    }

    // 开发态:不 spawn(开发者自己跑 chayuan start -a),直接报 disabled。
    // 通过环境变量 ``CHAYUAN_DESKTOP_SPAWN_SIDECAR=1`` 强制 dev 也 spawn(调试 Phase 3 用)。
    let force_spawn = std::env::var("CHAYUAN_DESKTOP_SPAWN_SIDECAR")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    if cfg!(debug_assertions) && !force_spawn {
        state.set_state(SidecarState::Disabled, None);
        state.set_data_dir(args.data_dir.clone());
        return Ok(state.snapshot());
    }

    state.set_data_dir(args.data_dir.clone());
    state.set_state(SidecarState::Starting, None);

    let port = state.snapshot().port;

    // ── 1. 通过 plugin-shell 拼 sidecar 命令 ─────────────────────────
    let shell = app.shell();
    let mut cmd = shell
        .sidecar("chayuan-server")
        .map_err(|e| format!("locate sidecar binary: {e}"))?
        .args(["start", "-a", "--single-machine"])
        // ⚠ CHAYUAN_ROOT_IGNORE_STATE=1 必须设。
        // chayuan/paths.py::resolve_chayuan_root 默认优先读 ~/.chayuan/state.json
        // 里 last_init_root —— 开发机上跑过 ``chayuan init`` 后写过的目录会凌驾
        // 于这里 env 注入的 CHAYUAN_ROOT 之上,导致 sidecar 读老 yaml 把 API
        // 端口 / 凭据全错配(实测:Tauri 注入 data_dir 用默认 62581,但老 yaml
        // 里 API 是个旧默认(此前出现过 7861),Tauri 探 62581 永远 404)。设这个
        // env 跳过 state.json 优先级,真正让 Tauri 选定的 data_dir 生效。
        // 注意:62581 是约定端口,看到 7861 一律视作历史残留要修。
        .env("CHAYUAN_ROOT_IGNORE_STATE", "1")
        .env("CHAYUAN_ROOT", &args.data_dir)
        .env("CHAYUAN_PROFILE", "single-machine")
        .env("CHAYUAN_AUTH", "anonymous")
        .env("CHAYUAN_REDIS", "disabled")
        .env("CHAYUAN_QUEUE", "inproc")
        .env("CHAYUAN_VECTOR_STORE", "sqlite-vec");

    // CPU 变体覆盖:用户在「本地模型」设置页选了 win-x64-noavx / win-x64-avx512 等
    // 自定义平台后,Tauri 把值存进 vendor_platform_override 设置项,这里透传给 sidecar。
    // 让 local_runtime.py:_platform_subdir_candidates() 走 env 路径,跳自动检测。
    // 来源 1:进程 env(开发机 / CI 调试)
    if let Ok(v) = std::env::var("CHAYUAN_VENDOR_PLATFORM") {
        let v = v.trim();
        if !v.is_empty() {
            cmd = cmd.env("CHAYUAN_VENDOR_PLATFORM", v);
        }
    }
    // 来源 2:start args 字段(前端设置页传过来)
    if let Some(v) = args.vendor_platform.as_ref() {
        let v = v.trim();
        if !v.is_empty() {
            cmd = cmd.env("CHAYUAN_VENDOR_PLATFORM", v);
        }
    }

    let (mut rx, child) = cmd
        .spawn()
        .map_err(|e| format!("spawn sidecar: {e}"))?;
    state.store_child(child);

    // ── 2. 后台线程读 stdout/stderr,Terminated 时切状态 ─────────────
    // Arc::clone(&*state) —— 通过 Deref 拿到 &Arc<SidecarManager> 再 clone 出
    // 独立的 Arc。注意:**不能**写 state.inner() —— Tauri 自带的
    // ``State::inner(&self) -> &T`` 名字跟我们之前的 ManagerExt 撞车,
    // method resolution 优先选 inherent,返的是借用,带 state 生命周期,
    // 进 thread::spawn 的 'static 闭包就抛 E0521。
    let app_h = app.clone();
    let mgr: Arc<SidecarManager> = Arc::clone(&*state);
    thread::spawn(move || {
        // Tauri 2 的 CommandEvent receiver 是 tokio mpsc;此处用 blocking_recv
        // 避免在主线程跑 tokio runtime 的复杂度。
        while let Some(ev) = rx.blocking_recv() {
            match ev {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    let s = String::from_utf8_lossy(&line).trim().to_string();
                    if !s.is_empty() {
                        mgr.set_log_line(s.clone());
                        // 同步 emit 给前端,banner 实时滚动启动日志
                        let _ = app_h.emit("cy:sidecar-log", s);
                    }
                }
                CommandEvent::Terminated(payload) => {
                    let cur = mgr.snapshot();
                    // 已 ready 后被杀:正常关闭路径(用户关窗触发 chayuan_sidecar_kill)
                    let next = if cur.state == SidecarState::Ready {
                        SidecarState::Stopped
                    } else {
                        SidecarState::Failed
                    };
                    let err = format!(
                        "sidecar exited code={:?} signal={:?}",
                        payload.code, payload.signal
                    );
                    mgr.set_state(next.clone(), Some(err));
                    let _ = app_h.emit("cy:sidecar-state", next);
                    break;
                }
                _ => {}
            }
        }
    });

    // ── 3. 后台线程 polling /healthz ───────────────────────────────
    let app_h2 = app.clone();
    let mgr2: Arc<SidecarManager> = Arc::clone(&*state);
    thread::spawn(move || {
        let started = std::time::Instant::now();
        loop {
            if started.elapsed() > HEALTH_TOTAL_DEADLINE {
                mgr2.set_state(
                    SidecarState::Failed,
                    Some(format!(
                        "/healthz 在 {}s 内未返 200",
                        HEALTH_TOTAL_DEADLINE.as_secs()
                    )),
                );
                let _ = app_h2.emit("cy:sidecar-state", SidecarState::Failed);
                return;
            }
            // 已被外部切到 stopped/failed → 终止 poll
            let cur_state = mgr2.snapshot().state;
            if matches!(cur_state, SidecarState::Stopped | SidecarState::Failed) {
                return;
            }
            if poll_healthz_once(port) {
                mgr2.set_state(SidecarState::Ready, None);
                let _ = app_h2.emit("cy:sidecar-state", SidecarState::Ready);
                return;
            }
            thread::sleep(HEALTH_POLL_INTERVAL);
        }
    });

    Ok(state.snapshot())
}

#[tauri::command]
pub fn chayuan_sidecar_status(
    state: tauri::State<'_, Arc<SidecarManager>>,
) -> SidecarStatus {
    state.snapshot()
}

/// 主动停(关窗 / 切换数据目录向导)。已停为 no-op。
#[tauri::command]
pub fn chayuan_sidecar_kill(
    state: tauri::State<'_, Arc<SidecarManager>>,
) -> Result<SidecarStatus, String> {
    if let Some(child) = state.take_child() {
        // CommandChild::kill 在 tauri-plugin-shell 内部 SIGKILL;Phase 4 可换成
        // SIGTERM + 3s grace + SIGKILL,这里先简单实现。
        let _ = child.kill();
    }
    state.set_state(SidecarState::Stopped, None);
    Ok(state.snapshot())
}

