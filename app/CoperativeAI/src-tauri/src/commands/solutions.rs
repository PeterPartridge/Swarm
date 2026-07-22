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
    pub test_command: Option<String>,
    pub language: Option<String>,
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
            test_command: s.test_command,
            language: s.language,
        }
    }
}

/// The languages a new Solution can be started in, each with its toolchain's
/// own generator. Shown in the form and editable before anything runs.
#[tauri::command]
pub async fn list_starters() -> Result<Vec<crate::starter::Starter>, String> {
    Ok(crate::starter::starters())
}

/// What creating a Solution with a starter did.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedSolution {
    pub solution_id: i64,
    /// None when no starter was chosen — creating a Solution without one stays
    /// perfectly valid, for a repository that already exists.
    pub started: Option<crate::starter::StarterRun>,
}

/// Creates a Solution and, when a starter was chosen, runs that language's
/// generator in a new folder.
///
/// **The Solution is created first and kept even if the generator fails.** The
/// record of what someone decided to build is worth more than the folder, and
/// rolling it back would lose the decision along with the error — leaving them
/// to retype everything to see the same message again. A failed run comes back
/// in `started` with the toolchain's own words, and the folder can be pointed
/// at or retried afterwards.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn create_solution_with_starter(
    db: State<'_, AppDb>,
    name: String,
    product_id: i64,
    solution_type: String,
    answers: String,
    starter_id: Option<String>,
    command: Option<String>,
    parent_dir: Option<String>,
) -> Result<CreatedSolution, String> {
    let solution_id = {
        let conn = db.0.lock().await;
        solution::create(&conn, &name, product_id, &solution_type, &answers)
            .await
            .map_err(to_message)?
    };

    let Some(starter_id) = starter_id.filter(|s| !s.trim().is_empty()) else {
        return Ok(CreatedSolution { solution_id, started: None });
    };
    let Some(parent) = parent_dir.filter(|p| !p.trim().is_empty()) else {
        return Err(
            "choose a folder to create the project in — a starter has to write somewhere".into(),
        );
    };

    // The command from the form wins over the stored template: it is the one
    // the person actually read before pressing the button.
    let template = command
        .filter(|c| !c.trim().is_empty())
        .or_else(|| crate::starter::find(&starter_id).map(|s| s.command))
        .unwrap_or_default();
    let filled = crate::starter::fill(&template, &name);

    let started = crate::starter::run(&parent, &name, &filled)?;

    {
        let conn = db.0.lock().await;
        solution::set_language(&conn, solution_id, Some(&starter_id))
            .await
            .map_err(to_message)?;
        // Only point the Solution at the folder if something was actually
        // created in it — a path recorded for a failed run is a working copy
        // that is not one.
        if started.succeeded {
            solution::set_local_path(&conn, solution_id, Some(&started.directory))
                .await
                .map_err(to_message)?;
        }
    }

    Ok(CreatedSolution { solution_id, started: Some(started) })
}

/// Runs a starter against a Solution that already exists.
///
/// Without this a failed starter was a dead end: the only ways out were to
/// point the Solution at a folder by hand or delete and recreate it, which
/// meant retyping the answers to see whether a toolchain had been installed
/// since. Same guards as creation — the command is the one shown in the form,
/// and the folder must still be empty.
#[tauri::command]
pub async fn start_existing_solution(
    db: State<'_, AppDb>,
    solution_id: i64,
    starter_id: String,
    command: Option<String>,
    parent_dir: String,
) -> Result<crate::starter::StarterRun, String> {
    let name = {
        let conn = db.0.lock().await;
        let Some(row) = solution::find_by_id(&conn, solution_id)
            .await
            .map_err(to_message)?
        else {
            return Err("that Solution no longer exists".into());
        };
        row.name
    };

    let template = command
        .filter(|c| !c.trim().is_empty())
        .or_else(|| crate::starter::find(&starter_id).map(|s| s.command))
        .unwrap_or_default();
    let started = crate::starter::run(&parent_dir, &name, &crate::starter::fill(&template, &name))?;

    {
        let conn = db.0.lock().await;
        solution::set_language(&conn, solution_id, Some(&starter_id))
            .await
            .map_err(to_message)?;
        if started.succeeded {
            solution::set_local_path(&conn, solution_id, Some(&started.directory))
                .await
                .map_err(to_message)?;
        }
    }
    Ok(started)
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
