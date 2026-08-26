//! Screens, APIs and database tables on a work item.
//!
//! Product's asks and the developers' plan are the same rows at different
//! stages — see `db::work_item_change` for why that is one table rather than
//! two. The commands here are thin; the judgement about what a Solution's type
//! can carry lives in the model, so the UI and the AI prompt cannot disagree.

use super::{to_message, AppDb};
use crate::db::{solution, work_item_change};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemChangeDto {
    pub id: i64,
    pub work_item_id: i64,
    /// Null while it is still Product's ask, unassigned to any Solution.
    pub solution_id: Option<i64>,
    pub kind: String,
    pub action: String,
    pub name: String,
    pub detail: String,
    pub mockup_path: Option<String>,
}

impl From<work_item_change::WorkItemChange> for WorkItemChangeDto {
    fn from(c: work_item_change::WorkItemChange) -> Self {
        WorkItemChangeDto {
            id: c.id,
            work_item_id: c.work_item_id,
            solution_id: c.solution_id,
            kind: c.kind,
            action: c.action,
            name: c.name,
            detail: c.detail,
            mockup_path: c.mockup_path,
        }
    }
}

#[tauri::command]
pub async fn list_work_item_changes(
    db: State<'_, AppDb>,
    work_item_id: i64,
) -> Result<Vec<WorkItemChangeDto>, String> {
    let conn = db.0.lock().await;
    let all = work_item_change::list_for_item(&conn, work_item_id)
        .await
        .map_err(to_message)?;
    Ok(all.into_iter().map(WorkItemChangeDto::from).collect())
}

/// One thing that can change, as the form needs it: what to store, what to
/// call it, which family it belongs under, and an example of the shape of a
/// name.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeKindDto {
    pub id: String,
    pub label: String,
    pub heading: String,
    pub group: String,
    pub group_label: String,
    pub example: String,
}

/// The whole vocabulary, in family order.
///
/// Sent whole rather than only the allowed subset, because a list of changes
/// already recorded has to be labelled too — including rows against a Solution
/// nobody has selected. The subset a Solution can *carry* is a separate
/// question, answered by `change_kinds_for_solution`.
#[tauri::command]
pub async fn change_kinds() -> Result<Vec<ChangeKindDto>, String> {
    Ok(work_item_change::KINDS
        .iter()
        .map(|k| ChangeKindDto {
            id: k.id.to_string(),
            label: k.label.to_string(),
            heading: k.heading.to_string(),
            group: k.group.to_string(),
            group_label: work_item_change::GROUPS
                .iter()
                .find(|(id, _)| *id == k.group)
                .map(|(_, label)| (*label).to_string())
                .unwrap_or_default(),
            example: k.example.to_string(),
        })
        .collect())
}

/// One entry of a batch, and what became of it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddOutcomeDto {
    pub kind: String,
    pub name: String,
    pub id: Option<i64>,
    /// Why it did not go in. Null when it did.
    pub refused: Option<String>,
}

/// What the form sends for one ticked or typed thing.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewChange {
    pub solution_id: Option<i64>,
    pub kind: String,
    pub action: String,
    pub name: String,
    pub detail: String,
}

/// Records several things at once — the five screens somebody just ticked.
///
/// Every entry comes back named with what happened to it. A duplicate among
/// eight is the ordinary case and must not fail the other seven, but it must
/// not be swallowed either: the form says which ones it skipped and why.
#[tauri::command]
pub async fn add_work_item_changes(
    db: State<'_, AppDb>,
    work_item_id: i64,
    entries: Vec<NewChange>,
) -> Result<Vec<AddOutcomeDto>, String> {
    let rows: Vec<(Option<i64>, String, String, String, String)> = entries
        .into_iter()
        .map(|e| (e.solution_id, e.kind, e.action, e.name, e.detail))
        .collect();
    let conn = db.0.lock().await;
    Ok(work_item_change::add_many(&conn, work_item_id, &rows)
        .await
        .map_err(to_message)?
        .into_iter()
        .map(|o| AddOutcomeDto {
            kind: o.kind,
            name: o.name,
            id: o.id,
            refused: o.refused,
        })
        .collect())
}

/// Writes the one "what needs to change" across everything just ticked.
#[tauri::command]
pub async fn set_work_item_change_detail(
    db: State<'_, AppDb>,
    ids: Vec<i64>,
    detail: String,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    work_item_change::set_detail_many(&conn, &ids, &detail)
        .await
        .map_err(to_message)
}

/// Adds a screen, API or table. `solution_id` is null for Product's ask.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn add_work_item_change(
    db: State<'_, AppDb>,
    work_item_id: i64,
    solution_id: Option<i64>,
    kind: String,
    action: String,
    name: String,
    detail: String,
) -> Result<i64, String> {
    let conn = db.0.lock().await;
    work_item_change::add(
        &conn,
        work_item_id,
        solution_id,
        &kind,
        &action,
        &name,
        &detail,
    )
    .await
    .map_err(to_message)
}

/// Points an ask at the Solution that will build it, or back at nobody.
#[tauri::command]
pub async fn assign_work_item_change(
    db: State<'_, AppDb>,
    id: i64,
    solution_id: Option<i64>,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    work_item_change::assign(&conn, id, solution_id)
        .await
        .map_err(to_message)
}

#[tauri::command]
pub async fn update_work_item_change(
    db: State<'_, AppDb>,
    id: i64,
    action: String,
    name: String,
    detail: String,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    work_item_change::update(&conn, id, &action, &name, &detail)
        .await
        .map_err(to_message)
}

#[tauri::command]
pub async fn delete_work_item_change(db: State<'_, AppDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    work_item_change::delete(&conn, id).await.map_err(to_message)
}

/// Which kinds this Solution's type can carry, so the form offers exactly
/// those. Asked of the backend rather than duplicated in the UI: two copies of
/// this rule would drift, and the drift would only show as a rejected save.
#[tauri::command]
pub async fn change_kinds_for_solution(
    db: State<'_, AppDb>,
    solution_id: i64,
) -> Result<Vec<String>, String> {
    let conn = db.0.lock().await;
    let Some(row) = solution::find_by_id(&conn, solution_id)
        .await
        .map_err(to_message)?
    else {
        return Err("that Solution no longer exists".into());
    };
    Ok(work_item_change::kinds_for(&row.solution_type)
        .iter()
        .map(|k| k.to_string())
        .collect())
}

/// Links a screen to the mockup that shows it, or clears the link.
///
/// Without this, screens and pictures were two lists side by side and the model
/// got a pile of images with a list of names, left to guess the pairing.
#[tauri::command]
pub async fn set_change_mockup(
    db: State<'_, AppDb>,
    id: i64,
    mockup_path: Option<String>,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    work_item_change::set_mockup(&conn, id, mockup_path.as_deref())
        .await
        .map_err(to_message)
}

/// What is already recorded against a Solution, to tick from.
///
/// There is no separate catalogue of a Solution's endpoints and screens, and
/// inventing one would mean a second place to keep in step. The union of every
/// change anybody has recorded is it, and it grows as the team works.
#[tauri::command]
pub async fn solution_catalogue(
    db: State<'_, AppDb>,
    solution_id: i64,
) -> Result<Vec<CatalogueEntry>, String> {
    let conn = db.0.lock().await;
    Ok(work_item_change::catalogue_for_solution(&conn, solution_id)
        .await
        .map_err(to_message)?
        .into_iter()
        .map(|(kind, name)| CatalogueEntry { kind, name })
        .collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogueEntry {
    pub kind: String,
    pub name: String,
}

/// One thing that appears to exist already, and how this app came to think so.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub name: String,
    /// "recorded" — somebody has planned work against it before — or the folder
    /// it was found in. **The provenance is shown**, because a name read off
    /// the disk is a guess about what the team calls that screen, and a guess
    /// presented as a fact is how a plan ends up naming a file instead of a
    /// feature.
    pub found_in: String,
}

/// What already exists of one kind, for a Solution — to suggest rather than
/// make somebody remember.
///
/// Two sources, in this order:
///
/// 1. **What has been recorded.** Every change anybody has planned against this
///    Solution of this kind. This is the team's own vocabulary and wins.
/// 2. **What is on disk**, in the folder the Product's Develop rules say this
///    kind lives in. Nothing is scanned when the rules say nothing: guessing
///    that screens are probably in `src/pages` would produce confident
///    suggestions for a repository laid out some other way.
///
/// Names come from file stems, with an `index` file taking its folder's name —
/// which is how a component in `Basket/index.tsx` is called Basket by everyone
/// except the filesystem.
#[tauri::command]
pub async fn suggest_change_names(
    db: State<'_, AppDb>,
    solution_id: i64,
    kind: String,
) -> Result<Vec<Suggestion>, String> {
    let (local_path, location) = {
        let conn = db.0.lock().await;
        let Some(sol) = solution::find_by_id(&conn, solution_id)
            .await
            .map_err(to_message)?
        else {
            return Err("that Solution no longer exists".into());
        };
        let location = crate::db::developer_rules::for_product(&conn, sol.product_id)
            .await
            .map_err(to_message)?
            .map(|r| crate::db::developer_rules::location_of(&r.kind_locations, &kind))
            .unwrap_or_default();
        (sol.local_path, location)
    };

    let mut out: Vec<Suggestion> = Vec::new();
    {
        let conn = db.0.lock().await;
        for (found_kind, name) in work_item_change::catalogue_for_solution(&conn, solution_id)
            .await
            .map_err(to_message)?
        {
            if found_kind == kind {
                out.push(Suggestion { name, found_in: "recorded".into() });
            }
        }
    }

    // Nothing said about where this kind lives, or nowhere to look: the
    // recorded list is the whole answer, and saying so beats inventing a
    // convention this repository may not follow.
    let Some(root) = local_path.filter(|_| !location.is_empty()) else {
        return Ok(out);
    };
    let folder = std::path::Path::new(&root).join(location.replace('\\', "/"));
    for name in names_in(&folder) {
        if !out.iter().any(|s| s.name.eq_ignore_ascii_case(&name)) {
            out.push(Suggestion { name, found_in: location.clone() });
        }
    }
    Ok(out)
}

/// The names of the things directly in a folder.
///
/// One level deep on purpose. A recursive walk of `src` on a real repository
/// returns thousands of files, and a suggestion list nobody can read is the
/// same as no suggestions — while being slower and hiding the good ones.
fn names_in(folder: &std::path::Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut found: Vec<String> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let name = if path.is_dir() {
            path.file_name().map(|n| n.to_string_lossy().to_string())
        } else {
            let stem = path.file_stem().map(|n| n.to_string_lossy().to_string());
            match stem.as_deref() {
                // `Basket/index.tsx` is the Basket component to everybody
                // except the filesystem.
                Some("index") | Some("mod") => path
                    .parent()
                    .and_then(|p| p.file_name())
                    .map(|n| n.to_string_lossy().to_string()),
                _ => stem,
            }
        };
        let Some(name) = name else { continue };
        // Dotfiles and test siblings are not things anybody plans work against.
        if name.starts_with('.') || name.ends_with(".test") || name.ends_with(".spec") {
            continue;
        }
        if !found.iter().any(|f| f.eq_ignore_ascii_case(&name)) {
            found.push(name);
        }
    }
    found.sort();
    found
}
