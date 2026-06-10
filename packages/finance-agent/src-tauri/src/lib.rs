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

static SESSION_FILE: Mutex<Option<String>> = Mutex::new(None);
static ABORT_FLAG: AtomicBool = AtomicBool::new(false);
static CURRENT_MODEL: Mutex<Option<String>> = Mutex::new(None);
static SYSTEM_PROMPT: Mutex<Option<String>> = Mutex::new(None);

#[derive(Serialize, Deserialize)]
struct ApiKeyCredential { #[serde(rename = "type")] cred_type: String, key: String }
type AuthData = HashMap<String, ApiKeyCredential>;

fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path().resource_dir().unwrap_or_else(|_| PathBuf::from(".")).join("data")
}
fn auth_path(app: &tauri::AppHandle) -> PathBuf { data_dir(app).join("auth.json") }

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
    open_in_explorer(&dir.to_string_lossy()).map_err(|e| e.to_string())
}
fn open_in_explorer(path: &str) -> Result<(), std::io::Error> {
    let cmd = if cfg!(target_os = "windows") { "explorer" } else if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    std::process::Command::new(cmd).arg(path).spawn()?; Ok(())
}

fn debug_log(app: &tauri::AppHandle, msg: &str) {
    let log_path = data_dir(app).join("debug.log");
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&log_path) {
        let _ = writeln!(f, "[{}] {}", std::process::id(), msg);
    }
}

#[derive(Serialize)]
struct SessionMeta {
    path: String, name: String, date: String, token_count: u32, message_count: u32, model: String,
}

#[tauri::command]
fn list_sessions(app: tauri::AppHandle) -> Result<Vec<SessionMeta>, String> {
    let sessions_dir = data_dir(&app).join("sessions");
    let mut list = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&sessions_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
                let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
                let mut name = String::new(); let mut date = String::new();
                let mut token_count = 0u32; let mut message_count = 0u32; let mut model = String::new();
                for line in content.lines().take(30) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
                        match json.get("type").and_then(|t| t.as_str()) {
                            Some("session") => { date = json.get("timestamp").and_then(|t| t.as_str()).unwrap_or("").to_string(); }
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
                                    if let Some(t) = usage.get("totalTokens").and_then(|t| t.as_u64()) { token_count += t as u32; }
                                }
                            }
                            _ => {}
                        }
                    }
                }
                list.push(SessionMeta {
                    path: path.to_string_lossy().to_string(),
                    name: if name.is_empty() { "Untitled".to_string() } else { name },
                    date, token_count, message_count, model,
                });
            }
        }
    }
    list.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(list)
}

#[tauri::command]
fn delete_session(path: String) -> Result<(), String> { std::fs::remove_file(&path).map_err(|e| e.to_string()) }

#[tauri::command]
fn rename_session(path: String, name: String) -> Result<(), String> {
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
    if let Some(first) = lines.first_mut() {
        if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(first) {
            if let Some(obj) = json.as_object_mut() { obj.insert("name".to_string(), serde_json::Value::String(name)); }
            *first = serde_json::to_string(&json).map_err(|e| e.to_string())?;
        }
    }
    std::fs::write(&path, lines.join("\n")).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_session(path: String, format: String) -> Result<String, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut plain = String::new(); let mut md = String::new(); let mut html = String::from("<!DOCTYPE html><html><meta charset='utf-8'><title>Export</title><body>");
    for line in content.lines() {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            if json.get("type").and_then(|t| t.as_str()) != Some("message") { continue; }
            let role = json.get("message").and_then(|m| m.get("role")).and_then(|r| r.as_str()).unwrap_or("");
            let text = json.get("message").and_then(|m| m.get("content")).and_then(|c| c.as_array())
                .and_then(|arr| arr.iter().find(|b| b.get("type").and_then(|t| t.as_str()) == Some("text")))
                .and_then(|b| b.get("text")).and_then(|t| t.as_str()).unwrap_or("");
            plain.push_str(&format!("[{}]: {}\n---\n", role, text));
            md.push_str(&format!("**{}**: {}\n\n", role, text));
            html.push_str(&format!("<div class='msg'><b>{}</b><br>{}</div>", role, text));
        }
    }
    html.push_str("</body></html>");
    match format.as_str() { "txt" => Ok(plain), "md" => Ok(md), "html" => Ok(html), _ => Err("Invalid format".to_string()) }
}

#[derive(Serialize)]
struct AvailableModel {
    provider: String,
    model_id: String,
    name: String,
}

#[tauri::command]
fn list_available_models(app: tauri::AppHandle) -> Result<Vec<AvailableModel>, String> {
    // Read auth keys to know which providers are configured
    let auth_path = auth_path(&app);
    let configured_providers: std::collections::HashSet<String> = if auth_path.exists() {
        let content = std::fs::read_to_string(&auth_path).map_err(|e| e.to_string())?;
        let auth: AuthData = serde_json::from_str(&content).unwrap_or_default();
        auth.into_keys().collect()
    } else { std::collections::HashSet::new() };

    // Read models.json (generated by sidecar) to get model details
    let models_path = data_dir(&app).join("models.json");
    let all_models: Vec<serde_json::Value> = if models_path.exists() {
        let content = std::fs::read_to_string(&models_path).map_err(|e| e.to_string())?;
        let registry: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
        registry.get("models").and_then(|m| m.as_array()).cloned().unwrap_or_default()
    } else { Vec::new() };

    // Fallback: hardcoded model list when models.json not yet generated
    let fallback_models = vec![
        ("anthropic", "claude-sonnet-4-20250514", "Claude Sonnet 4"),
        ("anthropic", "claude-opus-4-5", "Claude Opus 4.5"),
        ("anthropic", "claude-haiku-3-5", "Claude Haiku 3.5"),
        ("deepseek", "deepseek-v4-pro", "DeepSeek V4 Pro"),
        ("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash"),
        ("openai", "gpt-4o", "GPT-4o"),
        ("google", "gemini-2.0-flash", "Gemini 2.0 Flash"),
        ("mistral", "mistral-large-latest", "Mistral Large"),
        ("groq", "llama-3.3-70b-versatile", "Llama 3.3 70B"),
        ("openrouter", "auto", "OpenRouter Auto"),
    ];

    let mut result = Vec::new();

    // Try models.json first
    if !all_models.is_empty() {
        for m in &all_models {
            if let (Some(prov), Some(id)) = (
                m.get("provider").and_then(|p| p.as_str()),
                m.get("id").and_then(|i| i.as_str()),
            ) {
                if configured_providers.contains(prov) || configured_providers.is_empty() {
                    let name = m.get("name").and_then(|n| n.as_str()).unwrap_or(id);
                    result.push(AvailableModel {
                        provider: prov.to_string(),
                        model_id: id.to_string(),
                        name: name.to_string(),
                    });
                }
            }
        }
    }

    // Fallback: use hardcoded list filtered by configured providers
    if result.is_empty() {
        for (prov, id, name) in &fallback_models {
            if configured_providers.contains(*prov) || configured_providers.is_empty() {
                result.push(AvailableModel {
                    provider: prov.to_string(),
                    model_id: id.to_string(),
                    name: name.to_string(),
                });
            }
        }
    }

    Ok(result)
}

#[tauri::command]
fn load_session_messages(path: String) -> Result<Vec<serde_json::Value>, String> {
    if !std::path::Path::new(&path).exists() { return Ok(Vec::new()); }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut messages = Vec::new();
    for line in content.lines() {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            if json.get("type").and_then(|t| t.as_str()) == Some("message") {
                if let Some(msg) = json.get("message") {
                    messages.push(msg.clone());
                }
            }
        }
    }
    Ok(messages)
}

#[tauri::command]
fn switch_model(provider: String, model_id: String) -> Result<(), String> {
    *CURRENT_MODEL.lock().unwrap() = Some(format!("{}/{}", provider, model_id));
    // Also save to settings so model persists across app restarts
    Ok(())
}

#[tauri::command]
fn get_current_model() -> Result<Option<String>, String> { Ok(CURRENT_MODEL.lock().unwrap().clone()) }

fn settings_path(app: &tauri::AppHandle) -> PathBuf { data_dir(app).join("settings.json") }

#[derive(Serialize, Deserialize)]
struct AppSettings { language: Option<String>, theme: Option<String>, last_session_path: Option<String>, last_model: Option<String>, system_prompt: Option<String> }

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<String, String> {
    let path = settings_path(&app);
    if path.exists() { std::fs::read_to_string(&path).map_err(|e| e.to_string()) } else { Ok("{}".to_string()) }
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let _: AppSettings = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(&app), &json).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_session_path() -> Result<Option<String>, String> { Ok(SESSION_FILE.lock().unwrap().clone()) }

#[tauri::command]
fn save_export(app: tauri::AppHandle, content: String, filename: String) -> Result<String, String> {
    let dir = data_dir(&app).join("exports");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&filename);
    std::fs::write(&path, &content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn set_system_prompt(prompt: String) -> Result<(), String> { *SYSTEM_PROMPT.lock().unwrap() = Some(prompt); Ok(()) }
#[tauri::command]
fn get_system_prompt() -> Result<Option<String>, String> { Ok(SYSTEM_PROMPT.lock().unwrap().clone()) }
#[tauri::command]
fn abort_prompt() -> Result<(), String> { ABORT_FLAG.store(true, Ordering::SeqCst); Ok(()) }

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

#[tauri::command]
async fn send_prompt(app: tauri::AppHandle, text: String) -> Result<String, String> {
    debug_log(&app, "send_prompt START");
    ABORT_FLAG.store(false, Ordering::SeqCst);

    let mut cmd = app.shell().sidecar("agent-sidecar")
        .map_err(|e| { debug_log(&app, &format!("ERR sidecar config: {}", e)); e.to_string() })?
        .args(["--mode", "rpc"]);

    let session_path = SESSION_FILE.lock().unwrap().clone();
    if let Some(ref sf) = session_path {
        let clean = sf.trim_start_matches(r"\\?\");
        cmd = cmd.args(["--session", clean]);
        debug_log(&app, &format!("resuming session: {}", clean));
    } else { debug_log(&app, "no session file yet, will create new"); }

    cmd = cmd.args(["--allow-tools", "read,grep,write"]);

    if let Some(sp) = SYSTEM_PROMPT.lock().unwrap().as_ref() {
        cmd = cmd.args(["--system-prompt", sp]);
    }

    if let Some(ref m) = CURRENT_MODEL.lock().unwrap().clone() {
        cmd = cmd.args(["--model", m]);
        debug_log(&app, &format!("using model: {}", m));
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
        if ABORT_FLAG.load(Ordering::SeqCst) { debug_log(&app, "abort flag set"); break; }
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() { debug_log(&app, "loop END (deadline)"); break; }
        let event = tokio::time::timeout(remaining, rx.recv()).await;
        match event {
            Ok(Some(CommandEvent::Stdout(data))) => {
                let s = String::from_utf8_lossy(&data);
                event_count += 1;
                if event_count <= 3 { debug_log(&app, &format!("event {}: {:.120}", event_count, s.trim())); }
                all_output.push_str(&s);
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&s) {
                    match json.get("type").and_then(|t| t.as_str()) {
                        Some("agent_end") => { got_agent_end = true; }
                        Some("message_end") | Some("message_update") => {
                            if json.get("message").and_then(|m| m.get("role")).and_then(|r| r.as_str()) == Some("assistant") {
                                if let Some(msg) = json.get("message") {
                                    let content = extract_content(msg);
                                    let _ = app.emit("stream:update", content.to_string());
                                }
                                if json.get("type").and_then(|t| t.as_str()) == Some("message_end") { got_assistant_msg = true; }
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
    debug_log(&app, &format!("loop done: {} events, {} bytes", event_count, all_output.len()));
    let _ = child.kill(); debug_log(&app, "sidecar killed");

    if SESSION_FILE.lock().unwrap().is_none() {
        let sessions_dir = data_dir(&app).join("sessions");
        if let Ok(entries) = std::fs::read_dir(&sessions_dir) {
            if let Some(entry) = entries.filter_map(|e| e.ok())
                .filter(|e| e.path().extension().map(|x| x == "jsonl").unwrap_or(false))
                .max_by_key(|e| std::fs::metadata(e.path()).and_then(|m| m.modified()).ok())
            {
                *SESSION_FILE.lock().unwrap() = Some(entry.path().to_string_lossy().to_string());
                debug_log(&app, "saved session file");
            }
        }
    }

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
        if ABORT_FLAG.load(Ordering::SeqCst) {
            serde_json::json!({"text": "Generation stopped."})
        } else if all_output.is_empty() {
            serde_json::json!({"text": "No response from agent."})
        } else {
            let lines: Vec<&str> = all_output.lines().collect();
            let errors: Vec<String> = lines.iter().filter_map(|l| {
                let json: serde_json::Value = serde_json::from_str(l).ok()?;
                Some(json.get("message")?.get("errorMessage")?.as_str()?.to_string())
            }).collect();
            if !errors.is_empty() {
                serde_json::json!({"text": format!("Agent error: {}", errors.join("\n"))})
            } else if lines.iter().any(|l| l.contains("assistant")) {
                serde_json::json!({"text": "Generation was interrupted."})
            } else {
                serde_json::json!({"text": "No response."})
            }
        }
    };
    let json = serde_json::to_string(&result).map_err(|e| e.to_string())?;
    debug_log(&app, &format!("returning {} bytes", json.len()));
    Ok(json)
}

fn extract_content(msg: &serde_json::Value) -> serde_json::Value {
    let mut text: Vec<String> = Vec::new();
    let mut thinking: Vec<String> = Vec::new();
    if let Some(content) = msg.get("content").and_then(|c| c.as_array()) {
        for block in content {
            match block.get("type").and_then(|t| t.as_str()) {
                Some("text") => {
                    if let Some(t) = block.get("text").and_then(|t| t.as_str()) { if !t.is_empty() { text.push(t.to_string()); } }
                }
                Some("thinking") => {
                    if let Some(t) = block.get("thinking").and_then(|t| t.as_str()) { if !t.is_empty() { thinking.push(t.to_string()); } }
                }
                _ => {}
            }
        }
    }

    let text_str = text.join("\n");
    let thinking_str = thinking.join("\n");

    let display = if !text_str.is_empty() { text_str.clone() }
    else if !thinking_str.is_empty() { thinking_str.clone() }
    else {
        if let Some(err) = msg.get("errorMessage").and_then(|e| e.as_str()) { format!("Agent error: {}", err) }
        else if msg.get("stopReason").and_then(|r| r.as_str()) == Some("error") { "Agent stopped with an error (check your API key)".to_string() }
        else { "(empty response)".to_string() }
    };

    let mut obj = serde_json::Map::new();
    obj.insert("text".to_string(), serde_json::Value::String(display));
    if !thinking_str.is_empty() { obj.insert("thinking".to_string(), serde_json::Value::String(thinking_str)); }
    serde_json::Value::Object(obj)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            check_auth_state, save_api_key, get_app_version, open_data_dir,
            send_prompt, list_sessions, delete_session, rename_session,
            export_session, list_available_models, load_session_messages,
            switch_model, get_current_model,
            set_system_prompt, get_system_prompt,
            get_settings, save_settings, get_session_path, save_export,
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
