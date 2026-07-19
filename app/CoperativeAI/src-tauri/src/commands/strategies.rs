//! Developer rules and the AI-generated solution strategy they constrain.

use super::{to_message, AppDb};
use crate::ai::backend;
use crate::ai::client::{self, DeveloperRulesPrompt, GeneratedStrategy};
use crate::commands::ai_run;
use crate::db::{ai_feedback, developer_rules, product, solution, solution_strategy, work_item};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperRulesDto {
    pub product_id: i64,
    pub coding_standards: String,
    pub architecture_principles: String,
    pub maintainability: String,
    pub preferred_frameworks: String,
    pub allowed_tech: String,
    pub disallowed_tech: String,
    pub ai_constraints: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SolutionStrategyDto {
    pub work_item_id: i64,
    pub strategy: String,
    /// JSON array of {name, kind, rationale, tradeoffs}.
    pub architecture_options: String,
    pub chosen_option_index: Option<i64>,
    pub tech_stack: String,
    /// Disallowed technologies found in the AI's own output, if any. A rule
    /// has been broken.
    pub rule_violations: Vec<String>,
    /// Technologies not on the allow list. Not a rule break — a question for a
    /// person, kept separate so a notice never reads as a violation.
    pub unlisted_tech: Vec<String>,
}

#[tauri::command]
pub async fn get_developer_rules(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Option<DeveloperRulesDto>, String> {
    let conn = db.0.lock().await;
    let rules = developer_rules::get_for_product(&conn, product_id)
        .await
        .map_err(to_message)?;
    Ok(rules.map(|r| DeveloperRulesDto {
        product_id: r.product_id,
        coding_standards: r.coding_standards,
        architecture_principles: r.architecture_principles,
        maintainability: r.maintainability,
        preferred_frameworks: r.preferred_frameworks,
        allowed_tech: r.allowed_tech,
        disallowed_tech: r.disallowed_tech,
        ai_constraints: r.ai_constraints,
    }))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn set_developer_rules(
    db: State<'_, AppDb>,
    product_id: i64,
    coding_standards: String,
    architecture_principles: String,
    maintainability: String,
    preferred_frameworks: String,
    allowed_tech: String,
    disallowed_tech: String,
    ai_constraints: String,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    developer_rules::set_rules(
        &conn,
        product_id,
        &coding_standards,
        &architecture_principles,
        &maintainability,
        &preferred_frameworks,
        &allowed_tech,
        &disallowed_tech,
        &ai_constraints,
    )
    .await
    .map_err(to_message)
}

#[tauri::command]
pub async fn get_solution_strategy(
    db: State<'_, AppDb>,
    work_item_id: i64,
) -> Result<Option<SolutionStrategyDto>, String> {
    let conn = db.0.lock().await;
    let Some(stored) = solution_strategy::get_for_item(&conn, work_item_id)
        .await
        .map_err(to_message)?
    else {
        return Ok(None);
    };
    // Re-check on read as well as on write: the rules may have tightened since
    // the strategy was generated, and a violation that appears later is still a
    // violation the developer should see.
    let declared: Vec<String> = serde_json::from_str(&stored.technologies).unwrap_or_default();
    let (violations, unlisted) =
        match work_item::find_by_id(&conn, work_item_id).await.map_err(to_message)? {
            Some(item) => match developer_rules::get_for_product(&conn, item.product_id)
                .await
                .map_err(to_message)?
            {
                Some(rules) => (
                    violations_in_list(&rules.disallowed_tech, &declared),
                    developer_rules::unlisted(&rules.allowed_tech, &declared),
                ),
                None => (Vec::new(), Vec::new()),
            },
            None => (Vec::new(), Vec::new()),
        };
    Ok(Some(SolutionStrategyDto {
        work_item_id: stored.work_item_id,
        strategy: stored.strategy,
        architecture_options: stored.architecture_options,
        chosen_option_index: stored.chosen_option_index,
        tech_stack: stored.tech_stack,
        rule_violations: violations,
        unlisted_tech: unlisted,
    }))
}

/// Checks the technologies the AI said it would **use** against the forbidden
/// list.
///
/// Deliberately not the prose. The first live run returned a tech stack ending
/// "No Java or PHP anywhere" — the model had obeyed the prohibition exactly and
/// the old text search reported it as a violation. A check that fires on
/// correct behaviour teaches people to ignore it, which is worse than no check.
fn violations_in_list(disallowed: &str, technologies: &[String]) -> Vec<String> {
    let mut found: Vec<String> = technologies
        .iter()
        .flat_map(|tech| developer_rules::violations(disallowed, tech))
        .collect();
    found.sort();
    found.dedup();
    found
}

#[tauri::command]
pub async fn choose_architecture_option(
    db: State<'_, AppDb>,
    work_item_id: i64,
    index: Option<i64>,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    solution_strategy::choose_option(&conn, work_item_id, index)
        .await
        .map_err(to_message)
}

/// Asks the AI how to build a work item, within the developer rules.
#[tauri::command]
pub async fn generate_solution_strategy(
    db: State<'_, AppDb>,
    work_item_id: i64,
) -> Result<super::work_items::GenerationResult, String> {
    const PURPOSE: &str = "solutionStrategy";

    let (routed, prompt, product_id, disallowed, allowed, effort_tier) = {
        let conn = db.0.lock().await;
        let Some(item) = work_item::find_by_id(&conn, work_item_id)
            .await
            .map_err(to_message)?
        else {
            return Err("that work item no longer exists".into());
        };
        let product_id = item.product_id;
        let Some(product_row) = product::find_by_id(&conn, product_id)
            .await
            .map_err(to_message)?
        else {
            return Err("this work item's Product no longer exists".into());
        };
        // The item's own policy still gates it, exactly as story generation does.
        let (policy_provider, effort_tier) =
            super::work_items::resolve_item_ai_gate(&conn, work_item_id, &item.title).await?;
        let routed =
            ai_run::plan(&conn, product_id, policy_provider.id, &effort_tier, PURPOSE).await?;
        let rules = developer_rules::get_for_product(&conn, product_id)
            .await
            .map_err(to_message)?
            .unwrap_or_default();
        let solutions = solution::list_by_product(&conn, product_id)
            .await
            .map_err(to_message)?
            .into_iter()
            .map(|s| (s.name, s.solution_type, s.answers))
            .collect::<Vec<_>>();
        let clarifications = ai_feedback::clarifications_for_item(&conn, work_item_id)
            .await
            .map_err(to_message)?;
        let prompt = client::build_solution_strategy_prompt(
            &product_row.name,
            &product_row.answers,
            &solutions,
            &item.title,
            item.description.as_deref(),
            &DeveloperRulesPrompt {
                coding_standards: &rules.coding_standards,
                architecture_principles: &rules.architecture_principles,
                maintainability: &rules.maintainability,
                preferred_frameworks: &rules.preferred_frameworks,
                allowed_tech: &rules.allowed_tech,
                disallowed_tech: &rules.disallowed_tech,
                ai_constraints: &rules.ai_constraints,
            },
            &clarifications,
        );
        // The item's policy owns the effort tier here too, rather than this
        // command deciding that architecture work is always worth "high".
        (
            routed,
            prompt,
            product_id,
            rules.disallowed_tech,
            rules.allowed_tech,
            effort_tier,
        )
    };

    let started = std::time::Instant::now();
    // Dispatched by provider kind, so a budget handover mid-design reaches the
    // local model in its own request shape rather than failing.
    let result =
        backend::generate_solution_strategy(&routed.provider, &routed.model, &effort_tier, &prompt)
            .await;
    let latency_ms = started.elapsed().as_millis() as i64;

    match result {
        Ok((GeneratedStrategy::Strategy(draft), usage)) => {
            let conn = db.0.lock().await;
            ai_run::record(
                &conn, product_id, Some(work_item_id), &routed.provider, &routed.model,
                PURPOSE, &usage, latency_ms, "ok",
            )
            .await;
            let options_json = serde_json::to_string(
                &draft
                    .options
                    .iter()
                    .map(|o| {
                        serde_json::json!({
                            "name": o.name, "kind": o.kind,
                            "rationale": o.rationale, "tradeoffs": o.tradeoffs
                        })
                    })
                    .collect::<Vec<_>>(),
            )
            .unwrap_or_else(|_| "[]".into());
            let technologies_json =
                serde_json::to_string(&draft.technologies).unwrap_or_else(|_| "[]".into());
            solution_strategy::set_strategy(
                &conn, work_item_id, &draft.strategy, &options_json, &draft.tech_stack,
                &technologies_json, None,
            )
            .await
            .map_err(to_message)?;

            // A stated constraint is not an obeyed one: check the answer — but
            // against what it says it will use, not against its writing.
            let violations = violations_in_list(&disallowed, &draft.technologies);
            if !violations.is_empty() {
                ai_feedback::record(
                    &conn,
                    work_item_id,
                    "suggestion",
                    &format!(
                        "The proposed strategy uses technology the developer rules forbid: {}.",
                        violations.join(", ")
                    ),
                    "Regenerate, or relax the rule if it no longer applies.",
                    None,
                )
                .await
                .map_err(to_message)?;
            }

            // Unlisted technology is a question, not a breach. Recorded in
            // different words on purpose — an allow list of languages does not
            // mean a queue or a cloud service was forbidden, and calling this a
            // violation would be the fastest way to make people stop reading
            // violations.
            let unlisted = developer_rules::unlisted(&allowed, &draft.technologies);
            if !unlisted.is_empty() {
                ai_feedback::record(
                    &conn,
                    work_item_id,
                    "suggestion",
                    &format!(
                        "The strategy proposes technology that is not on this Product's allowed list: {}.",
                        unlisted.join(", ")
                    ),
                    "Add them to the allowed technologies if they are fine, or say why they are not.",
                    None,
                )
                .await
                .map_err(to_message)?;
            }
            Ok(super::work_items::GenerationResult {
                created: vec![draft.strategy],
                provider: routed.provider.name.clone(),
                model: routed.model.clone(),
                reason: routed.reason.clone(),
                blocked: None,
            })
        }
        Ok((GeneratedStrategy::Blocked { reason, what_is_needed }, usage)) => {
            let conn = db.0.lock().await;
            ai_run::record(
                &conn, product_id, Some(work_item_id), &routed.provider, &routed.model,
                PURPOSE, &usage, latency_ms, "declined",
            )
            .await;
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
            ai_run::record(
                &conn, product_id, Some(work_item_id), &routed.provider, &routed.model,
                PURPOSE, &Default::default(), latency_ms, "error",
            )
            .await;
            Err(e)
        }
    }
}
