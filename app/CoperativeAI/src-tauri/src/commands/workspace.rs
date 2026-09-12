//! The Developer Workspace: opening a Solution's working copy, and reviewing
//! what has changed in it against the developer rules.

use super::{to_message, AppDb};
use crate::db::{developer_rules, solution};
use crate::agent::review;
use crate::files::workspace;
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
    // The run whose checkout to walk. Without it this is the Solution's folder
    // — the default branch — which is what the Files pane shows when no agent
    // is selected. With one selected, the agent's own checkout is the tree
    // worth showing: it is where the files it added actually are.
    run_id: Option<i64>,
) -> Result<workspace::FileTree, String> {
    let root = {
        let conn = db.0.lock().await;
        root_for_run(&conn, solution_id, run_id).await?
    };
    workspace::read_tree(&root)
}

/// Which working copy to read: a run's own checkout, or the Solution's folder.
///
/// **A run's files are in the run's own checkout.** That is the point of giving
/// each one a worktree, and reading the Solution's folder instead answers about
/// the default branch — which is right when nobody is asking about a run, and
/// wrong the moment somebody is. A run row that predates its checkout falls back
/// rather than failing: the Solution's folder is still a truthful answer.
pub(crate) async fn root_for_run(
    conn: &turso::Connection,
    solution_id: i64,
    run_id: Option<i64>,
) -> Result<String, String> {
    match run_id {
        Some(id) => {
            let run = crate::db::change_run::find_by_id(conn, id)
                .await
                .map_err(to_message)?
                .ok_or("that run no longer exists")?;
            if run.worktree_path.trim().is_empty() {
                root_for(conn, solution_id).await
            } else {
                Ok(run.worktree_path)
            }
        }
        None => root_for(conn, solution_id).await,
    }
}

#[tauri::command]
pub async fn read_solution_file(
    db: State<'_, AppDb>,
    solution_id: i64,
    path: String,
    // The run whose copy to read. Without it this is the Solution's folder —
    // the default branch — which is what the Files pane shows when no agent is
    // selected. With an agent selected the file it wrote is the one to open,
    // and for a file it *added* the Solution's folder has nothing to open at
    // all.
    run_id: Option<i64>,
) -> Result<String, String> {
    let root = {
        let conn = db.0.lock().await;
        root_for_run(&conn, solution_id, run_id).await?
    };
    // `workspace::read_file` refuses anything outside the root. The path comes
    // from the frontend and is treated as untrusted.
    workspace::read_file(&root, &path)
}

/// Creates a new empty file in the working copy, then it can be opened and
/// edited like any other. Refused outside the Solution's folder or under
/// `.git`, same as every other write.
#[tauri::command]
pub async fn create_solution_file(
    db: State<'_, AppDb>,
    solution_id: i64,
    path: String,
) -> Result<(), String> {
    let root = {
        let conn = db.0.lock().await;
        root_for(&conn, solution_id).await?
    };
    workspace::create_file(&root, &path)
}

/// Makes one folder inside a Solution.
///
/// Its own command rather than a flag on file creation: an empty folder and
/// an empty file are different things to ask for, and a boolean at the call
/// site would read as neither.
#[tauri::command]
pub async fn create_solution_folder(
    db: State<'_, AppDb>,
    solution_id: i64,
    path: String,
) -> Result<(), String> {
    let root = {
        let conn = db.0.lock().await;
        root_for(&conn, solution_id).await?
    };
    workspace::create_folder(&root, &path)
}

/// What the coding pal said. `replacement` never touches disk from here — it
/// goes into the editor buffer, and the developer's own save is the gate.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PalDto {
    pub explanation: String,
    pub replacement: String,
    /// Forbidden technologies found in the proposal — shown, not enforced,
    /// because accepting is ungated everywhere in this app; but shown before
    /// the apply, not after the save.
    pub violations: Vec<String>,
    pub provider: String,
    pub model: String,
    pub reason: String,
    pub blocked: Option<super::work_items::BlockedDto>,
}

/// The in-editor coding pal: explain, refactor, document, or draft tests for
/// the open file. Gated by the Product AI policy, routed through the budget,
/// ledgered like every other AI action — an editor does not get its own
/// unmetered path.
#[tauri::command]
pub async fn ask_coding_pal(
    db: State<'_, AppDb>,
    solution_id: i64,
    path: String,
    action: String,
    instruction: String,
    selection: Option<String>,
) -> Result<PalDto, String> {
    use crate::ai::{backend, client};
    use crate::commands::ai_run;
    use crate::db::{product_policy, solution};

    const PURPOSE: &str = "codingPal";

    if !client::PAL_ACTIONS.contains(&action.as_str()) {
        return Err(format!(
            "'{action}' is not something the pal does — it can {}",
            client::PAL_ACTIONS.join(", ")
        ));
    }

    let (routed, prompt, product_id, disallowed) = {
        let conn = db.0.lock().await;
        let Some(solution_row) = solution::find_by_id(&conn, solution_id)
            .await
            .map_err(to_message)?
        else {
            return Err("that Solution no longer exists".into());
        };
        let product_id = solution_row.product_id;
        // Deny-by-default, the same policy that gates every Product-scoped
        // generation.
        let Some(policy) = product_policy::for_product(&conn, product_id)
            .await
            .map_err(to_message)?
        else {
            return Err(
                "this Product has no AI policy, so the pal can't read its code (deny-by-default). Set the Product's AI policy to allow reading and generating.".into(),
            );
        };
        let provider_id = match (policy.allow_read, policy.allow_generate, policy.provider_id) {
            (true, true, Some(id)) => id,
            _ => {
                return Err(
                    "The Product's AI policy blocks this: it must allow reading and generating, and name an AI provider.".into(),
                );
            }
        };
        let routed = ai_run::plan(&conn, product_id, provider_id, &policy.effort_tier, PURPOSE).await?;
        let root = root_for(&conn, solution_id).await?;
        // The same containment rule as every read — the pal cannot be pointed
        // at a file outside the Solution's folder.
        let file_content = workspace::read_file(&root, &path)?;
        let rules = developer_rules::for_product(&conn, product_id)
            .await
            .map_err(to_message)?
            .unwrap_or_default();
        let disallowed = rules.disallowed_tech.clone();
        let rules_doc = crate::files::pack::developer_rules_doc(&rules);
        let prompt = client::build_pal_prompt(
            &path,
            &file_content,
            &rules_doc,
            &action,
            &instruction,
            selection.as_deref(),
        );
        (routed, prompt, product_id, disallowed)
    };

    let started = std::time::Instant::now();
    let result =
        backend::generate_pal(&routed.provider, &routed.model, &routed.effort, &prompt).await;
    let latency_ms = started.elapsed().as_millis() as i64;

    match result {
        Ok((client::GeneratedPal::Answer(draft), usage)) => {
            let conn = db.0.lock().await;
            ai_run::record_ok(
                &conn,
                &ai_run::Call {
                    product_id,
                    work_item_id: None,
                    routed: &routed,
                    purpose: PURPOSE,
                    prompt: &prompt,
                },
                latency_ms,
                &usage,
                &draft.explanation,
            )
            .await;
            // Checked two ways, both against what the proposal would introduce:
            // the technologies the model says the code uses, and the code
            // itself — a replacement containing `import jquery` uses jQuery
            // whether or not it was declared.
            let mut violations: Vec<String> = draft
                .technologies
                .iter()
                .flat_map(|t| crate::db::developer_rules::violations(&disallowed, t))
                .chain(crate::db::developer_rules::violations(&disallowed, &draft.replacement))
                .collect();
            violations.sort();
            violations.dedup();
            Ok(PalDto {
                explanation: draft.explanation,
                replacement: draft.replacement,
                violations,
                provider: routed.provider.name.clone(),
                model: routed.model.clone(),
                reason: routed.reason.clone(),
                blocked: None,
            })
        }
        Ok((client::GeneratedPal::Blocked { reason, what_is_needed }, usage)) => {
            let conn = db.0.lock().await;
            ai_run::record_declined(
                &conn,
                &ai_run::Call {
                    product_id,
                    work_item_id: None,
                    routed: &routed,
                    purpose: PURPOSE,
                    prompt: &prompt,
                },
                latency_ms,
                &usage,
                &reason,
                &what_is_needed,
            )
            .await;
            Ok(PalDto {
                explanation: String::new(),
                replacement: String::new(),
                violations: Vec::new(),
                provider: routed.provider.name.clone(),
                model: routed.model.clone(),
                reason: routed.reason.clone(),
                blocked: Some(super::work_items::BlockedDto {
                    reason,
                    what_is_needed,
                    feedback_id: 0,
                }),
            })
        }
        Err(e) => {
            let conn = db.0.lock().await;
            let e = ai_run::record_failure(
                &conn,
                &ai_run::Call {
                    product_id,
                    work_item_id: None,
                    routed: &routed,
                    purpose: PURPOSE,
                    prompt: &prompt,
                },
                latency_ms,
                e,
            )
            .await;
            Err(e)
        }
    }
}

/// Saves an edited file back into the working copy. The path is untrusted;
/// `workspace::write_file` refuses anything outside the root or under `.git`.
#[tauri::command]
pub async fn write_solution_file(
    db: State<'_, AppDb>,
    solution_id: i64,
    path: String,
    contents: String,
) -> Result<(), String> {
    let root = {
        let conn = db.0.lock().await;
        root_for(&conn, solution_id).await?
    };
    workspace::write_file(&root, &path, &contents)
}

/// A work item prepared for a coding agent.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoverDto {
    pub run_id: i64,
    pub brief_path: String,
    pub brief: String,
    /// The command to run. Shown, not executed — see `handover.rs`.
    pub command: String,
}

/// Assembles everything known about a work item into one brief, writes it into
/// the working copy, and records the handover.
///
/// **Nothing is spawned and no cost is reported.** Claude Code bills against
/// its own subscription, so a figure here would be one the app cannot see. What
/// it does own is assembling the context completely and once — which is where
/// the tokens are actually saved, because the expensive failure is an agent
/// told too little that builds the wrong thing.
#[tauri::command]
/// Assembles the brief for a (work item, Solution).
///
/// Shared by `prepare_handover` (single run) and `start_run` (one of several,
/// each in its own worktree). One assembler rather than two, so an agent
/// started from the runs panel reads exactly what one started from the build
/// plan does — everything the team wrote, the chosen architecture, the answers
/// already given, and what waits on this work.
pub(crate) async fn build_handover_brief(
    conn: &turso::Connection,
    item: &crate::db::work_item::WorkItem,
    solution_id: i64,
    attempt: usize,
) -> Result<String, String> {
    use crate::db::{
        ai_feedback, architecture_doc, product, solution_strategy, work_item, work_item_link,
    };
    use crate::agent::handover::{self, HandoverInputs};

    let Some(product_row) = product::find_by_id(conn, item.product_id)
        .await
        .map_err(to_message)?
    else {
        return Err("this work item's Product no longer exists".into());
    };
    let solution_row = solution::find_by_id(conn, solution_id)
        .await
        .map_err(to_message)?;
    let rules = developer_rules::for_product(conn, item.product_id)
        .await
        .map_err(to_message)?
        .unwrap_or_default();

    // The build strategy, and which option the developer settled on — so the
    // agent does not re-open a decision that has already been made.
    let strategy = solution_strategy::for_item(conn, item.id)
        .await
        .map_err(to_message)?;
    let chosen = strategy.as_ref().and_then(|s| {
        let options: Vec<serde_json::Value> =
            serde_json::from_str(&s.architecture_options).unwrap_or_default();
        s.chosen_option_index
            .and_then(|i| options.get(i as usize).cloned())
            .and_then(|o| o.get("name").and_then(|n| n.as_str()).map(str::to_string))
    });

    // Only this Solution's architecture: a brief carrying every diagram in the
    // Product buries the request underneath them.
    let architecture: Vec<(String, String, String)> =
        architecture_doc::list_by_product(conn, item.product_id)
            .await
            .map_err(to_message)?
            .into_iter()
            .filter(|d| d.solution_id == Some(solution_id) || d.solution_id.is_none())
            .map(|d| (d.name, d.format, d.content))
            .collect();

    let clarifications = ai_feedback::clarifications_for_item(conn, item.id)
        .await
        .map_err(to_message)?;

    // How to run the Solution this work lands in: its own command if it has one,
    // otherwise what detection recognises. Written into the brief so the agent
    // can spin the front end up and hot-refresh the backend itself — the run
    // window's commands, travelling with the work.
    let dev = solution_row.as_ref().and_then(|row| {
        let root = row.local_path.as_deref().filter(|p| !p.trim().is_empty())?;
        match row.run_command.as_deref().filter(|c| !c.trim().is_empty()) {
            Some(command) => Some(crate::tooling::dev_runner::custom(command)),
            None => crate::tooling::dev_runner::detect(std::path::Path::new(root)),
        }
    });
    let run_start = dev.as_ref().map(|d| d.start.as_str()).filter(|s| !s.is_empty());
    let run_watch = dev.as_ref().map(|d| d.watch.as_str()).filter(|s| !s.is_empty());

    // What waits on this work — the shape it must not break.
    let all_items = work_item::list_by_product(conn, item.product_id)
        .await
        .map_err(to_message)?;
    let depended_on_by: Vec<String> = work_item_link::list_for_item(conn, item.id)
        .await
        .map_err(to_message)?
        .into_iter()
        .filter(|l| l.to_work_item_id == item.id && l.kind == "blocks")
        .filter_map(|l| {
            all_items
                .iter()
                .find(|i| i.id == l.from_work_item_id)
                .map(|i| i.title.clone())
        })
        .collect();

    // The per-Solution plan, so what the team wrote and the AI drew from it
    // travels with the work rather than staying in the app.
    let plan_rows = crate::db::work_item_plan::list_for_item(conn, item.id)
        .await
        .map_err(to_message)?;
    let all_solutions = solution::list_by_product(conn, item.product_id)
        .await
        .map_err(to_message)?;
    let plan_names: Vec<String> = plan_rows
        .iter()
        .map(|p| {
            all_solutions
                .iter()
                .find(|s| s.id == p.solution_id)
                .map(|s| s.name.clone())
                .unwrap_or_default()
        })
        .collect();
    let solution_plans: Vec<handover::SolutionPlanBrief<'_>> = plan_rows
        .iter()
        .zip(plan_names.iter())
        .map(|(p, name)| handover::SolutionPlanBrief {
            name,
            changes_required: &p.changes_required,
            unit_tests: &p.unit_tests,
            branch_name: &p.branch_name,
            clone_from: &p.clone_from,
            api_schema: &p.api_schema,
            page_schema: &p.page_schema,
            files_to_change: &p.files_to_change,
        })
        .collect();

    Ok(handover::brief(&HandoverInputs {
        product_name: &product_row.name,
        work_item_title: &item.title,
        work_item_type: &item.item_type,
        work_item_description: item.description.as_deref(),
        risk: &item.risk,
        solution_name: solution_row.as_ref().map(|s| s.name.as_str()),
        strategy: strategy.as_ref().map(|s| s.strategy.as_str()),
        chosen_option: chosen.as_deref(),
        rules: &rules,
        architecture: &architecture,
        clarifications: &clarifications,
        depended_on_by: &depended_on_by,
        solution_plans: &solution_plans,
        run_start,
        run_watch,
        attempt,
    }))
}

#[tauri::command]
pub async fn prepare_handover(
    db: State<'_, AppDb>,
    work_item_id: i64,
) -> Result<HandoverDto, String> {
    use crate::db::work_item;
    use crate::agent::handover;

    let (brief, brief_path, root, solution_id) = {
        let conn = db.0.lock().await;
        let Some(item) = work_item::find_by_id(&conn, work_item_id)
            .await
            .map_err(to_message)?
        else {
            return Err("that work item no longer exists".into());
        };
        let Some(solution_id) = item.solution_id else {
            return Err(format!(
                "'{}' is not linked to a Solution, so there is nowhere to hand it over to. Set the \
                 Solution it lands in on its build plan, in Develop.",
                item.title
            ));
        };
        let root = root_for(&conn, solution_id).await?;
        // Attempt number from the run history, so a second handover writes a
        // new file beside the first rather than over it — and so the record the
        // agent is asked to write is numbered with the brief it answers.
        let attempt = crate::db::change_run::list_for_item(&conn, work_item_id)
            .await
            .map_err(to_message)?
            .len()
            + 1;
        let brief = build_handover_brief(&conn, &item, solution_id, attempt).await?;
        let brief_path = handover::brief_path(&item.title, attempt);
        (brief, brief_path, root, solution_id)
    };

    // Written into the working copy so the agent can read it in place, under
    // this app's own folder rather than the project's root.
    crate::files::emit::write_generated(
        &root,
        &[crate::files::emit::EmitFile {
            rel_path: brief_path.clone(),
            contents: brief.clone(),
        }],
    )?;

    let conn = db.0.lock().await;
    let run_mode = crate::db::system_setting::agent_run_mode(&conn)
        .await
        .unwrap_or_else(|_| "acceptEdits".into());
    let run_id = crate::db::change_run::prepare(&conn, work_item_id, solution_id, &brief_path)
        .await
        .map_err(to_message)?;

    Ok(HandoverDto {
        run_id,
        command: crate::agent::handover::suggested_command(&brief_path, &run_mode),
        brief_path,
        brief,
    })
}

/// Records what the developer decided about a run. The app cannot see whether
/// a change was committed, so it records what it is told.
#[tauri::command]
pub async fn settle_change_run(
    db: State<'_, AppDb>,
    run_id: i64,
    state: String,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    crate::db::change_run::settle(&conn, run_id, &state)
        .await
        .map_err(to_message)
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
    /// The unsettled handover this review is evidence about, when one exists.
    /// The review is recorded against it, and the keep/discard decision is
    /// offered on it — always offered, whatever the findings say, because the
    /// user chose an accept that is never gated. The findings still travel
    /// with the run, so accepting over a violation is recorded as exactly that.
    pub run_id: Option<i64>,
    pub run_state: Option<String>,
    /// What the Develop area's Secondary AI made of the change, or why it did
    /// not say. **Never absent** — an empty panel reads exactly like a review
    /// that found nothing, which is the difference between "nobody looked" and
    /// "it is fine".
    pub second_opinion: crate::agent::second_opinion::Outcome,
    /// The same thing in one sentence, worded here rather than in the page.
    ///
    /// **So the attribution cannot be lost on the way out.** Every rendering of
    /// this has to name the model that gave the opinion, or say plainly that
    /// nothing did; leaving each caller to compose that is leaving each caller
    /// somewhere to drop it.
    pub second_opinion_summary: String,
}

/// Asks the Develop area's Secondary AI what it makes of the change.
///
/// **Every path returns a reason rather than nothing.** "Nobody looked" and
/// "it looked fine" must never read alike, so there is no route through here
/// that produces an empty result — an absent Secondary, an empty change, a
/// refusal and a failure each say something different.
///
/// **Never an error.** A second opinion that could not be got must not fail the
/// review it accompanies: the rules check is the thing that blocks, and this is
/// commentary beside it.
async fn second_opinion_on(
    db: &State<'_, AppDb>,
    solution_id: i64,
    run_id: Option<i64>,
    changes: &[workspace::FileChange],
    rules: &crate::db::developer_rules::DeveloperRules,
) -> crate::agent::second_opinion::Outcome {
    use crate::agent::second_opinion::{NotGiven, Outcome, SecondOpinion};
    use crate::ai::{backend, client};
    use crate::commands::ai_run;

    if changes.is_empty() {
        return Outcome::NotGiven(NotGiven::NothingChanged);
    }
    let _ = run_id;

    let (routed, prompt, product_id) = {
        let conn = db.0.lock().await;
        let Ok(Some(row)) = solution::find_by_id(&conn, solution_id).await else {
            return Outcome::NotGiven(NotGiven::Failed("that Solution is gone".into()));
        };
        // **Develop, because this is a code change.** Product and QA have their
        // own Secondary for their own work; borrowing one of theirs would be
        // the app choosing a provider nobody named for this job.
        let secondary =
            crate::db::routing_default::secondary_for(&conn, row.product_id, "develop").await;
        let Ok(Some(slot)) = secondary else {
            return Outcome::NotGiven(NotGiven::NoSecondary);
        };
        let Some(provider_id) = slot.provider_id else {
            return Outcome::NotGiven(NotGiven::NoSecondary);
        };
        let routed = match ai_run::plan(
            &conn,
            row.product_id,
            provider_id,
            &slot.effort_tier,
            SECOND_OPINION_PURPOSE,
        )
        .await
        {
            Ok(routed) => routed,
            // A budget that has run out is a real answer and not a fault: the
            // reason the router gives is kept as it is.
            Err(why) => return Outcome::NotGiven(NotGiven::Failed(why)),
        };
        let rules_doc = crate::files::pack::developer_rules_doc(rules);
        let (diff, truncated) = crate::agent::second_opinion::diff_text(changes);
        let prompt = crate::agent::second_opinion::build_prompt(&diff, &rules_doc, truncated);
        (routed, prompt, row.product_id)
    };

    let truncated = prompt.context.contains("larger than could be sent");
    let started = std::time::Instant::now();
    let result =
        backend::generate_pal(&routed.provider, &routed.model, &routed.effort, &prompt).await;
    let latency_ms = started.elapsed().as_millis() as i64;

    let conn = db.0.lock().await;
    let call = ai_run::Call {
        product_id,
        work_item_id: None,
        routed: &routed,
        purpose: SECOND_OPINION_PURPOSE,
        prompt: &prompt,
    };
    match result {
        // The pal shape is reused rather than a second one invented: its
        // `explanation` is always present and is exactly "what it thinks",
        // while `replacement` is empty for a question that only talks.
        Ok((client::GeneratedPal::Answer(draft), usage)) => {
            let _ = ai_run::record_ok(&conn, &call, latency_ms, &usage, &draft.explanation).await;
            Outcome::Given(SecondOpinion {
                model: routed.model.clone(),
                provider: routed.provider.name.clone(),
                notes: draft.explanation.clone(),
                truncated,
            })
        }
        Ok((client::GeneratedPal::Blocked { reason, what_is_needed }, usage)) => {
            let _ = ai_run::record_ok(&conn, &call, latency_ms, &usage, &reason).await;
            // A model is allowed to decline, and its reason is its own.
            Outcome::NotGiven(NotGiven::Declined(if what_is_needed.trim().is_empty() {
                reason
            } else {
                format!("{reason} — it needs: {what_is_needed}")
            }))
        }
        Err(why) => {
            let _ = ai_run::record_failure(&conn, &call, latency_ms, why.clone()).await;
            Outcome::NotGiven(NotGiven::Failed(why))
        }
    }
}

/// What the ledger calls this call, so a second opinion is visible as its own
/// line of spend rather than hidden inside whatever else ran.
const SECOND_OPINION_PURPOSE: &str = "secondOpinion";

#[tauri::command]
pub async fn review_solution_changes(
    db: State<'_, AppDb>,
    solution_id: i64,
    // Which working copy to read. **A run's changes are in the run's own
    // checkout, not in the Solution's folder** — that is the whole point of
    // giving each one a worktree, and reviewing the Solution root instead
    // reported "nothing has changed" while an agent's work sat finished in a
    // folder next door. Absent means your own workspace, which is a real thing
    // to review and the only thing this used to do.
    run_id: Option<i64>,
) -> Result<ChangeReviewDto, String> {
    let (root, rules) = {
        let conn = db.0.lock().await;
        let root = root_for_run(&conn, solution_id, run_id).await?;
        let Some(row) = solution::find_by_id(&conn, solution_id)
            .await
            .map_err(to_message)?
        else {
            return Err("that Solution no longer exists".into());
        };
        let rules = developer_rules::for_product(&conn, row.product_id)
            .await
            .map_err(to_message)?;
        (root, rules)
    };
    let no_rules = rules.is_none();
    let rules = rules.unwrap_or_default();
    let changes = workspace::read_changes(&root)?;
    let report = review::review(&changes, &rules);

    // Attach the review to the newest unsettled handover, so the run's record
    // shows what the rules made of what came back.
    let conn = db.0.lock().await;
    let run = crate::db::change_run::latest_open_for_solution(&conn, solution_id)
        .await
        .map_err(to_message)?;
    let (run_id, run_state) = match run {
        Some(run) => {
            let findings =
                serde_json::to_string(&report).unwrap_or_else(|_| "{}".into());
            crate::db::change_run::record_review(&conn, run.id, &findings, report.files_changed)
                .await
                .map_err(to_message)?;
            (Some(run.id), Some("reviewed".to_string()))
        }
        None => (None, None),
    };
    drop(conn);

    // **The second opinion is asked for here, on every review, rather than
    // behind a button.** The transition to `reviewed` is what this app means by
    // a run completing, so this is the completion hook — and a review somebody
    // has to remember to request is one that does not happen.
    let second_opinion = second_opinion_on(&db, solution_id, run_id, &changes, &rules).await;
    if let Some(id) = run_id {
        let conn = db.0.lock().await;
        let json = serde_json::to_string(&second_opinion).unwrap_or_else(|_| "null".into());
        // **Recorded separately, and a failure here does not undo the review.**
        // The rules check is local and always produces something; asking
        // another model is a network call that can fail on its own.
        let _ = crate::db::change_run::record_second_opinion(&conn, id, &json).await;
    }
    Ok(ChangeReviewDto {
        changes,
        report,
        no_rules,
        run_id,
        run_state,
        second_opinion_summary: second_opinion.says(),
        second_opinion,
    })
}

/// Facts about the selected file, for the explorer's properties panel.
#[tauri::command]
pub async fn file_properties(
    db: State<'_, AppDb>,
    solution_id: i64,
    path: String,
) -> Result<workspace::FileProperties, String> {
    let root = {
        let conn = db.0.lock().await;
        root_for(&conn, solution_id).await?
    };
    workspace::properties(&root, &path)
}
