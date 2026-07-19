//! The Developer Workspace: opening a Solution's working copy, and reviewing
//! what has changed in it against the developer rules.

use super::{to_message, AppDb};
use crate::db::{developer_rules, solution};
use crate::{review, workspace};
use serde::Serialize;
use tauri::State;

/// Resolves a Solution's working copy, with a message that says what to do when
/// there isn't one.
async fn root_for(conn: &turso::Connection, solution_id: i64) -> Result<String, String> {
    let Some(row) = solution::find_by_id(conn, solution_id)
        .await
        .map_err(to_message)?
    else {
        return Err("that Solution no longer exists".into());
    };
    row.local_path.filter(|p| !p.trim().is_empty()).ok_or_else(|| {
        format!(
            "'{}' has no folder on this machine yet. Point it at the working copy to open it — \
             a linked GitHub repository is not the same as a checkout.",
            row.name
        )
    })
}

#[tauri::command]
pub async fn set_solution_path(
    db: State<'_, AppDb>,
    solution_id: i64,
    local_path: Option<String>,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    solution::set_local_path(&conn, solution_id, local_path.as_deref())
        .await
        .map_err(to_message)
}

#[tauri::command]
pub async fn read_solution_tree(
    db: State<'_, AppDb>,
    solution_id: i64,
) -> Result<workspace::FileTree, String> {
    let root = {
        let conn = db.0.lock().await;
        root_for(&conn, solution_id).await?
    };
    workspace::read_tree(&root)
}

#[tauri::command]
pub async fn read_solution_file(
    db: State<'_, AppDb>,
    solution_id: i64,
    path: String,
) -> Result<String, String> {
    let root = {
        let conn = db.0.lock().await;
        root_for(&conn, solution_id).await?
    };
    // `workspace::read_file` refuses anything outside the root. The path comes
    // from the frontend and is treated as untrusted.
    workspace::read_file(&root, &path)
}

/// What changed in the working copy, and what the developer rules make of it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeReviewDto {
    pub changes: Vec<workspace::FileChange>,
    pub report: review::ReviewReport,
    /// True when this Product has no developer rules, so the review checked
    /// nothing. Silence because there is nothing to check reads exactly like
    /// silence because everything passed.
    pub no_rules: bool,
}

#[tauri::command]
pub async fn review_solution_changes(
    db: State<'_, AppDb>,
    solution_id: i64,
) -> Result<ChangeReviewDto, String> {
    let (root, rules) = {
        let conn = db.0.lock().await;
        let root = root_for(&conn, solution_id).await?;
        let Some(row) = solution::find_by_id(&conn, solution_id)
            .await
            .map_err(to_message)?
        else {
            return Err("that Solution no longer exists".into());
        };
        let rules = developer_rules::get_for_product(&conn, row.product_id)
            .await
            .map_err(to_message)?;
        (root, rules)
    };
    let no_rules = rules.is_none();
    let rules = rules.unwrap_or_default();
    let changes = workspace::read_changes(&root)?;
    let report = review::review(&changes, &rules);
    Ok(ChangeReviewDto { changes, report, no_rules })
}
