use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

const BRIDGE_TIMEOUT: Duration = Duration::from_secs(300);

fn is_executable(path: &Path) -> bool {
    #[cfg(windows)]
    {
        path.is_file()
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata = match path.metadata() {
            Ok(m) => m,
            Err(_) => return false,
        };
        if !metadata.is_file() {
            return false;
        }
        let permissions = metadata.permissions();
        permissions.mode() & 0o111 != 0
    }
}

fn search_path(commands: &[&str]) -> Option<PathBuf> {
    let path_var = std::env::var("PATH").ok()?;
    #[cfg(windows)]
    let separator = ';';
    #[cfg(not(windows))]
    let separator = ':';

    for dir in path_var.split(separator) {
        let dir = Path::new(dir);
        for cmd in commands {
            let path = dir.join(cmd);
            if is_executable(&path) {
                return Some(path);
            }
        }
    }
    None
}

fn common_install_paths(server_type: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let home_dir = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
        .map(PathBuf::from);

    match server_type {
        "cursor" => {
            #[cfg(target_os = "macos")]
            paths.push(PathBuf::from("/Applications/Cursor.app/Contents/MacOS/Cursor"));
            #[cfg(target_os = "linux")]
            {
                paths.push(PathBuf::from("/usr/bin/cursor"));
                paths.push(PathBuf::from("/opt/cursor/cursor"));
                paths.push(PathBuf::from("/opt/Cursor/cursor"));
                if let Some(home) = &home_dir {
                    paths.push(home.join(".local/bin/cursor"));
                    paths.push(home.join("AppImages/cursor"));
                }
            }
            #[cfg(windows)]
            {
                paths.push(PathBuf::from("C:/Program Files/Cursor/Cursor.exe"));
                paths.push(PathBuf::from("C:/Program Files (x86)/Cursor/Cursor.exe"));
                if let Some(home) = &home_dir {
                    paths.push(home.join("AppData/Local/Programs/cursor/Cursor.exe"));
                    paths.push(home.join("AppData/Local/cursor/Cursor.exe"));
                }
            }
        }
        "opencode" => {
            #[cfg(target_os = "macos")]
            {
                paths.push(PathBuf::from("/usr/local/bin/opencode"));
                paths.push(PathBuf::from("/opt/homebrew/bin/opencode"));
                if let Some(home) = &home_dir {
                    paths.push(home.join(".local/bin/opencode"));
                }
            }
            #[cfg(target_os = "linux")]
            {
                paths.push(PathBuf::from("/usr/local/bin/opencode"));
                paths.push(PathBuf::from("/usr/bin/opencode"));
                if let Some(home) = &home_dir {
                    paths.push(home.join(".local/bin/opencode"));
                    paths.push(home.join(".npm-global/bin/opencode"));
                    paths.push(home.join("node_modules/.bin/opencode"));
                }
            }
            #[cfg(windows)]
            {
                if let Some(home) = &home_dir {
                    paths.push(home.join("AppData/Roaming/npm/opencode.cmd"));
                    paths.push(home.join("AppData/Roaming/npm/opencode.exe"));
                    paths.push(home.join("AppData/Local/npm/opencode.cmd"));
                    paths.push(home.join("AppData/Local/npm/opencode.exe"));
                }
                paths.push(PathBuf::from("C:/Program Files/nodejs/opencode.cmd"));
                paths.push(PathBuf::from("C:/Program Files/nodejs/opencode.exe"));
            }
        }
        _ => {}
    }

    paths
}

#[tauri::command]
pub fn detect_acp_server(server_type: String) -> Result<Option<String>, String> {
    let commands: Vec<&str> = match server_type.as_str() {
        "opencode" => {
            #[cfg(windows)]
            {
                vec!["opencode.exe", "opencode.cmd", "opencode"]
            }
            #[cfg(not(windows))]
            {
                vec!["opencode"]
            }
        }
        "cursor" => {
            #[cfg(windows)]
            {
                vec!["Cursor.exe", "cursor.exe", "cursor"]
            }
            #[cfg(not(windows))]
            {
                vec!["cursor"]
            }
        }
        "custom" => return Ok(None),
        _ => return Err(format!("Unknown server type: {}", server_type)),
    };

    if let Some(path) = search_path(&commands) {
        return Ok(Some(path.to_string_lossy().to_string()));
    }

    for path in common_install_paths(&server_type) {
        if path.exists() {
            return Ok(Some(path.to_string_lossy().to_string()));
        }
    }

    Ok(None)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AcpBridgeEvent {
    #[serde(rename = "type")]
    event_type: String,
    event: Option<String>,
    data: Option<Value>,
    id: Option<String>,
    result: Option<Value>,
    error: Option<String>,
}

pub struct AcpBridgeState {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<std::process::ChildStdin>>,
    pending: Arc<Mutex<HashMap<String, Sender<Value>>>>,
    ready: Arc<Mutex<bool>>,
}

impl Default for AcpBridgeState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            stdin: Mutex::new(None),
            pending: Arc::new(Mutex::new(HashMap::new())),
            ready: Arc::new(Mutex::new(false)),
        }
    }
}

fn sidecar_script_path() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let script = manifest_dir.join("../sidecar/acp-bridge.mjs");
    if script.exists() {
        return Ok(script);
    }
    Err(format!(
        "ACP sidecar script not found: {}",
        script.display()
    ))
}

fn spawn_reader(
    app: AppHandle,
    stdout: std::process::ChildStdout,
    pending: Arc<Mutex<HashMap<String, Sender<Value>>>>,
    ready: Arc<Mutex<bool>>,
) {
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let line = match line {
                Ok(value) => value,
                Err(error) => {
                    let _ = app.emit(
                        "acp-event",
                        AcpBridgeEvent {
                            event_type: "event".to_string(),
                            event: Some("bridge_error".to_string()),
                            data: Some(json!({ "message": error.to_string() })),
                            id: None,
                            result: None,
                            error: None,
                        },
                    );
                    break;
                }
            };

            let msg: Value = match serde_json::from_str(&line) {
                Ok(value) => value,
                Err(error) => {
                    let _ = app.emit(
                        "acp-event",
                        AcpBridgeEvent {
                            event_type: "event".to_string(),
                            event: Some("bridge_error".to_string()),
                            data: Some(json!({
                                "message": error.to_string(),
                                "line": line
                            })),
                            id: None,
                            result: None,
                            error: None,
                        },
                    );
                    continue;
                }
            };

            match msg.get("type").and_then(|value| value.as_str()) {
                Some("ready") => {
                    *ready.lock().unwrap() = true;
                    let _ = app.emit(
                        "acp-event",
                        AcpBridgeEvent {
                            event_type: "event".to_string(),
                            event: Some("bridge_ready".to_string()),
                            data: Some(json!({})),
                            id: None,
                            result: None,
                            error: None,
                        },
                    );
                }
                Some("response") => {
                    if let Some(id) = msg.get("id").and_then(|value| value.as_str()) {
                        let sender = pending.lock().unwrap().remove(id);
                        if let Some(sender) = sender {
                            let _ = sender.send(msg);
                        }
                    }
                }
                Some("event") => {
                    let _ = app.emit("acp-event", msg);
                }
                _ => {}
            }
        }

        *ready.lock().unwrap() = false;
        let _ = app.emit(
            "acp-event",
            AcpBridgeEvent {
                event_type: "event".to_string(),
                event: Some("bridge_closed".to_string()),
                data: Some(json!({})),
                id: None,
                result: None,
                error: None,
            },
        );
    });
}

pub fn ensure_sidecar_started(app: &AppHandle, state: &AcpBridgeState) -> Result<(), String> {
    let mut child_guard = state.child.lock().unwrap();
    if child_guard.is_some() {
        return Ok(());
    }

    let script = sidecar_script_path()?;
    let mut child = Command::new("node")
        .arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format!("Failed to spawn ACP sidecar: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture sidecar stdout".to_string())?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to capture sidecar stdin".to_string())?;

    *state.stdin.lock().unwrap() = Some(stdin);
    *child_guard = Some(child);

    spawn_reader(
        app.clone(),
        stdout,
        state.pending.clone(),
        state.ready.clone(),
    );

    for _ in 0..50 {
        if *state.ready.lock().unwrap() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }

    Err("ACP sidecar did not become ready in time".to_string())
}

fn send_command(
    state: &AcpBridgeState,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let (sender, receiver): (Sender<Value>, Receiver<Value>) = mpsc::channel();
    state.pending.lock().unwrap().insert(id.clone(), sender);

    let command = json!({
        "type": "command",
        "id": id,
        "method": method,
        "params": params
    });

    {
        let mut stdin_guard = state.stdin.lock().unwrap();
        let stdin = stdin_guard
            .as_mut()
            .ok_or_else(|| "ACP sidecar stdin is not available".to_string())?;
        writeln!(stdin, "{command}")
            .map_err(|error| format!("Failed to write to ACP sidecar: {error}"))?;
        stdin
            .flush()
            .map_err(|error| format!("Failed to flush ACP sidecar stdin: {error}"))?;
    }

    match receiver.recv_timeout(BRIDGE_TIMEOUT) {
        Ok(response) => {
            if let Some(error) = response.get("error").and_then(|value| value.as_str()) {
                Err(error.to_string())
            } else {
                Ok(response.get("result").cloned().unwrap_or(Value::Null))
            }
        }
        Err(_) => {
            state.pending.lock().unwrap().remove(&id);
            Err("ACP sidecar command timed out".to_string())
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpStartParams {
    pub cwd: Option<String>,
    pub agent_command: Option<String>,
    pub agent_args: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpNewSessionParams {
    pub cwd: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpPromptParams {
    pub session_id: String,
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpSessionIdParams {
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpPermissionResponseParams {
    pub request_id: String,
    pub option_id: Option<String>,
}

#[tauri::command]
pub fn acp_ensure_bridge(app: AppHandle, state: State<AcpBridgeState>) -> Result<(), String> {
    ensure_sidecar_started(&app, &state)
}

#[tauri::command]
pub fn acp_start(
    app: AppHandle,
    state: State<AcpBridgeState>,
    params: AcpStartParams,
) -> Result<Value, String> {
    ensure_sidecar_started(&app, &state)?;
    send_command(
        &state,
        "start",
        json!({
            "cwd": params.cwd,
            "agentCommand": params.agent_command,
            "agentArgs": params.agent_args
        }),
    )
}

#[tauri::command]
pub fn acp_new_session(
    app: AppHandle,
    state: State<AcpBridgeState>,
    params: AcpNewSessionParams,
) -> Result<Value, String> {
    ensure_sidecar_started(&app, &state)?;
    send_command(
        &state,
        "newSession",
        json!({
            "cwd": params.cwd,
            "title": params.title
        }),
    )
}

#[tauri::command]
pub fn acp_prompt(
    app: AppHandle,
    state: State<AcpBridgeState>,
    params: AcpPromptParams,
) -> Result<Value, String> {
    ensure_sidecar_started(&app, &state)?;
    send_command(
        &state,
        "prompt",
        json!({
            "sessionId": params.session_id,
            "text": params.text
        }),
    )
}

#[tauri::command]
pub fn acp_cancel(
    app: AppHandle,
    state: State<AcpBridgeState>,
    params: AcpSessionIdParams,
) -> Result<Value, String> {
    ensure_sidecar_started(&app, &state)?;
    send_command(
        &state,
        "cancel",
        json!({ "sessionId": params.session_id }),
    )
}

#[tauri::command]
pub fn acp_list_sessions(
    app: AppHandle,
    state: State<AcpBridgeState>,
) -> Result<Value, String> {
    ensure_sidecar_started(&app, &state)?;
    send_command(&state, "listSessions", json!({}))
}

#[tauri::command]
pub fn acp_delete_session(
    app: AppHandle,
    state: State<AcpBridgeState>,
    params: AcpSessionIdParams,
) -> Result<Value, String> {
    ensure_sidecar_started(&app, &state)?;
    send_command(
        &state,
        "deleteSession",
        json!({ "sessionId": params.session_id }),
    )
}

#[tauri::command]
pub fn acp_permission_response(
    app: AppHandle,
    state: State<AcpBridgeState>,
    params: AcpPermissionResponseParams,
) -> Result<Value, String> {
    ensure_sidecar_started(&app, &state)?;
    let method = if params.option_id.is_some() {
        "permissionResponse"
    } else {
        "permissionCancel"
    };
    send_command(
        &state,
        method,
        json!({
            "requestId": params.request_id,
            "optionId": params.option_id
        }),
    )
}

pub fn init_bridge(app: &AppHandle) {
    let state = app.state::<AcpBridgeState>();
    if let Err(error) = ensure_sidecar_started(app, &state) {
        eprintln!("[acp-bridge] failed to start sidecar: {error}");
    }
}
