//! Marketing and Design: the two strategy areas, the assets design produces,
//! and the Figma link.
//!
//! Every AI call here goes through `ai_run::plan` and `ai_run::record` like the
//! rest of the platform — a new area does not get its own unmetered path.

use super::{to_message, AppDb};
use crate::db::design_asset;
use crate::figma;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignAssetDto {
    pub id: i64,
    pub product_id: i64,
    pub kind: String,
    pub name: String,
    pub content: String,
    pub format: String,
    pub figma_file_key: Option<String>,
    pub figma_node_id: Option<String>,
}

impl From<design_asset::DesignAsset> for DesignAssetDto {
    fn from(a: design_asset::DesignAsset) -> Self {
        DesignAssetDto {
            id: a.id,
            product_id: a.product_id,
            kind: a.kind,
            name: a.name,
            content: a.content,
            format: a.format,
            figma_file_key: a.figma_file_key,
            figma_node_id: a.figma_node_id,
        }
    }
}

#[tauri::command]
pub async fn list_design_assets(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Vec<DesignAssetDto>, String> {
    let conn = db.0.lock().await;
    let assets = design_asset::list_by_product(&conn, product_id)
        .await
        .map_err(to_message)?;
    Ok(assets.into_iter().map(DesignAssetDto::from).collect())
}

#[tauri::command]
pub async fn save_design_asset(
    db: State<'_, AppDb>,
    product_id: i64,
    kind: String,
    name: String,
    content: String,
) -> Result<i64, String> {
    let conn = db.0.lock().await;
    design_asset::save(&conn, product_id, &kind, &name, &content)
        .await
        .map_err(to_message)
}

#[tauri::command]
pub async fn delete_design_asset(db: State<'_, AppDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    design_asset::delete(&conn, id).await.map_err(to_message)
}

// ---------------------------------------------------------------- Figma link

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FigmaStatus {
    pub connected: bool,
}

#[tauri::command]
pub fn figma_status() -> FigmaStatus {
    FigmaStatus {
        connected: figma::token_stored(),
    }
}

/// Stores a Figma personal access token and returns the account it belongs to.
/// The token goes to the OS credential store and nowhere else — never the
/// database, never a config file, never a log line.
#[tauri::command]
pub async fn set_figma_token(token: String) -> Result<String, String> {
    let account = figma::verify(&token).await?;
    figma::store_token(&token)?;
    Ok(account)
}

#[tauri::command]
pub fn clear_figma_token() -> Result<(), String> {
    figma::delete_token()
}

/// Reads a Figma file and returns the digest — pages, screens, components and
/// copy — rather than the raw document, which runs to megabytes.
#[tauri::command]
pub async fn read_figma_file(file_ref: String) -> Result<FigmaFileDto, String> {
    let key = figma::file_key_from(&file_ref)?;
    let token = figma::get_token()?;
    let digest = figma::read_file(&token, &key).await?;
    Ok(FigmaFileDto {
        file_key: key,
        name: digest.name.clone(),
        pages: digest
            .pages
            .iter()
            .map(|p| FigmaPageDto {
                name: p.name.clone(),
                frames: p.frames.clone(),
                text_count: p.text.len() as i64,
                text_truncated: p.text_truncated,
            })
            .collect(),
        components: digest.components.clone(),
        styles: digest.styles.clone(),
        prompt_preview: digest.to_prompt(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FigmaFileDto {
    pub file_key: String,
    pub name: String,
    pub pages: Vec<FigmaPageDto>,
    pub components: Vec<String>,
    pub styles: Vec<String>,
    /// Exactly what would be sent to a model, so the cost is visible before
    /// anyone pays for it.
    pub prompt_preview: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FigmaPageDto {
    pub name: String,
    pub frames: Vec<String>,
    pub text_count: i64,
    pub text_truncated: bool,
}

/// Pushes a stored token asset into a Figma file as variables.
///
/// **Enterprise-only at Figma's end.** On any lesser plan this returns the
/// explanation from `figma::explain` — which names the plan as the cause and
/// points at the emitted `design/tokens.json` as the way through — rather than
/// a bare 403.
#[tauri::command]
pub async fn push_design_tokens(
    db: State<'_, AppDb>,
    asset_id: i64,
    file_ref: String,
    collection_name: String,
) -> Result<(), String> {
    let key = figma::file_key_from(&file_ref)?;
    let asset = {
        let conn = db.0.lock().await;
        design_asset::find_by_id(&conn, asset_id)
            .await
            .map_err(to_message)?
            .ok_or("that design asset no longer exists")?
    };
    if asset.kind != "tokens" {
        return Err(format!(
            "only a token set can be pushed as Figma variables — '{}' is a {}",
            asset.name, asset.kind
        ));
    }
    let token = figma::get_token()?;
    figma::push_variables(&token, &key, &collection_name, &asset.content).await?;

    let conn = db.0.lock().await;
    design_asset::record_figma_location(&conn, asset_id, &key, None)
        .await
        .map_err(to_message)
}

/// Posts a comment onto a Figma file — the one write that works on every plan,
/// so AI review lands where designers actually work.
#[tauri::command]
pub async fn post_figma_comment(file_ref: String, message: String) -> Result<(), String> {
    let key = figma::file_key_from(&file_ref)?;
    let token = figma::get_token()?;
    figma::post_comment(&token, &key, &message).await
}

/// Writes the Product's design assets to files under `design/`.
///
/// On any plan below Enterprise this is **the** way design tokens reach Figma,
/// since the Variables API is Enterprise-only — so it is a first-class action,
/// not a fallback hidden behind a failure.
#[tauri::command]
pub async fn emit_design_files(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Vec<String>, String> {
    use crate::db::product;

    let (assets, root) = {
        let conn = db.0.lock().await;
        let Some(product_row) = product::find_by_id(&conn, product_id)
            .await
            .map_err(to_message)?
        else {
            return Err("that Product no longer exists".into());
        };
        let assets = design_asset::list_by_product(&conn, product_id)
            .await
            .map_err(to_message)?
            .into_iter()
            .map(|a| (a.kind, a.name, a.content))
            .collect::<Vec<_>>();
        // The same helper the framework-file emission uses — one definition of
        // "where does this Product's generated output go".
        let root = super::emit::scaffold_root(&conn, &product_row.name).await?;
        (assets, root)
    };
    if assets.is_empty() {
        return Err("there are no design assets to write yet".into());
    }
    crate::emit::write_generated(&root, &crate::emit::design_files(&assets))
}

// ------------------------------------------------------------- AI generation

/// Generates the marketing or design strategy, and for design the artefacts
/// that follow from it.
///
/// Gated by the **Product's** AI policy, the same one that gates Deliverable
/// planning — a new area does not get a new way to spend money.
#[tauri::command]
pub async fn generate_design_strategy(
    db: State<'_, AppDb>,
    product_id: i64,
    area: String,
    brief: String,
    figma_file_ref: Option<String>,
) -> Result<super::work_items::GenerationResult, String> {
    use crate::ai::{backend, client};
    use crate::commands::ai_run;
    use crate::db::{product, product_policy, solution, strategy};

    if area != "marketing" && area != "design" {
        return Err(format!("'{area}' is not a design or marketing area"));
    }
    let purpose = if area == "marketing" {
        "marketingStrategy"
    } else {
        "designStrategy"
    };

    // Reading the Figma file happens before the lock and before routing: it is
    // a network call of its own, and a file that cannot be read should fail
    // here rather than half-way through a paid generation.
    let figma_digest = match figma_file_ref.as_deref().filter(|r| !r.trim().is_empty()) {
        Some(reference) => {
            let key = figma::file_key_from(reference)?;
            let token = figma::get_token()?;
            Some(figma::read_file(&token, &key).await?.to_prompt())
        }
        None => None,
    };

    let (routed, prompt, effort_tier) = {
        let conn = db.0.lock().await;
        let Some(product_row) = product::find_by_id(&conn, product_id)
            .await
            .map_err(to_message)?
        else {
            return Err("that Product no longer exists".into());
        };
        // Deny-by-default, exactly as Deliverable planning is.
        let Some(policy) = product_policy::get_for_product(&conn, product_id)
            .await
            .map_err(to_message)?
        else {
            return Err(format!(
                "'{}' has no Product AI policy, so AI can't work on {area} (deny-by-default). Set the Product's AI policy to allow reading and generating, and configure an AI provider in AI Settings.",
                product_row.name
            ));
        };
        let provider_id = match (policy.allow_read, policy.allow_generate, policy.provider_id) {
            (true, true, Some(id)) => id,
            _ => {
                return Err(
                    "The Product's AI policy blocks this: it must allow reading and generating, and name an AI provider.".into(),
                );
            }
        };
        let routed = ai_run::plan(&conn, product_id, provider_id, &policy.effort_tier, purpose).await?;
        let product_strategy = strategy::get(&conn, product_id, "product")
            .await
            .map_err(to_message)?;
        let solutions = solution::list_by_product(&conn, product_id)
            .await
            .map_err(to_message)?
            .into_iter()
            .map(|s| (s.name, s.solution_type, s.answers))
            .collect::<Vec<_>>();
        let prompt = client::build_design_prompt(
            &product_row.name,
            &product_row.answers,
            &product_strategy,
            &area,
            &brief,
            figma_digest.as_deref(),
            &solutions,
        );
        (routed, prompt, policy.effort_tier)
    };

    let started = std::time::Instant::now();
    let result =
        backend::generate_design(&routed.provider, &routed.model, &effort_tier, &prompt).await;
    let latency_ms = started.elapsed().as_millis() as i64;

    match result {
        Ok((client::GeneratedDesign::Design(draft), usage)) => {
            let conn = db.0.lock().await;
            ai_run::record(
                &conn, product_id, None, &routed.provider, &routed.model,
                purpose, &usage, latency_ms, "ok",
            )
            .await;

            strategy::save(
                &conn,
                product_id,
                &area,
                &serde_json::json!({
                    "strategy": draft.strategy,
                    "figmaFileKey": figma_file_ref.unwrap_or_default(),
                })
                .to_string(),
            )
            .await
            .map_err(to_message)?;

            // Artefacts are stored one at a time, and a rejected one does not
            // sink the rest: a model that returned three good flows and one
            // malformed diagram has still done most of the work.
            let mut created = vec![format!("{area} strategy")];
            let mut rejected: Vec<String> = Vec::new();
            if area == "design" {
                if !draft.tokens.trim().is_empty() {
                    match design_asset::save(&conn, product_id, "tokens", "Core", &draft.tokens).await {
                        Ok(_) => created.push("Core tokens".into()),
                        Err(e) => rejected.push(format!("tokens ({e})")),
                    }
                }
                for flow in &draft.flows {
                    match design_asset::save(&conn, product_id, "uiFlow", &flow.name, &flow.diagram).await {
                        Ok(_) => created.push(flow.name.clone()),
                        Err(e) => rejected.push(format!("{} ({e})", flow.name)),
                    }
                }
                if !draft.components.trim().is_empty() {
                    match design_asset::save(
                        &conn, product_id, "brandGuidelines", "Components", &draft.components,
                    )
                    .await
                    {
                        Ok(_) => created.push("Components".into()),
                        Err(e) => rejected.push(format!("components ({e})")),
                    }
                }
            }

            let mut reason = routed.reason.clone();
            if !rejected.is_empty() {
                reason.push_str(&format!(
                    " — but these came back unusable and were not saved: {}",
                    rejected.join("; ")
                ));
            }
            Ok(super::work_items::GenerationResult {
                created,
                provider: routed.provider.name.clone(),
                model: routed.model.clone(),
                reason,
                blocked: None,
            })
        }
        // The AI declined rather than inventing a direction. There is no work
        // item to hang the question on, so it travels back to the caller.
        Ok((client::GeneratedDesign::Blocked { reason, what_is_needed }, usage)) => {
            let conn = db.0.lock().await;
            ai_run::record(
                &conn, product_id, None, &routed.provider, &routed.model,
                purpose, &usage, latency_ms, "declined",
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
                purpose, &Default::default(), latency_ms, outcome,
            )
            .await;
            Err(e)
        }
    }
}
