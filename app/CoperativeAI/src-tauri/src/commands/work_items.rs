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
pub async fn update_work_item(
    db: State<'_, AppDb>,
    id: i64,
    assignee_id: Option<i64>,
    sprint_id: Option<i64>,
    start_date: Option<i64>,
    end_date: Option<i64>,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    work_item::update_item(&conn, id, assignee_id, sprint_id, start_date, end_date)
        .await
        .map_err(to_message)
}

#[tauri::command]
pub async fn delete_work_item(db: State<'_, AppDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    work_item::delete(&conn, id).await.map_err(to_message)
}

/// The AI-story hook. Runs every gate — feature type, hierarchy includes
/// user stories, per-item policy (deny-by-default), provider configured —
/// before any AI work would happen. Real generation ships with the AI
/// integration build; until then the gates themselves are the feature.
#[tauri::command]
pub async fn generate_user_stories(db: State<'_, AppDb>, feature_id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    generate_user_stories_inner(&conn, feature_id).await
}

pub(crate) async fn generate_user_stories_inner(
    conn: &turso::Connection,
    feature_id: i64,
) -> Result<(), String> {
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
    if !policy.allow_read || policy.provider_id.is_none() {
        return Err(format!(
            "'{}''s AI policy blocks this: it must allow reading and name an AI provider. Configure a provider in AI Settings and update the item's policy.",
            item.title
        ));
    }
    Err("AI story generation arrives with the AI-integration build — this feature's policy gates all passed.".into())
}

#[cfg(test)]
mod tests {
    use super::generate_user_stories_inner;
    use crate::db::product::tests::db_with_product;
    use crate::db::{ai_provider, system_setting, work_item, work_item_policy};

    #[tokio::test]
    async fn story_generation_is_denied_without_a_policy() {
        let (conn, product_id) = db_with_product().await;
        let feature = work_item::create(&conn, "Checkout", "feature", product_id, None, None)
            .await
            .expect("feature");
        let err = generate_user_stories_inner(&conn, feature)
            .await
            .expect_err("must be blocked");
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
        let err = generate_user_stories_inner(&conn, feature)
            .await
            .expect_err("must be blocked");
        assert!(err.contains("planning method"), "got: {err}");
    }

    #[tokio::test]
    async fn story_generation_only_works_on_features() {
        let (conn, product_id) = db_with_product().await;
        let epic = work_item::create(&conn, "Big thing", "epic", product_id, None, None)
            .await
            .expect("epic");
        let err = generate_user_stories_inner(&conn, epic)
            .await
            .expect_err("must be blocked");
        assert!(err.contains("features"), "got: {err}");
    }

    #[tokio::test]
    async fn with_all_gates_passed_the_pending_integration_is_reported() {
        let (conn, product_id) = db_with_product().await;
        let feature = work_item::create(&conn, "Checkout", "feature", product_id, None, None)
            .await
            .expect("feature");
        let provider = ai_provider::add(
            &conn,
            "Claude",
            "https://api.anthropic.com",
            &["claude-sonnet-5"],
            "alias",
        )
        .await
        .expect("provider");
        work_item_policy::set_policy(&conn, feature, true, false, false, Some(provider), "medium")
            .await
            .expect("policy");
        let err = generate_user_stories_inner(&conn, feature)
            .await
            .expect_err("integration not built yet");
        assert!(err.contains("gates all passed"), "got: {err}");
    }
}
