//! Sprint capacity commands — what each person has available, beside what they
//! have actually been given.

use super::{to_message, AppDb};
use crate::db::sprint_capacity;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberLoadDto {
    pub team_member_id: i64,
    pub capacity: i64,
    /// A count of work items, not estimated effort — work items carry no
    /// estimate, and inventing one would be a guess dressed as arithmetic.
    pub assigned_items: i64,
}

#[tauri::command]
pub async fn get_sprint_load(
    db: State<'_, AppDb>,
    sprint_id: i64,
) -> Result<Vec<MemberLoadDto>, String> {
    let conn = db.0.lock().await;
    let loads = sprint_capacity::load_for_sprint(&conn, sprint_id)
        .await
        .map_err(to_message)?;
    Ok(loads
        .into_iter()
        .map(|l| MemberLoadDto {
            team_member_id: l.team_member_id,
            capacity: l.capacity,
            assigned_items: l.assigned_items,
        })
        .collect())
}

#[tauri::command]
pub async fn set_sprint_capacity(
    db: State<'_, AppDb>,
    sprint_id: i64,
    team_member_id: i64,
    capacity: i64,
) -> Result<i64, String> {
    let conn = db.0.lock().await;
    sprint_capacity::set_capacity(&conn, sprint_id, team_member_id, capacity)
        .await
        .map_err(to_message)
}
