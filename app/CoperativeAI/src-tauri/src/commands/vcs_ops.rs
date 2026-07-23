//! Committing, pushing, branch history, SSH, and draw.io documents.
//!
//! The database lock is released before anything slow: a push crosses the
//! network and `git log` walks a repository, and holding the connection across
//! either would freeze the rest of the app behind it.

use super::{to_message, AppDb};
use crate::db::{commit_policy, solution};
use crate::{drawio, ssh, vcs};
use serde::Serialize;
use tauri::State;

async fn root_for(db: &State<'_, AppDb>, solution_id: i64) -> Result<String, String> {
    let conn = db.0.lock().await;
    let Some(row) = solution::find_by_id(&conn, solution_id)
        .await
        .map_err(to_message)?
    else {
        return Err("that Solution no longer exists".into());
    };
    row.local_path
        .filter(|p| !p.trim().is_empty())
        .ok_or_else(|| format!("'{}' has no folder on this machine yet", row.name))
}

/// The recent history across every branch, for the picture.
#[tauri::command]
pub async fn branch_history(
    db: State<'_, AppDb>,
    solution_id: i64,
    limit: Option<usize>,
) -> Result<Vec<vcs::Commit>, String> {
    let root = root_for(&db, solution_id).await?;
    vcs::history(&root, limit.unwrap_or(120))
}

/// Commits, with the message someone typed or the file list when they did not.
#[tauri::command]
pub async fn commit_solution(
    db: State<'_, AppDb>,
    solution_id: i64,
    message: String,
    push: bool,
) -> Result<vcs::CommitResult, String> {
    let root = root_for(&db, solution_id).await?;
    vcs::commit_all(&root, &message, push)
}

/// The automatic commit, whose message is only ever the files that changed.
///
/// Separate from `commit_solution` rather than the same call with a blank
/// message, because the two differ in what they may do: this one **refuses
/// unless a policy is on**. A timer or a save handler that could commit
/// regardless of the setting is one bug away from committing for someone who
/// turned it off.
#[tauri::command]
pub async fn auto_commit_solution(
    db: State<'_, AppDb>,
    solution_id: i64,
    trigger: String,
) -> Result<vcs::CommitResult, String> {
    let policy = {
        let conn = db.0.lock().await;
        commit_policy::get(&conn, solution_id).await.map_err(to_message)?
    };
    let wanted = match trigger.as_str() {
        "save" => policy.mode == "onSave",
        "timer" => policy.mode == "interval",
        other => return Err(format!("unknown trigger '{other}'")),
    };
    if !wanted {
        return Ok(vcs::CommitResult {
            committed: false,
            message: String::new(),
            files: Vec::new(),
            pushed: None,
        });
    }
    let root = root_for(&db, solution_id).await?;
    // Empty message on purpose: `commit_all` fills in the file list, which is
    // the whole point of an automatic commit.
    vcs::commit_all(&root, "", policy.push)
}

#[tauri::command]
pub async fn push_solution(db: State<'_, AppDb>, solution_id: i64) -> Result<String, String> {
    let root = root_for(&db, solution_id).await?;
    vcs::push(&root)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitPolicyDto {
    pub mode: String,
    pub push: bool,
    pub interval_minutes: i64,
}

#[tauri::command]
pub async fn get_commit_policy(
    db: State<'_, AppDb>,
    solution_id: i64,
) -> Result<CommitPolicyDto, String> {
    let conn = db.0.lock().await;
    let policy = commit_policy::get(&conn, solution_id)
        .await
        .map_err(to_message)?;
    Ok(CommitPolicyDto {
        mode: policy.mode,
        push: policy.push,
        interval_minutes: policy.interval_minutes,
    })
}

#[tauri::command]
pub async fn set_commit_policy(
    db: State<'_, AppDb>,
    solution_id: i64,
    mode: String,
    push: bool,
    interval_minutes: i64,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    commit_policy::set(&conn, solution_id, &mode, push, interval_minutes)
        .await
        .map_err(to_message)
}

/* ── SSH ───────────────────────────────────────────────────────────────── */

#[tauri::command]
pub async fn ssh_status() -> Result<ssh::SshStatus, String> {
    Ok(ssh::status())
}

/// Generates a key pair. Only the public half comes back.
#[tauri::command]
pub async fn generate_ssh_key(comment: String) -> Result<String, String> {
    ssh::generate(&comment)
}

#[tauri::command]
pub async fn test_github_ssh() -> Result<String, String> {
    ssh::test_github()
}

/// Points a Solution's origin at SSH instead of HTTPS.
#[tauri::command]
pub async fn use_ssh_remote(db: State<'_, AppDb>, solution_id: i64) -> Result<String, String> {
    let root = root_for(&db, solution_id).await?;
    ssh::use_ssh_remote(&root)
}

/* ── draw.io ───────────────────────────────────────────────────────────── */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramFile {
    pub path: String,
    pub name: String,
}

/// Where a Product's diagrams live — the folder its framework files were
/// written to, so they are versioned with the code they describe.
async fn product_dir(db: &State<'_, AppDb>, product_id: i64) -> Result<String, String> {
    let conn = db.0.lock().await;
    let Some(product) = crate::db::product::find_by_id(&conn, product_id)
        .await
        .map_err(to_message)?
    else {
        return Err("that Product no longer exists".into());
    };
    let registered = crate::db::solution_management::list_all(&conn)
        .await
        .map_err(to_message)?
        .into_iter()
        .find(|s| s.filename == product.name)
        .map(|s| s.filepath);
    registered.ok_or_else(|| {
        format!(
            "'{}' has no folder yet — generate its framework files first, and the diagrams go \
             beside them",
            product.name
        )
    })
}

#[tauri::command]
pub async fn list_diagrams(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Vec<DiagramFile>, String> {
    // A Product with no folder has no diagrams, which is not an error worth
    // showing anyone — the panel simply offers to make the first one.
    let Ok(dir) = product_dir(&db, product_id).await else {
        return Ok(Vec::new());
    };
    Ok(drawio::list(&dir)
        .into_iter()
        .map(|path| DiagramFile {
            name: std::path::Path::new(&path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("diagram")
                .to_string(),
            path,
        })
        .collect())
}

/// Writes a draw.io document from nodes and edges.
#[tauri::command]
pub async fn save_diagram(
    db: State<'_, AppDb>,
    product_id: i64,
    name: String,
    nodes: Vec<drawio::Node>,
    edges: Vec<drawio::Edge>,
) -> Result<String, String> {
    let dir = product_dir(&db, product_id).await?;
    let xml = drawio::build(&name, &nodes, &edges);
    drawio::save(&dir, &name, &xml)
}

/// Opens a diagram in whatever draw.io the machine has.
#[tauri::command]
pub async fn open_diagram(path: String) -> Result<(), String> {
    drawio::open(&path)
}
