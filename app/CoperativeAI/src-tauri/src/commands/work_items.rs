//! Commands behind the Product Planning board — thin wrappers over the
//! tested `db::work_item` module (see its unit tests for the behaviour).

use super::{to_message, AppDb};
use crate::db::work_item::{self, WorkItem};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemDto {
    pub id: i64,
    pub title: String,
    pub item_type: String,
    pub status: String,
    pub description: Option<String>,
    pub repository_id: i64,
    pub parent_item_id: Option<i64>,
}

impl From<WorkItem> for WorkItemDto {
    fn from(w: WorkItem) -> Self {
        WorkItemDto {
            id: w.id,
            title: w.title,
            item_type: w.item_type,
            status: w.status,
            description: w.description,
            repository_id: w.repository_id,
            parent_item_id: w.parent_item_id,
        }
    }
}

#[tauri::command]
pub async fn list_work_items(db: State<'_, AppDb>) -> Result<Vec<WorkItemDto>, String> {
    let conn = db.0.lock().await;
    let items = work_item::list_all(&conn).await.map_err(to_message)?;
    Ok(items.into_iter().map(WorkItemDto::from).collect())
}

#[tauri::command]
pub async fn create_work_item(
    db: State<'_, AppDb>,
    title: String,
    item_type: String,
    repository_id: i64,
    description: Option<String>,
) -> Result<i64, String> {
    let conn = db.0.lock().await;
    work_item::create(
        &conn,
        &title,
        &item_type,
        repository_id,
        None,
        description.as_deref(),
    )
    .await
    .map_err(to_message)
}

#[tauri::command]
pub async fn update_work_item_status(
    db: State<'_, AppDb>,
    id: i64,
    status: String,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    work_item::update_status(&conn, id, &status)
        .await
        .map_err(to_message)
}

#[tauri::command]
pub async fn delete_work_item(db: State<'_, AppDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    work_item::delete(&conn, id).await.map_err(to_message)
}
