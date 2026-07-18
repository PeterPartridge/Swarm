//! Model detection and the install workflow.
//!
//! Detection is a diff: whatever a provider lists, compared against what the
//! platform has already seen. Installation builds the capability pack, writes it
//! beside the Product's briefs, then runs the model against real probes. Only a
//! model that passes every probe becomes usable — see `ai::validation` for why
//! the probes check conformance rather than similarity to Claude.

use super::{to_message, AppDb};
use crate::ai::client::Prompt;
use crate::ai::validation::{self, ValidationReport};
use crate::ai::backend;
use crate::db::{ai_provider, developer_rules, model_install, product, solution_management, strategy};
use crate::{emit, pack};
use serde::Serialize;
use std::collections::HashMap;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatusDto {
    pub provider_id: i64,
    pub provider: String,
    pub model: String,
    pub state: String,
    pub pack_path: String,
    /// The last validation report, as JSON.
    pub validation_report: String,
}

/// Lists every known model with its install state, detecting any that are new.
///
/// Detection happens on read rather than on a timer: the moment anyone looks at
/// AI Settings the list is current, and there is no background job to explain.
#[tauri::command]
pub async fn list_model_status(db: State<'_, AppDb>) -> Result<Vec<ModelStatusDto>, String> {
    let conn = db.0.lock().await;
    let providers = ai_provider::list_all(&conn).await.map_err(to_message)?;
    for provider in &providers {
        model_install::sync_for_provider(&conn, provider.id, &provider.models)
            .await
            .map_err(to_message)?;
    }
    let names: HashMap<i64, String> =
        providers.iter().map(|p| (p.id, p.name.clone())).collect();

    let installs = model_install::list_all(&conn).await.map_err(to_message)?;
    Ok(installs
        .into_iter()
        .map(|m| ModelStatusDto {
            provider: names
                .get(&m.provider_id)
                .cloned()
                .unwrap_or_else(|| format!("Provider {}", m.provider_id)),
            provider_id: m.provider_id,
            model: m.model,
            state: m.state,
            pack_path: m.pack_path,
            validation_report: m.validation_report,
        })
        .collect())
}

/// Re-reads a local server's models, so a newly pulled one is noticed without
/// re-adding the provider.
#[tauri::command]
pub async fn refresh_provider_models(
    db: State<'_, AppDb>,
    provider_id: i64,
) -> Result<Vec<String>, String> {
    let provider = {
        let conn = db.0.lock().await;
        ai_provider::find_by_id(&conn, provider_id)
            .await
            .map_err(to_message)?
            .ok_or_else(|| "that AI provider no longer exists".to_string())?
    };
    if provider.kind != "ollama" {
        return Err(
            "only a local Ollama server can be re-read — for other providers, edit the model list"
                .into(),
        );
    }
    let models = crate::ai::ollama::list_models(&provider.api_base_url).await?;

    let conn = db.0.lock().await;
    ai_provider::set_models(&conn, provider_id, &models)
        .await
        .map_err(to_message)?;
    model_install::sync_for_provider(&conn, provider_id, &models)
        .await
        .map_err(to_message)
}

/// Builds the capability pack for a model, writes it to disk, and validates the
/// model against it. All-or-nothing: any failed probe leaves the model refused.
#[tauri::command]
pub async fn install_model(
    db: State<'_, AppDb>,
    provider_id: i64,
    model: String,
    product_id: i64,
) -> Result<ValidationReport, String> {
    // 1 — assemble the pack from the platform's own rules, and write it.
    let (provider, pack_files, root) = {
        let conn = db.0.lock().await;
        let provider = ai_provider::find_by_id(&conn, provider_id)
            .await
            .map_err(to_message)?
            .ok_or_else(|| "that AI provider no longer exists".to_string())?;
        let product_row = product::find_by_id(&conn, product_id)
            .await
            .map_err(to_message)?
            .ok_or_else(|| "that Product no longer exists".to_string())?;
        let rules = developer_rules::get_for_product(&conn, product_id)
            .await
            .map_err(to_message)?
            .unwrap_or_default();
        let product_strategy = strategy::get(&conn, product_id, "product")
            .await
            .map_err(to_message)?;

        let files = pack::build(&pack::PackInputs {
            model: &model,
            provider: &provider.name,
            product_name: &product_row.name,
            product_answers: &product_row.answers,
            product_strategy: &product_strategy,
            rules: &rules,
        });

        let root = solution_management::list_all(&conn)
            .await
            .map_err(to_message)?
            .into_iter()
            .find(|s| s.filename == product_row.name)
            .map(|s| s.filepath)
            .ok_or_else(|| {
                format!(
                    "'{}' has no folder on disk, so the capability pack has nowhere to go. \
                     Create the Product with a folder first.",
                    product_row.name
                )
            })?;
        (provider, files, root)
    };

    let pack_dir = pack_files
        .first()
        .and_then(|f| f.rel_path.rsplit_once('/').map(|(dir, _)| dir.to_string()))
        .unwrap_or_default();
    // A pack is generated, not authored: it is rewritten every install, using
    // the path that overwrites rather than the one that protects hand edits.
    emit::write_generated(&root, &pack_files)?;

    // 2 — run the probes. Failures are recorded, not raised: a model that
    // cannot do the job is a result, not an error.
    let disallowed = {
        let conn = db.0.lock().await;
        developer_rules::get_for_product(&conn, product_id)
            .await
            .map_err(to_message)?
            .map(|r| r.disallowed_tech)
            .unwrap_or_default()
    };
    let report = run_probes(&provider, &model, &disallowed).await;

    // 3 — record the outcome. Only a clean sweep unlocks the model.
    let state = if report.passed { "installed" } else { "failed" };
    let report_json = serde_json::to_string(&report).unwrap_or_else(|_| "{}".into());
    {
        let conn = db.0.lock().await;
        model_install::set_result(&conn, provider_id, &model, state, &pack_dir, &report_json)
            .await
            .map_err(to_message)?;
    }
    Ok(report)
}

/// The probes, run against the real model.
async fn run_probes(
    provider: &crate::db::ai_provider::AiProvider,
    model: &str,
    disallowed: &str,
) -> ValidationReport {
    let mut probes = Vec::new();

    // A deliberately complete brief — declining this one is a failure.
    let clear = Prompt {
        context: "You are helping a product team plan work.\n\nProduct: Shop App\n\
                  Product brief answers (JSON): {\"purpose\":\"sell coffee online to UK customers\"}\n"
            .into(),
        task: "Feature: Checkout\nFeature description: Customers pay for a basket of coffee \
               with a card and receive an emailed receipt.\n\nWrite 3-6 user stories covering \
               this feature. Each story: a title in classic user-story form and a \
               one-to-three sentence description of what done looks like."
            .into(),
    };
    probes.push(validation::check_work_items(
        &backend::generate_stories(provider, model, "low", &clear)
            .await
            .map(|(g, _)| g),
    ));

    // Strategy, architecture vocabulary, and rule obedience in one call.
    let mut strategy_context = String::from(
        "You are helping a product team plan work.\n\nProduct: Shop App\n\
         Product brief answers (JSON): {\"purpose\":\"sell coffee online\"}\n\n\
         Developer rules — these are constraints, not preferences:\n",
    );
    if !disallowed.trim().is_empty() {
        strategy_context.push_str(&format!(
            "- MUST NOT use, under any circumstances: {disallowed}\n"
        ));
    }
    let strategy_prompt = Prompt {
        context: strategy_context,
        task: "Work item: Order processing\nDescription: Take paid orders and hand them to \
               fulfilment, retrying on failure.\n\nPropose how to build this. Give: a short \
               written strategy; 2-4 architecture options, each with a name, a kind \
               (windowsService, azureWebApp, azureFunction, api, backgroundWorker, or other), \
               why it fits, and its trade-offs; the tech stack; and \"technologies\", a plain \
               list of every technology you are actually proposing to USE. List only what you \
               are using — do not list anything you are avoiding."
            .into(),
    };
    probes.extend(validation::check_strategy(
        &backend::generate_solution_strategy(provider, model, "high", &strategy_prompt)
            .await
            .map(|(g, _)| g),
        disallowed,
    ));

    // The one that matters most: a brief with nothing in it.
    let hopeless = Prompt {
        context: "You are helping a product team plan work.\n\nProduct: (none given)\n\
                  Product brief answers (JSON): {}\n"
            .into(),
        task: "Work item: \"Make it better\"\n\nWrite 3-6 user stories covering this feature.\
               \n\nIf this is too vague or contradictory to do well, do NOT guess. Leave \
               \"stories\" empty and fill in \"blocked\" instead: give the reason and, in \
               whatIsNeeded, the single most useful question a person could answer to unblock \
               it. Declining with a good question is a better outcome than inventing work."
            .into(),
    };
    probes.push(validation::check_declines_vague(
        &backend::generate_stories(provider, model, "low", &hopeless)
            .await
            .map(|(g, _)| g),
    ));

    ValidationReport::finish(model, probes)
}
