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

// ── Existing prompt command (temporary simplified stub) ──

use tauri_plugin_shell::process::CommandEvent;

#[tauri::command]
async fn send_prompt(app: tauri::AppHandle, text: String) -> Result<String, String> {
    let (mut rx, mut child) = app
        .shell()
        .sidecar("agent-sidecar")
        .map_err(|e| e.to_string())?
        .args(["--mode", "rpc"])
        .spawn()
        .map_err(|e| e.to_string())?;

    // Write the prompt as a JSON-RPC command to stdin
    let command = serde_json::json!({
        "type": "prompt",
        "message": text,
        "id": "1"
    });
    let input = format!("{}\n", serde_json::to_string(&command).map_err(|e| e.to_string())?);
    child.write(input.as_bytes()).map_err(|e| e.to_string())?;

    // Read events with a 120-second timeout on each recv.
    // Keep stdin open so the sidecar doesn't exit before the
    // LLM call finishes.
    let mut response = String::new();
    let mut assistant_received = false;
    let mut saw_agent_end = false;

    while !(assistant_received && saw_agent_end) {
        let event = tokio::time::timeout(
            std::time::Duration::from_secs(120),
            rx.recv(),
        ).await;

        match event {
            Ok(Some(CommandEvent::Stdout(data))) => {
                let line = String::from_utf8_lossy(&data);
                response.push_str(&line);

                // Parse JSON to detect assistant message_end and agent_end
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                    match json.get("type").and_then(|t| t.as_str()) {
                        Some("agent_end") => saw_agent_end = true,
                        Some("message_end") => {
                            if json.get("message").and_then(|m| m.get("role")).and_then(|r| r.as_str()) == Some("assistant") {
                                assistant_received = true;
                            }
                        }
                        _ => {}
                    }
                }
            }
            Ok(Some(CommandEvent::Terminated(_))) => break,
            Ok(None) => break,
            Ok(_) => {}
            Err(_) => {
                // Timeout — append marker and exit loop
                response.push_str("\n[Agent timed out after 120 seconds]\n");
                break;
            }
        }
    }

    // Kill the sidecar since we're done reading
    let _ = child.kill();

    // Extract assistant reply: last assistant message_end with structured content
    let reply = response
        .lines()
        .filter_map(|line| -> Option<serde_json::Value> {
            let json: serde_json::Value = serde_json::from_str(line).ok()?;
            if json.get("type")?.as_str()? != "message_end" { return None; }
            let msg = json.get("message")?;
            if msg.get("role")?.as_str()? != "assistant" { return None; }
            Some(msg.clone())
        })
        .last();

    // Build structured response: separate text, thinking, and error
    let result = if let Some(msg) = reply {
        if let Some(err) = msg.get("errorMessage").and_then(|e| e.as_str()) {
            if !err.is_empty() {
                serde_json::json!({"text": format!("Agent error: {}", err)})
            } else {
                extract_content_blocks(&msg)
            }
        } else {
            extract_content_blocks(&msg)
        }
    } else {
        // No assistant message — check for errors or show raw
        if response.is_empty() {
            serde_json::json!({"text": "No response from agent. The sidecar may have crashed."})
        } else {
            let errors: Vec<String> = response.lines().filter_map(|l| {
                let json: serde_json::Value = serde_json::from_str(l).ok()?;
                Some(json.get("message")?.get("errorMessage")?.as_str()?.to_string())
            }).collect();
            if !errors.is_empty() {
                serde_json::json!({
                    "text": format!("Agent errors:\n{}", errors.join("\n")),
                    "_raw": response
                })
            } else {
                serde_json::json!({
                    "text": "No assistant response received.",
                    "_raw": response
                })
            }
        }
    };

    Ok(serde_json::to_string(&result).map_err(|e| e.to_string())?)
}

/// Extract text and thinking blocks from an assistant message.
fn extract_content_blocks(msg: &serde_json::Value) -> serde_json::Value {
    let mut text_parts: Vec<String> = Vec::new();
    let mut thinking_parts: Vec<String> = Vec::new();

    if let Some(content) = msg.get("content").and_then(|c| c.as_array()) {
        for block in content {
            match block.get("type").and_then(|t| t.as_str()) {
                Some("text") => {
                    if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                        if !t.is_empty() {
                            text_parts.push(t.to_string());
                        }
                    }
                }
                Some("thinking") => {
                    if let Some(t) = block.get("thinking").and_then(|t| t.as_str()) {
                        if !t.is_empty() {
                            thinking_parts.push(t.to_string());
                        }
                    }
                }
                _ => {}
            }
        }
    }

    let mut obj = serde_json::Map::new();
    obj.insert("text".to_string(), serde_json::Value::String(text_parts.join("\n")));
    if !thinking_parts.is_empty() {
        obj.insert("thinking".to_string(), serde_json::Value::String(thinking_parts.join("\n")));
    }
    serde_json::Value::Object(obj)
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
