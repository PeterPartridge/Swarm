//! Commands behind Solution Creation (Develop tab) — see db::solution.

use super::{to_message, AppDb};
use crate::db::solution::{self, Solution};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SolutionDto {
    pub id: i64,
    pub name: String,
    pub product_id: i64,
    pub solution_type: String,
    pub answers: String,
    pub origin: String,
    pub github_url: Option<String>,
    pub github_visibility: Option<String>,
    pub local_path: Option<String>,
}

impl From<Solution> for SolutionDto {
    fn from(s: Solution) -> Self {
        SolutionDto {
            id: s.id,
            name: s.name,
            product_id: s.product_id,
            solution_type: s.solution_type,
            answers: s.answers,
            origin: s.origin,
            github_url: s.github_url,
            github_visibility: s.github_visibility,
            local_path: s.local_path,
        }
    }
}

#[tauri::command]
pub async fn list_solutions(db: State<'_, AppDb>) -> Result<Vec<SolutionDto>, String> {
    let conn = db.0.lock().await;
    let solutions = solution::list_all(&conn).await.map_err(to_message)?;
    Ok(solutions.into_iter().map(SolutionDto::from).collect())
}

#[tauri::command]
pub async fn create_solution(
    db: State<'_, AppDb>,
    name: String,
    product_id: i64,
    solution_type: String,
    answers: String,
) -> Result<i64, String> {
    let conn = db.0.lock().await;
    solution::create(&conn, &name, product_id, &solution_type, &answers)
        .await
        .map_err(to_message)
}

#[tauri::command]
pub async fn delete_solution(db: State<'_, AppDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    solution::delete(&conn, id).await.map_err(to_message)
}
