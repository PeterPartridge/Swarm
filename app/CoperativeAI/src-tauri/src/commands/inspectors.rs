//! The git hub and the test explorer: every Solution's working copy at once.
//!
//! **The database lock is released before anything slow runs.** A test suite can
//! take minutes and git can take seconds; holding the connection across either
//! would freeze every other part of the app behind it. Each command therefore
//! reads what it needs from the database inside a scope, drops the lock, and
//! only then touches the disk — the same shape the AI commands use.
//!
//! **A Solution that cannot be inspected reports why, and the rest still work.**
//! One Solution with no folder, or a folder that is not a repository, must not
//! blank the whole hub — that is the failure mode that makes a cross-Solution
//! view useless in exactly the situation it is for.

use super::{to_message, AppDb};
use crate::db::solution;
use crate::{test_runner, vcs, workspace};
use serde::Serialize;
use tauri::State;

/// One Solution's row in the git hub.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SolutionRepo {
    pub solution_id: i64,
    pub name: String,
    pub status: Option<vcs::RepoStatus>,
    /// Why there is no status — no folder linked, folder gone, not a repo.
    pub unavailable: Option<String>,
}

/// Every Solution in a Product, with its repository state.
#[tauri::command]
pub async fn product_git_overview(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Vec<SolutionRepo>, String> {
    let solutions = solutions_of(&db, product_id).await?;

    Ok(solutions
        .into_iter()
        .map(|(solution_id, name, root)| match root {
            None => SolutionRepo {
                solution_id,
                name,
                status: None,
                unavailable: Some(
                    "no folder on this machine yet — point it at a working copy".into(),
                ),
            },
            Some(root) => match vcs::status(&root) {
                Ok(status) => SolutionRepo { solution_id, name, status: Some(status), unavailable: None },
                Err(message) => SolutionRepo {
                    solution_id,
                    name,
                    status: None,
                    unavailable: Some(message),
                },
            },
        })
        .collect())
}

/// One Solution's changed files, with the diff for each.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SolutionChanges {
    pub solution_id: i64,
    pub name: String,
    pub changes: Vec<workspace::FileChange>,
    pub unavailable: Option<String>,
}

/// What has changed across every Solution in a Product.
///
/// This is what the Code area's git toggle shows: the same file list, filtered
/// to work in progress, with the diff attached so "what changed" needs no
/// second call.
#[tauri::command]
pub async fn product_changed_files(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Vec<SolutionChanges>, String> {
    let solutions = solutions_of(&db, product_id).await?;

    Ok(solutions
        .into_iter()
        .map(|(solution_id, name, root)| {
            let (changes, unavailable) = match root {
                None => (Vec::new(), Some("no folder on this machine yet".to_string())),
                Some(root) => match workspace::read_changes(&root) {
                    Ok(changes) => (changes, None),
                    Err(message) => (Vec::new(), Some(message)),
                },
            };
            SolutionChanges { solution_id, name, changes, unavailable }
        })
        .collect())
}

/// The three sides of one conflicted file.
#[tauri::command]
pub async fn read_conflict_sides(
    db: State<'_, AppDb>,
    solution_id: i64,
    path: String,
) -> Result<vcs::ConflictSides, String> {
    let root = root_for(&db, solution_id).await?;
    vcs::conflict_sides(&root, &path)
}

/// Stages a resolved file. Refuses while conflict markers remain.
#[tauri::command]
pub async fn mark_conflict_resolved(
    db: State<'_, AppDb>,
    solution_id: i64,
    path: String,
) -> Result<(), String> {
    let root = root_for(&db, solution_id).await?;
    vcs::mark_resolved(&root, &path)
}

/// The test suites in one Solution — its own command if it has one, otherwise
/// whatever detection finds.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SolutionSuites {
    pub solution_id: i64,
    pub name: String,
    pub suites: Vec<test_runner::Suite>,
    /// Set when the Solution's own command is in use, so the UI can say that
    /// detection was overridden rather than leaving someone puzzled about
    /// where the command came from.
    pub custom_command: Option<String>,
    pub unavailable: Option<String>,
}

/// Every test suite across a Product's Solutions.
#[tauri::command]
pub async fn list_test_suites(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Vec<SolutionSuites>, String> {
    let solutions = {
        let conn = db.0.lock().await;
        solution::list_by_product(&conn, product_id)
            .await
            .map_err(to_message)?
            .into_iter()
            .map(|s| {
                (
                    s.id,
                    s.name,
                    s.local_path.filter(|p| !p.trim().is_empty()),
                    s.test_command.filter(|c| !c.trim().is_empty()),
                )
            })
            .collect::<Vec<_>>()
    };

    Ok(solutions
        .into_iter()
        .map(|(solution_id, name, root, custom)| {
            let Some(root) = root else {
                return SolutionSuites {
                    solution_id,
                    name,
                    suites: Vec::new(),
                    custom_command: custom,
                    unavailable: Some("no folder on this machine yet".into()),
                };
            };
            let suites = match &custom {
                Some(command) => vec![test_runner::custom_suite(command)],
                None => test_runner::detect(std::path::Path::new(&root)),
            };
            let unavailable = suites.is_empty().then(|| {
                "nothing recognisable to run here — set a test command on this Solution".to_string()
            });
            SolutionSuites { solution_id, name, suites, custom_command: custom, unavailable }
        })
        .collect())
}

/// Runs every suite in one Solution.
///
/// One Solution at a time on purpose: the frontend loops, so results appear as
/// each Solution finishes rather than after the slowest one in the Product.
#[tauri::command]
pub async fn run_solution_tests(
    db: State<'_, AppDb>,
    solution_id: i64,
) -> Result<Vec<test_runner::SuiteRun>, String> {
    let (root, custom) = {
        let conn = db.0.lock().await;
        let Some(row) = solution::find_by_id(&conn, solution_id)
            .await
            .map_err(to_message)?
        else {
            return Err("that Solution no longer exists".into());
        };
        let root = row.local_path.filter(|p| !p.trim().is_empty()).ok_or_else(|| {
            format!("'{}' has no folder on this machine to run tests in", row.name)
        })?;
        (root, row.test_command.filter(|c| !c.trim().is_empty()))
    };

    let path = std::path::Path::new(&root);
    let suites = match &custom {
        Some(command) => vec![test_runner::custom_suite(command)],
        None => test_runner::detect(path),
    };
    if suites.is_empty() {
        return Err(
            "no test suite was found in this Solution — set a test command on it and try again"
                .into(),
        );
    }
    Ok(suites.iter().map(|suite| test_runner::run(path, suite)).collect())
}

/// Runs one named suite, so a single failing suite can be re-run alone.
#[tauri::command]
pub async fn run_test_suite(
    db: State<'_, AppDb>,
    solution_id: i64,
    kind: String,
    directory: String,
    command_line: String,
) -> Result<test_runner::SuiteRun, String> {
    let root = root_for(&db, solution_id).await?;
    let suite = test_runner::Suite {
        kind,
        directory,
        command_line,
        found_by: "re-run".into(),
    };
    Ok(test_runner::run(std::path::Path::new(&root), &suite))
}

#[tauri::command]
pub async fn set_solution_test_command(
    db: State<'_, AppDb>,
    solution_id: i64,
    command: Option<String>,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    solution::set_test_command(&conn, solution_id, command.as_deref())
        .await
        .map_err(to_message)
}

/// (id, name, working copy) for every Solution in a Product, with the lock
/// released before the caller touches any of them.
async fn solutions_of(
    db: &State<'_, AppDb>,
    product_id: i64,
) -> Result<Vec<(i64, String, Option<String>)>, String> {
    let conn = db.0.lock().await;
    Ok(solution::list_by_product(&conn, product_id)
        .await
        .map_err(to_message)?
        .into_iter()
        .map(|s| (s.id, s.name, s.local_path.filter(|p| !p.trim().is_empty())))
        .collect())
}

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
