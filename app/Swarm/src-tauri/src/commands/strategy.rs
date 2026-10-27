//! Strategy commands — one structured document per (Product, area:
//! product/develop/test).

use super::{to_message, AppDb};
use crate::db::strategy;
use tauri::State;

#[tauri::command]
pub async fn get_strategy(
    db: State<'_, AppDb>,
    product_id: i64,
    area: String,
) -> Result<String, String> {
    let conn = db.0.lock().await;
    strategy::get(&conn, product_id, &area).await.map_err(to_message)
}

#[tauri::command]
pub async fn save_strategy(
    db: State<'_, AppDb>,
    product_id: i64,
    area: String,
    content: String,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    strategy::save(&conn, product_id, &area, &content)
        .await
        .map_err(to_message)
}
