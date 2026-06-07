use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

struct AgentProcess(Mutex<Option<std::process::Child>>);

#[tauri::command]
async fn send_prompt(app: tauri::AppHandle, text: String) -> Result<String, String> {
    let sidecar = app.shell()
        .sidecar("agent-sidecar")
        .map_err(|e| e.to_string())?
        .args(["--mode", "rpc"]);

    let output = sidecar
        .output()
        .await
        .map_err(|e| e.to_string())?;

    // Forward prompt via RPC and read response
    let input = serde_json::json!({"type": "prompt", "message": text, "id": "1"});
    // In a real implementation, connect stdin/stdout streams
    // and read JSON lines for streaming responses.
    //
    // For simplicity, this sends one prompt and waits for the full output.
    let response = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(response)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![send_prompt])
        .setup(|app| {
            // Create data directory on first launch
            let data_dir = app.path().resource_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
                .join("data");
            std::fs::create_dir_all(&data_dir.join("sessions"))
                .expect("failed to create data directory");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
