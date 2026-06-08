use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

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
            cred_type: "api_key".to_string(),
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

// ── Streaming prompt command ──

#[tauri::command]
async fn send_prompt(app: tauri::AppHandle, text: String) -> Result<(), String> {
    let (mut rx, mut child) = app
        .shell()
        .sidecar("agent-sidecar")
        .map_err(|e| e.to_string())?
        .args(["--mode", "rpc"])
        .spawn()
        .map_err(|e| e.to_string())?;

    // Write prompt as JSON-RPC command
    let command = serde_json::json!({
        "type": "prompt",
        "message": text,
        "id": "1"
    });
    let input = format!("{}\n", serde_json::to_string(&command).map_err(|e| e.to_string())?);
    child.write(input.as_bytes()).map_err(|e| e.to_string())?;

    let _ = app.emit("stream:status", "Connected to agent…");

    // Hard 60-second timeout for the ENTIRE prompt.
    // DeepSeek reasoning models output thinking progressively but
    // the actual text response may never arrive as a separate block.
    // The frontend's fallback (thinking-as-text) kicks in after this
    // timeout fires and the invoke returns.
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        async {
            loop {
                match rx.recv().await {
                    Some(CommandEvent::Stdout(data)) => {
                        let line = String::from_utf8_lossy(&data);
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                            stream_sidecar_event(&app, &json);
                        }
                    }
                    Some(CommandEvent::Terminated(_)) => break,
                    None => break,
                    _ => {}
                }
            }
        },
    ).await;

    if result.is_err() {
        let _ = app.emit("stream:error", "Response complete (thinking shown above)");
    }

    let _ = child.kill();
    let _ = app.emit("stream:done", "");
    Ok(())
}

/// Parse a single sidecar stdout JSON line and emit appropriate stream events.
fn stream_sidecar_event(app: &tauri::AppHandle, json: &serde_json::Value) {
    let event_type = match json.get("type").and_then(|t| t.as_str()) {
        Some(t) => t,
        None => return,
    };

    match event_type {
        "message_update" | "message_end" => {
            if let Some(msg) = json.get("message") {
                if msg.get("role").and_then(|r| r.as_str()) != Some("assistant") {
                    return;
                }
                // Forward text and thinking content to the frontend.
                // message_update events contain the FULL accumulated text
                // and thinking, so the frontend replaces (not appends) on
                // each event to avoid duplication.
                if let Some(content) = msg.get("content").and_then(|c| c.as_array()) {
                    for block in content {
                        match block.get("type").and_then(|t| t.as_str()) {
                            Some("text") => {
                                if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                                    if !t.is_empty() {
                                        let _ = app.emit("stream:text", t);
                                    }
                                }
                            }
                            Some("thinking") => {
                                if let Some(t) = block.get("thinking").and_then(|t| t.as_str()) {
                                    if !t.is_empty() {
                                        let _ = app.emit("stream:thinking", t);
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
                // Check for errors
                if let Some(err) = msg.get("errorMessage").and_then(|e| e.as_str()) {
                    if !err.is_empty() {
                        let _ = app.emit("stream:error", err);
                    }
                }
            }
        }
        _ => {}
    }
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
            let dir = data_dir(&app.handle());
            std::fs::create_dir_all(dir.join("sessions"))
                .expect("failed to create data/sessions directory");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
