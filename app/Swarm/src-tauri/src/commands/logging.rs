//! Reading and writing the app log — the trail that answers "nothing happened".

use super::{to_message, AppDb};
use crate::db::app_log;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntryDto {
    pub id: i64,
    pub at: i64,
    pub area: String,
    pub message: String,
    pub detail: String,
}

/// Writes a line from the screen.
///
/// **The screen's half matters as much as the backend's.** A press that never
/// reached a command — a button that was disabled, a guard that returned early
/// — leaves nothing in any backend log, and that is exactly the case somebody
/// is trying to explain when they say nothing happened.
#[tauri::command]
pub async fn log_event(
    db: State<'_, AppDb>,
    area: String,
    message: String,
    detail: Option<String>,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    app_log::record(&conn, &area, &message, detail.as_deref().unwrap_or(""))
        .await
        .map_err(to_message)
}

#[tauri::command]
pub async fn list_app_log(
    db: State<'_, AppDb>,
    limit: Option<i64>,
) -> Result<Vec<LogEntryDto>, String> {
    let conn = db.0.lock().await;
    Ok(app_log::recent(&conn, limit.unwrap_or(200))
        .await
        .map_err(to_message)?
        .into_iter()
        .map(|e| LogEntryDto {
            id: e.id,
            at: e.at,
            area: e.area,
            message: e.message,
            detail: e.detail,
        })
        .collect())
}

#[tauri::command]
pub async fn clear_app_log(db: State<'_, AppDb>) -> Result<(), String> {
    let conn = db.0.lock().await;
    app_log::clear(&conn).await.map_err(to_message)
}
