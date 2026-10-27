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

/// One work item's build plan as its own OS window.
///
/// **The Build view's three panes each pull out, and this is the second of
/// them.** A screen where you compare a plan against the code it produced is a
/// two-monitor job, and switching tabs to check what was asked for is the part
/// that made it one. Scoped to a work item, not a Product, so it takes an id
/// the workspace commands above have no use for.
#[tauri::command]
pub async fn open_work_item_window(
    app: AppHandle,
    work_item_id: i64,
    title: String,
) -> Result<(), String> {
    let label = format!("work-item-{work_item_id}");
    if let Some(existing) = app.get_webview_window(&label) {
        return existing.set_focus().map_err(|e| e.to_string());
    }
    let url = format!("index.html?window=workItem&workItemId={work_item_id}");
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(format!("{title} — build plan"))
        .inner_size(900.0, 760.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// One file from a Solution's working copy as its own OS window.
///
/// One window per file rather than per Solution: the reason to pull a file out
/// is to hold it beside another one, and a single window that re-pointed itself
/// would make that impossible.
#[tauri::command]
pub async fn open_file_window(
    app: AppHandle,
    solution_id: i64,
    path: String,
) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("no file to open".into());
    }
    // The path is in the label so two files from one Solution are two windows.
    // Non-alphanumerics out: a label is an identifier, and a Windows path is
    // full of characters it will not take.
    let safe: String = path
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let label = format!("file-{solution_id}-{safe}");
    if let Some(existing) = app.get_webview_window(&label) {
        return existing.set_focus().map_err(|e| e.to_string());
    }
    let url = format!(
        "index.html?window=file&solutionId={solution_id}&path={}",
        encode_query(&path)
    );
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(path.clone())
        .inner_size(900.0, 700.0)
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

/// Percent-encodes a path for a query string.
///
/// **Hand-written rather than a crate.** This is the only place in the app that
/// needs it, and the alphabet is small: a relative path is letters, digits and
/// separators, and everything else — the space in `Program Files`, the `#` that
/// would truncate the URL — becomes `%XX`. A dependency for four lines would be
/// a dependency to keep updated for four lines.
fn encode_query(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                out.push(byte as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The characters that actually appear in a Windows path, and the two that
    /// would break the URL if they travelled as themselves.
    #[test]
    fn a_path_survives_the_query_string() {
        assert_eq!(encode_query("src/main.rs"), "src/main.rs");
        assert_eq!(encode_query("My Docs/a b.txt"), "My%20Docs/a%20b.txt");
        assert_eq!(encode_query("a#b&c=d"), "a%23b%26c%3Dd");
        // Non-ASCII goes as UTF-8 bytes, which is what the browser decodes back.
        assert_eq!(encode_query("caf\u{e9}.md"), "caf%C3%A9.md");
    }
}
