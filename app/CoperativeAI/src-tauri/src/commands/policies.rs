//! AI policy commands — the editor surface over the deny-by-default gates in
//! db::work_item_policy (per item) and db::product_policy (per Product, used by
//! Deliverable planning).

use super::{to_message, AppDb};
use crate::db::product_policy::{self, ProductPolicy};
use crate::db::work_item_policy::{self, WorkItemPolicy};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemPolicyDto {
    pub work_item_id: i64,
    pub allow_read: bool,
    pub allow_edit: bool,
    pub allow_generate_tests: bool,
    pub provider_id: Option<i64>,
    pub effort_tier: String,
}

impl From<WorkItemPolicy> for WorkItemPolicyDto {
    fn from(p: WorkItemPolicy) -> Self {
        WorkItemPolicyDto {
            work_item_id: p.work_item_id,
            allow_read: p.allow_read,
            allow_edit: p.allow_edit,
            allow_generate_tests: p.allow_generate_tests,
            provider_id: p.provider_id,
            effort_tier: p.effort_tier,
        }
    }
}

#[tauri::command]
pub async fn get_work_item_policy(
    db: State<'_, AppDb>,
    work_item_id: i64,
) -> Result<Option<WorkItemPolicyDto>, String> {
    let conn = db.0.lock().await;
    let policy = work_item_policy::for_item(&conn, work_item_id)
        .await
        .map_err(to_message)?;
    Ok(policy.map(WorkItemPolicyDto::from))
}

#[tauri::command]
pub async fn set_work_item_policy(
    db: State<'_, AppDb>,
    work_item_id: i64,
    allow_read: bool,
    allow_edit: bool,
    allow_generate_tests: bool,
    provider_id: Option<i64>,
    effort_tier: String,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    work_item_policy::set_policy(
        &conn,
        work_item_id,
        allow_read,
        allow_edit,
        allow_generate_tests,
        provider_id,
        &effort_tier,
    )
    .await
    .map_err(to_message)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductPolicyDto {
    pub product_id: i64,
    pub allow_read: bool,
    pub allow_generate: bool,
    pub allow_edit: bool,
    pub allow_generate_tests: bool,
    pub provider_id: Option<i64>,
    pub effort_tier: String,
}

impl From<ProductPolicy> for ProductPolicyDto {
    fn from(p: ProductPolicy) -> Self {
        ProductPolicyDto {
            product_id: p.product_id,
            allow_read: p.allow_read,
            allow_generate: p.allow_generate,
            allow_edit: p.allow_edit,
            allow_generate_tests: p.allow_generate_tests,
            provider_id: p.provider_id,
            effort_tier: p.effort_tier,
        }
    }
}

#[tauri::command]
pub async fn get_product_policy(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Option<ProductPolicyDto>, String> {
    let conn = db.0.lock().await;
    let policy = product_policy::for_product(&conn, product_id)
        .await
        .map_err(to_message)?;
    Ok(policy.map(ProductPolicyDto::from))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn set_product_policy(
    db: State<'_, AppDb>,
    product_id: i64,
    allow_read: bool,
    allow_generate: bool,
    allow_edit: bool,
    allow_generate_tests: bool,
    provider_id: Option<i64>,
    effort_tier: String,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    product_policy::set_policy(
        &conn,
        product_id,
        allow_read,
        allow_generate,
        allow_edit,
        allow_generate_tests,
        provider_id,
        &effort_tier,
    )
    .await
    .map_err(to_message)
}

/// A Solution's AI policy override — see `db::ai_permission` for the walk.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SolutionPolicyDto {
    pub solution_id: i64,
    pub allow_read: bool,
    pub allow_edit: bool,
    pub allow_generate_tests: bool,
    pub provider_id: Option<i64>,
    pub effort_tier: String,
}

/// The override for one Solution, or `None` where it follows its Product.
#[tauri::command]
pub async fn get_solution_policy(
    db: State<'_, AppDb>,
    solution_id: i64,
) -> Result<Option<SolutionPolicyDto>, String> {
    let conn = db.0.lock().await;
    let policy = crate::db::solution_policy::for_solution(&conn, solution_id)
        .await
        .map_err(to_message)?;
    Ok(policy.map(|p| SolutionPolicyDto {
        solution_id: p.solution_id,
        allow_read: p.allow_read,
        allow_edit: p.allow_edit,
        allow_generate_tests: p.allow_generate_tests,
        provider_id: p.provider_id,
        effort_tier: p.effort_tier,
    }))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn set_solution_policy(
    db: State<'_, AppDb>,
    solution_id: i64,
    allow_read: bool,
    allow_edit: bool,
    allow_generate_tests: bool,
    provider_id: Option<i64>,
    effort_tier: String,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    crate::db::solution_policy::set_policy(
        &conn,
        solution_id,
        allow_read,
        allow_edit,
        allow_generate_tests,
        provider_id,
        &effort_tier,
    )
    .await
    .map_err(to_message)
}

/// Removes the override, so this Solution follows its Product again.
#[tauri::command]
pub async fn clear_solution_policy(
    db: State<'_, AppDb>,
    solution_id: i64,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    crate::db::solution_policy::clear(&conn, solution_id)
        .await
        .map_err(to_message)
}

/// Whether the AI may act on one work item, and what to change if not.
///
/// **The walk, exposed for the UI.** The build plan disables Plan and Execute
/// when nothing may act, and it has to ask the same question the gate asks —
/// otherwise the button and the backend disagree, which is how a screen ends up
/// refusing work the backend would have allowed, or offering work it will
/// refuse.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPermissionDto {
    pub allowed: bool,
    /// Empty when allowed; otherwise what to change and where.
    pub reason: String,
    /// Whether a provider is named anywhere that could run it.
    pub has_provider: bool,
}

#[tauri::command]
pub async fn check_item_ai_permission(
    db: State<'_, AppDb>,
    work_item_id: i64,
) -> Result<AiPermissionDto, String> {
    use crate::db::{ai_permission, work_item_policy::AiUse};

    let conn = db.0.lock().await;
    let verdict = ai_permission::verdict(&conn, work_item_id, AiUse::Read)
        .await
        .map_err(to_message)?;
    // The item's own routing override can name a provider the permission does
    // not, so both are considered before saying there is nothing to send to.
    let own = crate::db::work_item_policy::for_item(&conn, work_item_id)
        .await
        .map_err(to_message)?
        .and_then(|p| p.provider_id);
    let area = crate::db::work_item::find_by_id(&conn, work_item_id)
        .await
        .map_err(to_message)?
        .map(|i| i.product_id);
    let default = match area {
        Some(product_id) => crate::db::routing_default::for_area(&conn, product_id, "develop")
            .await
            .map_err(to_message)?
            .and_then(|d| d.provider_id),
        None => None,
    };
    Ok(AiPermissionDto {
        allowed: verdict.allowed,
        reason: if verdict.allowed {
            String::new()
        } else {
            ai_permission::refusal(&verdict, AiUse::Read)
        },
        has_provider: own.or(default).or(verdict.provider_id).is_some(),
    })
}
