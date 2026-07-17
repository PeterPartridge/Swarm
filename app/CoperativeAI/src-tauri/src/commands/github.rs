//! GitHub commands (Develop tab): store a Personal Access Token in the OS
//! credential store, report connection status, and — per Solution — link an
//! existing repository or create a new one via the GitHub REST API. The token
//! itself never crosses into the DB; solutions only record the repo URL.

use super::{to_message, AppDb};
use crate::db::solution;
use crate::github;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubStatus {
    /// Whether a token is present in the credential store (checked locally, no
    /// network call). `login` is only known right after a successful connect.
    pub connected: bool,
}

/// Local-only: is a token stored? Cheap enough to call on page load.
#[tauri::command]
pub async fn github_status() -> Result<GithubStatus, String> {
    Ok(GithubStatus {
        connected: github::token_stored(),
    })
}

/// Verifies the token against GitHub and, if valid, stores it. Returns the
/// authenticated login so the UI can show "Connected as …".
#[tauri::command]
pub async fn set_github_token(token: String) -> Result<String, String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("paste a GitHub personal access token first".into());
    }
    let login = github::verify(token).await?;
    github::store_token(token)?;
    Ok(login)
}

#[tauri::command]
pub async fn remove_github_token() -> Result<(), String> {
    github::delete_token()
}

/// Links an existing repository to a Solution by URL (origin = "imported").
#[tauri::command]
pub async fn link_solution_repo(
    db: State<'_, AppDb>,
    solution_id: i64,
    url: String,
) -> Result<(), String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("enter the repository URL to link".into());
    }
    let conn = db.0.lock().await;
    solution::set_github(&conn, solution_id, Some(url), None, "imported")
        .await
        .map_err(to_message)
}

/// Creates a new repository under the connected account and links it to the
/// Solution (origin = "created"). Returns the new repo's URL.
#[tauri::command]
pub async fn create_solution_repo(
    db: State<'_, AppDb>,
    solution_id: i64,
    repo_name: String,
    private: bool,
    description: String,
) -> Result<String, String> {
    let token = github::get_token()?;
    let url = github::create_repo(&token, repo_name.trim(), private, description.trim()).await?;
    let visibility = if private { "private" } else { "public" };
    let conn = db.0.lock().await;
    solution::set_github(&conn, solution_id, Some(&url), Some(visibility), "created")
        .await
        .map_err(to_message)?;
    Ok(url)
}
