//! The checklists a work item passes through, and where each item has got to.

use super::{to_message, AppDb};
use crate::db::lifecycle;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GateDto {
    pub id: String,
    pub label: String,
    /// The area that owns this gate's steps. Product sees every gate; Develop
    /// and QA see the one they own — the whole point of splitting them.
    pub owner: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepDto {
    pub id: i64,
    pub gate: String,
    pub name: String,
    pub position: i64,
}

/// The three handovers, sent to the UI rather than written there twice.
#[tauri::command]
pub fn lifecycle_gates() -> Vec<GateDto> {
    lifecycle::GATES
        .iter()
        .map(|g| GateDto {
            id: g.id.into(),
            label: g.label.into(),
            owner: g.owner.into(),
        })
        .collect()
}

#[tauri::command]
pub async fn list_lifecycle_steps(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Vec<StepDto>, String> {
    let conn = db.0.lock().await;
    Ok(lifecycle::list_steps(&conn, product_id)
        .await
        .map_err(to_message)?
        .into_iter()
        .map(|s| StepDto {
            id: s.id,
            gate: s.gate,
            name: s.name,
            position: s.position,
        })
        .collect())
}

/// Replaces one gate's checklist. The order sent is the order it is read in.
#[tauri::command]
pub async fn set_lifecycle_steps(
    db: State<'_, AppDb>,
    product_id: i64,
    gate: String,
    names: Vec<String>,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    lifecycle::set_steps(&conn, product_id, &gate, &names)
        .await
        .map_err(to_message)
}

/// The steps this work item has ticked off, as their ids.
#[tauri::command]
pub async fn list_work_item_steps(
    db: State<'_, AppDb>,
    work_item_id: i64,
) -> Result<Vec<i64>, String> {
    let conn = db.0.lock().await;
    lifecycle::done_steps(&conn, work_item_id)
        .await
        .map_err(to_message)
}

#[tauri::command]
pub async fn set_work_item_step(
    db: State<'_, AppDb>,
    work_item_id: i64,
    step_id: i64,
    done: bool,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    lifecycle::tick(&conn, work_item_id, step_id, done)
        .await
        .map_err(to_message)
}
