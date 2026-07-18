//! AI feedback commands — reading the questions the AI raised against a work
//! item, and answering them.

use super::{to_message, AppDb};
use crate::db::ai_feedback::{self, AiFeedback};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiFeedbackDto {
    pub id: i64,
    pub work_item_id: i64,
    pub kind: String,
    pub message: String,
    pub what_is_needed: String,
    pub resolved: bool,
    pub resolved_note: String,
}

impl From<AiFeedback> for AiFeedbackDto {
    fn from(f: AiFeedback) -> Self {
        AiFeedbackDto {
            id: f.id,
            work_item_id: f.work_item_id,
            kind: f.kind,
            message: f.message,
            what_is_needed: f.what_is_needed,
            resolved: f.resolved,
            resolved_note: f.resolved_note,
        }
    }
}

#[tauri::command]
pub async fn list_ai_feedback(
    db: State<'_, AppDb>,
    work_item_id: i64,
) -> Result<Vec<AiFeedbackDto>, String> {
    let conn = db.0.lock().await;
    let items = ai_feedback::list_for_item(&conn, work_item_id)
        .await
        .map_err(to_message)?;
    Ok(items.into_iter().map(AiFeedbackDto::from).collect())
}

/// Answers the AI's question. The note becomes a clarification sent with the
/// next prompt for this item, so the same question is not asked twice.
#[tauri::command]
pub async fn resolve_ai_feedback(
    db: State<'_, AppDb>,
    id: i64,
    note: String,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    ai_feedback::resolve(&conn, id, &note).await.map_err(to_message)
}
