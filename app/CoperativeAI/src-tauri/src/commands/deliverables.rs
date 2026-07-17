//! Deliverable commands — a Product's strategy deliverables that work items
//! group under.

use super::{to_message, AppDb};
use crate::db::deliverable::{self, Deliverable};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliverableDto {
    pub id: i64,
    pub product_id: i64,
    pub name: String,
    pub description: String,
}

impl From<Deliverable> for DeliverableDto {
    fn from(d: Deliverable) -> Self {
        DeliverableDto {
            id: d.id,
            product_id: d.product_id,
            name: d.name,
            description: d.description,
        }
    }
}

#[tauri::command]
pub async fn list_deliverables(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Vec<DeliverableDto>, String> {
    let conn = db.0.lock().await;
    let items = deliverable::list_by_product(&conn, product_id)
        .await
        .map_err(to_message)?;
    Ok(items.into_iter().map(DeliverableDto::from).collect())
}

#[tauri::command]
pub async fn create_deliverable(
    db: State<'_, AppDb>,
    product_id: i64,
    name: String,
    description: String,
) -> Result<i64, String> {
    let conn = db.0.lock().await;
    deliverable::create(&conn, product_id, &name, &description)
        .await
        .map_err(to_message)
}

#[tauri::command]
pub async fn delete_deliverable(db: State<'_, AppDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    deliverable::delete(&conn, id).await.map_err(to_message)
}
