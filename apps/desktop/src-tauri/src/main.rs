// Desktop app: the website's build in a native window, plus updates from GitHub Releases.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_updater::UpdaterExt;

const RELEASES: &str = "https://github.com/PedroRaposo02/simulacrum/releases/download/";

/// Download and install the release described by `manifest` (its latest.json), then restart.
/// The installer's signature is checked against the public key in tauri.conf.json.
#[tauri::command]
async fn install_update(app: tauri::AppHandle, manifest: String) -> Result<(), String> {
    if !manifest.starts_with(RELEASES) {
        return Err("Updates only come from this project's GitHub releases".into());
    }
    let url = manifest.parse().map_err(|e| format!("{e}"))?;
    let updater = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?.ok_or("Already up to date")?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart();
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![install_update])
        .run(tauri::generate_context!())
        .expect("error while running Simulacrum");
}
