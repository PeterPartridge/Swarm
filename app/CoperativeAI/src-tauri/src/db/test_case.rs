//! The `TestCase` model — a plain-English test scenario QA designs in the Test
//! area. A test case belongs to a Product and may be associated with a
//! Deliverable, a Work Item, both, or neither (a test can exist before the work
//! that satisfies it does).

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

/// designed = written by QA; implemented = a real test exists at `test_path`.
pub const STATES: &[&str] = &["designed", "implemented"];

/// How the last run of a scenario's test ended.
///
/// **Deliberately separate from `STATES`.** Running does not change whether a
/// test exists, and a red test is not an unimplemented one — before the work is
/// built, red is the *expected* result. Folding the two together would make the
/// app claim a scenario had regressed to "designed" because its test correctly
/// failed.
pub const RUN_OUTCOMES: &[&str] = &["passed", "failed", "skipped", "errored"];

#[derive(Debug, Clone, PartialEq)]
pub struct TestCase {
    pub id: i64,
    pub product_id: i64,
    pub title: String,
    pub scenario: String,
    pub state: String,
    pub test_path: Option<String>,
    pub deliverable_id: Option<i64>,
    pub work_item_id: Option<i64>,
    /// Whether this scenario is part of the regression suite — the set that is
    /// run to prove the product still works, rather than to prove one change.
    ///
    /// **Somebody says so; nothing infers it.** The same spec can be a one-off
    /// check this week and the thing guarding checkout for two years, and no
    /// property of the test can tell those apart.
    pub regression: bool,
    /// The names of the tests in `test_path`, as their runner prints them.
    /// Recorded at generation so a scenario's own verdict can be found in a
    /// run that covers the whole suite. Empty for a hand-written test, and for
    /// anything implemented before this was asked for.
    pub test_names: Vec<String>,
    pub last_run_at: Option<i64>,
    /// One of `RUN_OUTCOMES`, or `None` if it has never been run.
    pub last_run_outcome: Option<String>,
    /// A short human summary ("2 passed, 1 failed", or "by exit code only"
    /// when no parser recognised the output). Never the full output — that is
    /// returned to the caller and shown, but storing megabytes of runner noise
    /// per case would bloat an embedded database for something read once.
    pub last_run_summary: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

const SELECT: &str = "SELECT id, productId, title, scenario, state, testPath, deliverableId, workItemId, createdAt, updatedAt, testNames, lastRunAt, lastRunOutcome, lastRunSummary, regression FROM test_cases";

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS test_cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            productId INTEGER NOT NULL,
            title TEXT NOT NULL,
            scenario TEXT NOT NULL DEFAULT '',
            state TEXT NOT NULL DEFAULT 'designed',
            testPath TEXT,
            deliverableId INTEGER,
            workItemId INTEGER,
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL,
            testNames TEXT NOT NULL DEFAULT '[]',
            lastRunAt INTEGER,
            lastRunOutcome TEXT,
            lastRunSummary TEXT
        )",
        (),
    )
    .await?;

    // **Added, not recreated around.** Round 2 shipped this table, and the rows
    // in it hold paths somebody typed by hand — the same rule `solutions`
    // follows for every column added since its first version.
    let mut columns = Vec::new();
    let mut rows = conn.query("PRAGMA table_info(test_cases)", ()).await?;
    while let Some(row) = rows.next().await? {
        let name: String = row.get(1)?;
        columns.push(name);
    }
    for (name, definition) in [
        ("testNames", "TEXT NOT NULL DEFAULT '[]'"),
        ("lastRunAt", "INTEGER"),
        ("lastRunOutcome", "TEXT"),
        ("lastRunSummary", "TEXT"),
        ("regression", "INTEGER NOT NULL DEFAULT 0"),
    ] {
        if !columns.iter().any(|c| c == name) {
            conn.execute(&format!("ALTER TABLE test_cases ADD COLUMN {name} {definition}"), ())
                .await?;
        }
    }
    Ok(())
}

/// Puts a scenario in the regression suite, or takes it out.
///
/// Its own call, like `set_implemented`: it is a decision about what the test
/// is *for*, and routing it through the general update would mean restating a
/// title and scenario nobody was changing — which is how they get overwritten.
pub async fn set_regression(conn: &Connection, id: i64, regression: bool) -> Result<()> {
    if find_by_id(conn, id).await?.is_none() {
        return Err(DbError::Validation(format!("no test case with id {id}")));
    }
    conn.execute(
        "UPDATE test_cases SET regression = ?1, updatedAt = ?2 WHERE id = ?3",
        (if regression { 1_i64 } else { 0 }, now_millis(), id),
    )
    .await?;
    Ok(())
}

/// Records that a scenario now has a real test, and what its tests are called.
///
/// Separate from `update_case` because it is a different act: `update_case` is
/// somebody editing a scenario, this is the outcome of implementing one. Going
/// through the general update would mean the caller restating the title and
/// scenario it did not change, which is how they get overwritten.
pub async fn set_implementation(
    conn: &Connection,
    id: i64,
    test_path: &str,
    names: &[String],
) -> Result<()> {
    if find_by_id(conn, id).await?.is_none() {
        return Err(DbError::Validation(format!("no test case with id {id}")));
    }
    let names_json = serde_json::to_string(names).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "UPDATE test_cases SET state = 'implemented', testPath = ?1, testNames = ?2,
         updatedAt = ?3 WHERE id = ?4",
        (test_path, names_json, now_millis(), id),
    )
    .await?;
    Ok(())
}

/// Records how the last run of this scenario's test went.
///
/// Does **not** touch `state`: see `RUN_OUTCOMES`.
pub async fn record_run(
    conn: &Connection,
    id: i64,
    outcome: &str,
    summary: &str,
) -> Result<()> {
    if !RUN_OUTCOMES.contains(&outcome) {
        return Err(DbError::Validation(format!(
            "a run outcome must be one of {RUN_OUTCOMES:?}, got '{outcome}'"
        )));
    }
    if find_by_id(conn, id).await?.is_none() {
        return Err(DbError::Validation(format!("no test case with id {id}")));
    }
    conn.execute(
        "UPDATE test_cases SET lastRunAt = ?1, lastRunOutcome = ?2, lastRunSummary = ?3,
         updatedAt = ?4 WHERE id = ?5",
        (now_millis(), outcome, summary, now_millis(), id),
    )
    .await?;
    Ok(())
}

/// Association targets are validated when supplied — a test case never points
/// at a Deliverable or Work Item that does not exist.
async fn check_links(
    conn: &Connection,
    deliverable_id: Option<i64>,
    work_item_id: Option<i64>,
) -> Result<()> {
    if let Some(d) = deliverable_id {
        if crate::db::deliverable::find_by_id(conn, d).await?.is_none() {
            return Err(DbError::Validation(format!("no Deliverable with id {d}")));
        }
    }
    if let Some(w) = work_item_id {
        if crate::db::work_item::find_by_id(conn, w).await?.is_none() {
            return Err(DbError::Validation(format!("no work item with id {w}")));
        }
    }
    Ok(())
}

pub async fn create(
    conn: &Connection,
    product_id: i64,
    title: &str,
    scenario: &str,
    deliverable_id: Option<i64>,
    work_item_id: Option<i64>,
) -> Result<i64> {
    if title.trim().is_empty() {
        return Err(DbError::Validation("a test case needs a title".into()));
    }
    if crate::db::product::find_by_id(conn, product_id).await?.is_none() {
        return Err(DbError::Validation(format!(
            "no Product with id {product_id}"
        )));
    }
    check_links(conn, deliverable_id, work_item_id).await?;
    let now = now_millis();
    conn.execute(
        "INSERT INTO test_cases (productId, title, scenario, state, testPath, deliverableId, workItemId, createdAt, updatedAt)
         VALUES (?1, ?2, ?3, 'designed', NULL, ?4, ?5, ?6, ?7)",
        (product_id, title, scenario, deliverable_id, work_item_id, now, now),
    )
    .await?;
    last_insert_id(conn).await
}

pub async fn list_by_product(conn: &Connection, product_id: i64) -> Result<Vec<TestCase>> {
    let mut rows = conn
        .query(&format!("{SELECT} WHERE productId = ?1 ORDER BY id"), (product_id,))
        .await?;
    let mut items = Vec::new();
    while let Some(row) = rows.next().await? {
        items.push(row_to_test_case(row)?);
    }
    Ok(items)
}

pub async fn find_by_id(conn: &Connection, id: i64) -> Result<Option<TestCase>> {
    let mut rows = conn.query(&format!("{SELECT} WHERE id = ?1"), (id,)).await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_test_case(row)?)),
        None => Ok(None),
    }
}

/// The editable parts of a test case.
///
/// Grouped rather than passed as six more positional parameters: `title`,
/// `scenario` and `state` are all `&str`, and `deliverable_id` and
/// `work_item_id` are both `Option<i64>` — swapping either pair compiles
/// silently and lands a test case against the wrong work.
#[derive(Debug, Clone, Copy)]
pub struct TestCaseUpdate<'a> {
    pub title: &'a str,
    pub scenario: &'a str,
    pub state: &'a str,
    /// Where the implemented test lives, once it exists.
    pub test_path: Option<&'a str>,
    pub deliverable_id: Option<i64>,
    pub work_item_id: Option<i64>,
}

/// Updates the editable parts of a test case: its text, what it is associated
/// with, and whether it has been implemented (and where).
pub async fn update_case(
    conn: &Connection,
    id: i64,
    update: &TestCaseUpdate<'_>,
) -> Result<()> {
    if update.title.trim().is_empty() {
        return Err(DbError::Validation("a test case needs a title".into()));
    }
    if !STATES.contains(&update.state) {
        return Err(DbError::Validation(format!(
            "state must be one of {STATES:?}, got '{}'",
            update.state
        )));
    }
    // A read must be finished before the write below — see db::mod notes.
    let exists = find_by_id(conn, id).await?.is_some();
    if !exists {
        return Err(DbError::Validation(format!("no test case with id {id}")));
    }
    check_links(conn, update.deliverable_id, update.work_item_id).await?;
    conn.execute(
        "UPDATE test_cases SET title = ?1, scenario = ?2, state = ?3, testPath = ?4,
         deliverableId = ?5, workItemId = ?6, updatedAt = ?7 WHERE id = ?8",
        (
            update.title,
            update.scenario,
            update.state,
            update.test_path,
            update.deliverable_id,
            update.work_item_id,
            now_millis(),
            id,
        ),
    )
    .await?;
    Ok(())
}

pub async fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM test_cases WHERE id = ?1", (id,))
        .await?;
    Ok(())
}

fn row_to_test_case(row: turso::Row) -> Result<TestCase> {
    Ok(TestCase {
        id: row.get(0)?,
        product_id: row.get(1)?,
        title: row.get(2)?,
        scenario: row.get(3)?,
        state: row.get(4)?,
        test_path: row.get(5)?,
        deliverable_id: row.get(6)?,
        work_item_id: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        // Stored as JSON, like every other list in this schema. A row written
        // before the column existed reads as `[]` from its default.
        test_names: row
            .get::<String>(10)
            .ok()
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default(),
        last_run_at: row.get(11)?,
        last_run_outcome: row.get(12)?,
        last_run_summary: row.get(13)?,
        // A row written before the column existed reads 0 from its default,
        // which is the right answer: nobody had put it in the suite.
        regression: row.get::<i64>(14).unwrap_or(0) != 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    #[tokio::test]
    async fn created_test_case_is_listed_under_its_product_as_designed() {
        let (conn, product_id) = db_with_product().await;
        create(&conn, product_id, "Login works", "Given a user…", None, None)
            .await
            .expect("create");
        let list = list_by_product(&conn, product_id).await.expect("list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "Login works");
        assert_eq!(list[0].state, "designed");
        assert_eq!(list[0].test_path, None);
    }

    #[tokio::test]
    async fn title_and_product_are_required() {
        let (conn, product_id) = db_with_product().await;
        assert!(create(&conn, product_id, " ", "", None, None).await.is_err());
        assert!(create(&conn, 999, "T", "", None, None).await.is_err());
    }

    #[tokio::test]
    async fn a_test_case_associates_with_a_deliverable_or_a_work_item() {
        let (conn, product_id) = db_with_product().await;
        let deliverable = crate::db::deliverable::create(&conn, product_id, "MVP", "")
            .await
            .expect("deliverable");
        let item = crate::db::work_item::create(&conn, "Login", "feature", product_id, None, None)
            .await
            .expect("work item");

        let by_deliverable = create(&conn, product_id, "Ship MVP", "", Some(deliverable), None)
            .await
            .expect("by deliverable");
        let by_item = create(&conn, product_id, "Login works", "", None, Some(item))
            .await
            .expect("by work item");

        let list = list_by_product(&conn, product_id).await.expect("list");
        let d = list.iter().find(|t| t.id == by_deliverable).expect("found");
        let w = list.iter().find(|t| t.id == by_item).expect("found");
        assert_eq!(d.deliverable_id, Some(deliverable));
        assert_eq!(d.work_item_id, None);
        assert_eq!(w.work_item_id, Some(item));
    }

    #[tokio::test]
    async fn associations_must_point_at_rows_that_exist() {
        let (conn, product_id) = db_with_product().await;
        assert!(create(&conn, product_id, "T", "", Some(999), None).await.is_err());
        assert!(create(&conn, product_id, "T", "", None, Some(999)).await.is_err());
    }

    #[tokio::test]
    async fn marking_a_case_implemented_records_where_the_test_lives() {
        let (conn, product_id) = db_with_product().await;
        let id = create(&conn, product_id, "Login works", "…", None, None)
            .await
            .expect("create");
        update_case(
            &conn,
            id,
            &TestCaseUpdate {
                title: "Login works",
                scenario: "…",
                state: "implemented",
                test_path: Some("src/__tests__/login.test.ts"),
                deliverable_id: None,
                work_item_id: None,
            },
        )
        .await
        .expect("update");
        let case = find_by_id(&conn, id).await.expect("find").expect("exists");
        assert_eq!(case.state, "implemented");
        assert_eq!(case.test_path.as_deref(), Some("src/__tests__/login.test.ts"));
    }

    #[tokio::test]
    async fn update_rejects_a_bad_state_empty_title_or_unknown_case() {
        let (conn, product_id) = db_with_product().await;
        let id = create(&conn, product_id, "T", "", None, None).await.expect("create");
        // Same update but for the one thing each case is checking, so what is
        // being rejected is the difference rather than buried in a row of args.
        let valid = TestCaseUpdate {
            title: "T",
            scenario: "",
            state: "designed",
            test_path: None,
            deliverable_id: None,
            work_item_id: None,
        };
        let bad_state = TestCaseUpdate { state: "shipped", ..valid };
        let blank_title = TestCaseUpdate { title: " ", ..valid };

        assert!(update_case(&conn, id, &bad_state).await.is_err());
        assert!(update_case(&conn, id, &blank_title).await.is_err());
        assert!(update_case(&conn, 999, &valid).await.is_err());
    }

    /// Deleting what a test case points at must not leave a dangling id — the
    /// case survives, unlinked, because the test is still worth running.
    #[tokio::test]
    async fn deleting_an_association_target_unlinks_the_case_without_deleting_it() {
        let (conn, product_id) = db_with_product().await;
        let deliverable = crate::db::deliverable::create(&conn, product_id, "MVP", "")
            .await
            .expect("deliverable");
        let item = crate::db::work_item::create(&conn, "Login", "feature", product_id, None, None)
            .await
            .expect("work item");
        let by_deliverable = create(&conn, product_id, "Ship MVP", "", Some(deliverable), None)
            .await
            .expect("case");
        let by_item = create(&conn, product_id, "Login works", "", None, Some(item))
            .await
            .expect("case");

        crate::db::deliverable::delete(&conn, deliverable).await.expect("delete deliverable");
        crate::db::work_item::delete(&conn, item).await.expect("delete work item");

        let d = find_by_id(&conn, by_deliverable).await.expect("q").expect("still there");
        let w = find_by_id(&conn, by_item).await.expect("q").expect("still there");
        assert_eq!(d.deliverable_id, None);
        assert_eq!(w.work_item_id, None);
    }

    #[tokio::test]
    async fn a_run_records_its_outcome_without_touching_the_state() {
        let (conn, product_id) = db_with_product().await;
        let case = create(&conn, product_id, "Login works", "", None, None)
            .await
            .expect("case");
        set_implementation(&conn, case, "src/login.test.ts", &["signs in".to_string()])
            .await
            .expect("implemented");

        record_run(&conn, case, "failed", "1 failed, 0 passed")
            .await
            .expect("record");

        let stored = find_by_id(&conn, case).await.expect("q").expect("there");
        assert_eq!(stored.last_run_outcome.as_deref(), Some("failed"));
        assert_eq!(stored.last_run_summary.as_deref(), Some("1 failed, 0 passed"));
        assert!(stored.last_run_at.is_some());
        // Running is not implementing: a red test is still an implemented one,
        // and is in fact the expected result before the work exists.
        assert_eq!(stored.state, "implemented");
        assert_eq!(stored.test_names, vec!["signs in".to_string()]);
    }

    #[tokio::test]
    async fn an_outcome_the_app_does_not_use_is_refused() {
        let (conn, product_id) = db_with_product().await;
        let case = create(&conn, product_id, "Login works", "", None, None)
            .await
            .expect("case");
        assert!(record_run(&conn, case, "green", "").await.is_err());
        assert!(record_run(&conn, 999, "passed", "").await.is_err());
    }

    /// The columns are added to an existing table rather than recreated around:
    /// somebody typed the paths in the rows already there, and round 2 shipped
    /// before any of this existed.
    #[tokio::test]
    async fn a_round_two_table_gains_the_run_columns_and_keeps_its_rows() {
        let (conn, product_id) = db_with_product().await;
        conn.execute("DROP TABLE test_cases", ()).await.expect("drop");
        conn.execute(
            "CREATE TABLE test_cases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                productId INTEGER NOT NULL,
                title TEXT NOT NULL,
                scenario TEXT NOT NULL DEFAULT '',
                state TEXT NOT NULL DEFAULT 'designed',
                testPath TEXT,
                deliverableId INTEGER,
                workItemId INTEGER,
                createdAt INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL
            )",
            (),
        )
        .await
        .expect("round two table");
        conn.execute(
            "INSERT INTO test_cases (productId, title, scenario, state, testPath, createdAt, updatedAt)
             VALUES (?1, 'Hand written', '', 'implemented', 'tests/by_hand.rs', 1, 1)",
            (product_id,),
        )
        .await
        .expect("old row");

        create_table(&conn).await.expect("migrate");

        let list = list_by_product(&conn, product_id).await.expect("list");
        assert_eq!(list.len(), 1, "the hand-typed row must survive");
        assert_eq!(list[0].test_path.as_deref(), Some("tests/by_hand.rs"));
        assert!(list[0].test_names.is_empty(), "an old row has no names");
        assert_eq!(list[0].last_run_outcome, None);
    }

    #[tokio::test]
    async fn delete_removes_only_that_case() {
        let (conn, product_id) = db_with_product().await;
        let a = create(&conn, product_id, "A", "", None, None).await.expect("a");
        create(&conn, product_id, "B", "", None, None).await.expect("b");
        delete(&conn, a).await.expect("delete");
        let list = list_by_product(&conn, product_id).await.expect("list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "B");
    }
    /// **A regression suite is a decision, not a property of the test.** The
    /// same Playwright spec can be a one-off check this week and the thing that
    /// guards checkout for the next two years; which it is, is somebody saying
    /// so — so it is a flag a person sets, and it survives everything else being
    /// edited.
    #[tokio::test]
    async fn a_case_can_be_put_in_the_regression_suite_and_taken_out() {
        let (conn, product_id) = db_with_product().await;
        let id = create(&conn, product_id, "Checkout still works", "pay with a card", None, None)
            .await
            .expect("create");

        assert!(!find_by_id(&conn, id).await.expect("read").expect("case").regression);

        set_regression(&conn, id, true).await.expect("in");
        assert!(find_by_id(&conn, id).await.expect("read").expect("case").regression);

        // Editing the scenario must not quietly take it back out.
        update_case(
            &conn,
            id,
            &TestCaseUpdate {
                title: "Checkout still works",
                scenario: "pay with a card, then refund it",
                state: "designed",
                test_path: None,
                deliverable_id: None,
                work_item_id: None,
            },
        )
        .await
        .expect("edit");
        assert!(find_by_id(&conn, id).await.expect("read").expect("case").regression);

        set_regression(&conn, id, false).await.expect("out");
        assert!(!find_by_id(&conn, id).await.expect("read").expect("case").regression);
    }

}
