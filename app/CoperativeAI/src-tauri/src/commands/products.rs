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

/// Creates a Product; when a scaffold folder is given, the framework files
/// are generated there behind the scenes and registered in the
/// SolutionManagement table. Scaffold failure rolls the Product back so the
/// card and the disk stay consistent.
#[tauri::command]
pub async fn create_product(
    db: State<'_, AppDb>,
    name: String,
    answers: String,
    scaffold_dir: Option<String>,
) -> Result<i64, String> {
    let conn = db.0.lock().await;
    let id = product::create(&conn, &name, &answers).await.map_err(to_message)?;
    if let Some(dir) = scaffold_dir.filter(|d| !d.trim().is_empty()) {
        let path = match crate::scaffold::scaffold_product(&dir, &name, &answers) {
            Ok(path) => path,
            Err(e) => {
                let _ = product::delete(&conn, id).await;
                return Err(e);
            }
        };
        crate::db::solution_management::create(&conn, &name, &path, "1")
            .await
            .map_err(to_message)?;
    }
    Ok(id)
}

/// The Overview panel's scaffold lookup: the registered file location for
/// this Product's generated framework files, if any.
#[tauri::command]
pub async fn get_product_scaffold(
    db: State<'_, AppDb>,
    name: String,
) -> Result<Option<String>, String> {
    let conn = db.0.lock().await;
    let solutions = crate::db::solution_management::list_all(&conn)
        .await
        .map_err(to_message)?;
    Ok(solutions
        .into_iter()
        .find(|s| s.filename == name)
        .map(|s| s.filepath))
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
