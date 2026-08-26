//! Pull-out windows: opens a Product-workspace screen as its own OS window.
//! Created from Rust so no JS window-creation capabilities are needed.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const SCREENS: &[&str] = &["strategy", "planning", "roadmap", "marketing", "design", "overview"];

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

/// The console — a Solution's shell and the debugger's output — as its own OS
/// window, so it can go on the other monitor.
///
/// **Separate from `open_screen_window` on purpose.** That one is scoped to a
/// Product and its six workspace screens; this is scoped to a Solution and,
/// optionally, a shell that is already running. Widening the other command to
/// take both would have made every caller pass arguments that mean nothing to
/// it.
///
/// The terminal survives the trip because the PTY lives in this process and is
/// adopted by id — see `attach_terminal`, which hands back the recent output to
/// catch up on. The debugger's output does not: it is a stream of events with
/// no replay, so the new window starts from the next line and says so.
#[tauri::command]
pub async fn open_console_window(
    app: AppHandle,
    solution_id: i64,
    solution_name: String,
    terminal_id: Option<String>,
) -> Result<(), String> {
    // One console per Solution: dragging it out twice focuses the one that is
    // already open rather than leaving two windows watching one shell.
    let label = format!("console-{solution_id}");
    if let Some(existing) = app.get_webview_window(&label) {
        return existing.set_focus().map_err(|e| e.to_string());
    }
    let mut url = format!("index.html?window=console&solutionId={solution_id}");
    if let Some(id) = terminal_id.filter(|t| !t.trim().is_empty()) {
        url.push_str(&format!("&terminalId={id}"));
    }
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(format!("{solution_name} — console"))
        .inner_size(900.0, 480.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}
