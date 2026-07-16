//! Commands behind the "How Products are planned" settings — see
//! db::system_setting (preset validation lives there).

use super::{to_message, AppDb};
use crate::db::system_setting;
use tauri::State;

#[tauri::command]
pub async fn get_planning_hierarchy(db: State<'_, AppDb>) -> Result<Vec<String>, String> {
    let conn = db.0.lock().await;
    system_setting::get_planning_hierarchy(&conn)
        .await
        .map_err(to_message)
}

#[tauri::command]
pub async fn set_planning_hierarchy(
    db: State<'_, AppDb>,
    hierarchy: Vec<String>,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    system_setting::set_planning_hierarchy(&conn, &hierarchy)
        .await
        .map_err(to_message)
}

#[tauri::command]
pub async fn get_roadmap_mode(db: State<'_, AppDb>) -> Result<String, String> {
    let conn = db.0.lock().await;
    system_setting::get_roadmap_mode(&conn).await.map_err(to_message)
}

#[tauri::command]
pub async fn set_roadmap_mode(db: State<'_, AppDb>, mode: String) -> Result<(), String> {
    let conn = db.0.lock().await;
    system_setting::set_roadmap_mode(&conn, &mode)
        .await
        .map_err(to_message)
}
