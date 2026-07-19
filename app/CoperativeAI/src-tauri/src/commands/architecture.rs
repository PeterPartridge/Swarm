//! Developer Planning: architecture documents, and how a Product's Solutions
//! depend on one another.

use super::{to_message, AppDb};
use crate::db::{architecture_doc, repo_link};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchitectureDocDto {
    pub id: i64,
    pub product_id: i64,
    pub solution_id: Option<i64>,
    pub kind: String,
    pub name: String,
    pub content: String,
    pub format: String,
}

impl From<architecture_doc::ArchitectureDoc> for ArchitectureDocDto {
    fn from(d: architecture_doc::ArchitectureDoc) -> Self {
        ArchitectureDocDto {
            id: d.id,
            product_id: d.product_id,
            solution_id: d.solution_id,
            kind: d.kind,
            name: d.name,
            content: d.content,
            format: d.format,
        }
    }
}

#[tauri::command]
pub async fn list_architecture_docs(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Vec<ArchitectureDocDto>, String> {
    let conn = db.0.lock().await;
    let docs = architecture_doc::list_by_product(&conn, product_id)
        .await
        .map_err(to_message)?;
    Ok(docs.into_iter().map(ArchitectureDocDto::from).collect())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn save_architecture_doc(
    db: State<'_, AppDb>,
    product_id: i64,
    solution_id: Option<i64>,
    kind: String,
    name: String,
    content: String,
    format: String,
) -> Result<i64, String> {
    let conn = db.0.lock().await;
    architecture_doc::save(&conn, product_id, solution_id, &kind, &name, &content, &format)
        .await
        .map_err(to_message)
}

#[tauri::command]
pub async fn delete_architecture_doc(db: State<'_, AppDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    architecture_doc::delete(&conn, id).await.map_err(to_message)
}

// ------------------------------------------------------------- Solution links

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoLinkDto {
    pub id: i64,
    pub from_solution_id: i64,
    pub to_solution_id: i64,
    pub kind: String,
    pub notes: String,
}

#[tauri::command]
pub async fn list_repo_links(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Vec<RepoLinkDto>, String> {
    let conn = db.0.lock().await;
    let links = repo_link::list_for_product(&conn, product_id)
        .await
        .map_err(to_message)?;
    Ok(links
        .into_iter()
        .map(|l| RepoLinkDto {
            id: l.id,
            from_solution_id: l.from_solution_id,
            to_solution_id: l.to_solution_id,
            kind: l.kind,
            notes: l.notes,
        })
        .collect())
}

#[tauri::command]
pub async fn link_solutions(
    db: State<'_, AppDb>,
    from_solution_id: i64,
    to_solution_id: i64,
    kind: String,
    notes: String,
) -> Result<i64, String> {
    let conn = db.0.lock().await;
    repo_link::link(&conn, from_solution_id, to_solution_id, &kind, &notes)
        .await
        .map_err(to_message)
}

#[tauri::command]
pub async fn unlink_solutions(db: State<'_, AppDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    repo_link::unlink(&conn, id).await.map_err(to_message)
}

/// What a change to this Solution would reach, at any depth. The question the
/// map exists to answer.
#[tauri::command]
pub async fn solutions_reached_by(
    db: State<'_, AppDb>,
    solution_id: i64,
) -> Result<Vec<i64>, String> {
    let conn = db.0.lock().await;
    repo_link::reaches(&conn, solution_id)
        .await
        .map_err(to_message)
}

// ------------------------------------------------------------- AI generation

/// Asks the AI to draw an architecture document.
///
/// The result is validated as the notation it claims to be **before** it is
/// stored — `architecture_doc::save` refuses anything that will not render. A
/// diagram that does not render is worse than no diagram: it looks like
/// documentation, so nobody writes the documentation.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn generate_architecture_doc(
    db: State<'_, AppDb>,
    product_id: i64,
    solution_id: Option<i64>,
    kind: String,
    format: String,
    brief: String,
) -> Result<super::work_items::GenerationResult, String> {
    use crate::ai::{backend, client};
    use crate::commands::ai_run;
    use crate::db::{product, product_policy, solution, strategy};

    const PURPOSE: &str = "architectureDoc";

    let (routed, prompt, effort_tier) = {
        let conn = db.0.lock().await;
        let Some(product_row) = product::find_by_id(&conn, product_id)
            .await
            .map_err(to_message)?
        else {
            return Err("that Product no longer exists".into());
        };
        let Some(policy) = product_policy::get_for_product(&conn, product_id)
            .await
            .map_err(to_message)?
        else {
            return Err(format!(
                "'{}' has no Product AI policy, so AI can't draw architecture (deny-by-default). Set the Product's AI policy to allow reading and generating, and configure an AI provider in AI Settings.",
                product_row.name
            ));
        };
        let provider_id = match (policy.allow_read, policy.allow_generate, policy.provider_id) {
            (true, true, Some(id)) => id,
            _ => {
                return Err(
                    "The Product's AI policy blocks this: it must allow reading and generating, and name an AI provider."
                        .into(),
                );
            }
        };
        let routed =
            ai_run::plan(&conn, product_id, provider_id, &policy.effort_tier, PURPOSE).await?;

        let solutions = solution::list_by_product(&conn, product_id)
            .await
            .map_err(to_message)?;
        let name_of = |id: i64| -> String {
            solutions
                .iter()
                .find(|s| s.id == id)
                .map(|s| s.name.clone())
                .unwrap_or_else(|| format!("#{id}"))
        };
        // The links already recorded are the ground truth about how these
        // systems depend on one another, so the AI draws from them rather than
        // guessing at the shape.
        let links: Vec<String> = repo_link::list_for_product(&conn, product_id)
            .await
            .map_err(to_message)?
            .into_iter()
            .map(|l| {
                let note = if l.notes.trim().is_empty() {
                    String::new()
                } else {
                    format!(" ({})", l.notes)
                };
                format!(
                    "{} {} {}{note}",
                    name_of(l.from_solution_id),
                    l.kind,
                    name_of(l.to_solution_id)
                )
            })
            .collect();
        let existing: Vec<(String, String)> = architecture_doc::list_by_product(&conn, product_id)
            .await
            .map_err(to_message)?
            .into_iter()
            .map(|d| (d.name, d.content))
            .collect();
        let product_strategy = strategy::get(&conn, product_id, "develop")
            .await
            .map_err(to_message)?;
        let prompt = client::build_architecture_prompt(
            &product_row.name,
            &product_row.answers,
            &product_strategy,
            &solutions
                .into_iter()
                .map(|s| (s.name, s.solution_type, s.answers))
                .collect::<Vec<_>>(),
            &links,
            &existing,
            &kind,
            &format,
            &brief,
        );
        (routed, prompt, policy.effort_tier)
    };

    let started = std::time::Instant::now();
    let result = backend::generate_diagram(
        &routed.provider,
        &routed.model,
        &effort_tier,
        &prompt,
        &format,
    )
    .await;
    let latency_ms = started.elapsed().as_millis() as i64;

    match result {
        Ok((client::GeneratedDiagram::Diagram(draft), usage)) => {
            let conn = db.0.lock().await;
            ai_run::record(
                &conn, product_id, None, &routed.provider, &routed.model,
                PURPOSE, &usage, latency_ms, "ok",
            )
            .await;
            // The store validates the notation. A model that returned prose has
            // been paid for either way, so the ledger row above stands — but
            // nothing unusable gets saved, and the caller is told why.
            architecture_doc::save(
                &conn, product_id, solution_id, &kind, &draft.name, &draft.content, &format,
            )
            .await
            .map_err(|e| {
                format!(
                    "the AI drew something that will not render, so it was not saved: {}",
                    to_message(e)
                )
            })?;
            let mut created = vec![draft.name];
            if !draft.explanation.trim().is_empty() {
                created.push(draft.explanation);
            }
            Ok(super::work_items::GenerationResult {
                created,
                provider: routed.provider.name.clone(),
                model: routed.model.clone(),
                reason: routed.reason.clone(),
                blocked: None,
            })
        }
        Ok((client::GeneratedDiagram::Blocked { reason, what_is_needed }, usage)) => {
            let conn = db.0.lock().await;
            ai_run::record(
                &conn, product_id, None, &routed.provider, &routed.model,
                PURPOSE, &usage, latency_ms, "declined",
            )
            .await;
            Ok(super::work_items::GenerationResult {
                created: Vec::new(),
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
