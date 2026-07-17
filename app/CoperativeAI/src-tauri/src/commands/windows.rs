//! Pull-out windows: opens a Product-workspace screen as its own OS window.
//! Created from Rust so no JS window-creation capabilities are needed.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const SCREENS: &[&str] = &["planning", "roadmap", "overview"];

#[tauri::command]
pub async fn open_screen_window(
    app: AppHandle,
    screen: String,
    product_id: i64,
    product_name: String,
) -> Result<(), String> {
    if !SCREENS.contains(&screen.as_str()) {
        return Err(format!("unknown screen '{screen}'"));
    }
    // One window per screen+product: reopening focuses the existing one.
    let label = format!("{screen}-{product_id}");
    if let Some(existing) = app.get_webview_window(&label) {
        return existing.set_focus().map_err(|e| e.to_string());
    }
    let url = format!("index.html?window={screen}&productId={product_id}");
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(format!("{product_name} — {screen}"))
        .inner_size(1100.0, 720.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}
