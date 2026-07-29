//! Execution runs: one checkout, one branch and one terminal each.
//!
//! This is what makes "have the AI execute them simultaneously" safe. Two work
//! items very often touch the same Solution, and two agents in one working copy
//! overwrite each other's edits and interleave their commits. Each run
//! therefore gets its own `git worktree` — a real checkout of the same
//! repository on its own branch, in its own folder.
//!
//! The branch and its base are not invented here: they are the ones already on
//! the work item's build plan, prefilled from the Develop Strategy's pattern.

use super::{to_message, AppDb};
use crate::db::{change_run, solution, work_item, work_item_plan};
use crate::vcs;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDto {
    pub id: i64,
    pub work_item_id: i64,
    pub work_item_title: String,
    pub solution_id: i64,
    pub solution_name: String,
    pub state: String,
    pub branch: String,
    pub worktree_path: String,
    pub terminal_id: String,
    pub brief_path: String,
    pub files_changed: i64,
}

/// Every run in a Product, and every (work item, Solution) that could become
/// one.
///
/// Planned-but-not-started pairs are listed alongside real runs so the panel
/// answers "what could I start?" as well as "what is going?". A pair with no
/// branch name is shown too, with an empty branch — refusing to list it would
/// hide the work rather than the problem.
#[tauri::command]
pub async fn list_runs(db: State<'_, AppDb>, product_id: i64) -> Result<Vec<RunDto>, String> {
    let conn = db.0.lock().await;
    let items = work_item::list_by_product(&conn, product_id)
        .await
        .map_err(to_message)?;
    let solutions = solution::list_by_product(&conn, product_id)
        .await
        .map_err(to_message)?;
    let runs = change_run::list_for_product(&conn, product_id)
        .await
        .map_err(to_message)?;

    let name_of = |id: i64| {
        solutions
            .iter()
            .find(|s| s.id == id)
            .map(|s| s.name.clone())
            .unwrap_or_else(|| format!("#{id}"))
    };
    let title_of = |id: i64| {
        items
            .iter()
            .find(|i| i.id == id)
            .map(|i| i.title.clone())
            .unwrap_or_else(|| format!("#{id}"))
    };

    let mut out = Vec::new();
    for item in &items {
        for plan in work_item_plan::list_for_item(&conn, item.id)
            .await
            .map_err(to_message)?
        {
            let existing = runs
                .iter()
                .find(|r| r.work_item_id == item.id && r.solution_id == plan.solution_id);
            out.push(RunDto {
                id: existing.map(|r| r.id).unwrap_or(0),
                work_item_id: item.id,
                work_item_title: title_of(item.id),
                solution_id: plan.solution_id,
                solution_name: name_of(plan.solution_id),
                // Zero id means "not started yet", which is what the panel
                // offers a Start button for.
                state: existing
                    .map(|r| r.state.clone())
                    .unwrap_or_else(|| "notStarted".into()),
                branch: plan.branch_name.clone(),
                worktree_path: existing.map(|r| r.worktree_path.clone()).unwrap_or_default(),
                terminal_id: existing.map(|r| r.terminal_id.clone()).unwrap_or_default(),
                brief_path: existing.map(|r| r.brief_path.clone()).unwrap_or_default(),
                files_changed: existing.map(|r| r.files_changed).unwrap_or(0),
            });
        }
    }
    Ok(out)
}

/// What starting a run produced.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartedRun {
    pub run_id: i64,
    pub worktree_path: String,
    pub branch: String,
    /// The brief, written inside the worktree.
    pub brief_path: String,
    /// Shown, never executed by the app — the terminal runs it.
    pub command: String,
    /// How to start the Solution running in the worktree, so a started run can
    /// boot the app alongside its agent. Empty when there is nothing detection
    /// recognises and no override — then no dev-server terminal is opened.
    pub run_start: String,
}

/// Prepares one (work item, Solution) to run: its own checkout, its own branch,
/// its own brief.
///
/// Deliberately stops short of running anything. The command comes back to be
/// typed into a terminal, exactly as the single-run path already works — an app
/// that silently started an agent that writes files would be doing the one
/// thing this whole design keeps as a deliberate press.
#[tauri::command]
pub async fn start_run(
    db: State<'_, AppDb>,
    work_item_id: i64,
    solution_id: i64,
) -> Result<StartedRun, String> {
    use crate::handover;

    let (root, branch, clone_from, brief, brief_path, attempt, run_start) = {
        let conn = db.0.lock().await;
        let Some(plan) = work_item_plan::list_for_item(&conn, work_item_id)
            .await
            .map_err(to_message)?
            .into_iter()
            .find(|p| p.solution_id == solution_id)
        else {
            return Err(
                "that Solution is not marked as affected by this work item — tick it on the build plan first"
                    .into(),
            );
        };
        if plan.branch_name.trim().is_empty() {
            return Err(
                "this run has no branch name. Set one on the build plan — a run needs its own \
                 branch, because that is what keeps it apart from the others."
                    .into(),
            );
        }
        let Some(row) = solution::find_by_id(&conn, solution_id)
            .await
            .map_err(to_message)?
        else {
            return Err("that Solution no longer exists".into());
        };
        // The Solution's own run command wins over detection, the same rule the
        // Run panel and the brief use. Kept before `local_path` is moved below.
        let run_override = row.run_command.clone().filter(|c| !c.trim().is_empty());
        let root = row.local_path.filter(|p| !p.trim().is_empty()).ok_or_else(|| {
            format!(
                "'{}' has no folder on this machine, so there is nothing to make a worktree from",
                row.name
            )
        })?;
        // Detection reads the same manifest the worktree will have — the repo is
        // one repository — so the command works run from the checkout below.
        let run_start = match run_override {
            Some(command) => crate::dev_runner::custom(&command).start,
            None => crate::dev_runner::detect(std::path::Path::new(&root))
                .map(|d| d.start)
                .unwrap_or_default(),
        };
        let item = work_item::find_by_id(&conn, work_item_id)
            .await
            .map_err(to_message)?
            .ok_or("that work item no longer exists")?;
        let attempt = change_run::list_for_item(&conn, work_item_id)
            .await
            .map_err(to_message)?
            .len();
        // The brief is built by the existing assembler, unchanged — this round
        // only changes *where* it is written.
        let brief = super::workspace::build_handover_brief(&conn, &item, solution_id).await?;
        let brief_path = handover::brief_path(&item.title, attempt);
        (root, plan.branch_name, plan.clone_from, brief, brief_path, attempt, run_start)
    };
    let _ = attempt;

    // The checkout comes first: the brief is written into it, not into the main
    // working copy, so an agent reading its brief is already in its own folder.
    let worktree = vcs::add_worktree(&root, &branch, &clone_from)?;
    crate::emit::write_generated(
        &worktree,
        &[crate::emit::EmitFile {
            rel_path: brief_path.clone(),
            contents: brief,
        }],
    )?;

    let run_id = {
        let conn = db.0.lock().await;
        let id = change_run::prepare(&conn, work_item_id, solution_id, &brief_path)
            .await
            .map_err(to_message)?;
        change_run::set_workspace(&conn, id, &worktree, "")
            .await
            .map_err(to_message)?;
        id
    };

    Ok(StartedRun {
        run_id,
        worktree_path: worktree,
        branch,
        command: handover::suggested_command(&brief_path),
        brief_path,
        run_start,
    })
}

/// The worktrees that exist for a Solution's repository, main checkout aside.
///
/// So the panel can show a run's own checkout is really there — and, for the
/// debt the plan flagged, surface a worktree left behind by a run somebody
/// walked away from, which is otherwise invisible until the disk fills.
#[tauri::command]
pub async fn list_run_worktrees(
    db: State<'_, AppDb>,
    solution_id: i64,
) -> Result<Vec<String>, String> {
    let root = {
        let conn = db.0.lock().await;
        let Some(row) = solution::find_by_id(&conn, solution_id)
            .await
            .map_err(to_message)?
        else {
            return Err("that Solution no longer exists".into());
        };
        row.local_path
            .filter(|p| !p.trim().is_empty())
            .ok_or("that Solution has no folder on this machine")?
    };
    // Only the run checkouts, never the main one — offering to remove the
    // repository itself is not a thing this button should do.
    Ok(vcs::list_worktrees(&root)?
        .into_iter()
        .filter(|p| p.contains(".coperativeai-worktrees"))
        .collect())
}

/// A checkout on disk that no run claims any more.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AbandonedWorktree {
    pub solution_id: i64,
    pub solution_name: String,
    pub path: String,
}

/// Run checkouts left behind across a Product.
///
/// The debt this closes: cleanup is offered, never forced, so a run somebody
/// walked away from keeps its worktree — and until now nothing ever mentioned
/// it again, which meant the only way to discover the pile was to run out of
/// disk. A worktree is "abandoned" when no `change_run` still points at it.
///
/// A Solution whose repository cannot be read is skipped rather than failing
/// the lot: one broken working copy must not hide every other Solution's
/// leftovers.
#[tauri::command]
pub async fn list_abandoned_worktrees(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Vec<AbandonedWorktree>, String> {
    let (solutions, claimed) = {
        let conn = db.0.lock().await;
        let solutions: Vec<(i64, String, Option<String>)> =
            solution::list_by_product(&conn, product_id)
                .await
                .map_err(to_message)?
                .into_iter()
                .map(|s| (s.id, s.name, s.local_path.filter(|p| !p.trim().is_empty())))
                .collect();
        let claimed: Vec<String> = change_run::list_for_product(&conn, product_id)
            .await
            .map_err(to_message)?
            .into_iter()
            .map(|r| r.worktree_path)
            .filter(|p| !p.trim().is_empty())
            .collect();
        (solutions, claimed)
    };

    let same = |a: &str, b: &str| a.replace('\\', "/").eq_ignore_ascii_case(&b.replace('\\', "/"));

    let mut out = Vec::new();
    for (solution_id, solution_name, root) in solutions {
        let Some(root) = root else { continue };
        let Ok(worktrees) = vcs::list_worktrees(&root) else {
            continue;
        };
        for path in worktrees {
            if !path.contains(".coperativeai-worktrees") {
                continue;
            }
            if claimed.iter().any(|c| same(c, &path)) {
                continue;
            }
            out.push(AbandonedWorktree {
                solution_id,
                solution_name: solution_name.clone(),
                path,
            });
        }
    }
    Ok(out)
}

/// Removes a leftover checkout by path.
///
/// The path is checked against that Solution's own worktrees before anything is
/// deleted — it arrives from the frontend, and a delete that trusted whatever
/// it was handed would be a way to remove any folder on the machine. The main
/// checkout is never a candidate, and `remove_worktree` still refuses while
/// there is uncommitted work in it.
#[tauri::command]
pub async fn remove_worktree_at(
    db: State<'_, AppDb>,
    solution_id: i64,
    path: String,
) -> Result<(), String> {
    let root = {
        let conn = db.0.lock().await;
        let Some(row) = solution::find_by_id(&conn, solution_id)
            .await
            .map_err(to_message)?
        else {
            return Err("that Solution no longer exists".into());
        };
        row.local_path
            .filter(|p| !p.trim().is_empty())
            .ok_or("that Solution has no folder on this machine")?
    };

    let same = |a: &str, b: &str| a.replace('\\', "/").eq_ignore_ascii_case(&b.replace('\\', "/"));
    let known = vcs::list_worktrees(&root)?;
    if !known
        .iter()
        .any(|w| same(w, &path) && w.contains(".coperativeai-worktrees"))
    {
        return Err(
            "that folder is not one of this Solution's run checkouts, so it was not removed".into(),
        );
    }
    vcs::remove_worktree(&root, &path)
}

/// Removes a finished run's checkout.
///
/// Refused while it holds uncommitted work — pulling a worktree from under an
/// agent, or from under output nobody has kept, destroys what the run was for.
#[tauri::command]
pub async fn discard_run_worktree(db: State<'_, AppDb>, run_id: i64) -> Result<(), String> {
    let (root, worktree) = {
        let conn = db.0.lock().await;
        let Some(run) = change_run::find_by_id(&conn, run_id)
            .await
            .map_err(to_message)?
        else {
            return Err("that run no longer exists".into());
        };
        if run.worktree_path.trim().is_empty() {
            return Ok(());
        }
        let Some(row) = solution::find_by_id(&conn, run.solution_id)
            .await
            .map_err(to_message)?
        else {
            return Err("that run's Solution no longer exists".into());
        };
        let root = row
            .local_path
            .filter(|p| !p.trim().is_empty())
            .ok_or("that run's Solution has no folder any more")?;
        (root, run.worktree_path)
    };

    vcs::remove_worktree(&root, &worktree)?;
    let conn = db.0.lock().await;
    change_run::set_workspace(&conn, run_id, "", "")
        .await
        .map_err(to_message)
}
