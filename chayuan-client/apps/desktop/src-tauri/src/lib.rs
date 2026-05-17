use std::io::Cursor;
use std::sync::Arc;

use sha2::{Digest, Sha256};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, RunEvent,
};

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
        .invoke_handler(tauri::generate_handler![
            chayuan_vault_password,
            chayuan_tray_set_menu,
            chayuan_tray_set_tooltip,
            chayuan_screenshot,
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
            // 三项菜单：打开主窗口 / 切换显示 / 退出
            let show = MenuItem::with_id(app, "show", "打开察元 AI", true, None::<&str>)?;
            let new_chat = MenuItem::with_id(app, "new_chat", "新对话", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &new_chat, &quit])?;

            let _tray = TrayIconBuilder::with_id("main")
                .tooltip("察元 AI")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "new_chat" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                            let _ = w.emit("cy:new-chat", ());
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let visible = w.is_visible().unwrap_or(false);
                            if visible {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

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
