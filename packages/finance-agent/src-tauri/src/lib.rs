use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

// Persist the session file path across send_prompt calls
static SESSION_FILE: Mutex<Option<String>> = Mutex::new(None);

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

// ── Session management ──

static ABORT_FLAG: AtomicBool = AtomicBool::new(false);
static CURRENT_MODEL: Mutex<Option<String>> = Mutex::new(None);
static SYSTEM_PROMPT: Mutex<Option<String>> = Mutex::new(None);

#[derive(Serialize)]
struct SessionMeta {
    path: String,
    name: String,
    date: String,
    token_count: u32,
    message_count: u32,
    model: String,
}

#[tauri::command]
fn list_sessions(app: tauri::AppHandle) -> Result<Vec<SessionMeta>, String> {
    let sessions_dir = data_dir(&app).join("sessions");
    let mut list = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&sessions_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
                // Read only first 30 lines for performance (header + first messages)
                let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
                let mut name = String::new();
                let mut date = String::new();
                let mut token_count = 0u32;
                let mut message_count = 0u32;
                let mut model = String::new();
                for line in content.lines().take(30) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
                        match json.get("type").and_then(|t| t.as_str()) {
                            Some("session") => {
                                date = json.get("timestamp").and_then(|t| t.as_str()).unwrap_or("").to_string();
                            }
                            Some("model_change") => {
                                if let Some(m) = json.get("modelId").and_then(|m| m.as_str()) {
                                    model = format!("{}/{}", json.get("provider").and_then(|p| p.as_str()).unwrap_or("?"), m);
                                }
                            }
                            Some("message") => {
                                message_count += 1;
                                if name.is_empty() {
                                    if let Some(text) = json.get("message").and_then(|m| m.get("content")).and_then(|c| c.get(0)).and_then(|b| b.get("text")).and_then(|t| t.as_str()) {
                                        name = text.chars().take(50).collect();
                                    }
                                }
                                if let Some(usage) = json.get("message").and_then(|m| m.get("usage")) {
                                    if let Some(t) = usage.get("totalTokens").and_then(|t| t.as_u64()) {
                                        token_count += t as u32;
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
                list.push(SessionMeta {
                    path: path.to_string_lossy().to_string(),
                    name: if name.is_empty() { "Untitled".to_string() } else { name },
                    date,
                    token_count,
                    message_count,
                    model,
                });
            }
        }
    }
    list.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(list)
}

#[tauri::command]
fn delete_session(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_session(path: String, name: String) -> Result<(), String> {
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
    if let Some(first) = lines.first_mut() {
        if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(first) {
            if let Some(obj) = json.as_object_mut() {
                obj.insert("name".to_string(), serde_json::Value::String(name));
                *first = serde_json::to_string(&json).map_err(|e| e.to_string())?;
            }
        }
    }
    std::fs::write(&path, lines.join("\n")).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_session(path: String, format: String) -> Result<String, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut plain = String::new();
    let mut md = String::new();
    let mut html_parts: Vec<String> = Vec::new();
    html_parts.push("<!DOCTYPE html><html><head><meta charset='utf-8'><title>Chat Export</title><style>body{font-family:system-ui;max-width:800px;margin:auto;padding:20px}.msg{margin:12px 0;padding:12px;border-radius:8px}.user{background:#e3f2fd}.assistant{background:#f5f5f5}</style></head><body>".to_string());
    for line in content.lines() {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            if json.get("type").and_then(|t| t.as_str()) != Some("message") { continue; }
            let role = json.get("message").and_then(|m| m.get("role")).and_then(|r| r.as_str()).unwrap_or("");
            let text = json.get("message").and_then(|m| m.get("content")).and_then(|c| c.as_array())
                .and_then(|arr| arr.iter().find(|b| b.get("type").and_then(|t| t.as_str()) == Some("text")))
                .and_then(|b| b.get("text")).and_then(|t| t.as_str()).unwrap_or("");
            plain.push_str(&format!("[{}]: {}\n---\n", role, text));
            md.push_str(&format!("**{}**: {}\n\n", role, text));
            html_parts.push(format!("<div class='msg {}'><strong>{}</strong><br>{}</div>", role, role, text));
        }
    }
    html_parts.push("</body></html>".to_string());
    match format.as_str() {
        "txt" => Ok(plain),
        "md" => Ok(md),
        "html" => Ok(html_parts.join("\n")),
        _ => Err("Invalid format. Use txt, md, or html.".to_string()),
    }
}

#[tauri::command]
fn switch_model(provider: String, model_id: String) -> Result<(), String> {
    *CURRENT_MODEL.lock().unwrap() = Some(format!("{}/{}", provider, model_id));
    Ok(())
}

#[tauri::command]
fn get_current_model() -> Result<Option<String>, String> {
    Ok(CURRENT_MODEL.lock().unwrap().clone())
}

fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    data_dir(app).join("settings.json")
}

#[derive(Serialize, Deserialize)]
struct AppSettings {
    language: Option<String>,
    theme: Option<String>,
    last_session_path: Option<String>,
    last_model: Option<String>,
    system_prompt: Option<String>,
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<String, String> {
    let path = settings_path(&app);
    if path.exists() {
        std::fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok("{}".to_string())
    }
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let path = settings_path(&app);
    // Parse to validate, then write
    let _: AppSettings = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    std::fs::write(&path, &json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_system_prompt(prompt: String) -> Result<(), String> {
    *SYSTEM_PROMPT.lock().unwrap() = Some(prompt);
    Ok(())
}

#[tauri::command]
fn get_system_prompt() -> Result<Option<String>, String> {
    Ok(SYSTEM_PROMPT.lock().unwrap().clone())
}

#[tauri::command]
fn abort_prompt() -> Result<(), String> {
    ABORT_FLAG.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn csv_to_excel(csv_path: String, xlsx_path: String) -> Result<(), String> {
    let csv_content = std::fs::read_to_string(&csv_path).map_err(|e| e.to_string())?;
    let mut workbook = rust_xlsxwriter::Workbook::new();
    let worksheet = workbook.add_worksheet();
    
    for (row, line) in csv_content.lines().enumerate() {
        for (col, value) in line.split(',').enumerate() {
            worksheet.write(row as u32, col as u16, value.trim()).map_err(|e| e.to_string())?;
        }
    }
    
    workbook.save(&xlsx_path).map_err(|e| e.to_string())?;
    Ok(())
}

// ── send_prompt: collect all events, return structured JSON ──

#[tauri::command]
async fn send_prompt(app: tauri::AppHandle, text: String) -> Result<String, String> {
    debug_log(&app, "send_prompt START");
    ABORT_FLAG.store(false, Ordering::SeqCst);

    // Use persistent session file across calls
    let mut cmd = app.shell().sidecar("agent-sidecar")
        .map_err(|e| { debug_log(&app, &format!("ERR sidecar config: {}", e)); e.to_string() })?
        .args(["--mode", "rpc"]);

    if let Some(sf) = SESSION_FILE.lock().unwrap().as_ref() {
        cmd = cmd.args(["--session", sf]);
        debug_log(&app, &format!("resuming session: {}", sf));
    }

    // Enable read/grep/write tools
    cmd = cmd.args(["--allow-tools", "read,grep,write"]);

    // Pass custom system prompt if set
    if let Some(sp) = SYSTEM_PROMPT.lock().unwrap().as_ref() {
        cmd = cmd.args(["--system-prompt", sp]);
    }

    let (mut rx, mut child) = cmd.spawn()
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
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(60);

    while !(got_assistant_msg && got_agent_end) {
        if ABORT_FLAG.load(Ordering::SeqCst) {
            debug_log(&app, "abort flag set, breaking");
            break;
        }
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() { debug_log(&app, "loop END (deadline)"); break; }

        let event = tokio::time::timeout(remaining, rx.recv()).await;
        match event {
            Ok(Some(CommandEvent::Stdout(data))) => {
                let s = String::from_utf8_lossy(&data);
                event_count += 1;
                if event_count <= 3 {
                    debug_log(&app, &format!("event {}: {:.120}", event_count, s.trim()));
                }
                all_output.push_str(&s);
                // Track completion and stream updates
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&s) {
                    match json.get("type").and_then(|t| t.as_str()) {
                        Some("agent_end") => { got_agent_end = true; }
                        Some("message_end") | Some("message_update") => {
                            if json.get("message").and_then(|m| m.get("role")).and_then(|r| r.as_str()) == Some("assistant") {
                                if let Some(msg) = json.get("message") {
                                    let content = extract_content(msg);
                                    let _ = app.emit("stream:update", content.to_string());
                                }
                                if json.get("type").and_then(|t| t.as_str()) == Some("message_end") {
                                    got_assistant_msg = true;
                                }
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
    let _ = child.kill();
    debug_log(&app, "sidecar killed");

    // Save session file path for conversation continuity
    if SESSION_FILE.lock().unwrap().is_none() {
        let sessions_dir = data_dir(&app).join("sessions");
        if let Ok(entries) = std::fs::read_dir(&sessions_dir) {
            let newest = entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().extension().map(|x| x == "jsonl").unwrap_or(false))
                .max_by_key(|e| std::fs::metadata(e.path()).and_then(|m| m.modified()).ok());
            if let Some(entry) = newest {
                let path = entry.path().to_string_lossy().to_string();
                *SESSION_FILE.lock().unwrap() = Some(path);
                debug_log(&app, &format!("saved session file"));
            }
        }
    }

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
    debug_log(&app, &format!("returning {} bytes", json.len()));
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
            check_auth_state, save_api_key, get_app_version, open_data_dir,
            send_prompt, list_sessions, delete_session, rename_session,
            export_session, switch_model, get_current_model,
            set_system_prompt, get_system_prompt,
            get_settings, save_settings,
            abort_prompt, csv_to_excel,
        ])
        .setup(|app| {
            let dir = data_dir(&app.handle());
            std::fs::create_dir_all(dir.join("sessions")).expect("failed to create data/sessions directory");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
