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
use crate::git::vcs;
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
    /// Whether this pair's plan has been approved. Carried on the run rather
    /// than looked up per row by the panel, so "Start all (n)" can count what
    /// would actually start instead of offering a number that starts nothing.
    pub plan_approved: bool,
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
                plan_approved: plan.approved_at > 0,
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
    let conn = db.0.lock().await;
    prepare_run(&conn, work_item_id, solution_id).await
}

/// The body of `start_run`, over a plain connection.
///
/// Split out so the whole loop — plan, worktree, brief, commit, merge — can be
/// driven end to end in a test against a real repository. The command is a thin
/// wrapper, so what the test exercises is what the app runs, rather than a
/// second copy of the sequence that could drift from it.
pub(crate) async fn prepare_run(
    conn: &turso::Connection,
    work_item_id: i64,
    solution_id: i64,
) -> Result<StartedRun, String> {
    use crate::agent::handover;

    let (root, branch, clone_from, brief, brief_path, attempt, run_start) = {
        let Some(plan) = work_item_plan::list_for_item(conn, work_item_id)
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
        // Enforced here rather than only on the button, because this is the
        // point where a worktree gets made and an agent is handed a brief. A UI
        // that hides Start is a courtesy; this is the actual gate, and it also
        // covers "start all" and anything added later that reaches this path.
        //
        // Editing or regenerating the plan sets `approved_at` back to 0, so this
        // is checking consent to *this* version, not to some earlier one.
        if plan.approved_at == 0 {
            return Err(
                "this plan has not been approved yet. Read it and press Approve on the plan \
                 first — a run makes a checkout and hands an agent a brief, so it waits on \
                 somebody having agreed to what it says."
                    .into(),
            );
        }
        let Some(row) = solution::find_by_id(conn, solution_id)
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
            Some(command) => crate::tooling::dev_runner::custom(&command).start,
            None => crate::tooling::dev_runner::detect(std::path::Path::new(&root))
                .map(|d| d.start)
                .unwrap_or_default(),
        };
        let item = work_item::find_by_id(conn, work_item_id)
            .await
            .map_err(to_message)?
            .ok_or("that work item no longer exists")?;
        let attempt = change_run::list_for_item(conn, work_item_id)
            .await
            .map_err(to_message)?
            .len();
        // The brief is built by the existing assembler, unchanged — this round
        // only changes *where* it is written.
        let brief = super::workspace::build_handover_brief(conn, &item, solution_id).await?;
        let brief_path = handover::brief_path(&item.title, attempt);
        (root, plan.branch_name, plan.clone_from, brief, brief_path, attempt, run_start)
    };
    let _ = attempt;

    // The checkout comes first: the brief is written into it, not into the main
    // working copy, so an agent reading its brief is already in its own folder.
    let worktree = vcs::add_worktree(&root, &branch, &clone_from)?;
    crate::files::emit::write_generated(
        &worktree,
        &[crate::files::emit::EmitFile {
            rel_path: brief_path.clone(),
            contents: brief,
        }],
    )?;

    let run_id = {
        let id = change_run::prepare(conn, work_item_id, solution_id, &brief_path)
            .await
            .map_err(to_message)?;
        change_run::set_workspace(conn, id, &worktree, "")
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

/// The branch and base a run works on, with its Solution's repository.
///
/// Both come from the work item's build plan, not from anything invented here —
/// the same pair `start_run` cut the worktree from.
async fn branch_of_run(
    db: &State<'_, AppDb>,
    run_id: i64,
) -> Result<(String, String, String), String> {
    let conn = db.0.lock().await;
    let Some(run) = change_run::find_by_id(&conn, run_id)
        .await
        .map_err(to_message)?
    else {
        return Err("that run no longer exists".into());
    };
    let Some(plan) = work_item_plan::list_for_item(&conn, run.work_item_id)
        .await
        .map_err(to_message)?
        .into_iter()
        .find(|p| p.solution_id == run.solution_id)
    else {
        return Err("this run's build plan has gone, so its branch is unknown".into());
    };
    if plan.branch_name.trim().is_empty() {
        return Err("this run has no branch name on its build plan".into());
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
        .ok_or("that run's Solution has no folder on this machine")?;
    // An empty base means the plan never said; main is the only sane guess and
    // it is the same one add_worktree made.
    let base = if plan.clone_from.trim().is_empty() {
        "main".to_string()
    } else {
        plan.clone_from
    };
    Ok((root, plan.branch_name, base))
}

/// Whether a run's branch would merge cleanly — checked without touching the
/// working copy, so "this will be a fight" is knowable before committing to it.
#[tauri::command]
pub async fn preview_run_merge(
    db: State<'_, AppDb>,
    run_id: i64,
) -> Result<vcs::MergePreview, String> {
    let (root, branch, base) = branch_of_run(&db, run_id).await?;
    vcs::merge_preview(&root, &branch, &base)
}

/// Brings a run's branch home.
///
/// Deliberately a press rather than something settling a run does for you: this
/// is the one operation in the feature that rewrites shared history instead of
/// a scratch folder.
#[tauri::command]
pub async fn merge_run_branch(
    db: State<'_, AppDb>,
    run_id: i64,
) -> Result<vcs::MergeOutcome, String> {
    let (root, branch, base) = branch_of_run(&db, run_id).await?;
    vcs::merge_branch(&root, &branch, &base)
}

/// Abandons a conflicted merge, putting the checkout back as it was.
#[tauri::command]
pub async fn abort_run_merge(db: State<'_, AppDb>, run_id: i64) -> Result<(), String> {
    let (root, _, _) = branch_of_run(&db, run_id).await?;
    vcs::abort_merge(&root)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;
    use crate::db::{work_item, work_item_plan};
    use std::path::Path;

    /// A real repository with one commit on `main`, nested a level down so the
    /// worktrees (which land beside it) cannot collide between tests.
    fn temp_repo(name: &str) -> Option<std::path::PathBuf> {
        let enclosing = std::env::temp_dir().join(format!(
            "coperativeai-loop-{}-{name}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&enclosing);
        let dir = enclosing.join("repo");
        std::fs::create_dir_all(&dir).ok()?;
        let run = |args: &[&str]| {
            std::process::Command::new("git")
                .current_dir(&dir)
                .args(args)
                .output()
                .ok()
                .map(|o| o.status.success())
                .unwrap_or(false)
        };
        if !run(&["init", "-b", "main"]) {
            return None;
        }
        run(&["config", "user.email", "t@example.invalid"]);
        run(&["config", "user.name", "Test"]);
        std::fs::write(dir.join("README.md"), "hello").ok()?;
        run(&["add", "-A"]);
        run(&["commit", "-m", "first"]);
        Some(dir)
    }

    /// Stands in for the agent: writes a file in the run's own checkout and
    /// commits it, which is all the rest of the loop needs from that step.
    fn agent_commits(worktree: &str, file: &str, text: &str) {
        std::fs::write(Path::new(worktree).join(file), text).expect("write");
        for args in [["add", "-A"], ["commit", "-m"]] {
            let mut cmd = std::process::Command::new("git");
            cmd.current_dir(worktree).arg(args[0]).arg(args[1]);
            if args[0] == "commit" {
                cmd.arg("agent work");
            }
            cmd.output().expect("git");
        }
    }

    /// Sets a Product up the way the app does: a Solution pointed at a real
    /// repository, a work item, and a build plan naming the branch.
    async fn product_with_run(
        conn: &turso::Connection,
        product_id: i64,
        root: &str,
        title: &str,
        branch: &str,
    ) -> (i64, i64) {
        let solution_id = solution::create(conn, "Shop API", product_id, "api", "{}")
            .await
            .expect("solution");
        solution::set_local_path(conn, solution_id, Some(root))
            .await
            .expect("point the Solution at the repo");
        let item_id = work_item::create(conn, title, "feature", product_id, None, None)
            .await
            .expect("work item");
        let plan_id = work_item_plan::attach(conn, item_id, solution_id)
            .await
            .expect("tick the Solution as affected");
        work_item_plan::set_written(conn, plan_id, "Add it", "It works", branch, "main", "[]")
            .await
            .expect("write the plan");
        // Part of the loop now: a run refuses to start until somebody has read
        // the plan and agreed to it.
        work_item_plan::approve(conn, item_id, solution_id)
            .await
            .expect("approve the plan");
        (item_id, solution_id)
    }

    /// **The gate.** A run makes a checkout and hands an agent a brief, so it
    /// waits on a person. Enforced in `prepare_run` rather than only by hiding a
    /// button, because "start all" and anything added later reach this same path.
    #[tokio::test]
    async fn a_run_will_not_start_until_the_plan_is_approved() {
        let Some(dir) = temp_repo("ungated") else {
            eprintln!("skipped: git is not usable here");
            return;
        };
        let root = dir.to_str().expect("utf-8");
        let (conn, product_id) = db_with_product().await;
        let (item_id, solution_id) =
            product_with_run(&conn, product_id, root, "Add checkout", "feature/9-checkout").await;

        work_item_plan::unapprove(&conn, item_id, solution_id)
            .await
            .expect("withdraw approval");

        let err = prepare_run(&conn, item_id, solution_id)
            .await
            .map(|s| s.branch)
            .expect_err("must refuse an unapproved plan");
        assert!(err.contains("not been approved"), "got: {err}");

        // And nothing was made on the way to refusing — a half-prepared run
        // would leave a checkout nobody asked for.
        let runs = change_run::list_for_product(&conn, product_id).await.expect("runs");
        assert!(
            runs.iter().all(|r| r.worktree_path.is_empty()),
            "a refused run must not leave a checkout behind"
        );

        // Approving is all that was missing.
        work_item_plan::approve(&conn, item_id, solution_id)
            .await
            .expect("approve");
        prepare_run(&conn, item_id, solution_id)
            .await
            .map(|s| s.branch)
            .expect("starts once approved");
    }

    /// Consent was given to the plan as it read at the time. Editing it makes a
    /// different plan, and an approval that survived the rewrite would let an
    /// agent build something nobody agreed to — which is the whole point of the
    /// gate.
    #[tokio::test]
    async fn editing_the_plan_withdraws_approval() {
        let Some(dir) = temp_repo("edited") else {
            eprintln!("skipped: git is not usable here");
            return;
        };
        let root = dir.to_str().expect("utf-8");
        let (conn, product_id) = db_with_product().await;
        let (item_id, solution_id) =
            product_with_run(&conn, product_id, root, "Add checkout", "feature/9-checkout").await;

        let plan_id = work_item_plan::list_for_item(&conn, item_id)
            .await
            .expect("plans")[0]
            .id;
        work_item_plan::set_written(
            &conn,
            plan_id,
            "Actually, rewrite the payment module",
            "It works",
            "feature/9-checkout",
            "main",
            "[]",
        )
        .await
        .expect("rewrite the plan");

        let err = prepare_run(&conn, item_id, solution_id)
            .await
            .map(|s| s.branch)
            .expect_err("the rewritten plan needs approving again");
        assert!(err.contains("not been approved"), "got: {err}");
    }

    /// The AI's half withdraws it too, and that matters more: a regeneration can
    /// propose different files and a different API, so inheriting the approval
    /// would have the AI approving its own new plan.
    #[tokio::test]
    async fn regenerating_the_schemas_withdraws_approval_as_well() {
        let (conn, product_id) = db_with_product().await;
        let solution_id = solution::create(&conn, "Shop API", product_id, "api", "{}")
            .await
            .expect("solution");
        let item_id = work_item::create(&conn, "Add checkout", "feature", product_id, None, None)
            .await
            .expect("work item");
        let plan_id = work_item_plan::attach(&conn, item_id, solution_id)
            .await
            .expect("attach");
        work_item_plan::approve(&conn, item_id, solution_id)
            .await
            .expect("approve");

        work_item_plan::set_generated(&conn, plan_id, "{}", "{}", "src/pay.rs")
            .await
            .expect("regenerate");

        let plan = &work_item_plan::list_for_item(&conn, item_id).await.expect("plans")[0];
        assert_eq!(
            plan.approved_at, 0,
            "a fresh generation must not inherit the old approval"
        );
    }

    /// **The whole loop, on a real Product against a real repository.**
    ///
    /// Product → Solution pointed at a repo → work item → build plan → run
    /// prepared (its own branch, its own checkout, its brief written into it) →
    /// the agent commits → the branch comes home. Every step is the code the app
    /// runs, not a second copy of the sequence that could drift from it.
    #[tokio::test]
    async fn a_work_item_goes_from_plan_to_merged() {
        let Some(dir) = temp_repo("full") else {
            eprintln!("skipped: git is not usable here");
            return;
        };
        let root = dir.to_str().expect("utf-8");
        let (conn, product_id) = db_with_product().await;
        let (item_id, solution_id) =
            product_with_run(&conn, product_id, root, "Add checkout", "feature/9-checkout").await;

        // Start the run: a checkout of its own, on its own branch.
        let started = prepare_run(&conn, item_id, solution_id).await.expect("start the run");
        assert_eq!(started.branch, "feature/9-checkout");
        assert!(Path::new(&started.worktree_path).is_dir(), "the run has its own folder");

        // The brief the agent reads is inside that folder, not the main copy.
        let brief = Path::new(&started.worktree_path).join(&started.brief_path);
        assert!(brief.is_file(), "the brief is written where the agent will be");
        let text = std::fs::read_to_string(&brief).expect("read brief");
        assert!(text.contains("Add checkout"), "the brief names the work");
        assert!(
            !dir.join(&started.brief_path).exists(),
            "and not into the main checkout"
        );

        // The run is recorded, so the panel finds it again after a restart.
        let runs = change_run::list_for_product(&conn, product_id).await.expect("runs");
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].worktree_path, started.worktree_path);

        // The agent does its work.
        agent_commits(&started.worktree_path, "checkout.rs", "fn pay() {}");

        // Bringing it home: checked first, then done.
        let preview = vcs::merge_preview(root, &started.branch, "main").expect("preview");
        assert!(preview.clean, "nothing else touched this file: {preview:?}");
        assert_eq!(preview.commits_ahead, 1);
        let outcome = vcs::merge_branch(root, &started.branch, "main").expect("merge");
        assert!(outcome.merged);
        assert!(dir.join("checkout.rs").is_file(), "the work landed on main");

        let _ = std::fs::remove_dir_all(dir.parent().unwrap_or(&dir));
    }

    /// **Two work items at once** — what the worktrees exist for. Both run
    /// against one Solution without sharing a checkout, and the second one home
    /// is the merge that has to be resolved.
    #[tokio::test]
    async fn two_runs_on_one_solution_stay_apart_and_the_second_conflicts() {
        let Some(dir) = temp_repo("parallel") else {
            eprintln!("skipped: git is not usable here");
            return;
        };
        let root = dir.to_str().expect("utf-8");
        let (conn, product_id) = db_with_product().await;

        // One Solution, two work items — the case that used to overwrite itself.
        let (first_item, solution_id) =
            product_with_run(&conn, product_id, root, "Add checkout", "feature/9-checkout").await;
        let second_item =
            work_item::create(&conn, "Add refunds", "feature", product_id, None, None)
                .await
                .expect("second item");
        let plan = work_item_plan::attach(&conn, second_item, solution_id)
            .await
            .expect("attach");
        work_item_plan::set_written(
            &conn, plan, "Add it", "It works", "feature/10-refunds", "main", "[]",
        )
        .await
        .expect("plan");
        work_item_plan::approve(&conn, second_item, solution_id)
            .await
            .expect("approve the second plan too");

        let a = prepare_run(&conn, first_item, solution_id).await.expect("first run");
        let b = prepare_run(&conn, second_item, solution_id).await.expect("second run");
        assert_ne!(a.worktree_path, b.worktree_path, "each run gets its own checkout");

        // Both agents edit the same file — the collision this design expects.
        agent_commits(&a.worktree_path, "shared.rs", "fn a() {}");
        agent_commits(&b.worktree_path, "shared.rs", "fn b() {}");

        // Neither disturbed the other: each checkout still holds its own work.
        let read =
            |wt: &str| std::fs::read_to_string(Path::new(wt).join("shared.rs")).expect("read");
        assert_eq!(read(&a.worktree_path), "fn a() {}");
        assert_eq!(read(&b.worktree_path), "fn b() {}");

        // First home merges; the second is reported as a fight before it starts.
        assert!(vcs::merge_branch(root, &a.branch, "main").expect("first").merged);
        let preview = vcs::merge_preview(root, &b.branch, "main").expect("preview");
        assert!(!preview.clean, "the second branch rewrote the same file");
        assert!(preview.conflicts.iter().any(|f| f.contains("shared.rs")));

        let _ = std::fs::remove_dir_all(dir.parent().unwrap_or(&dir));
    }
}
