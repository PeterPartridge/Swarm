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
    let policy = work_item_policy::get_for_item(&conn, work_item_id)
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
    pub provider_id: Option<i64>,
    pub effort_tier: String,
}

impl From<ProductPolicy> for ProductPolicyDto {
    fn from(p: ProductPolicy) -> Self {
        ProductPolicyDto {
            product_id: p.product_id,
            allow_read: p.allow_read,
            allow_generate: p.allow_generate,
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
    let policy = product_policy::get_for_product(&conn, product_id)
        .await
        .map_err(to_message)?;
    Ok(policy.map(ProductPolicyDto::from))
}

#[tauri::command]
pub async fn set_product_policy(
    db: State<'_, AppDb>,
    product_id: i64,
    allow_read: bool,
    allow_generate: bool,
    provider_id: Option<i64>,
    effort_tier: String,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    product_policy::set_policy(
        &conn,
        product_id,
        allow_read,
        allow_generate,
        provider_id,
        &effort_tier,
    )
    .await
    .map_err(to_message)
}
