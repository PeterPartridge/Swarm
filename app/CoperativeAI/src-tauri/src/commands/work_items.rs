//! Commands behind the Planning board — thin wrappers over the tested
//! `db::work_item` module (see its unit tests for the behaviour).

use super::{to_message, AppDb};
use crate::db::work_item::{self, WorkItem};
use crate::db::{system_setting, work_item_policy};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemDto {
    pub id: i64,
    pub title: String,
    pub item_type: String,
    pub status: String,
    pub description: Option<String>,
    pub product_id: i64,
    pub parent_item_id: Option<i64>,
    pub assignee_id: Option<i64>,
    pub sprint_id: Option<i64>,
    pub start_date: Option<i64>,
    pub end_date: Option<i64>,
    pub deliverable_id: Option<i64>,
    pub expected_cost: Option<f64>,
    pub estimated_profit: Option<f64>,
    pub chargeable: bool,
    pub customer_cover_pct: Option<f64>,
    pub risk: String,
    pub solution_id: Option<i64>,
}

impl From<WorkItem> for WorkItemDto {
    fn from(w: WorkItem) -> Self {
        WorkItemDto {
            id: w.id,
            title: w.title,
            item_type: w.item_type,
            status: w.status,
            description: w.description,
            product_id: w.product_id,
            parent_item_id: w.parent_item_id,
            assignee_id: w.assignee_id,
            sprint_id: w.sprint_id,
            start_date: w.start_date,
            end_date: w.end_date,
            deliverable_id: w.deliverable_id,
            expected_cost: w.expected_cost,
            estimated_profit: w.estimated_profit,
            chargeable: w.chargeable,
            customer_cover_pct: w.customer_cover_pct,
            risk: w.risk,
            solution_id: w.solution_id,
        }
    }
}

#[tauri::command]
pub async fn list_work_items(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Vec<WorkItemDto>, String> {
    let conn = db.0.lock().await;
    let items = work_item::list_by_product(&conn, product_id)
        .await
        .map_err(to_message)?;
    Ok(items.into_iter().map(WorkItemDto::from).collect())
}

#[tauri::command]
pub async fn create_work_item(
    db: State<'_, AppDb>,
    title: String,
    item_type: String,
    product_id: i64,
    parent_item_id: Option<i64>,
    description: Option<String>,
) -> Result<i64, String> {
    let conn = db.0.lock().await;
    work_item::create(
        &conn,
        &title,
        &item_type,
        product_id,
        parent_item_id,
        description.as_deref(),
    )
    .await
    .map_err(to_message)
}

#[tauri::command]
pub async fn update_work_item_status(
    db: State<'_, AppDb>,
    id: i64,
    status: String,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    work_item::update_status(&conn, id, &status)
        .await
        .map_err(to_message)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_work_item(
    db: State<'_, AppDb>,
    id: i64,
    assignee_id: Option<i64>,
    sprint_id: Option<i64>,
    start_date: Option<i64>,
    end_date: Option<i64>,
    deliverable_id: Option<i64>,
    expected_cost: Option<f64>,
    estimated_profit: Option<f64>,
    chargeable: bool,
    customer_cover_pct: Option<f64>,
    risk: Option<String>,
    solution_id: Option<i64>,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    work_item::update_item(
        &conn,
        id,
        work_item::WorkItemFields {
            assignee_id,
            sprint_id,
            start_date,
            end_date,
            deliverable_id,
            expected_cost,
            estimated_profit,
            chargeable,
            customer_cover_pct,
            risk: risk.unwrap_or_default(),
            solution_id,
        },
    )
    .await
    .map_err(to_message)
}

/// Dependencies between work items. Two items whose Solutions differ are a
/// cross-repo dependency, which the caller derives from `solutionId` rather
/// than being told — one fact, held once.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemLinkDto {
    pub id: i64,
    pub from_work_item_id: i64,
    pub to_work_item_id: i64,
    pub kind: String,
}

/// Every link out of this Product's items — one call for a whole board.
#[tauri::command]
pub async fn list_work_item_links(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Vec<WorkItemLinkDto>, String> {
    let conn = db.0.lock().await;
    let links = crate::db::work_item_link::list_for_product(&conn, product_id)
        .await
        .map_err(to_message)?;
    Ok(links
        .into_iter()
        .map(|l| WorkItemLinkDto {
            id: l.id,
            from_work_item_id: l.from_work_item_id,
            to_work_item_id: l.to_work_item_id,
            kind: l.kind,
        })
        .collect())
}

#[tauri::command]
pub async fn link_work_items(
    db: State<'_, AppDb>,
    from_work_item_id: i64,
    to_work_item_id: i64,
    kind: String,
) -> Result<i64, String> {
    let conn = db.0.lock().await;
    crate::db::work_item_link::link(&conn, from_work_item_id, to_work_item_id, &kind)
        .await
        .map_err(to_message)
}

#[tauri::command]
pub async fn unlink_work_items(db: State<'_, AppDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    crate::db::work_item_link::unlink(&conn, id)
        .await
        .map_err(to_message)
}

#[tauri::command]
pub async fn delete_work_item(db: State<'_, AppDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    work_item::delete(&conn, id).await.map_err(to_message)
}

/// What a generation produced, plus which provider actually ran it and why.
/// The routing reason travels back to the UI deliberately: when a budget hands
/// work over to a local model the output quality changes, and the user must not
/// discover that by wondering why the results got worse.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationResult {
    pub created: Vec<String>,
    pub provider: String,
    pub model: String,
    pub reason: String,
    /// Set when the AI declined rather than guessing. `created` is then empty
    /// and a question is waiting against the work item.
    pub blocked: Option<BlockedDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedDto {
    pub reason: String,
    pub what_is_needed: String,
    pub feedback_id: i64,
}

/// Everything the gates resolve before any content moves: the feature, the
/// provider it may use, and the effort tier its policy allows.
pub(crate) struct StoryGenerationContext {
    pub feature: WorkItem,
    pub provider: crate::db::ai_provider::AiProvider,
    pub effort_tier: String,
}

/// The AI-story command. Gates first (feature type, hierarchy includes user
/// stories, per-item deny-by-default policy, provider configured), then the
/// real work: key from the OS credential store → Claude Messages API with
/// structured outputs → new userStory items under the feature.
#[tauri::command]
pub async fn generate_user_stories(
    db: State<'_, AppDb>,
    feature_id: i64,
) -> Result<GenerationResult, String> {
    use crate::ai::{backend, client};
    use crate::commands::ai_run;
    use crate::db::{product, solution};

    const PURPOSE: &str = "storyGeneration";

    // Resolve gates, budget routing, and prompt inputs under the lock, then
    // release it for the network call so the rest of the app stays responsive.
    let (context, routed, prompt, product_id) = {
        let conn = db.0.lock().await;
        let context = resolve_story_generation(&conn, feature_id).await?;
        let product_id = context.feature.product_id;
        let Some(product_row) = product::find_by_id(&conn, product_id)
            .await
            .map_err(to_message)?
        else {
            return Err("this feature's Product no longer exists".into());
        };
        // The item's policy says which provider is *allowed*; the budget says
        // which is *affordable*. Both must agree before anything is sent.
        let routed = ai_run::plan(
            &conn,
            product_id,
            context.provider.id,
            &context.effort_tier,
            PURPOSE,
        )
        .await?;
        let solutions = solution::list_by_product(&conn, product_id)
            .await
            .map_err(to_message)?
            .into_iter()
            .map(|s| (s.name, s.solution_type, s.answers))
            .collect::<Vec<_>>();
        // Answers a person already gave for this item travel with the prompt,
        // so the AI does not ask the same question twice.
        let clarifications = crate::db::ai_feedback::clarifications_for_item(&conn, feature_id)
            .await
            .map_err(to_message)?;
        let prompt = client::build_story_prompt(
            &product_row.name,
            &product_row.answers,
            &context.feature.title,
            context.feature.description.as_deref(),
            &solutions,
            &clarifications,
        );
        (context, routed, prompt, product_id)
    };

    let started = std::time::Instant::now();
    let result = backend::generate_stories(
        &routed.provider,
        &routed.model,
        &context.effort_tier,
        &prompt,
    )
    .await;
    let latency_ms = started.elapsed().as_millis() as i64;

    // A failed call still consumed something at the provider's end, and the
    // attempt is worth recording either way.
    let drafts = match result {
        Ok((client::Generated::Items(drafts), usage)) => {
            let conn = db.0.lock().await;
            ai_run::record(
                &conn, product_id, Some(feature_id), &routed.provider, &routed.model,
                PURPOSE, &usage, latency_ms, "ok",
            )
            .await;
            drafts
        }
        // The AI declined rather than guessing. That is a good outcome, not an
        // error: the question is stored against the item and returned, and the
        // call is ledgered as spend because the model ran and was paid for.
        Ok((client::Generated::Blocked { reason, what_is_needed }, usage)) => {
            let conn = db.0.lock().await;
            ai_run::record(
                &conn, product_id, Some(feature_id), &routed.provider, &routed.model,
                PURPOSE, &usage, latency_ms, "declined",
            )
            .await;
            let feedback_id = crate::db::ai_feedback::record(
                &conn, feature_id, "needsInformation", &reason, &what_is_needed, None,
            )
            .await
            .map_err(to_message)?;
            return Ok(GenerationResult {
                created: Vec::new(),
                provider: routed.provider.name.clone(),
                model: routed.model.clone(),
                reason: routed.reason.clone(),
                blocked: Some(BlockedDto { reason, what_is_needed, feedback_id }),
            });
        }
        Err(e) => {
            let conn = db.0.lock().await;
            let outcome = if e.contains("refusal") { "refusal" } else { "error" };
            ai_run::record(
                &conn, product_id, Some(feature_id), &routed.provider, &routed.model,
                PURPOSE, &Default::default(), latency_ms, outcome,
            )
            .await;
            return Err(e);
        }
    };

    let conn = db.0.lock().await;
    let mut created = Vec::new();
    for draft in drafts {
        work_item::create(
            &conn,
            &draft.title,
            "userStory",
            product_id,
            Some(feature_id),
            Some(&draft.description),
        )
        .await
        .map_err(to_message)?;
        created.push(draft.title);
    }
    Ok(GenerationResult {
        created,
        provider: routed.provider.name.clone(),
        model: routed.model.clone(),
        reason: routed.reason.clone(),
        blocked: None,
    })
}

/// The gate half, kept separate so the deny-by-default behaviour is unit
/// testable without a credential store or network.
pub(crate) async fn resolve_story_generation(
    conn: &turso::Connection,
    feature_id: i64,
) -> Result<StoryGenerationContext, String> {
    let Some(item) = work_item::find_by_id(conn, feature_id)
        .await
        .map_err(to_message)?
    else {
        return Err(format!("no work item with id {feature_id}"));
    };
    if item.item_type != "feature" {
        return Err(format!(
            "AI story generation works on features — '{}' is a {}",
            item.title, item.item_type
        ));
    }
    let hierarchy = system_setting::get_planning_hierarchy(conn)
        .await
        .map_err(to_message)?;
    if !hierarchy.iter().any(|t| t == "userStory") {
        return Err(
            "The current planning method doesn't use user stories — change 'How Products are planned' in settings to a method that includes them.".into(),
        );
    }
    let (provider, effort_tier) = resolve_item_ai_gate(conn, feature_id, &item.title).await?;
    Ok(StoryGenerationContext {
        feature: item,
        provider,
        effort_tier,
    })
}

/// The deny-by-default policy gate for one work item, without the checks that
/// are specific to story generation. Every AI action anchored on an item goes
/// through this, so a new feature cannot accidentally skip the policy.
pub(crate) async fn resolve_item_ai_gate(
    conn: &turso::Connection,
    item_id: i64,
    item_title: &str,
) -> Result<(crate::db::ai_provider::AiProvider, String), String> {
    // No policy row, or one that doesn't allow reading via a named provider,
    // blocks the call before any content moves.
    let Some(policy) = work_item_policy::get_for_item(conn, item_id)
        .await
        .map_err(to_message)?
    else {
        return Err(format!(
            "'{item_title}' has no AI policy, so AI can't touch it (deny-by-default). Set its work-item AI policy to allow reading, and configure an AI provider in AI Settings."
        ));
    };
    let provider_id = match (policy.allow_read, policy.provider_id) {
        (true, Some(provider_id)) => provider_id,
        _ => {
            return Err(format!(
                "'{item_title}''s AI policy blocks this: it must allow reading and name an AI provider. Configure a provider in AI Settings and update the item's policy."
            ));
        }
    };
    let Some(provider) = crate::db::ai_provider::find_by_id(conn, provider_id)
        .await
        .map_err(to_message)?
    else {
        return Err("the policy's AI provider no longer exists — update the item's policy".into());
    };
    Ok((provider, policy.effort_tier))
}

/// Everything the Deliverable gate resolves before any content moves.
pub(crate) struct DeliverableGenerationContext {
    pub deliverable: crate::db::deliverable::Deliverable,
    pub provider: crate::db::ai_provider::AiProvider,
    pub effort_tier: String,
    /// The hierarchy level to create — see `level_for_deliverable`.
    pub item_type: String,
}

/// Which level a Deliverable breaks down into: the one directly above user
/// stories, so the existing per-feature button can expand them further. With no
/// user-story level configured, the hierarchy's top level is used instead.
pub(crate) fn level_for_deliverable(hierarchy: &[String]) -> Option<String> {
    match hierarchy.iter().position(|t| t == "userStory") {
        // user stories at the very top: generate those
        Some(0) => Some("userStory".to_string()),
        Some(i) => Some(hierarchy[i - 1].clone()),
        None => hierarchy.first().cloned(),
    }
}

/// The gate half of Deliverable generation, kept separate so the
/// deny-by-default behaviour is unit testable without a credential store or
/// network. Gated by the **Product's** policy — deliberately coarser than a
/// work-item policy, so allowing it for one Deliverable allows it for all of
/// that Product's Deliverables.
pub(crate) async fn resolve_deliverable_generation(
    conn: &turso::Connection,
    deliverable_id: i64,
) -> Result<DeliverableGenerationContext, String> {
    use crate::db::{deliverable, product_policy};

    let Some(deliverable) = deliverable::find_by_id(conn, deliverable_id)
        .await
        .map_err(to_message)?
    else {
        return Err(format!("no deliverable with id {deliverable_id}"));
    };
    let hierarchy = system_setting::get_planning_hierarchy(conn)
        .await
        .map_err(to_message)?;
    let Some(item_type) = level_for_deliverable(&hierarchy) else {
        return Err(
            "The current planning method has no work item levels — set 'How Products are planned' in settings."
                .into(),
        );
    };
    // Deny-by-default: no Product policy, or one that doesn't allow reading and
    // generating via a named provider, blocks the call before any content moves.
    let Some(policy) = product_policy::get_for_product(conn, deliverable.product_id)
        .await
        .map_err(to_message)?
    else {
        return Err(format!(
            "'{}''s Product has no AI policy, so AI can't plan it (deny-by-default). Set the Product's AI policy to allow reading and generating, and configure an AI provider in AI Settings.",
            deliverable.name
        ));
    };
    let provider_id = match (policy.allow_read, policy.allow_generate, policy.provider_id) {
        (true, true, Some(provider_id)) => provider_id,
        _ => {
            return Err(format!(
                "The Product's AI policy blocks this: it must allow reading and generating, and name an AI provider. Update it in the Product area (deliverable '{}').",
                deliverable.name
            ));
        }
    };
    let Some(provider) = crate::db::ai_provider::find_by_id(conn, provider_id)
        .await
        .map_err(to_message)?
    else {
        return Err("the policy's AI provider no longer exists — update the Product's policy".into());
    };
    Ok(DeliverableGenerationContext {
        deliverable,
        provider,
        effort_tier: policy.effort_tier,
        item_type,
    })
}

/// Generates the work that achieves a Deliverable. Gates first (Product policy,
/// planning hierarchy), then: key from the OS credential store → Claude Messages
/// API with structured outputs → new work items linked to the Deliverable.
#[tauri::command]
pub async fn generate_deliverable_work(
    db: State<'_, AppDb>,
    deliverable_id: i64,
) -> Result<GenerationResult, String> {
    use crate::ai::{backend, client};
    use crate::commands::ai_run;
    use crate::db::{product, solution, strategy};

    const PURPOSE: &str = "deliverablePlanning";

    // Resolve gates, budget routing, and prompt inputs under the lock, then
    // release it for the network call so the rest of the app stays responsive.
    let (context, routed, prompt, product_id) = {
        let conn = db.0.lock().await;
        let context = resolve_deliverable_generation(&conn, deliverable_id).await?;
        let product_id = context.deliverable.product_id;
        let Some(product_row) = product::find_by_id(&conn, product_id)
            .await
            .map_err(to_message)?
        else {
            return Err("this deliverable's Product no longer exists".into());
        };
        let routed = ai_run::plan(
            &conn,
            product_id,
            context.provider.id,
            &context.effort_tier,
            PURPOSE,
        )
        .await?;
        let solutions = solution::list_by_product(&conn, product_id)
            .await
            .map_err(to_message)?
            .into_iter()
            .map(|s| (s.name, s.solution_type, s.answers))
            .collect::<Vec<_>>();
        let strategy_json = strategy::get(&conn, product_id, "product")
            .await
            .map_err(to_message)?;
        // Existing titles under this deliverable, so a second press adds to the
        // plan rather than repeating it.
        let existing = work_item::list_by_product(&conn, product_id)
            .await
            .map_err(to_message)?
            .into_iter()
            .filter(|i| i.deliverable_id == Some(deliverable_id))
            .map(|i| i.title)
            .collect::<Vec<_>>();
        let label = human_level(&context.item_type);
        let prompt = client::build_deliverable_prompt(
            &product_row.name,
            &product_row.answers,
            &strategy_json,
            &context.deliverable.name,
            &context.deliverable.description,
            label,
            &existing,
            &solutions,
        );
        (context, routed, prompt, product_id)
    };

    let started = std::time::Instant::now();
    let result = backend::generate_stories(
        &routed.provider,
        &routed.model,
        &context.effort_tier,
        &prompt,
    )
    .await;
    let latency_ms = started.elapsed().as_millis() as i64;

    let drafts = match result {
        Ok((client::Generated::Items(drafts), usage)) => {
            let conn = db.0.lock().await;
            ai_run::record(
                &conn, product_id, None, &routed.provider, &routed.model,
                PURPOSE, &usage, latency_ms, "ok",
            )
            .await;
            drafts
        }
        // A Deliverable has no work item to hang feedback on, so the question
        // is returned to the caller rather than stored. Storing it against an
        // invented work item would be worse than not storing it.
        Ok((client::Generated::Blocked { reason, what_is_needed }, usage)) => {
            let conn = db.0.lock().await;
            ai_run::record(
                &conn, product_id, None, &routed.provider, &routed.model,
                PURPOSE, &usage, latency_ms, "declined",
            )
            .await;
            return Ok(GenerationResult {
                created: Vec::new(),
                provider: routed.provider.name.clone(),
                model: routed.model.clone(),
                reason: routed.reason.clone(),
                blocked: Some(BlockedDto { reason, what_is_needed, feedback_id: 0 }),
            });
        }
        Err(e) => {
            let conn = db.0.lock().await;
            let outcome = if e.contains("refusal") { "refusal" } else { "error" };
            ai_run::record(
                &conn, product_id, None, &routed.provider, &routed.model,
                PURPOSE, &Default::default(), latency_ms, outcome,
            )
            .await;
            return Err(e);
        }
    };

    let conn = db.0.lock().await;
    let mut created = Vec::new();
    for draft in drafts {
        let id = work_item::create(
            &conn,
            &draft.title,
            &context.item_type,
            context.deliverable.product_id,
            None,
            Some(&draft.description),
        )
        .await
        .map_err(to_message)?;
        // Link it to the deliverable it was generated to achieve.
        work_item::update_item(
            &conn,
            id,
            work_item::WorkItemFields {
                deliverable_id: Some(deliverable_id),
                ..Default::default()
            },
        )
        .await
        .map_err(to_message)?;
        created.push(draft.title);
    }
    Ok(GenerationResult {
        created,
        provider: routed.provider.name.clone(),
        model: routed.model.clone(),
        reason: routed.reason.clone(),
        blocked: None,
    })
}

/// Plain wording for a hierarchy level, for the prompt.
fn human_level(item_type: &str) -> &'static str {
    match item_type {
        "epic" => "epic",
        "userStory" => "user story",
        "task" => "task",
        _ => "feature",
    }
}

#[cfg(test)]
mod tests {
    use super::{level_for_deliverable, resolve_deliverable_generation, resolve_story_generation};
    use crate::db::product::tests::db_with_product;
    use crate::db::{
        ai_provider, deliverable, product_policy, system_setting, work_item, work_item_policy,
    };

    fn hierarchy(levels: &[&str]) -> Vec<String> {
        levels.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_deliverable_breaks_down_into_the_level_above_user_stories() {
        // the default method: Feature sits above User Story
        assert_eq!(
            level_for_deliverable(&hierarchy(&["epic", "feature", "userStory", "task"])),
            Some("feature".to_string())
        );
        assert_eq!(
            level_for_deliverable(&hierarchy(&["feature", "userStory", "task"])),
            Some("feature".to_string())
        );
        // no user stories configured — fall back to the top level
        assert_eq!(
            level_for_deliverable(&hierarchy(&["feature", "task"])),
            Some("feature".to_string())
        );
        assert_eq!(
            level_for_deliverable(&hierarchy(&["epic", "task"])),
            Some("epic".to_string())
        );
        // user stories at the top: generate those
        assert_eq!(
            level_for_deliverable(&hierarchy(&["userStory", "task"])),
            Some("userStory".to_string())
        );
        assert_eq!(level_for_deliverable(&[]), None);
    }

    #[tokio::test]
    async fn deliverable_generation_is_denied_without_a_product_policy() {
        let (conn, product_id) = db_with_product().await;
        let d = deliverable::create(&conn, product_id, "MVP", "the first release")
            .await
            .expect("deliverable");
        let err = resolve_deliverable_generation(&conn, d)
            .await
            .err()
            .expect("must be blocked");
        assert!(err.contains("deny-by-default"), "got: {err}");
    }

    #[tokio::test]
    async fn deliverable_generation_needs_read_generate_and_a_provider() {
        let (conn, product_id) = db_with_product().await;
        let d = deliverable::create(&conn, product_id, "MVP", "")
            .await
            .expect("deliverable");
        let provider = ai_provider::add(&conn, "Claude", "https://api.anthropic.com", &["m"], "alias")
            .await
            .expect("provider");

        // reading allowed but generating denied
        product_policy::set_policy(&conn, product_id, true, false, Some(provider), "low")
            .await
            .expect("policy");
        assert!(resolve_deliverable_generation(&conn, d).await.is_err());

        // both allowed but no provider named
        product_policy::set_policy(&conn, product_id, true, true, None, "low")
            .await
            .expect("policy");
        assert!(resolve_deliverable_generation(&conn, d).await.is_err());

        // fully allowed
        product_policy::set_policy(&conn, product_id, true, true, Some(provider), "medium")
            .await
            .expect("policy");
        let context = resolve_deliverable_generation(&conn, d).await.expect("allowed");
        assert_eq!(context.item_type, "feature");
        assert_eq!(context.effort_tier, "medium");
    }

    #[tokio::test]
    async fn deliverable_generation_rejects_an_unknown_deliverable() {
        let (conn, _product_id) = db_with_product().await;
        assert!(resolve_deliverable_generation(&conn, 999).await.is_err());
    }

    #[tokio::test]
    async fn story_generation_is_denied_without_a_policy() {
        let (conn, product_id) = db_with_product().await;
        let feature = work_item::create(&conn, "Checkout", "feature", product_id, None, None)
            .await
            .expect("feature");
        let err = resolve_story_generation(&conn, feature)
            .await
            .err()
            .expect("must be blocked");
        assert!(err.contains("deny-by-default"), "got: {err}");
    }

    #[tokio::test]
    async fn story_generation_requires_a_hierarchy_with_user_stories() {
        let (conn, product_id) = db_with_product().await;
        let preset: Vec<String> = ["feature", "task"].iter().map(|s| s.to_string()).collect();
        system_setting::set_planning_hierarchy(&conn, &preset)
            .await
            .expect("set preset");
        let feature = work_item::create(&conn, "Checkout", "feature", product_id, None, None)
            .await
            .expect("feature");
        let err = resolve_story_generation(&conn, feature)
            .await
            .err()
            .expect("must be blocked");
        assert!(err.contains("planning method"), "got: {err}");
    }

    #[tokio::test]
    async fn story_generation_only_works_on_features() {
        let (conn, product_id) = db_with_product().await;
        let epic = work_item::create(&conn, "Big thing", "epic", product_id, None, None)
            .await
            .expect("epic");
        let err = resolve_story_generation(&conn, epic)
            .await
            .err()
            .expect("must be blocked");
        assert!(err.contains("features"), "got: {err}");
    }

    #[tokio::test]
    async fn with_all_gates_passed_the_provider_and_effort_are_resolved() {
        let (conn, product_id) = db_with_product().await;
        let feature = work_item::create(&conn, "Checkout", "feature", product_id, None, None)
            .await
            .expect("feature");
        let provider = ai_provider::add(
            &conn,
            "Claude",
            "https://api.anthropic.com",
            &["claude-opus-4-8"],
            "alias",
        )
        .await
        .expect("provider");
        work_item_policy::set_policy(&conn, feature, true, false, false, Some(provider), "medium")
            .await
            .expect("policy");
        let context = resolve_story_generation(&conn, feature)
            .await
            .expect("gates pass");
        assert_eq!(context.provider.id, provider);
        assert_eq!(context.effort_tier, "medium");
        assert_eq!(context.feature.title, "Checkout");
    }

    #[tokio::test]
    async fn a_deleted_provider_blocks_generation() {
        let (conn, product_id) = db_with_product().await;
        let feature = work_item::create(&conn, "Checkout", "feature", product_id, None, None)
            .await
            .expect("feature");
        let provider = ai_provider::add(&conn, "Claude", "https://a.example", &["m"], "alias")
            .await
            .expect("provider");
        work_item_policy::set_policy(&conn, feature, true, false, false, Some(provider), "low")
            .await
            .expect("policy");
        ai_provider::remove(&conn, provider).await.expect("remove");
        let err = resolve_story_generation(&conn, feature)
            .await
            .err()
            .expect("must be blocked");
        assert!(err.contains("policy"), "got: {err}");
    }
}
