//! Work-item AI policy commands — the editor surface over the
//! deny-by-default gate in db::work_item_policy.

use super::{to_message, AppDb};
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
