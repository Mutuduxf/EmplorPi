use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::fs::OpenOptions;
use std::io::Write;
use tauri::Manager;
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
    if !path.exists() { return Ok(false); }
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
    } else { HashMap::new() };
    auth.insert(provider, ApiKeyCredential { cred_type: "api_key".to_string(), key });
    let json = serde_json::to_string_pretty(&auth).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_app_version() -> String { env!("CARGO_PKG_VERSION").to_string() }

#[tauri::command]
fn open_data_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = data_dir(&app);
    let path_str = dir.to_string_lossy().to_string();
    open_in_explorer(&path_str).map_err(|e| e.to_string())?;
    Ok(())
}

fn debug_log(app: &tauri::AppHandle, msg: &str) {
    let log_path = data_dir(app).join("debug.log");
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&log_path) {
        let _ = writeln!(f, "[{}] {}", std::process::id(), msg);
    }
}

fn open_in_explorer(path: &str) -> Result<(), std::io::Error> {
    let cmd = if cfg!(target_os = "windows") { "explorer" }
    else if cfg!(target_os = "macos") { "open" }
    else { "xdg-open" };
    std::process::Command::new(cmd).arg(path).spawn()?;
    Ok(())
}

// ── send_prompt: collect all events, return structured JSON ──

#[tauri::command]
async fn send_prompt(app: tauri::AppHandle, text: String) -> Result<String, String> {
    debug_log(&app, "send_prompt START");

    let (mut rx, mut child) = app
        .shell()
        .sidecar("agent-sidecar")
        .map_err(|e| { debug_log(&app, &format!("ERR sidecar config: {}", e)); e.to_string() })?
        .args(["--mode", "rpc"])
        .spawn()
        .map_err(|e| { debug_log(&app, &format!("ERR spawn: {}", e)); e.to_string() })?;
    debug_log(&app, "sidecar spawned OK");

    let command = serde_json::json!({"type": "prompt", "message": text, "id": "1"});
    let input = format!("{}\n", serde_json::to_string(&command).map_err(|e| e.to_string())?);
    child.write(input.as_bytes()).map_err(|e| e.to_string())?;
    debug_log(&app, "prompt written to stdin");

    let mut all_output = String::new();
    let mut event_count = 0u32;
    let mut got_assistant_msg = false;
    let mut got_agent_end = false;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(120);

    while !(got_assistant_msg && got_agent_end) {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() { debug_log(&app, "loop END (deadline)"); break; }

        let event = tokio::time::timeout(remaining, rx.recv()).await;
        match event {
            Ok(Some(CommandEvent::Stdout(data))) => {
                let s = String::from_utf8_lossy(&data);
                event_count += 1;
                if event_count <= 5 {
                    debug_log(&app, &format!("event {}: {}", event_count, s.trim().chars().take(120).collect::<String>()));
                }
                all_output.push_str(&s);
                // Track completion
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&s) {
                    match json.get("type").and_then(|t| t.as_str()) {
                        Some("agent_end") => { got_agent_end = true; }
                        Some("message_end") => {
                            if json.get("message").and_then(|m| m.get("role")).and_then(|r| r.as_str()) == Some("assistant") {
                                got_assistant_msg = true;
                            }
                        }
                        _ => {}
                    }
                }
            }
            Ok(Some(CommandEvent::Terminated(_))) => { debug_log(&app, "loop END (terminated)"); break; }
            Ok(None) => { debug_log(&app, "loop END (None)"); break; }
            Ok(_) => {}
            Err(_) => { debug_log(&app, "loop END (timeout)"); break; }
        }
    }
    debug_log(&app, &format!("loop done: got_assistant_msg={}, got_agent_end={}, {} events, {} bytes", got_assistant_msg, got_agent_end, event_count, all_output.len()));

    debug_log(&app, &format!("loop done: {} events, {} bytes", event_count, all_output.len()));
    let _ = child.kill();
    debug_log(&app, "sidecar killed");

    // Extract assistant message content
    let last_assistant_msg = all_output.lines()
        .filter_map(|line| -> Option<serde_json::Value> {
            let json: serde_json::Value = serde_json::from_str(line).ok()?;
            match json.get("type").and_then(|t| t.as_str()) {
                Some("message_end") | Some("message_update") => {}
                _ => { return None; }
            }
            let msg = json.get("message")?;
            if msg.get("role").and_then(|r| r.as_str()) != Some("assistant") { return None; }
            Some(msg.clone())
        })
        .last();

    let result = if let Some(ref msg) = last_assistant_msg {
        extract_content(msg)
    } else {
        // No assistant message at all — show raw events as fallback
        if all_output.is_empty() {
            serde_json::json!({"text": "No response from agent."})
        } else {
            let lines: Vec<&str> = all_output.lines().collect();
            let errors: Vec<String> = lines.iter().filter_map(|l| {
                let json: serde_json::Value = serde_json::from_str(l).ok()?;
                Some(json.get("message")?.get("errorMessage")?.as_str()?.to_string())
            }).collect();
            if !errors.is_empty() {
                serde_json::json!({"text": format!("Agent error: {}", errors.join("\n"))})
            } else {
                serde_json::json!({"text": format!("No assistant response.\nRaw:\n{}", lines.join("\n"))})
            }
        }
    };

    let json = serde_json::to_string(&result).map_err(|e| e.to_string())?;
    debug_log(&app, &format!("returning {} bytes: {:.120}", json.len(), json));
    Ok(json)
}

/// Separate text and thinking blocks from an assistant message.
/// DeepSeek reasoning models put everything in thinking — use it as text fallback.
fn extract_content(msg: &serde_json::Value) -> serde_json::Value {
    let mut text: Vec<String> = Vec::new();
    let mut thinking: Vec<String> = Vec::new();

    if let Some(content) = msg.get("content").and_then(|c| c.as_array()) {
        for block in content {
            match block.get("type").and_then(|t| t.as_str()) {
                Some("text") => {
                    if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                        if !t.is_empty() { text.push(t.to_string()); }
                    }
                }
                Some("thinking") => {
                    if let Some(t) = block.get("thinking").and_then(|t| t.as_str()) {
                        if !t.is_empty() { thinking.push(t.to_string()); }
                    }
                }
                _ => {}
            }
        }
    }

    let text_str = text.join("\n");
    let thinking_str = thinking.join("\n");

    let mut obj = serde_json::Map::new();
    if text_str.is_empty() && !thinking_str.is_empty() {
        // DeepSeek reasoning: no text block, use thinking as the reply
        obj.insert("text".to_string(), serde_json::Value::String(thinking_str));
    } else {
        obj.insert("text".to_string(), serde_json::Value::String(text_str));
        if !thinking_str.is_empty() {
            obj.insert("thinking".to_string(), serde_json::Value::String(thinking_str));
        }
    }
    serde_json::Value::Object(obj)
}

// ── App entry ──

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            check_auth_state, save_api_key, get_app_version, open_data_dir, send_prompt,
        ])
        .setup(|app| {
            let dir = data_dir(&app.handle());
            std::fs::create_dir_all(dir.join("sessions")).expect("failed to create data/sessions directory");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
