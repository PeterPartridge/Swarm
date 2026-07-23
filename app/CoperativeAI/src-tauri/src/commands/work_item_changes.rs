//! Screens, APIs and database tables on a work item.
//!
//! Product's asks and the developers' plan are the same rows at different
//! stages — see `db::work_item_change` for why that is one table rather than
//! two. The commands here are thin; the judgement about what a Solution's type
//! can carry lives in the model, so the UI and the AI prompt cannot disagree.

use super::{to_message, AppDb};
use crate::db::{solution, work_item_change};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemChangeDto {
    pub id: i64,
    pub work_item_id: i64,
    /// Null while it is still Product's ask, unassigned to any Solution.
    pub solution_id: Option<i64>,
    pub kind: String,
    pub action: String,
    pub name: String,
    pub detail: String,
    pub mockup_path: Option<String>,
}

impl From<work_item_change::WorkItemChange> for WorkItemChangeDto {
    fn from(c: work_item_change::WorkItemChange) -> Self {
        WorkItemChangeDto {
            id: c.id,
            work_item_id: c.work_item_id,
            solution_id: c.solution_id,
            kind: c.kind,
            action: c.action,
            name: c.name,
            detail: c.detail,
            mockup_path: c.mockup_path,
        }
    }
}

#[tauri::command]
pub async fn list_work_item_changes(
    db: State<'_, AppDb>,
    work_item_id: i64,
) -> Result<Vec<WorkItemChangeDto>, String> {
    let conn = db.0.lock().await;
    let all = work_item_change::list_for_item(&conn, work_item_id)
        .await
        .map_err(to_message)?;
    Ok(all.into_iter().map(WorkItemChangeDto::from).collect())
}

/// Adds a screen, API or table. `solution_id` is null for Product's ask.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn add_work_item_change(
    db: State<'_, AppDb>,
    work_item_id: i64,
    solution_id: Option<i64>,
    kind: String,
    action: String,
    name: String,
    detail: String,
) -> Result<i64, String> {
    let conn = db.0.lock().await;
    work_item_change::add(
        &conn,
        work_item_id,
        solution_id,
        &kind,
        &action,
        &name,
        &detail,
    )
    .await
    .map_err(to_message)
}

/// Points an ask at the Solution that will build it, or back at nobody.
#[tauri::command]
pub async fn assign_work_item_change(
    db: State<'_, AppDb>,
    id: i64,
    solution_id: Option<i64>,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    work_item_change::assign(&conn, id, solution_id)
        .await
        .map_err(to_message)
}

#[tauri::command]
pub async fn update_work_item_change(
    db: State<'_, AppDb>,
    id: i64,
    action: String,
    name: String,
    detail: String,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    work_item_change::update(&conn, id, &action, &name, &detail)
        .await
        .map_err(to_message)
}

#[tauri::command]
pub async fn delete_work_item_change(db: State<'_, AppDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    work_item_change::delete(&conn, id).await.map_err(to_message)
}

/// Which kinds this Solution's type can carry, so the form offers exactly
/// those. Asked of the backend rather than duplicated in the UI: two copies of
/// this rule would drift, and the drift would only show as a rejected save.
#[tauri::command]
pub async fn change_kinds_for_solution(
    db: State<'_, AppDb>,
    solution_id: i64,
) -> Result<Vec<String>, String> {
    let conn = db.0.lock().await;
    let Some(row) = solution::find_by_id(&conn, solution_id)
        .await
        .map_err(to_message)?
    else {
        return Err("that Solution no longer exists".into());
    };
    Ok(work_item_change::kinds_for(&row.solution_type)
        .iter()
        .map(|k| k.to_string())
        .collect())
}

/// Links a screen to the mockup that shows it, or clears the link.
///
/// Without this, screens and pictures were two lists side by side and the model
/// got a pile of images with a list of names, left to guess the pairing.
#[tauri::command]
pub async fn set_change_mockup(
    db: State<'_, AppDb>,
    id: i64,
    mockup_path: Option<String>,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    work_item_change::set_mockup(&conn, id, mockup_path.as_deref())
        .await
        .map_err(to_message)
}

/// What is already recorded against a Solution, to tick from.
///
/// There is no separate catalogue of a Solution's endpoints and screens, and
/// inventing one would mean a second place to keep in step. The union of every
/// change anybody has recorded is it, and it grows as the team works.
#[tauri::command]
pub async fn solution_catalogue(
    db: State<'_, AppDb>,
    solution_id: i64,
) -> Result<Vec<CatalogueEntry>, String> {
    let conn = db.0.lock().await;
    Ok(work_item_change::catalogue_for_solution(&conn, solution_id)
        .await
        .map_err(to_message)?
        .into_iter()
        .map(|(kind, name)| CatalogueEntry { kind, name })
        .collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogueEntry {
    pub kind: String,
    pub name: String,
}
