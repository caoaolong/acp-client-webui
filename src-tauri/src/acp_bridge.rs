use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

const BRIDGE_TIMEOUT: Duration = Duration::from_secs(300);

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
