use std::io::Cursor;
use std::sync::{Arc, Mutex};

use sha2::{Digest, Sha256};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, RunEvent, WindowEvent,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

/// 截图选区流程的跨窗口共享状态。
///
/// 流程:主窗调 ``chayuan_capture_for_overlay`` → Rust 抓屏写到 ``buffer`` →
/// 主窗自己创建 overlay 窗口 → overlay 窗读 ``buffer`` 渲图 + 让用户拖框 →
/// 用户确认/取消 → overlay 调 ``chayuan_submit_screenshot_result`` 写 ``result``
/// + emit 事件 + 自关 → 主窗收事件 → 调 ``chayuan_take_screenshot_result`` 拿
/// 最终裁剪 PNG(或 None=用户取消)。
///
/// 用 Tauri State 而非 ``Lazy<Mutex>``: 测试时可隔离;清理在 RunEvent::Exit
/// 自动 drop。bytes 走 Rust 全程不经 JSON,前后端零序列化开销。
#[derive(Default)]
struct ScreenshotState {
    /// 主窗抓屏后写,overlay 窗读一次(take)后清空
    buffer: Mutex<Option<Vec<u8>>>,
    /// overlay 窗交付的最终结果:
    ///   Some(Some(bytes)) → 用户确认了选区
    ///   Some(None)        → 用户取消
    ///   None              → overlay 还没交付(主窗早调时的初始态)
    result: Mutex<Option<Option<Vec<u8>>>>,
}

/// 主显示器尺寸 — 创建 overlay 窗口时定位 + 设大小用
#[derive(serde::Serialize)]
struct MonitorGeom {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

mod data_dir;
mod sidecar;

/// 派生稳定的 vault 密码：machine-uid + 应用盐。前端调 `chayuan_vault_password` 取。
#[tauri::command]
fn chayuan_vault_password() -> Result<String, String> {
    let mid = machine_uid::get().unwrap_or_else(|_| "anon-machine".to_string());
    let salt = "chayuan.vault.v1";
    let mut hasher = Sha256::new();
    hasher.update(mid.as_bytes());
    hasher.update(salt.as_bytes());
    Ok(hex::encode(hasher.finalize()))
}

/// 占位：tray 菜单按 id 重设；事件通过 'tray-click' emit 给前端。
#[tauri::command]
fn chayuan_tray_set_menu(_items: Vec<serde_json::Value>) -> Result<(), String> {
    // 当前默认 tray 在 setup 里建好；动态变更菜单项需更多 plumbing，
    // 后续按需扩展。返回 Ok 让前端稳定。
    Ok(())
}

#[tauri::command]
fn chayuan_tray_set_tooltip(text: String, app: tauri::AppHandle) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_tooltip(Some(text)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 关闭独立 splashscreen 窗口 + 显示主窗口。
/// 前端 main.tsx 在 React 首屏 paint 之后调用本 command,把 splash 渐隐换主窗。
/// 兜底:无 splashscreen 窗口时也要让 main show(避免主窗口卡在 visible=false)。
#[tauri::command]
async fn chayuan_close_splashscreen(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(splash) = app.get_webview_window("splashscreen") {
        // 关 splash 失败不阻塞 main show — 至少让用户能看到主窗
        let _ = splash.close();
    }
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| format!("show main: {e}"))?;
        let _ = main.set_focus();
    }
    Ok(())
}

/// 截图（全屏第一块显示器）→ PNG 字节
#[tauri::command]
fn chayuan_screenshot() -> Result<Vec<u8>, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("xcap: {e}"))?;
    let primary = monitors.into_iter().next().ok_or_else(|| "no monitor".to_string())?;
    let img = primary.capture_image().map_err(|e| format!("capture: {e}"))?;
    let mut buf: Vec<u8> = Vec::new();
    let dyn_img = image::DynamicImage::ImageRgba8(img);
    dyn_img
        .write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
        .map_err(|e| format!("png: {e}"))?;
    Ok(buf)
}

/// 截图 → 写到共享 state,返回显示器几何信息给 caller 用来创建 overlay 窗口。
///
/// 主窗调用时机:用户点剪刀 → 抓屏入 state → JS 端用 ``WebviewWindow`` 在主显示
/// 器位置创建无边框透明 overlay → overlay 调 ``chayuan_take_screenshot_buffer``
/// 读回 PNG 字节 → 拖框选区。
///
/// 同时清空 result slot(防止上次 cancelled 残留污染本次结果)。
#[tauri::command]
fn chayuan_capture_for_overlay(
    state: tauri::State<'_, ScreenshotState>,
) -> Result<MonitorGeom, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("xcap: {e}"))?;
    let primary = monitors.into_iter().next().ok_or_else(|| "no monitor".to_string())?;
    // xcap 0.6+ 把 x/y/width/height 改成 Result<T, XCapError>(底层 OS API 可能
    // 失败,比如 Wayland 无权限);用 ? 解包,失败映射成 String
    let geom = MonitorGeom {
        x: primary.x().map_err(|e| format!("monitor.x: {e}"))?,
        y: primary.y().map_err(|e| format!("monitor.y: {e}"))?,
        width: primary.width().map_err(|e| format!("monitor.width: {e}"))?,
        height: primary.height().map_err(|e| format!("monitor.height: {e}"))?,
    };
    let img = primary.capture_image().map_err(|e| format!("capture: {e}"))?;
    let mut buf: Vec<u8> = Vec::new();
    let dyn_img = image::DynamicImage::ImageRgba8(img);
    dyn_img
        .write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
        .map_err(|e| format!("png: {e}"))?;
    *state.buffer.lock().map_err(|e| format!("buffer lock: {e}"))? = Some(buf);
    *state.result.lock().map_err(|e| format!("result lock: {e}"))? = None;
    Ok(geom)
}

/// overlay 窗口拉取主窗刚抓的 PNG;take 一次后 state 清空(避免悬挂大块内存)
#[tauri::command]
fn chayuan_take_screenshot_buffer(
    state: tauri::State<'_, ScreenshotState>,
) -> Result<Vec<u8>, String> {
    state.buffer.lock().map_err(|e| format!("buffer lock: {e}"))?
        .take()
        .ok_or_else(|| "screenshot buffer empty — capture_for_overlay 没先调?".to_string())
}

/// overlay 窗口提交最终结果:
///   bytes=Some(裁剪 PNG) → 用户确认
///   bytes=None           → 用户取消
/// 写入 state 后立刻 emit ``chayuan://screenshot/done`` 到主窗,主窗 listen
/// 到后用 ``chayuan_take_screenshot_result`` 取走。
#[tauri::command]
async fn chayuan_submit_screenshot_result(
    bytes: Option<Vec<u8>>,
    app: tauri::AppHandle,
    state: tauri::State<'_, ScreenshotState>,
) -> Result<(), String> {
    *state.result.lock().map_err(|e| format!("result lock: {e}"))? = Some(bytes);
    // emit 到所有窗口,主窗自己 listen 即可;事件没有 payload,bytes 在 state
    let _ = app.emit("chayuan://screenshot/done", ());
    // 自关 overlay — 用户 confirm/cancel 后窗口立刻消失,体验跟 QQ 一致
    if let Some(overlay) = app.get_webview_window("screenshot-overlay") {
        let _ = overlay.close();
    }
    Ok(())
}

/// 主窗在收到 done 事件后拉走结果。
/// 返 None:用户取消 / 还没提交(异常路径,主窗 listen 之后才会调)
#[tauri::command]
fn chayuan_take_screenshot_result(
    state: tauri::State<'_, ScreenshotState>,
) -> Result<Option<Vec<u8>>, String> {
    Ok(state
        .result
        .lock()
        .map_err(|e| format!("result lock: {e}"))?
        .take()
        .flatten())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // window_state plugin:默认 save 全部 state flags(SIZE / POSITION / MAXIMIZED /
    // FULLSCREEN / DECORATIONS / VISIBLE),启动时按窗口 label 自动 restore。
    //
    // ⚠ 这里**必须排除 VISIBLE**,否则:之前 session main 窗口 visible=true 被存了,
    // 下次启动 plugin 在 setup 之前 restore → main 被强制 show,即使 conf.json
    // 写了 visible: false。用户看到的就是 main 的 backgroundColor(#0f172a 深蓝)
    // 即"蓝屏",splash 窗口被遮挡 / 还没起来就被夺焦。
    // 同时排除 DECORATIONS,避免 plugin 覆盖 splash 窗口的 decorations:false。
    //
    // splashscreen 窗口完全不持久化(每次启动都是固定 420×420 center 状态)。
    // 关键:排除 VISIBLE / DECORATIONS;splashscreen 窗口靠 setup 阶段 force show
    // 兜底,plugin 即便存了它的 state 也无害。
    let window_state_plugin = tauri_plugin_window_state::Builder::default()
        .with_state_flags(
            tauri_plugin_window_state::StateFlags::SIZE
                | tauri_plugin_window_state::StateFlags::POSITION
                | tauri_plugin_window_state::StateFlags::MAXIMIZED
                | tauri_plugin_window_state::StateFlags::FULLSCREEN,
        )
        .build();

    tauri::Builder::default()
        .plugin(window_state_plugin)
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        // Stronghold 用 ChaCha20-Poly1305 加密 vault,key 必须是稳定的 32 byte。
        // 旧 closure 直接 password.as_bytes().to_vec(),长度不固定时 libsodium 抛
        // "illegal non-contiguous size",前端 secure store 全废。
        // 这里用 argon2id 做 KDF:salt 写死 + 单次轮数(冷启动一次,够用),
        // 输出固定 32 byte。失败软回落到 SHA-256(同样 32 byte,弱但保证不崩)。
        .plugin(tauri_plugin_stronghold::Builder::new(|password| {
            use argon2::{Algorithm, Argon2, Params, Version};

            let salt: &[u8] = b"chayuan.stronghold.v1";
            let mut key = [0u8; 32];

            let params = Params::new(19_456, 2, 1, Some(32))
                .unwrap_or_else(|_| Params::default());
            let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

            if argon2.hash_password_into(password.as_bytes(), salt, &mut key).is_err() {
                // KDF 失败的话用 SHA-256 兜底,至少 key 长度合规
                let mut hasher = Sha256::new();
                hasher.update(password.as_bytes());
                hasher.update(salt);
                let digest = hasher.finalize();
                key.copy_from_slice(&digest);
            }
            key.to_vec()
        }).build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Arc::new(sidecar::SidecarManager::new(62581)))
        .manage(ScreenshotState::default())
        .invoke_handler(tauri::generate_handler![
            chayuan_vault_password,
            chayuan_tray_set_menu,
            chayuan_tray_set_tooltip,
            chayuan_screenshot,
            chayuan_capture_for_overlay,
            chayuan_take_screenshot_buffer,
            chayuan_submit_screenshot_result,
            chayuan_take_screenshot_result,
            chayuan_close_splashscreen,
            data_dir::chayuan_data_dir_state,
            data_dir::chayuan_data_dir_set,
            data_dir::chayuan_data_dir_default,
            data_dir::chayuan_data_dir_check_existing,
            data_dir::chayuan_data_dir_reset,
            sidecar::chayuan_sidecar_start,
            sidecar::chayuan_sidecar_status,
            sidecar::chayuan_sidecar_kill
        ])
        .setup(|app| {
            // ── splash 强制顺序(double safety net)─────────────────
            // 即便 window_state plugin / WebView2 startup quirks 抢先 show 了 main,
            // 这里把 main 强行 hide、把 splash 强行 show 一次,确保 splash 是首先
            // 出现的那一个。两个 best-effort,失败不阻塞 setup。
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.hide();
            }
            if let Some(splash) = app.get_webview_window("splashscreen") {
                let _ = splash.show();
                let _ = splash.set_focus();
            }

            // ── 系统托盘 ────────────────────────────────────────────
            // 菜单(从上到下):
            //   打开察元 AI
            //   新对话
            //   ─── 分隔 ───
            //   重启
            //   关于
            //   ─── 分隔 ───
            //   退出
            let show     = MenuItem::with_id(app, "show",     "打开察元 AI", true, None::<&str>)?;
            let new_chat = MenuItem::with_id(app, "new_chat", "新对话",       true, None::<&str>)?;
            let sep1     = PredefinedMenuItem::separator(app)?;
            let restart  = MenuItem::with_id(app, "restart",  "重启",         true, None::<&str>)?;
            let about    = MenuItem::with_id(app, "about",    "关于",         true, None::<&str>)?;
            let sep2     = PredefinedMenuItem::separator(app)?;
            // 右上角 X 是关到托盘不退程序;真退出由这条菜单触发,后台 sidecar
            // 也会一起结束(由 RunEvent::ExitRequested 的 on_window_event 处理)。
            let quit     = MenuItem::with_id(app, "quit",     "退出", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&show, &new_chat, &sep1, &restart, &about, &sep2, &quit],
            )?;

            // 托盘图标:用 tauri build 注入的 default_window_icon (即 tauri.conf.json
            // bundle.icon 链里第一张),保证跟标题栏 / installer 图标视觉一致。
            // 拿不到 → setup 失败 (理论不会 — bundle.icon 已配 icons/icon.ico,
            // tauri 编译期把 ico 嵌进 binary 当 default_window_icon)。
            let tray_icon = app
                .default_window_icon()
                .cloned()
                .ok_or_else(|| {
                    "default_window_icon 不存在 — tauri.conf.json bundle.icon 链丢失?"
                        .to_string()
                })?;
            let _tray = TrayIconBuilder::with_id("main")
                .icon(tray_icon)
                .tooltip("察元 AI")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.unminimize();
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "new_chat" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.unminimize();
                            let _ = w.show();
                            let _ = w.set_focus();
                            let _ = w.emit("cy:new-chat", ());
                        }
                    }
                    "restart" => {
                        // AppHandle::restart 是 divergent(返 !),tauri 内部把
                        // 当前进程替换成新 instance,后面代码不会跑。
                        app.restart();
                    }
                    "about" => {
                        // 非阻塞 message dialog;callback 忽略点击结果。
                        let pkg_ver = app.package_info().version.to_string();
                        app.dialog()
                            .message(format!(
                                "察元 AI · Chayuan AI 桌面单机版\n\
                                 版本:{pkg_ver}\n\
                                 \n\
                                 面向办公场景的离线 AI 助手 — 把 WPS/Office 文档\n\
                                 处理、个人/企业知识库、结构化数据、外部向量库、\n\
                                 多模态资料和本地/服务端模型能力统一起来。\n\
                                 \n\
                                 © Chayuan AI · AGPL-3.0"
                            ))
                            .title("关于 察元 AI")
                            .kind(MessageDialogKind::Info)
                            .show(|_| {});
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // 用户要求:双击图标 → 打开主窗。
                    // 单击不做切换显示/隐藏 — 避免和双击竞争误触(Windows 系统会先派发
                    // Click,250ms 内再派发 DoubleClick);右键菜单 Tauri 内置支持,
                    // 右键即出 menu 不需要 hook。
                    if let TrayIconEvent::DoubleClick { .. } = event {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.unminimize();
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            // ── 拦截 main 关闭:右上角 X → 隐藏到托盘,不退程序 ─────
            // 真退出由托盘菜单"退出"触发(app.exit(0)),或者外部信号 / 任务管理器
            // 强杀。RunEvent::ExitRequested 仍会被走到回收 sidecar。
            if let Some(main) = app.get_webview_window("main") {
                let main_for_close = main.clone();
                main.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = main_for_close.hide();
                    }
                });
            }

            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            // splash 兜底:前端 30s 没 invoke chayuan_close_splashscreen 也强制 show main
            // (异步 import 失败 / sidecar 卡死 / 前端 crash 等极端情况),让用户能看到错误。
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(30));
                if let Some(main) = handle.get_webview_window("main") {
                    if !main.is_visible().unwrap_or(false) {
                        let _ = main.show();
                        let _ = main.set_focus();
                    }
                }
                if let Some(splash) = handle.get_webview_window("splashscreen") {
                    let _ = splash.close();
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // 应用退出前回收 sidecar 子进程,避免留僵尸 Python 进程占数据目录锁。
            if let RunEvent::ExitRequested { .. } = event {
                let mgr = app_handle.state::<Arc<sidecar::SidecarManager>>();
                mgr.kill_on_exit();
            }
        });
}
