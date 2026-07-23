// The data layer is built ahead of the command layer (tables first, per the
// approved build order), so these APIs have no callers outside tests yet.
// Remove this allow as commands start consuming each module.
#![allow(dead_code)]

pub mod ai_feedback;
pub mod ai_provider;
pub mod ai_usage;
pub mod architecture_doc;
pub mod change_run;
pub mod commit_policy;
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
pub mod work_item_change;
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

/// The column names of a table, empty when the table does not exist.
///
/// Every migration asks this to decide whether it needs to run, and every one
/// of them must ask it *this* way.
///
/// `SELECT name FROM pragma_table_info('x')` — the obvious spelling, and what
/// this app used everywhere — leaves a read transaction open that nothing ever
/// closes. Reads keep working, writes keep returning Ok, and **every write made
/// afterwards on that connection is discarded when the process exits.** The
/// page cache serves them for the life of the session, so the app looks
/// correct right up until it is restarted.
///
/// That is how it presented: startup reached the first migration, poisoned the
/// connection before the fifth table was created, and every Product anyone
/// created was gone the next time they opened the app.
///
/// `PRAGMA table_info(...)` through turso's own pragma API does not do this —
/// it drains and finalises the statement itself. Column 1 is the name.
pub async fn table_columns(conn: &Connection, table: &str) -> Result<Vec<String>> {
    let mut columns = Vec::new();
    conn.pragma_query(&format!("table_info('{table}')"), |row| {
        if let Ok(name) = row.get::<String>(1) {
            columns.push(name);
        }
        Ok(())
    })
    .await?;
    Ok(columns)
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
    // after work_item + solution: a change names one and may name the other
    work_item_change::create_table(conn).await?;
    // after work_item + solution: a run hands one into the other
    change_run::create_table(conn).await?;
    // after solution: a commit policy belongs to one
    commit_policy::create_table(conn).await?;
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

#[cfg(test)]
mod durability_tests {
    use super::*;

    /// The whole of startup must reach disk.
    ///
    /// This is the test that was missing. Every other database test runs
    /// against `:memory:`, where a write that never reaches the file cannot
    /// fail — so nothing proved that closing the app and opening it again
    /// finds the work still there. It did not: one bad spelling of a schema
    /// read poisoned the connection partway through `create_all_tables`, and
    /// from that point on every write was discarded when the process exited.
    /// Four tables of thirty survived, and every Product anyone created was
    /// gone by the next launch.
    ///
    /// Asserting on the table count rather than on one row is deliberate: a
    /// test that only checked Products would still have passed, because
    /// `products` is built before the first migration that broke things.
    #[tokio::test]
    async fn every_table_and_a_late_write_survive_a_restart() {
        let dir = std::env::temp_dir().join(format!(
            "coperativeai-durability-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("CoperativeAIdb.db");
        let path = path.to_str().expect("utf-8 path").to_string();

        let expected = {
            let conn = connect(&path).await.expect("open");
            create_all_tables(&conn).await.expect("tables");
            // written last, so it is behind every migration
            product::create(&conn, "Shop App", "{}").await.expect("product");
            team_member::add(&conn, "Ada", None).await.expect("member");
            count_tables(&conn).await
        };
        assert!(expected > 20, "startup should build the whole schema, got {expected}");

        let conn = connect(&path).await.expect("reopen");
        assert_eq!(
            count_tables(&conn).await,
            expected,
            "tables created at startup did not survive the restart"
        );
        assert_eq!(
            product::list_all(&conn).await.expect("products").len(),
            1,
            "the Product was created and then lost when the app restarted"
        );
        assert_eq!(
            team_member::list_all(&conn).await.expect("members").len(),
            1,
            "a write made after every migration did not survive the restart"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Startup is idempotent: running it again over a populated file must not
    /// disturb what is already there.
    #[tokio::test]
    async fn a_second_startup_leaves_the_data_alone() {
        let dir = std::env::temp_dir().join(format!(
            "coperativeai-restart-idempotent-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("CoperativeAIdb.db");
        let path = path.to_str().expect("utf-8 path").to_string();

        {
            let conn = connect(&path).await.expect("open");
            create_all_tables(&conn).await.expect("tables");
            product::create(&conn, "Shop App", "{}").await.expect("product");
        }
        {
            // second launch: migrations run again over real data
            let conn = connect(&path).await.expect("reopen");
            create_all_tables(&conn).await.expect("tables again");
            product::create(&conn, "Second Product", "{}").await.expect("product 2");
        }

        let conn = connect(&path).await.expect("third open");
        create_all_tables(&conn).await.expect("tables again");
        let names: Vec<String> = product::list_all(&conn)
            .await
            .expect("products")
            .into_iter()
            .map(|p| p.name)
            .collect();
        assert_eq!(names, vec!["Shop App", "Second Product"]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    async fn count_tables(conn: &Connection) -> i64 {
        let mut rows = conn
            .query("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'", ())
            .await
            .expect("count tables");
        rows.next()
            .await
            .expect("row")
            .expect("one row")
            .get(0)
            .expect("count")
    }

    /// The spelling that caused it, pinned so it cannot come back quietly.
    ///
    /// `SELECT ... FROM pragma_table_info(...)` leaves a read transaction open
    /// that nothing closes, and every write afterwards is lost on exit. This
    /// test does not assert the bug — it asserts that the helper every
    /// migration now uses does *not* have it.
    #[tokio::test]
    async fn reading_a_tables_columns_does_not_stop_later_writes_persisting() {
        let dir = std::env::temp_dir().join(format!(
            "coperativeai-columns-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("CoperativeAIdb.db");
        let path = path.to_str().expect("utf-8 path").to_string();

        {
            let conn = connect(&path).await.expect("open");
            product::create_table(&conn).await.expect("table");
            let columns = table_columns(&conn, "products").await.expect("columns");
            assert!(columns.iter().any(|c| c == "answers"), "got {columns:?}");
            // and a table that does not exist reads as no columns, not an error
            assert!(table_columns(&conn, "not_a_table").await.expect("none").is_empty());

            product::create(&conn, "Written After", "{}").await.expect("product");
        }

        let conn = connect(&path).await.expect("reopen");
        assert_eq!(
            product::list_all(&conn).await.expect("list").len(),
            1,
            "a write made after reading a table's columns was lost"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod spelling_guard {
    /// The bad spelling must never come back.
    ///
    /// `SELECT ... FROM pragma_table_info(...)` leaves a read transaction open
    /// and every write afterwards on that connection is discarded at process
    /// exit. It cost this app every Product anyone had ever created. The fix
    /// was `table_columns`, but that is a convention, and a convention is only
    /// as good as the next person who does not know about it.
    ///
    /// This walks the source rather than the schema because the defect is in
    /// how the question is *asked*, and nothing at runtime can see the
    /// difference — that is exactly what made it so expensive.
    #[test]
    fn no_migration_reads_a_pragma_through_a_select() {
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut offenders = Vec::new();
        walk(&src, &mut |path, text| {
            // This file documents the spelling in order to forbid it.
            if path.ends_with("mod.rs") && text.contains("no_migration_reads_a_pragma") {
                return;
            }
            for (n, line) in text.lines().enumerate() {
                let lower = line.to_lowercase();
                if lower.contains("pragma_table_info") && lower.contains("select") {
                    offenders.push(format!("{}:{}", path.display(), n + 1));
                }
            }
        });
        assert!(
            offenders.is_empty(),
            "use db::table_columns instead — a SELECT over pragma_table_info silently discards \
             every later write on that connection. Found at: {offenders:?}"
        );
    }

    fn walk(dir: &std::path::Path, f: &mut impl FnMut(&std::path::Path, &str)) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, f);
            } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
                if let Ok(text) = std::fs::read_to_string(&path) {
                    f(&path, &text);
                }
            }
        }
    }
}
