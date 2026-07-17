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
        },
    )
    .await
    .map_err(to_message)
}

#[tauri::command]
pub async fn delete_work_item(db: State<'_, AppDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    work_item::delete(&conn, id).await.map_err(to_message)
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
) -> Result<Vec<String>, String> {
    use crate::ai::{client, keys};
    use crate::db::{product, solution};

    // Resolve gates + prompt inputs under the lock, then release it for the
    // network call so the rest of the app stays responsive.
    let (context, prompt) = {
        let conn = db.0.lock().await;
        let context = resolve_story_generation(&conn, feature_id).await?;
        let Some(product_row) = product::find_by_id(&conn, context.feature.product_id)
            .await
            .map_err(to_message)?
        else {
            return Err("this feature's Product no longer exists".into());
        };
        let solutions = solution::list_by_product(&conn, product_row.id)
            .await
            .map_err(to_message)?
            .into_iter()
            .map(|s| (s.name, s.solution_type, s.answers))
            .collect::<Vec<_>>();
        let prompt = client::build_story_prompt(
            &product_row.name,
            &product_row.answers,
            &context.feature.title,
            context.feature.description.as_deref(),
            &solutions,
        );
        (context, prompt)
    };

    let api_key = keys::get_key(&context.provider.key_alias)?;
    let model = context
        .provider
        .models
        .first()
        .cloned()
        .ok_or_else(|| "the allowed AI provider has no models configured".to_string())?;
    let drafts = client::generate_stories(
        &context.provider.api_base_url,
        &api_key,
        &model,
        &context.effort_tier,
        &prompt,
    )
    .await?;

    let conn = db.0.lock().await;
    let mut created = Vec::new();
    for draft in drafts {
        work_item::create(
            &conn,
            &draft.title,
            "userStory",
            context.feature.product_id,
            Some(feature_id),
            Some(&draft.description),
        )
        .await
        .map_err(to_message)?;
        created.push(draft.title);
    }
    Ok(created)
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
    // Deny-by-default: no policy row, or a policy that doesn't allow reading
    // via a named provider, blocks the call before any content moves.
    let Some(policy) = work_item_policy::get_for_item(conn, feature_id)
        .await
        .map_err(to_message)?
    else {
        return Err(format!(
            "'{}' has no AI policy, so AI can't touch it (deny-by-default). Set its work-item AI policy to allow reading, and configure an AI provider in AI Settings.",
            item.title
        ));
    };
    let provider_id = match (policy.allow_read, policy.provider_id) {
        (true, Some(provider_id)) => provider_id,
        _ => {
            return Err(format!(
                "'{}''s AI policy blocks this: it must allow reading and name an AI provider. Configure a provider in AI Settings and update the item's policy.",
                item.title
            ));
        }
    };
    let Some(provider) = crate::db::ai_provider::find_by_id(conn, provider_id)
        .await
        .map_err(to_message)?
    else {
        return Err("the policy's AI provider no longer exists — update the item's policy".into());
    };
    Ok(StoryGenerationContext {
        feature: item,
        provider,
        effort_tier: policy.effort_tier,
    })
}

#[cfg(test)]
mod tests {
    use super::resolve_story_generation;
    use crate::db::product::tests::db_with_product;
    use crate::db::{ai_provider, system_setting, work_item, work_item_policy};

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
