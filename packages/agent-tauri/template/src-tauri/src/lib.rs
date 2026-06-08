use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

// ── Auth storage (matches agent-base's auth.json format) ──

#[derive(Serialize, Deserialize)]
struct ApiKeyCredential {
    #[serde(rename = "type")]
    cred_type: String,
    key: String,
}

type AuthData = HashMap<String, ApiKeyCredential>;

fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("data")
}

fn auth_path(app: &tauri::AppHandle) -> PathBuf {
    data_dir(app).join("auth.json")
}

// ── Auth commands ──

#[tauri::command]
fn check_auth_state(app: tauri::AppHandle) -> Result<bool, String> {
    let path = auth_path(&app);
    if !path.exists() {
        return Ok(false);
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let auth: AuthData = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(auth.values().any(|c| !c.key.is_empty()))
}

#[tauri::command]
fn save_api_key(app: tauri::AppHandle, provider: String, key: String) -> Result<(), String> {
    let dir = data_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let path = auth_path(&app);
    let mut auth: AuthData = if path.exists() {
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        HashMap::new()
    };

    auth.insert(
        provider,
        ApiKeyCredential {
            cred_type: "apiKey".to_string(),
            key,
        },
    );

    let json = serde_json::to_string_pretty(&auth).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Menu commands ──

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn open_data_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = data_dir(&app);
    let path_str = dir.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(&path_str)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path_str)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&path_str)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ── Existing prompt command (temporary simplified stub) ──

#[tauri::command]
async fn send_prompt(app: tauri::AppHandle, _text: String) -> Result<String, String> {
    let sidecar = app
        .shell()
        .sidecar("agent-sidecar")
        .map_err(|e| e.to_string())?
        .args(["--mode", "rpc"]);

    // TODO: proper stdin/stdout streaming with JSON lines protocol
    let output = sidecar.output().await.map_err(|e| e.to_string())?;
    let response = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(response)
}

// ── App entry ──

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            check_auth_state,
            save_api_key,
            get_app_version,
            open_data_dir,
            send_prompt,
        ])
        .setup(|app| {
            let dir = data_dir(app);
            std::fs::create_dir_all(dir.join("sessions"))
                .expect("failed to create data/sessions directory");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
