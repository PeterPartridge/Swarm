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

/// Every unanswered AI question in a Product, with the work item that raised it
/// named — so the AI panel can say which agent is waiting on you rather than
/// leaving you to open each item and check.
#[tauri::command]
pub async fn list_open_questions(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Vec<OpenQuestionDto>, String> {
    let conn = db.0.lock().await;
    let open = ai_feedback::list_open_for_product(&conn, product_id)
        .await
        .map_err(to_message)?;
    let items = crate::db::work_item::list_by_product(&conn, product_id)
        .await
        .map_err(to_message)?;

    Ok(open
        .into_iter()
        .map(|q| OpenQuestionDto {
            work_item_title: items
                .iter()
                .find(|i| i.id == q.work_item_id)
                .map(|i| i.title.clone())
                .unwrap_or_else(|| format!("#{}", q.work_item_id)),
            id: q.id,
            work_item_id: q.work_item_id,
            kind: q.kind,
            message: q.message,
            what_is_needed: q.what_is_needed,
        })
        .collect())
}

/// An open question, carrying the work item's title so the panel can name it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenQuestionDto {
    pub id: i64,
    pub work_item_id: i64,
    pub work_item_title: String,
    pub kind: String,
    pub message: String,
    pub what_is_needed: String,
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

/// Raises a question for Product against a work item.
///
/// Deliberately the same table the AI's own questions use: the answer becomes a
/// clarification like any other, so what Product replies travels into every
/// later prompt for this item. A second question mechanism would collect the
/// same answers into a box nothing reads.
#[tauri::command]
pub async fn ask_product_question(
    db: State<'_, AppDb>,
    work_item_id: i64,
    question: String,
) -> Result<i64, String> {
    if question.trim().is_empty() {
        return Err("a question needs to say something".into());
    }
    let conn = db.0.lock().await;
    ai_feedback::record(
        &conn,
        work_item_id,
        "productQuestion",
        question.trim(),
        "Product needs to answer this before the work can be designed.",
        None,
    )
    .await
    .map_err(to_message)
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
