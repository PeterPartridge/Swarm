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

    let (routed, prompt, effort_tier, product_id, disallowed) = {
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
        let Some(policy) = product_policy::get_for_product(&conn, product_id)
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
        let rules = developer_rules::get_for_product(&conn, product_id)
            .await
            .map_err(to_message)?
            .unwrap_or_default();
        let disallowed = rules.disallowed_tech.clone();
        let rules_doc = crate::pack::developer_rules_doc(&rules);
        let prompt = client::build_pal_prompt(
            &path,
            &file_content,
            &rules_doc,
            &action,
            &instruction,
            selection.as_deref(),
        );
        (routed, prompt, policy.effort_tier, product_id, disallowed)
    };

    let started = std::time::Instant::now();
    let result =
        backend::generate_pal(&routed.provider, &routed.model, &effort_tier, &prompt).await;
    let latency_ms = started.elapsed().as_millis() as i64;

    match result {
        Ok((client::GeneratedPal::Answer(draft), usage)) => {
            let conn = db.0.lock().await;
            ai_run::record(
                &conn, product_id, None, &routed.provider, &routed.model,
                PURPOSE, &usage, latency_ms, "ok",
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
            ai_run::record(
                &conn, product_id, None, &routed.provider, &routed.model,
                PURPOSE, &usage, latency_ms, "declined",
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
            let outcome = if e.contains("refusal") { "refusal" } else { "error" };
            ai_run::record(
                &conn, product_id, None, &routed.provider, &routed.model,
                PURPOSE, &Default::default(), latency_ms, outcome,
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
pub async fn prepare_handover(
    db: State<'_, AppDb>,
    work_item_id: i64,
) -> Result<HandoverDto, String> {
    use crate::db::{
        ai_feedback, architecture_doc, product, solution_strategy, work_item, work_item_link,
    };
    use crate::handover::{self, HandoverInputs};

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
                "'{}' is not linked to a Solution, so there is nowhere to hand it over to. Set its Solution on the planning board.",
                item.title
            ));
        };
        let root = root_for(&conn, solution_id).await?;
        let Some(product_row) = product::find_by_id(&conn, item.product_id)
            .await
            .map_err(to_message)?
        else {
            return Err("this work item's Product no longer exists".into());
        };
        let solution_row = solution::find_by_id(&conn, solution_id)
            .await
            .map_err(to_message)?;
        let rules = developer_rules::get_for_product(&conn, item.product_id)
            .await
            .map_err(to_message)?
            .unwrap_or_default();

        // The build strategy, and which option the developer settled on — so
        // the agent does not re-open a decision that has already been made.
        let strategy = solution_strategy::get_for_item(&conn, work_item_id)
            .await
            .map_err(to_message)?;
        let chosen = strategy.as_ref().and_then(|s| {
            let options: Vec<serde_json::Value> =
                serde_json::from_str(&s.architecture_options).unwrap_or_default();
            s.chosen_option_index
                .and_then(|i| options.get(i as usize).cloned())
                .and_then(|o| o.get("name").and_then(|n| n.as_str()).map(str::to_string))
        });

        // Only this Solution's architecture: a brief carrying every diagram in
        // the Product buries the request underneath them.
        let architecture: Vec<(String, String, String)> =
            architecture_doc::list_by_product(&conn, item.product_id)
                .await
                .map_err(to_message)?
                .into_iter()
                .filter(|d| d.solution_id == Some(solution_id) || d.solution_id.is_none())
                .map(|d| (d.name, d.format, d.content))
                .collect();

        let clarifications = ai_feedback::clarifications_for_item(&conn, work_item_id)
            .await
            .map_err(to_message)?;

        // What waits on this work — the shape it must not break.
        let all_items = work_item::list_by_product(&conn, item.product_id)
            .await
            .map_err(to_message)?;
        let depended_on_by: Vec<String> = work_item_link::list_for_item(&conn, work_item_id)
            .await
            .map_err(to_message)?
            .into_iter()
            .filter(|l| l.to_work_item_id == work_item_id && l.kind == "blocks")
            .filter_map(|l| {
                all_items
                    .iter()
                    .find(|i| i.id == l.from_work_item_id)
                    .map(|i| i.title.clone())
            })
            .collect();

        let brief = handover::brief(&HandoverInputs {
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
        });
        // Attempt number from the run history, so a second handover writes a
        // new file beside the first rather than over it.
        let attempt = crate::db::change_run::list_for_item(&conn, work_item_id)
            .await
            .map_err(to_message)?
            .len()
            + 1;
        let brief_path = handover::brief_path(&item.title, attempt);
        (brief, brief_path, root, solution_id)
    };

    // Written into the working copy so the agent can read it in place, under
    // this app's own folder rather than the project's root.
    crate::emit::write_generated(
        &root,
        &[crate::emit::EmitFile {
            rel_path: brief_path.clone(),
            contents: brief.clone(),
        }],
    )?;

    let conn = db.0.lock().await;
    let run_id = crate::db::change_run::prepare(&conn, work_item_id, solution_id, &brief_path)
        .await
        .map_err(to_message)?;

    Ok(HandoverDto {
        run_id,
        command: crate::handover::suggested_command(&brief_path),
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
    Ok(ChangeReviewDto { changes, report, no_rules, run_id, run_state })
}
