//! 单机模式数据目录解析与持久化(Phase 1)。
//!
//! 用户首启动时通过弹窗选择数据目录(``CHAYUAN_ROOT``)。本模块负责:
//!
//! - 计算 OS 默认数据目录(与服务端 ``chayuan.paths.resolve_chayuan_root`` 算法对齐)
//! - 读 / 写持久化配置 ``<config_dir>/chayuan/desktop.json``
//! - 检测某路径下是否已有察元数据(marker / sqlite / data 子目录),用于"沿用旧数据"提示
//! - 暴露 4 个 ``#[tauri::command]`` 给前端 First-Run 向导调用
//!
//! 默认目录(与 ``chayuan/paths.py:APP_NAME = "chayuan"`` 同名,便于已有用户继续使用历史数据):
//!
//! | 平台    | 路径                                              |
//! | :---    | :---                                              |
//! | macOS   | ``~/Library/Application Support/chayuan``         |
//! | Windows | ``%APPDATA%\chayuan``                             |
//! | Linux   | ``$XDG_DATA_HOME/chayuan`` → ``~/.local/share/chayuan`` |
//!
//! 持久化文件位置(独立于数据目录,避免数据目录被切走后丢失指针):
//!
//! | 平台    | 路径                                                                          |
//! | :---    | :---                                                                          |
//! | macOS   | ``~/Library/Application Support/chayuan/desktop.json`` (与数据目录同名根)     |
//! | Windows | ``%APPDATA%\chayuan\desktop.json``                                            |
//! | Linux   | ``$XDG_CONFIG_HOME/chayuan/desktop.json`` → ``~/.config/chayuan/desktop.json`` |

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const APP_DIR_NAME: &str = "chayuan";
const CONFIG_FILE_NAME: &str = "desktop.json";

/// 当前持久化 schema 版本。v2 开始带 linked_install_id;读到 v1 旧文件 +
/// 没字段 → 视为不匹配,fresh wizard。
const PERSIST_SCHEMA_VERSION: u32 = 2;

/// 持久化到 ``desktop.json`` 的最小载荷。
#[derive(Debug, Serialize, Deserialize, Clone)]
struct PersistedConfig {
    /// 用户选择的数据目录绝对路径。
    data_dir: String,
    /// schema 版本,用于将来字段扩展时迁移。
    #[serde(default = "default_version")]
    version: u32,
    /// 这条配置当时绑定的 install ID。卸载重装后 install dir 里的 install_id
    /// 文件没了,首启时会生成新 ID,跟这里对不上就当 fresh install 处理。
    /// v1 旧格式没这字段,反序列化得 None,等同对不上 → 弹向导。
    #[serde(default)]
    linked_install_id: Option<String>,
}

fn default_version() -> u32 {
    PERSIST_SCHEMA_VERSION
}

/// 前端 ``chayuan_data_dir_state`` 返回结构。
#[derive(Debug, Serialize)]
pub struct DataDirState {
    /// 用户是否已经在向导里选过路径(``desktop.json`` 存在且可解析)。
    pub configured: bool,
    /// 当前生效的数据目录:已配置时 = 用户选的;未配置时 = OS 默认。
    pub path: String,
    /// OS 默认数据目录,前端用作 placeholder。
    pub default_path: String,
    /// 配置文件路径(诊断 / "切换数据目录"向导回显用)。
    pub config_file: String,
    /// ``path`` 路径下是否已经存在察元历史数据。``configured=false`` 时也会检测默认路径。
    pub has_existing_data: bool,
}

/// 计算 OS 默认数据目录。优先级:
///
/// 1. 环境变量 ``$CHAYUAN_ROOT`` (允许 ops / 自动化覆盖)
/// 2. Linux:``$XDG_DATA_HOME/chayuan`` (XDG 显式时)
/// 3. ``dirs::data_dir() / chayuan``  (macOS = Application Support;
///    Windows = %APPDATA%;Linux = ~/.local/share)
/// 4. 兜底:``~/.chayuan`` (理论不可达;``dirs`` 在 home 不可用时返回 None)
pub fn default_data_dir() -> PathBuf {
    if let Some(v) = std::env::var_os("CHAYUAN_ROOT") {
        if !v.is_empty() {
            return PathBuf::from(v);
        }
    }

    // Linux 显式 XDG 优先
    #[cfg(target_os = "linux")]
    {
        if let Some(v) = std::env::var_os("XDG_DATA_HOME") {
            let s = v.to_string_lossy();
            if !s.trim().is_empty() {
                return PathBuf::from(s.into_owned()).join(APP_DIR_NAME);
            }
        }
    }

    if let Some(d) = dirs::data_dir() {
        return d.join(APP_DIR_NAME);
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".chayuan")
}

/// ``desktop.json`` 路径(与数据目录解耦,放在用户配置目录下)。
fn config_file_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| {
        dirs::home_dir()
            .map(|h| h.join(".config"))
            .unwrap_or_else(|| PathBuf::from("."))
    });
    base.join(APP_DIR_NAME).join(CONFIG_FILE_NAME)
}

fn read_persisted() -> Option<PersistedConfig> {
    let p = config_file_path();
    let raw = fs::read_to_string(&p).ok()?;
    serde_json::from_str::<PersistedConfig>(&raw).ok()
}

fn write_persisted(cfg: &PersistedConfig) -> Result<(), String> {
    let p = config_file_path();
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create config dir: {e}"))?;
    }
    let body = serde_json::to_string_pretty(cfg).map_err(|e| format!("serialize: {e}"))?;
    fs::write(&p, body).map_err(|e| format!("write {}: {e}", p.display()))?;
    Ok(())
}

/// 拿到当前安装的 install ID — 用 exe 路径 + exe 修改时间 hash 出来。
///
/// 为什么不写文件:MSI 默认装在 ``C:\Program Files\Chayuan\``,用户态进程对
/// install dir 没写权限,fs::write 永远失败 → 每次启动生成不同 ID → 跟
/// desktop.json 对不上 → 每次都弹向导(用户实测撞这条)。
///
/// 改纯**确定性 hash**,无 I/O:
/// - 同一份安装 → 同一个 exe 路径 + 同一个 mtime → 同一个 ID
/// - 卸载重装 → MSI 重新写入 exe → mtime 变 → 新 ID,跟旧 desktop.json 对不上
///   → 弹向导(用户预期行为)
/// - 升级(in-place patch)→ exe 被覆盖 → mtime 变 → 弹向导;这是合理的,
///   升级是个重新确认数据目录的好时机
fn current_install_id() -> Option<String> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let exe = std::env::current_exe().ok()?;
    let meta = fs::metadata(&exe).ok()?;
    let mtime_secs = meta
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();
    let mut h = DefaultHasher::new();
    exe.hash(&mut h);
    mtime_secs.hash(&mut h);
    Some(format!("exe-{:x}", h.finish()))
}

/// 检查路径下是否已有察元历史数据。命中任一即认为存在(顺序大致按可信度):
///
/// * 配置面板写的 marker:``data_dir_marker``
/// * 旧版主库:``chayuan.sqlite`` / ``chayuan_meta.sqlite``
/// * 知识库元数据:``data/knowledge_base/info.db`` (``chayuan.settings`` 默认布局)
/// * 单机版重构后约定的子目录:``vectors/`` / ``files/`` / ``models_cache/``
fn check_has_existing_data(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }
    const FILE_MARKERS: &[&str] = &[
        "data_dir_marker",
        "chayuan.sqlite",
        "chayuan_meta.sqlite",
        "config.toml",
        "data/knowledge_base/info.db",
    ];
    for f in FILE_MARKERS {
        if path.join(f).is_file() {
            return true;
        }
    }
    const DIR_MARKERS: &[&str] = &["vectors", "files", "models_cache", "data"];
    for d in DIR_MARKERS {
        if path.join(d).is_dir() {
            return true;
        }
    }
    false
}

/// 当前生效路径:已选则用 persisted,否则 OS 默认。
///
/// 暂未被 Rust 侧调用(Tauri 命令直接读 ``chayuan_data_dir_state``),
/// 留作通用工具函数,加 ``#[allow(dead_code)]`` 防编译告警。
#[allow(dead_code)]
pub fn effective_data_dir() -> PathBuf {
    read_persisted()
        .map(|c| PathBuf::from(c.data_dir))
        .unwrap_or_else(default_data_dir)
}

#[tauri::command]
pub fn chayuan_data_dir_state() -> DataDirState {
    let default = default_data_dir();
    let persisted = read_persisted();

    // 关键:configured 不能仅看 desktop.json 存不存在,还得看里面的 linked_install_id
    // 跟当前安装的 install ID 是否匹配。重装后 install dir 是全新的(MSI 卸载会清),
    // .chayuan_install_id 文件消失 → 我们生成新 ID → 跟 desktop.json 里旧 ID 对不上
    // → configured=false → 前端 FirstRunSetup 弹向导,让用户重新选/确认数据目录。
    // 老 v1 格式的 desktop.json 没 linked_install_id 字段(反序列化为 None),也走
    // 这条 fresh 路径。
    let cur_install_id = current_install_id();
    let configured = match (persisted.as_ref(), cur_install_id.as_ref()) {
        (Some(p), Some(cur)) => p.linked_install_id.as_deref() == Some(cur.as_str()),
        _ => false,
    };

    let active = if configured {
        persisted
            .as_ref()
            .map(|c| PathBuf::from(&c.data_dir))
            .unwrap_or_else(|| default.clone())
    } else {
        // 不匹配时回显默认路径(向导首屏的 placeholder),不再透露旧 dataDir 误导用户
        default.clone()
    };
    let has_existing = check_has_existing_data(&active);
    DataDirState {
        configured,
        path: active.to_string_lossy().to_string(),
        default_path: default.to_string_lossy().to_string(),
        config_file: config_file_path().to_string_lossy().to_string(),
        has_existing_data: has_existing,
    }
}

/// 探测前端任意候选路径,用于"选择目录"对话框反馈"该目录已有旧数据"。
#[tauri::command]
pub fn chayuan_data_dir_check_existing(path: String) -> bool {
    check_has_existing_data(Path::new(&path))
}

/// 持久化用户选定的数据目录。前端在向导确认后调一次。
///
/// 步骤:
/// 1. ``mkdir -p`` 目标目录(允许选不存在的新目录)
/// 2. 校验路径可写(``touch .chayuan_write_test`` 后删除),失败直接报错给 UI
/// 3. 在数据目录顶层放一个轻量 marker(``data_dir_marker``) ── 下次打开同一目录
///    时 ``has_existing_data`` 命中,UI 提示"沿用现有数据"
/// 4. 写 ``desktop.json``
#[tauri::command]
pub fn chayuan_data_dir_set(path: String) -> Result<DataDirState, String> {
    let dir = PathBuf::from(path.trim());
    if dir.as_os_str().is_empty() {
        return Err("path is empty".into());
    }
    fs::create_dir_all(&dir).map_err(|e| format!("create data dir {}: {e}", dir.display()))?;

    // write probe + marker
    let probe = dir.join(".chayuan_write_test");
    fs::write(&probe, b"ok").map_err(|e| format!("write probe in {}: {e}", dir.display()))?;
    let _ = fs::remove_file(&probe);
    let marker = dir.join("data_dir_marker");
    if !marker.exists() {
        let body = format!(
            "# chayuan data directory marker\n# created by desktop first-run wizard\nschema = {}\n",
            PERSIST_SCHEMA_VERSION
        );
        fs::write(&marker, body)
            .map_err(|e| format!("write marker in {}: {e}", dir.display()))?;
    }

    let cfg = PersistedConfig {
        data_dir: dir.to_string_lossy().to_string(),
        version: PERSIST_SCHEMA_VERSION,
        // 把当前安装的 install ID 一并落盘 — 下次启动 chayuan_data_dir_state 拿
        // install dir 里的 ID 跟这个对比,只有匹配才算 configured;重装后对不上
        // 就回退到 wizard,数据目录的设置不会跨安装"幽灵生效"。
        linked_install_id: current_install_id(),
    };
    write_persisted(&cfg)?;

    Ok(chayuan_data_dir_state())
}

/// 仅返回默认路径(供向导首屏 placeholder)。
#[tauri::command]
pub fn chayuan_data_dir_default() -> String {
    default_data_dir().to_string_lossy().to_string()
}

/// 重置(清空 ``desktop.json``)。仅给"切换数据目录向导"用,**不删除数据本身**。
#[tauri::command]
pub fn chayuan_data_dir_reset() -> Result<(), String> {
    let p = config_file_path();
    if p.exists() {
        fs::remove_file(&p).map_err(|e| format!("remove {}: {e}", p.display()))?;
    }
    Ok(())
}
