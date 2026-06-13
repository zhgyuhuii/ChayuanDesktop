use std::io::Write;
use sha2::{Digest, Sha256};
use futures_util::StreamExt;
use tauri::Emitter;

/// 下载一个组件:按候选源顺序尝试,支持断点续传(Range)+ sha256 校验,落到 dest。
/// [BUILD-VERIFY] 需 Rust 工具链 + 网络;本机不编译,仅形状正确。
#[tauri::command]
async fn download_file(window: tauri::Window, candidates: Vec<String>, dest: String, sha256: Option<String>) -> Result<String, String> {
    let path = std::path::PathBuf::from(&dest);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let already = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let client = reqwest::Client::new();
    let mut last_err = String::from("no candidates");
    for url in &candidates {
        let req = client.get(url).header("Range", format!("bytes={}-", already));
        match req.send().await {
            Ok(resp) => {
                // 总大小 = 续传起点 + 本次 Content-Length(服务端不给则 None)
                let total: Option<u64> = resp.content_length().map(|c| c + already);
                let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&path)
                    .map_err(|e| e.to_string())?;
                let mut stream = resp.bytes_stream();
                let mut ok = true;
                let mut received: u64 = already;
                let mut last_emit: u64 = already;
                while let Some(chunk) = stream.next().await {
                    match chunk {
                        Ok(bytes) => {
                            if file.write_all(&bytes).is_err() { ok = false; break; }
                            received += bytes.len() as u64;
                            // 节流:每 ~1MB 推一次进度,避免事件风暴
                            if received - last_emit >= 1_048_576 {
                                last_emit = received;
                                let _ = window.emit("download-progress", serde_json::json!({
                                    "dest": dest, "received": received, "total": total
                                }));
                            }
                        }
                        Err(e) => { last_err = e.to_string(); ok = false; break; }
                    }
                }
                if ok {
                    let _ = window.emit("download-progress", serde_json::json!({
                        "dest": dest, "received": received, "total": total.or(Some(received))
                    }));
                    if let Some(expected) = &sha256 {
                        let actual = sha256_of(&path).map_err(|e| e.to_string())?;
                        if !actual.eq_ignore_ascii_case(expected) {
                            return Err(format!("sha256 mismatch: {} != {}", actual, expected));
                        }
                    }
                    return Ok(dest);
                }
            }
            Err(e) => { last_err = e.to_string(); }
        }
    }
    Err(last_err)
}

fn sha256_of(path: &std::path::Path) -> std::io::Result<String> {
    let mut hasher = Sha256::new();
    let mut f = std::fs::File::open(path)?;
    std::io::copy(&mut f, &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()))
}

/// 把 staging 目录打成自解压安装包。
/// [BUILD-VERIFY] 真打包需目标平台 makeself / 7z 自解压头;本骨架用 tar.gz + shell 自解压头(Linux/mac)。
#[tauri::command]
async fn build_installer(staging_dir: String, out_path: String, tier: String, os: String) -> Result<String, String> {
    use std::process::Command;
    let staging = std::path::Path::new(&staging_dir);
    if !staging.is_dir() {
        return Err(format!("staging 不存在: {}", staging_dir));
    }
    // [BUILD-VERIFY] Linux/mac:tar 打包 + 拼 shell 自解压头;Windows 待接 7z SFX。
    if os == "win" {
        return Err("windows 自解压制包待接 7z SFX [BUILD-VERIFY]".into());
    }
    let tar_tmp = format!("{}.tar.gz", out_path);
    let status = Command::new("tar")
        .args(["-czf", &tar_tmp, "-C", &staging_dir, "."])
        .status()
        .map_err(|e| format!("tar 失败: {}", e))?;
    if !status.success() {
        return Err("tar 退出码非 0".into());
    }
    // 自解压头:解压到 $1(默认 ./chayuan-<tier>)后跑 install.sh
    let stub = format!(
        "#!/bin/sh\nset -e\nDEST=\"${{1:-./chayuan-{tier}}}\"\nmkdir -p \"$DEST\"\nARCHIVE_LINE=$(awk '/^__ARCHIVE__/ {{print NR + 1; exit 0}}' \"$0\")\ntail -n +$ARCHIVE_LINE \"$0\" | tar -xzf - -C \"$DEST\"\n[ -f \"$DEST/install.sh\" ] && sh \"$DEST/install.sh\"\nexit 0\n__ARCHIVE__\n",
        tier = tier
    );
    // 拼 stub + tar 内容 → out_path
    let mut out = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
    use std::io::Write;
    out.write_all(stub.as_bytes()).map_err(|e| e.to_string())?;
    let tar_bytes = std::fs::read(&tar_tmp).map_err(|e| e.to_string())?;
    out.write_all(&tar_bytes).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&tar_tmp);
    Ok(out_path)
}

/// website 基址:env CHAYUAN_WEBSITE_BASE 覆盖,默认官网。
fn website_base() -> String {
    std::env::var("CHAYUAN_WEBSITE_BASE")
        .unwrap_or_else(|_| "https://aidooo.com".to_string())
        .trim_end_matches('/')
        .to_string()
}

async fn get_json(url: &str) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} from {}", resp.status(), url));
    }
    let text = resp.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str::<serde_json::Value>(&text).map_err(|e| format!("非法 JSON: {}", e))
}

/// 拉取下载构建器清单(GET {base}/api/installer/manifest)。前端拿到后 validateManifest + resolveComponents。
/// [BUILD-VERIFY] 需 Rust 工具链 + 网络;形状正确,真实编译/联网未在本机验证。
#[tauri::command]
async fn fetch_manifest() -> Result<serde_json::Value, String> {
    get_json(&format!("{}/api/installer/manifest", website_base())).await
}

/// 应用更新:把已下载校验过的新包原子替换到目标路径(先写 .new 再 rename)。
/// [BUILD-VERIFY] 真替换运行中安装需平台细节(Windows 文件占用 → 重启替换);本骨架做原子 rename。
#[tauri::command]
async fn apply_update(downloaded_path: String, target_path: String) -> Result<String, String> {
    let src = std::path::Path::new(&downloaded_path);
    if !src.is_file() {
        return Err(format!("下载文件不存在: {}", downloaded_path));
    }
    let tmp = format!("{}.new", target_path);
    std::fs::copy(&downloaded_path, &tmp).map_err(|e| format!("写临时文件失败: {}", e))?;
    // 原子替换:rename 覆盖(同盘原子)。Windows 上目标被占用会失败 → [BUILD-VERIFY] 退重启替换。
    std::fs::rename(&tmp, &target_path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("原子替换失败(可能文件占用,需重启替换): {}", e)
    })?;
    Ok(target_path)
}

/// 拉 website 版本信息(GET {base}/api/version/{product})。decideUpdate 消费它判断是否有新版。
/// [BUILD-VERIFY] 需 Rust 工具链 + 网络;真实编译/联网未在本机验证。
#[tauri::command]
async fn fetch_version(product: String) -> Result<serde_json::Value, String> {
    get_json(&format!("{}/api/version/{}", website_base(), product)).await
}

/// 解包下载好的归档到 dest 目录。kind=component.unpack:none/tar.gz/tgz/zip 等。
/// 用系统 tar(tar -xf 自动识别 gz;mac/Win10+ 的 bsdtar 还能解 zip),Linux 的 zip 退 unzip。
/// [BUILD-VERIFY] 需 Rust + 目标平台 tar/unzip;沙箱不编译。
#[tauri::command]
async fn unpack_archive(archive: String, dest: String, kind: String) -> Result<String, String> {
    use std::process::Command;
    let k = kind.to_lowercase();
    if k.is_empty() || k == "none" {
        return Ok(dest); // 不需解压(调用方已下载到 dest)
    }
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let status = if k.contains("zip") {
        match Command::new("tar").args(["-xf", &archive, "-C", &dest]).status() {
            Ok(st) if st.success() => st,
            _ => Command::new("unzip").args(["-o", &archive, "-d", &dest]).status()
                .map_err(|e| format!("解压 zip 失败(无 tar/unzip): {}", e))?,
        }
    } else {
        Command::new("tar").args(["-xf", &archive, "-C", &dest]).status()
            .map_err(|e| format!("解压失败: {}", e))?
    };
    if !status.success() {
        return Err(format!("解压退出码非 0(kind={})", kind));
    }
    Ok(dest)
}

/// 读已装版本:exe 同级目录的 installer-manifest.json / version.json 里的 version。
/// [BUILD-VERIFY] 真实安装布局以打包为准;读不到返错,前端回落默认版本。
#[tauri::command]
fn read_installed_version() -> Result<String, String> {
    let base = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    for name in ["installer-manifest.json", "version.json"] {
        let p = base.join(name);
        if let Ok(text) = std::fs::read_to_string(&p) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(ver) = v.get("version").and_then(|x| x.as_str()) {
                    return Ok(ver.to_string());
                }
            }
        }
    }
    Err("未找到已装版本文件".into())
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![download_file, fetch_manifest, build_installer, apply_update, fetch_version, unpack_archive, read_installed_version])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
