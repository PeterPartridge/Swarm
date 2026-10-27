//! Commands behind the RoadMap's sprints — see db::sprint.

use super::{to_message, AppDb};
use crate::db::sprint::{self, Sprint};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SprintDto {
    pub id: i64,
    pub product_id: i64,
    pub name: String,
    pub start_date: Option<i64>,
    pub end_date: Option<i64>,
}

impl From<Sprint> for SprintDto {
    fn from(s: Sprint) -> Self {
        SprintDto {
            id: s.id,
            product_id: s.product_id,
            name: s.name,
            start_date: s.start_date,
            end_date: s.end_date,
        }
    }
}

#[tauri::command]
pub async fn list_sprints(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Vec<SprintDto>, String> {
    let conn = db.0.lock().await;
    let sprints = sprint::list_by_product(&conn, product_id)
        .await
        .map_err(to_message)?;
    Ok(sprints.into_iter().map(SprintDto::from).collect())
}

#[tauri::command]
pub async fn create_sprint(
    db: State<'_, AppDb>,
    product_id: i64,
    name: String,
    start_date: Option<i64>,
    end_date: Option<i64>,
) -> Result<i64, String> {
    let conn = db.0.lock().await;
    sprint::create(&conn, product_id, &name, start_date, end_date)
        .await
        .map_err(to_message)
}

#[tauri::command]
pub async fn remove_sprint(db: State<'_, AppDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    sprint::remove(&conn, id).await.map_err(to_message)
}
