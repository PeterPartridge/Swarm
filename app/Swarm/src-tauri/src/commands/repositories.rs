//! Repository commands. The Product Planning board needs a repository to
//! attach work items to, so listing plus a minimal first-repository add are
//! exposed now; the full Repository Management page is its own build
//! (roadmap #4) — this deliberate small overlap is logged in its spec.

use super::{to_message, AppDb};
use crate::db::repository::{self, Repository};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryDto {
    pub id: i64,
    pub name: String,
    pub local_path: String,
    pub is_active: bool,
}

impl From<Repository> for RepositoryDto {
    fn from(r: Repository) -> Self {
        RepositoryDto {
            id: r.id,
            name: r.name,
            local_path: r.local_path,
            is_active: r.is_active,
        }
    }
}

#[tauri::command]
pub async fn list_repositories(db: State<'_, AppDb>) -> Result<Vec<RepositoryDto>, String> {
    let conn = db.0.lock().await;
    let repos = repository::list_all(&conn).await.map_err(to_message)?;
    Ok(repos.into_iter().map(RepositoryDto::from).collect())
}

#[tauri::command]
pub async fn add_repository(
    db: State<'_, AppDb>,
    name: String,
    local_path: String,
) -> Result<i64, String> {
    let conn = db.0.lock().await;
    repository::add(&conn, &name, &local_path, None, None)
        .await
        .map_err(to_message)
}
