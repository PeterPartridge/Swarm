//! Test-case commands (Test tab): QA's plain-English scenarios, each optionally
//! associated with a Deliverable or a Work Item.

use super::{to_message, AppDb};
use crate::db::test_case::{self, TestCase};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestCaseDto {
    pub id: i64,
    pub product_id: i64,
    pub title: String,
    pub scenario: String,
    pub state: String,
    pub test_path: Option<String>,
    pub deliverable_id: Option<i64>,
    pub work_item_id: Option<i64>,
}

impl From<TestCase> for TestCaseDto {
    fn from(t: TestCase) -> Self {
        TestCaseDto {
            id: t.id,
            product_id: t.product_id,
            title: t.title,
            scenario: t.scenario,
            state: t.state,
            test_path: t.test_path,
            deliverable_id: t.deliverable_id,
            work_item_id: t.work_item_id,
        }
    }
}

#[tauri::command]
pub async fn list_test_cases(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Vec<TestCaseDto>, String> {
    let conn = db.0.lock().await;
    let cases = test_case::list_by_product(&conn, product_id)
        .await
        .map_err(to_message)?;
    Ok(cases.into_iter().map(TestCaseDto::from).collect())
}

#[tauri::command]
pub async fn create_test_case(
    db: State<'_, AppDb>,
    product_id: i64,
    title: String,
    scenario: String,
    deliverable_id: Option<i64>,
    work_item_id: Option<i64>,
) -> Result<i64, String> {
    let conn = db.0.lock().await;
    test_case::create(&conn, product_id, &title, &scenario, deliverable_id, work_item_id)
        .await
        .map_err(to_message)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_test_case(
    db: State<'_, AppDb>,
    id: i64,
    title: String,
    scenario: String,
    state: String,
    test_path: Option<String>,
    deliverable_id: Option<i64>,
    work_item_id: Option<i64>,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    test_case::update_case(
        &conn,
        id,
        &title,
        &scenario,
        &state,
        test_path.as_deref(),
        deliverable_id,
        work_item_id,
    )
    .await
    .map_err(to_message)
}

#[tauri::command]
pub async fn delete_test_case(db: State<'_, AppDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    test_case::delete(&conn, id).await.map_err(to_message)
}
