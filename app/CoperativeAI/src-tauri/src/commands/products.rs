//! Commands behind the Product home — see db::product for behaviour tests.

use super::{to_message, AppDb};
use crate::db::product::{self, Product};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductDto {
    pub id: i64,
    pub name: String,
    pub answers: String,
}

impl From<Product> for ProductDto {
    fn from(p: Product) -> Self {
        ProductDto {
            id: p.id,
            name: p.name,
            answers: p.answers,
        }
    }
}

#[tauri::command]
pub async fn list_products(db: State<'_, AppDb>) -> Result<Vec<ProductDto>, String> {
    let conn = db.0.lock().await;
    let products = product::list_all(&conn).await.map_err(to_message)?;
    Ok(products.into_iter().map(ProductDto::from).collect())
}

#[tauri::command]
pub async fn create_product(
    db: State<'_, AppDb>,
    name: String,
    answers: String,
) -> Result<i64, String> {
    let conn = db.0.lock().await;
    product::create(&conn, &name, &answers).await.map_err(to_message)
}

#[tauri::command]
pub async fn get_product(db: State<'_, AppDb>, id: i64) -> Result<ProductDto, String> {
    let conn = db.0.lock().await;
    let found = product::find_by_id(&conn, id).await.map_err(to_message)?;
    found
        .map(ProductDto::from)
        .ok_or_else(|| format!("no Product with id {id}"))
}

#[tauri::command]
pub async fn delete_product(db: State<'_, AppDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    product::delete(&conn, id).await.map_err(to_message)
}
