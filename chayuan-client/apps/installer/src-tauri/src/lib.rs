use std::io::Write;
use sha2::{Digest, Sha256};
use futures_util::StreamExt;

/// 下载一个组件:按候选源顺序尝试,支持断点续传(Range)+ sha256 校验,落到 dest。
/// [BUILD-VERIFY] 需 Rust 工具链 + 网络;本机不编译,仅形状正确。
#[tauri::command]
async fn download_file(candidates: Vec<String>, dest: String, sha256: Option<String>) -> Result<String, String> {
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
                let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&path)
                    .map_err(|e| e.to_string())?;
                let mut stream = resp.bytes_stream();
                let mut ok = true;
                while let Some(chunk) = stream.next().await {
                    match chunk {
                        Ok(bytes) => { if file.write_all(&bytes).is_err() { ok = false; break; } }
                        Err(e) => { last_err = e.to_string(); ok = false; break; }
                    }
                }
                if ok {
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

/// 拉取归一化清单 —— [BUILD-VERIFY] 真实从 website 取;骨架先返空清单。
#[tauri::command]
async fn fetch_manifest() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({ "version": "0.0.0", "components": [] }))
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![download_file, fetch_manifest])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
