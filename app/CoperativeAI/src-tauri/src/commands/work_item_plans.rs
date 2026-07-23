//! What a work item requires of each Solution it touches, and the AI turn that
//! converts that writing into schemas a developer can build from.

use super::{to_message, AppDb};
use crate::db::{solution, work_item, work_item_plan};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemPlanDto {
    pub id: i64,
    pub work_item_id: i64,
    pub solution_id: i64,
    /// Carried so the UI can name the Solution without a second lookup.
    pub solution_name: String,
    pub changes_required: String,
    pub unit_tests: String,
    pub branch_name: String,
    pub clone_from: String,
    pub mockups: String,
    pub api_schema: String,
    pub page_schema: String,
    pub files_to_change: String,
}

#[tauri::command]
pub async fn list_work_item_plans(
    db: State<'_, AppDb>,
    work_item_id: i64,
) -> Result<Vec<WorkItemPlanDto>, String> {
    let conn = db.0.lock().await;
    let plans = work_item_plan::list_for_item(&conn, work_item_id)
        .await
        .map_err(to_message)?;
    let solutions = match work_item::find_by_id(&conn, work_item_id).await.map_err(to_message)? {
        Some(item) => solution::list_by_product(&conn, item.product_id)
            .await
            .map_err(to_message)?,
        None => Vec::new(),
    };
    Ok(plans
        .into_iter()
        .map(|p| WorkItemPlanDto {
            solution_name: solutions
                .iter()
                .find(|s| s.id == p.solution_id)
                .map(|s| s.name.clone())
                .unwrap_or_else(|| format!("#{}", p.solution_id)),
            id: p.id,
            work_item_id: p.work_item_id,
            solution_id: p.solution_id,
            changes_required: p.changes_required,
            unit_tests: p.unit_tests,
            branch_name: p.branch_name,
            clone_from: p.clone_from,
            mockups: p.mockups,
            api_schema: p.api_schema,
            page_schema: p.page_schema,
            files_to_change: p.files_to_change,
        })
        .collect())
}

/// Marks a Solution as affected by this work item, prefilling the branch name
/// and clone-from from the Develop Strategy so the team's convention is the
/// default rather than something everyone retypes differently.
#[tauri::command]
pub async fn attach_solution_to_work_item(
    db: State<'_, AppDb>,
    work_item_id: i64,
    solution_id: i64,
) -> Result<i64, String> {
    use crate::db::strategy;

    let conn = db.0.lock().await;
    let id = work_item_plan::attach(&conn, work_item_id, solution_id)
        .await
        .map_err(to_message)?;

    // Prefill only on a plan nobody has written on yet — re-attaching must not
    // overwrite a branch someone renamed on purpose.
    let plan = work_item_plan::find_by_id(&conn, id)
        .await
        .map_err(to_message)?
        .ok_or("the plan vanished as it was created")?;
    if plan.branch_name.is_empty() && plan.clone_from.is_empty() {
        if let Some(item) = work_item::find_by_id(&conn, work_item_id).await.map_err(to_message)? {
            let develop = strategy::get(&conn, item.product_id, "develop")
                .await
                .map_err(to_message)?;
            let doc: serde_json::Value = serde_json::from_str(&develop).unwrap_or_default();
            let pattern = doc.get("branchPattern").and_then(|v| v.as_str()).unwrap_or("");
            let clone_from = doc.get("defaultCloneFrom").and_then(|v| v.as_str()).unwrap_or("");
            let branch =
                work_item_plan::branch_from_pattern(pattern, item.id, &item.title, &item.item_type);
            if !branch.is_empty() || !clone_from.is_empty() {
                work_item_plan::set_written(
                    &conn, id, &plan.changes_required, &plan.unit_tests, &branch, clone_from,
                    &plan.mockups,
                )
                .await
                .map_err(to_message)?;
            }
        }
    }
    Ok(id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn save_work_item_plan(
    db: State<'_, AppDb>,
    id: i64,
    changes_required: String,
    unit_tests: String,
    branch_name: String,
    clone_from: String,
    mockups: String,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    work_item_plan::set_written(
        &conn, id, &changes_required, &unit_tests, &branch_name, &clone_from, &mockups,
    )
    .await
    .map_err(to_message)
}

#[tauri::command]
pub async fn detach_work_item_plan(db: State<'_, AppDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    work_item_plan::detach(&conn, id).await.map_err(to_message)
}

/// Turns what the team wrote into the schemas a developer builds from.
///
/// This is the payoff of the questions: everything Product answered is already
/// a clarification on the work item, so it travels into the prompt without
/// anyone re-typing it. Gated by the Product AI policy, routed through the
/// budget, ledgered, and dispatched by provider kind like every other AI action.
#[tauri::command]
pub async fn generate_change_plan(
    db: State<'_, AppDb>,
    work_item_id: i64,
) -> Result<super::work_items::GenerationResult, String> {
    use crate::ai::{backend, client};
    use crate::commands::ai_run;
    use crate::db::{ai_feedback, architecture_doc, developer_rules, product, strategy};

    const PURPOSE: &str = "changePlan";

    let (routed, prompt, effort_tier, product_id, plans, solution_names, images, skipped, unassigned) = {
        let conn = db.0.lock().await;
        let Some(item) = work_item::find_by_id(&conn, work_item_id)
            .await
            .map_err(to_message)?
        else {
            return Err("that work item no longer exists".into());
        };
        let plans = work_item_plan::list_for_item(&conn, work_item_id)
            .await
            .map_err(to_message)?;
        if plans.is_empty() {
            return Err(
                "no Solutions are marked as affected yet — add at least one before generating schemas"
                    .into(),
            );
        }
        // Nothing written means nothing to design from; the escape hatch would
        // catch it, but refusing here costs nothing at all.
        if plans.iter().all(|p| p.changes_required.trim().is_empty()) {
            return Err(
                "none of the affected Solutions say what has to change yet — write that first, and the schemas follow from it"
                    .into(),
            );
        }

        let product_id = item.product_id;
        let Some(product_row) = product::find_by_id(&conn, product_id)
            .await
            .map_err(to_message)?
        else {
            return Err("this work item's Product no longer exists".into());
        };
        // The item's own policy gates this, exactly as story generation does.
        let (policy_provider, effort_tier) =
            super::work_items::resolve_item_ai_gate(&conn, work_item_id, &item.title).await?;
        let routed =
            ai_run::plan(&conn, product_id, policy_provider.id, &effort_tier, PURPOSE).await?;

        // Only a model someone has confirmed can see gets shown the pictures.
        // Sending them to a text-only model wastes a paid call on an error; the
        // prompt wording changes to match, because a model told to look at
        // pictures it was not sent will invent what it saw.
        let can_see = crate::db::model_install::supports_vision(
            &conn, routed.provider.id, &routed.model,
        )
        .await
        .map_err(to_message)?;
        let mockup_paths: Vec<String> = plans
            .iter()
            .flat_map(|p| serde_json::from_str::<Vec<String>>(&p.mockups).unwrap_or_default())
            .collect();
        let (images, skipped) = if can_see && !mockup_paths.is_empty() {
            crate::ai::vision::load_images(&mockup_paths)
        } else {
            (Vec::new(), Vec::new())
        };
        let mockups_attached = !images.is_empty();

        let solutions = solution::list_by_product(&conn, product_id)
            .await
            .map_err(to_message)?;
        let rules = developer_rules::get_for_product(&conn, product_id)
            .await
            .map_err(to_message)?
            .unwrap_or_default();
        let architecture: Vec<(String, String)> =
            architecture_doc::list_by_product(&conn, product_id)
                .await
                .map_err(to_message)?
                .into_iter()
                .map(|d| (d.name, d.content))
                .collect();
        let clarifications = ai_feedback::clarifications_for_item(&conn, work_item_id)
            .await
            .map_err(to_message)?;
        let develop_strategy = strategy::get(&conn, product_id, "develop")
            .await
            .map_err(to_message)?;

        // The structured screens/APIs/tables per Solution. Without these the
        // model was handed only the prose beside them and derived schemas from
        // a summary of the plan rather than the plan itself.
        let mut planned: Vec<Vec<crate::db::work_item_change::WorkItemChange>> = Vec::new();
        for p in &plans {
            planned.push(
                crate::db::work_item_change::list_for_solution(&conn, work_item_id, p.solution_id)
                    .await
                    .map_err(to_message)?,
            );
        }
        // Asks nobody has assigned yet. Reported rather than silently dropped:
        // a screen Product asked for that reaches no Solution is exactly the
        // thing that goes missing until someone notices it was never built.
        let unassigned: Vec<String> = crate::db::work_item_change::list_for_item(&conn, work_item_id)
            .await
            .map_err(to_message)?
            .into_iter()
            .filter(|c| c.solution_id.is_none())
            .map(|c| c.name)
            .collect();

        // Borrowed views for the prompt, and the names to match the reply back.
        let prompt_plans: Vec<(String, String, String, String, Vec<String>)> = plans
            .iter()
            .map(|p| {
                let sol = solutions.iter().find(|s| s.id == p.solution_id);
                (
                    sol.map(|s| s.name.clone()).unwrap_or_default(),
                    sol.map(|s| s.solution_type.clone()).unwrap_or_default(),
                    p.changes_required.clone(),
                    p.unit_tests.clone(),
                    serde_json::from_str::<Vec<String>>(&p.mockups).unwrap_or_default(),
                )
            })
            .collect();
        let planned_borrowed: Vec<Vec<client::PlannedChange<'_>>> = planned
            .iter()
            .map(|per_solution| {
                per_solution
                    .iter()
                    .map(|c| client::PlannedChange {
                        kind: &c.kind,
                        action: &c.action,
                        name: &c.name,
                        detail: &c.detail,
                        // Only worth naming when the picture actually went: a
                        // "shown in basket.png" beside an image the model was
                        // never sent is a reference to nothing.
                        mockup: c
                            .mockup_path
                            .as_deref()
                            .filter(|_| mockups_attached)
                            .map(file_name_of),
                    })
                    .collect()
            })
            .collect();
        let borrowed: Vec<client::SolutionPlanPrompt<'_>> = prompt_plans
            .iter()
            .zip(planned_borrowed.iter())
            .map(|((name, kind, changes, tests, mockups), changes_list)| {
                client::SolutionPlanPrompt {
                    name,
                    solution_type: kind,
                    changes_required: changes,
                    unit_tests: tests,
                    changes: changes_list,
                    mockups,
                    mockups_attached,
                }
            })
            .collect();

        let prompt = client::build_change_plan_prompt(
            &product_row.name,
            &product_row.answers,
            &develop_strategy,
            &item.title,
            item.description.as_deref(),
            &client::DeveloperRulesPrompt {
                coding_standards: &rules.coding_standards,
                architecture_principles: &rules.architecture_principles,
                maintainability: &rules.maintainability,
                preferred_frameworks: &rules.preferred_frameworks,
                allowed_tech: &rules.allowed_tech,
                disallowed_tech: &rules.disallowed_tech,
                ai_constraints: &rules.ai_constraints,
            },
            &architecture,
            &clarifications,
            &borrowed,
        );
        let names: Vec<(i64, String)> = plans
            .iter()
            .map(|p| {
                (
                    p.id,
                    solutions
                        .iter()
                        .find(|s| s.id == p.solution_id)
                        .map(|s| s.name.clone())
                        .unwrap_or_default(),
                )
            })
            .collect();
        (routed, prompt, effort_tier, product_id, plans, names, images, skipped, unassigned)
    };

    let started = std::time::Instant::now();
    let result = backend::generate_change_plan(
        &routed.provider, &routed.model, &effort_tier, &prompt, &images,
    )
    .await;
    let latency_ms = started.elapsed().as_millis() as i64;

    match result {
        Ok((client::GeneratedChangePlan::Plan(changes), usage)) => {
            let conn = db.0.lock().await;
            ai_run::record(
                &conn, product_id, Some(work_item_id), &routed.provider, &routed.model,
                PURPOSE, &usage, latency_ms, "ok",
            )
            .await;

            // Matched back by name, case-insensitively: a model that renamed a
            // Solution has not planned for it, and writing its schemas onto the
            // wrong repository would be worse than dropping them.
            let mut created = Vec::new();
            let mut unmatched = Vec::new();
            for change in &changes {
                match solution_names
                    .iter()
                    .find(|(_, name)| name.eq_ignore_ascii_case(&change.solution))
                {
                    Some((plan_id, name)) => {
                        work_item_plan::set_generated(
                            &conn, *plan_id, &change.api_schema, &change.page_schema,
                            &change.files_to_change,
                        )
                        .await
                        .map_err(to_message)?;
                        created.push(name.clone());
                    }
                    None => unmatched.push(change.solution.clone()),
                }
            }

            let mut reason = routed.reason.clone();
            if !images.is_empty() {
                reason.push_str(&format!(
                    " — {} picture{} shown to the model",
                    images.len(),
                    if images.len() == 1 { "" } else { "s" }
                ));
            }
            // A picture silently dropped is a picture the user believes was
            // looked at, so every omission is named.
            if !skipped.is_empty() {
                reason.push_str(&format!(" — not sent: {}", skipped.join("; ")));
            }
            // A screen Product asked for that reaches no Solution is the thing
            // that goes missing until someone notices it was never built.
            if !unassigned.is_empty() {
                reason.push_str(&format!(
                    " — not assigned to any Solution, so not designed: {}",
                    unassigned.join(", ")
                ));
            }
            if !unmatched.is_empty() {
                reason.push_str(&format!(
                    " — but it named {} which is not an affected Solution, so that part was dropped",
                    unmatched.join(", ")
                ));
            }
            let missing: Vec<String> = solution_names
                .iter()
                .filter(|(_, name)| !created.iter().any(|c| c == name))
                .map(|(_, name)| name.clone())
                .collect();
            if !missing.is_empty() {
                reason.push_str(&format!(" — nothing came back for {}", missing.join(", ")));
            }
            let _ = plans;

            Ok(super::work_items::GenerationResult {
                created,
                provider: routed.provider.name.clone(),
                model: routed.model.clone(),
                reason,
                blocked: None,
            })
        }
        Ok((client::GeneratedChangePlan::Blocked { reason, what_is_needed }, usage)) => {
            let conn = db.0.lock().await;
            ai_run::record(
                &conn, product_id, Some(work_item_id), &routed.provider, &routed.model,
                PURPOSE, &usage, latency_ms, "declined",
            )
            .await;
            // Recorded against the item, so the question joins the others the
            // team is already answering rather than living in a toast.
            let feedback_id = ai_feedback::record(
                &conn, work_item_id, "needsInformation", &reason, &what_is_needed, None,
            )
            .await
            .map_err(to_message)?;
            Ok(super::work_items::GenerationResult {
                created: Vec::new(),
                provider: routed.provider.name.clone(),
                model: routed.model.clone(),
                reason: routed.reason.clone(),
                blocked: Some(super::work_items::BlockedDto {
                    reason,
                    what_is_needed,
                    feedback_id,
                }),
            })
        }
        Err(e) => {
            let conn = db.0.lock().await;
            let outcome = if e.contains("refusal") { "refusal" } else { "error" };
            ai_run::record(
                &conn, product_id, Some(work_item_id), &routed.provider, &routed.model,
                PURPOSE, &Default::default(), latency_ms, outcome,
            )
            .await;
            Err(e)
        }
    }
}

/// The file name from a full path, for naming a mockup in the prompt.
/// The model is shown the picture, not the disk, so the folder it lives in is
/// noise that costs tokens.
fn file_name_of(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// Writes the work item as `.md` and `.json` for an agent to work from.
///
/// Both, from one structure. The Markdown is for reading the intent; the JSON
/// is for a tool that wants a list of endpoints rather than a paragraph to
/// guess at. Generating one from the other would mean parsing prose or
/// rendering a form, and either way they would drift.
#[tauri::command]
pub async fn write_work_item_files(
    db: State<'_, AppDb>,
    work_item_id: i64,
) -> Result<Vec<String>, String> {
    use crate::work_item_files as files;

    let (doc, product_dir) = {
        let conn = db.0.lock().await;
        let Some(item) = work_item::find_by_id(&conn, work_item_id)
            .await
            .map_err(to_message)?
        else {
            return Err("that work item no longer exists".into());
        };
        let Some(product) = crate::db::product::find_by_id(&conn, item.product_id)
            .await
            .map_err(to_message)?
        else {
            return Err("this work item's Product no longer exists".into());
        };
        // Beside the Product's framework files, so the pair lives with the
        // code it describes rather than in the app's data folder.
        let dir = crate::db::solution_management::list_all(&conn)
            .await
            .map_err(to_message)?
            .into_iter()
            .find(|s| s.filename == product.name)
            .map(|s| s.filepath)
            .ok_or_else(|| {
                format!(
                    "'{}' has no folder yet — generate its framework files first, and these go \
                     beside them",
                    product.name
                )
            })?;

        let solutions = solution::list_by_product(&conn, item.product_id)
            .await
            .map_err(to_message)?;
        let plans = work_item_plan::list_for_item(&conn, work_item_id)
            .await
            .map_err(to_message)?;
        let all_changes = crate::db::work_item_change::list_for_item(&conn, work_item_id)
            .await
            .map_err(to_message)?;
        let clarifications = crate::db::ai_feedback::clarifications_for_item(&conn, work_item_id)
            .await
            .map_err(to_message)?;

        let entry = |c: &crate::db::work_item_change::WorkItemChange| files::ChangeEntry {
            kind: c.kind.clone(),
            action: c.action.clone(),
            name: c.name.clone(),
            detail: c.detail.clone(),
            mockup: c.mockup_path.clone(),
        };

        let parts: Vec<files::SolutionPart> = plans
            .iter()
            .map(|p| {
                let sol = solutions.iter().find(|s| s.id == p.solution_id);
                files::SolutionPart {
                    name: sol.map(|s| s.name.clone()).unwrap_or_default(),
                    solution_type: sol.map(|s| s.solution_type.clone()).unwrap_or_default(),
                    changes_required: p.changes_required.clone(),
                    unit_tests: p.unit_tests.clone(),
                    branch_name: p.branch_name.clone(),
                    clone_from: p.clone_from.clone(),
                    changes: all_changes
                        .iter()
                        .filter(|c| c.solution_id == Some(p.solution_id))
                        .map(entry)
                        .collect(),
                    api_schema: p.api_schema.clone(),
                    page_schema: p.page_schema.clone(),
                    files_to_change: p.files_to_change.clone(),
                }
            })
            .collect();

        let doc = files::WorkItemDoc {
            id: item.id,
            title: item.title.clone(),
            item_type: item.item_type.clone(),
            status: item.status.clone(),
            description: item.description.clone().unwrap_or_default(),
            risk: item.risk.clone(),
            product: product.name.clone(),
            development_details: item.development_details.clone(),
            clarifications,
            solutions: parts,
            unassigned: all_changes
                .iter()
                .filter(|c| c.solution_id.is_none())
                .map(entry)
                .collect(),
        };
        (doc, dir)
    };

    let (md_path, json_path) = files::paths(doc.id, &doc.title);
    let written = crate::emit::write_generated(
        &product_dir,
        &[
            crate::emit::EmitFile {
                rel_path: md_path,
                contents: files::to_markdown(&doc),
            },
            crate::emit::EmitFile {
                rel_path: json_path,
                contents: files::to_json(&doc),
            },
        ],
    )?;
    Ok(written)
}
