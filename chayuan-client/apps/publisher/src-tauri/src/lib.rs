use std::sync::OnceLock;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Window};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

fn website_base() -> String {
    std::env::var("CHAYUAN_PUBLISHER_BASE").unwrap_or_else(|_| "https://aidooo.com".to_string())
}

// 带 cookie jar 的全局 client,登录 cookie 自动随后续请求。
fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| reqwest::Client::builder().cookie_store(true).build().unwrap())
}


#[tauri::command]
async fn get_captcha() -> Result<Value, String> {
    let url = format!("{}/api/admin/captcha", website_base());
    let r = client().get(&url).send().await.map_err(|e| e.to_string())?;
    let v: Value = r.json().await.map_err(|e| e.to_string())?;
    Ok(v)
}

#[tauri::command]
async fn login(username: String, password: String, captcha_id: String, captcha_code: String) -> Result<(), String> {
    let url = format!("{}/api/admin/login", website_base());
    let body = json!({ "username": username, "password": password, "captchaId": captcha_id, "captchaCode": captcha_code });
    let r = client().post(&url).json(&body).send().await.map_err(|e| e.to_string())?;
    if r.status().is_success() { Ok(()) } else {
        let code = r.status().as_u16();
        let v: Value = r.json().await.unwrap_or(json!({}));
        Err(format!("{}:{}", code, v.get("error").and_then(|x| x.as_str()).unwrap_or("login_failed")))
    }
}

#[derive(Serialize)]
struct GitInfo { version: String, changelog: String }

#[tauri::command]
async fn read_git_version(repo: String) -> Result<GitInfo, String> {
    // 优先 VERSION 文件
    let vf = std::path::Path::new(&repo).join("VERSION");
    let version = if let Ok(s) = std::fs::read_to_string(&vf) {
        s.trim().to_string()
    } else {
        let out = std::process::Command::new("git").args(["-C", &repo, "describe", "--tags", "--always"]).output()
            .map_err(|e| e.to_string())?;
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    };
    let log = std::process::Command::new("git").args(["-C", &repo, "log", "-n", "20", "--pretty=format:%h %s"]).output()
        .map_err(|e| e.to_string())?;
    let changelog = String::from_utf8_lossy(&log.stdout).to_string();
    Ok(GitInfo { version, changelog })
}

#[derive(Serialize)]
struct ScannedFile { path: String, filename: String, #[serde(rename = "sizeBytes")] size_bytes: u64 }

#[tauri::command]
async fn scan_build_dir(dir: String) -> Result<Vec<ScannedFile>, String> {
    let mut out = vec![];
    let rd = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for e in rd.flatten() {
        let md = match e.metadata() { Ok(m) => m, Err(_) => continue };
        if !md.is_file() { continue; }
        let filename = e.file_name().to_string_lossy().to_string();
        out.push(ScannedFile { path: e.path().to_string_lossy().to_string(), filename, size_bytes: md.len() });
    }
    Ok(out)
}

#[tauri::command]
async fn hash_file(path: String) -> Result<String, String> {
    let mut f = tokio::fs::File::open(&path).await.map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = f.read(&mut buf).await.map_err(|e| e.to_string())?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

// 通用 JSON 请求:init/finalize/publish/set-primary/version/releases。
#[tauri::command]
async fn http_json(method: String, path: String, body: Option<Value>) -> Result<Value, String> {
    let url = format!("{}{}", website_base(), path);
    let c = client();
    let mut req = match method.to_uppercase().as_str() {
        "GET" => c.get(&url), "POST" => c.post(&url), "PATCH" => c.patch(&url), "DELETE" => c.delete(&url),
        m => return Err(format!("unsupported method {}", m)),
    };
    if let Some(b) = body { req = req.json(&b); }
    let r = req.send().await.map_err(|e| e.to_string())?;
    let status = r.status().as_u16();
    let v: Value = r.json().await.unwrap_or(json!({}));
    if (200..300).contains(&status) { Ok(v) } else { Err(format!("{}:{}", status, v)) }
}

// 上传一个文件的指定块集合(续传时只传缺的),每块后 emit upload-progress。
#[tauri::command]
async fn upload_chunks(window: Window, upload_id: String, upload_path: String, file_path: String,
                       chunk_size: u64, total_chunks: u32, indices: Vec<u32>) -> Result<(), String> {
    let base = website_base();
    let url = format!("{}{}/{}/chunk", base, upload_path, upload_id); // upload_path = /api/admin/uploads
    let mut f = tokio::fs::File::open(&file_path).await.map_err(|e| e.to_string())?;
    let total = indices.len();
    for (done, idx) in indices.into_iter().enumerate() {
        let start = idx as u64 * chunk_size;
        f.seek(std::io::SeekFrom::Start(start)).await.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; chunk_size as usize];
        let n = f.read(&mut buf).await.map_err(|e| e.to_string())?;
        buf.truncate(n);
        let r = client().patch(&url)
            .header("X-Chunk-Index", idx.to_string())
            .header("Content-Type", "application/octet-stream")
            .body(buf).send().await.map_err(|e| e.to_string())?;
        if !r.status().is_success() { return Err(format!("chunk {} failed: {}", idx, r.status())); }
        let _ = window.emit("upload-progress", json!({
            "uploadId": upload_id, "received": done + 1, "total": total, "totalChunks": total_chunks,
        }));
    }
    Ok(())
}

#[tauri::command]
async fn write_temp(filename: String, contents: Vec<u8>) -> Result<String, String> {
    let dir = std::env::temp_dir().join("chayuan-publisher");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let p = dir.join(&filename);
    std::fs::write(&p, &contents).map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().to_string())
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_captcha, login, read_git_version, scan_build_dir, hash_file, http_json, upload_chunks, write_temp
        ])
        .run(tauri::generate_context!())
        .expect("error while running publisher");
}
