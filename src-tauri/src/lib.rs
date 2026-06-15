mod acp_bridge;

use acp_bridge::AcpBridgeState;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AcpBridgeState::default())
        .setup(|app| {
            acp_bridge::init_bridge(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            acp_bridge::acp_ensure_bridge,
            acp_bridge::acp_start,
            acp_bridge::acp_new_session,
            acp_bridge::acp_prompt,
            acp_bridge::acp_cancel,
            acp_bridge::acp_list_sessions,
            acp_bridge::acp_delete_session,
            acp_bridge::acp_permission_response,
            acp_bridge::detect_acp_server,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
