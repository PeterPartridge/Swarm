// The data layer is built ahead of the command layer (tables first, per the
// approved build order), so these APIs have no callers outside tests yet.
// Remove this allow as commands start consuming each module.
#![allow(dead_code)]

pub mod ai_feedback;
pub mod ai_provider;
pub mod ai_usage;
pub mod architecture_doc;
pub mod change_run;
pub mod deliverable;
pub mod design_asset;
pub mod developer_rules;
pub mod emitted_file;
pub mod model_install;
pub mod model_price;
pub mod feature_design;
pub mod product;
pub mod product_budget;
pub mod product_policy;
pub mod repo_link;
pub mod repository;
pub mod role;
pub mod solution;
pub mod solution_management;
pub mod solution_strategy;
pub mod sprint;
pub mod sprint_capacity;
pub mod strategy;
pub mod system_setting;
pub mod team_member;
pub mod test_case;
pub mod work_item;
pub mod work_item_link;
pub mod work_item_plan;
pub mod work_item_policy;

use std::time::{SystemTime, UNIX_EPOCH};
use turso::{Builder, Connection, Database};

/// A database failure or a rejected value (invariants are enforced in code
/// because the embedded engine does not enforce foreign keys for us).
#[derive(Debug)]
pub enum DbError {
    Db(turso::Error),
    Validation(String),
}

impl From<turso::Error> for DbError {
    fn from(e: turso::Error) -> Self {
        DbError::Db(e)
    }
}

impl std::fmt::Display for DbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DbError::Db(e) => write!(f, "database error: {e}"),
            DbError::Validation(msg) => write!(f, "{msg}"),
        }
    }
}

impl std::error::Error for DbError {}

pub type Result<T> = std::result::Result<T, DbError>;

/// Opens the CoperativeAI database at the given path (or an in-memory database
/// for `:memory:`, used by tests) and returns a ready connection.
pub async fn connect(path: &str) -> turso::Result<Connection> {
    let db: Database = Builder::new_local(path).build().await?;
    db.connect()
}

/// Creates every table the app uses. Called once at startup (and by tests
/// that exercise cross-table rules).
pub async fn create_all_tables(conn: &Connection) -> Result<()> {
    system_setting::create_table(conn).await?;
    solution_management::create_table(conn).await?;
    product::create_table(conn).await?;
    role::create_table(conn).await?;
    team_member::create_table(conn).await?;
    deliverable::create_table(conn).await?;
    sprint::create_table(conn).await?;
    // after sprint + team_member: capacity names both
    sprint_capacity::create_table(conn).await?;
    solution::create_table(conn).await?;
    // after solution: links and architecture docs name them
    repo_link::create_table(conn).await?;
    architecture_doc::create_table(conn).await?;
    repository::create_table(conn).await?;
    work_item::create_table(conn).await?;
    // after work_item: links name two of them
    work_item_link::create_table(conn).await?;
    // after work_item + solution: a run hands one into the other
    change_run::create_table(conn).await?;
    // after work_item + solution: a plan is what one requires of the other
    work_item_plan::create_table(conn).await?;
    ai_provider::create_table(conn).await?;
    work_item_policy::create_table(conn).await?;
    product_policy::create_table(conn).await?;
    // after ai_provider + product: budgets name providers, prices name models
    ai_usage::create_table(conn).await?;
    model_price::create_table(conn).await?;
    model_install::create_table(conn).await?;
    product_budget::create_table(conn).await?;
    emitted_file::create_table(conn).await?;
    // after work_item: feedback hangs off an item
    ai_feedback::create_table(conn).await?;
    developer_rules::create_table(conn).await?;
    solution_strategy::create_table(conn).await?;
    feature_design::create_table(conn).await?;
    strategy::create_table(conn).await?;
    // after product: design assets belong to one
    design_asset::create_table(conn).await?;
    // after deliverable + work_item: a test case may point at either
    test_case::create_table(conn).await?;
    Ok(())
}

/// Timestamps are stored as unix milliseconds so ordering doesn't depend on
/// SQL date functions.
pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before 1970")
        .as_millis() as i64
}
