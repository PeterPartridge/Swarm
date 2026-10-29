//! Admin → Extensions: list, read a source, install, remove. See
//! application/ai-only/Hives/extensions.md.
//!
//! **Install reads the source again** rather than trusting what the screen
//! sends: the screen shows a file, and the command installs what that file
//! says now, checked by the same rules.

use super::{to_message, AppDb};
use crate::db::{installed_extension, system_setting};
use crate::extensions::{catalogue, fetch};
use tauri::State;

#[tauri::command]
pub async fn list_installed_extensions(
    db: State<'_, AppDb>,
) -> Result<Vec<installed_extension::Installed>, String> {
    let conn = db.0.lock().await;
    installed_extension::list(&conn).await.map_err(to_message)
}

/// What a source offers, each entry with the reason it cannot be installed if
/// there is one. Installs nothing, and holds no database lock while fetching.
#[tauri::command]
pub async fn read_extension_source(url: String) -> Result<Vec<catalogue::Offer>, String> {
    let text = fetch::read_source(&url).await?;
    catalogue::read(&text, env!("CARGO_PKG_VERSION"), &catalogue::built_in())
}

#[tauri::command]
pub async fn install_extension(
    db: State<'_, AppDb>,
    url: String,
    kind: String,
    id: String,
) -> Result<(), String> {
    let offers = read_extension_source(url.clone()).await?;
    let Some(offer) = offers.iter().find(|o| o.kind == kind && o.id == id) else {
        return Err(format!("{url} does not list {kind} '{id}'."));
    };
    if let Some(problem) = &offer.problem {
        return Err(problem.clone());
    }
    // Until the download, checksum and review path is wired (Round 2, steps
    // 3–4), a Hive with code is refused here rather than recorded as
    // installed with no code behind it.
    if offer.entry.is_some() {
        return Err("Installing a Hive from outside is not finished in this build.".into());
    }
    let conn = db.0.lock().await;
    installed_extension::install(&conn, &offer.kind, &offer.id, &offer.version, url.trim())
        .await
        .map_err(to_message)
}

/// Removes an extension. **The cell the sandbox setting names cannot be
/// removed** — the terminal and the test runner would then be pointed at a
/// place that is not installed. Choose another place first.
#[tauri::command]
pub async fn remove_extension(db: State<'_, AppDb>, kind: String, id: String) -> Result<(), String> {
    let conn = db.0.lock().await;
    let sandbox = system_setting::agent_sandbox(&conn).await.map_err(to_message)?;
    crate::extensions::may_remove(&kind, &id, &sandbox)?;
    installed_extension::remove(&conn, &kind, &id)
        .await
        .map_err(to_message)
}
