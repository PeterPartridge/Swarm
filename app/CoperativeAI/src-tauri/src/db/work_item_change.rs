//! What a work item actually changes: screens, APIs and database tables.
//!
//! One table rather than three, and one table rather than two levels, because
//! the thing Product asks for and the thing a developer plans are **the same
//! row at different stages of its life**:
//!
//! - Product adds "a basket screen" with no Solution against it. That is the
//!   ask: they know what they want to see and not which repository grows it.
//! - A developer assigns it to a Solution, and adds the APIs and tables that
//!   serving that screen needs.
//!
//! Modelling those as separate tables would mean copying the ask across and
//! then keeping two records in step, and they would drift the first time
//! somebody renamed a screen.
//!
//! **What can be added depends on the Solution's type.** A database Solution
//! does not have screens; a website does not own tables. `kinds_for` is the one
//! place that judgement lives, so the UI and the AI prompt cannot disagree
//! about it.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

/// What sort of thing is being added or changed.
pub const KINDS: &[&str] = &["screen", "api", "table"];

/// Whether it is new or an existing thing being altered. The distinction earns
/// its place: "change the checkout screen" and "add a checkout screen" produce
/// very different work, and a plan that blurs them gets estimated wrong.
pub const ACTIONS: &[&str] = &["add", "change"];

#[derive(Debug, Clone, PartialEq)]
pub struct WorkItemChange {
    pub id: i64,
    pub work_item_id: i64,
    /// None while this is still Product's ask, unassigned to any Solution.
    pub solution_id: Option<i64>,
    pub kind: String,
    pub action: String,
    pub name: String,
    /// Free text: what the screen shows, what the endpoint does, what the
    /// table holds.
    pub detail: String,
    /// The mockup this screen is a picture of. Screens and pictures were two
    /// separate lists until this existed, so the model got a pile of images and
    /// a list of names and had to guess the pairing.
    pub mockup_path: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

const SELECT: &str = "SELECT id, workItemId, solutionId, kind, action, name, detail, mockupPath, createdAt, updatedAt FROM work_item_changes";

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS work_item_changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workItemId INTEGER NOT NULL,
            solutionId INTEGER,
            kind TEXT NOT NULL,
            action TEXT NOT NULL DEFAULT 'add',
            name TEXT NOT NULL,
            detail TEXT NOT NULL DEFAULT '',
            mockupPath TEXT,
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    let columns = crate::db::table_columns(conn, "work_item_changes").await?;
    if !columns.is_empty() && !columns.iter().any(|c| c == "mockupPath") {
        conn.execute(
            "ALTER TABLE work_item_changes ADD COLUMN mockupPath TEXT",
            (),
        )
        .await?;
    }
    Ok(())
}

/// Links a screen to the mockup that shows it, or clears the link.
pub async fn set_mockup(conn: &Connection, id: i64, mockup_path: Option<&str>) -> Result<()> {
    if find_by_id(conn, id).await?.is_none() {
        return Err(DbError::Validation(format!("no change with id {id}")));
    }
    let cleaned = mockup_path.map(str::trim).filter(|p| !p.is_empty());
    conn.execute(
        "UPDATE work_item_changes SET mockupPath = ?1, updatedAt = ?2 WHERE id = ?3",
        (cleaned, now_millis(), id),
    )
    .await?;
    Ok(())
}

/// Which kinds of change a Solution of this type can carry.
///
/// Deliberately not a free-for-all: offering "add a database table" on a
/// website Solution invites someone to record work against the repository that
/// will never do it, and the mistake is only found when the branch is empty.
///
/// An `api` Solution gets tables because an API almost always owns its own
/// storage, and an `application` gets both because a desktop or mobile app
/// commonly has local storage as well as screens.
pub fn kinds_for(solution_type: &str) -> &'static [&'static str] {
    match solution_type {
        "website" => &["screen"],
        "application" => &["screen", "table"],
        "api" => &["api", "table"],
        "database" => &["table"],
        // An unknown type gets everything rather than nothing: a Solution type
        // added later should not silently lose the ability to plan work.
        _ => KINDS,
    }
}

/// Adds a screen, API or table to a work item.
///
/// `solution_id` is None for Product's ask. Validation is the same either way —
/// an unnamed screen is no more useful to Product than to a developer.
pub async fn add(
    conn: &Connection,
    work_item_id: i64,
    solution_id: Option<i64>,
    kind: &str,
    action: &str,
    name: &str,
    detail: &str,
) -> Result<i64> {
    if name.trim().is_empty() {
        return Err(DbError::Validation(format!("a {kind} needs a name")));
    }
    if !KINDS.contains(&kind) {
        return Err(DbError::Validation(format!(
            "kind must be one of {KINDS:?}, got '{kind}'"
        )));
    }
    if !ACTIONS.contains(&action) {
        return Err(DbError::Validation(format!(
            "action must be one of {ACTIONS:?}, got '{action}'"
        )));
    }
    if crate::db::work_item::find_by_id(conn, work_item_id)
        .await?
        .is_none()
    {
        return Err(DbError::Validation(format!(
            "no work item with id {work_item_id}"
        )));
    }
    // A Solution that is named must exist, and the kind must be one that
    // Solution can actually carry.
    if let Some(solution_id) = solution_id {
        let Some(solution) = crate::db::solution::find_by_id(conn, solution_id).await? else {
            return Err(DbError::Validation(format!(
                "no Solution with id {solution_id}"
            )));
        };
        let allowed = kinds_for(&solution.solution_type);
        if !allowed.contains(&kind) {
            return Err(DbError::Validation(format!(
                "a {} Solution does not carry {kind}s — it can have: {}",
                solution.solution_type,
                allowed.join(", ")
            )));
        }
    }

    // Two rows for the same endpoint is not a plan, it is a plan and a typo.
    // Compared case-insensitively and against the same Solution, because
    // `POST /checkout` on the API and on the web app are genuinely different
    // pieces of work.
    let existing = list_for_item(conn, work_item_id).await?;
    if existing.iter().any(|c| {
        c.solution_id == solution_id
            && c.kind == kind
            && c.name.eq_ignore_ascii_case(name.trim())
    }) {
        return Err(DbError::Validation(format!(
            "'{}' is already on this work item{}",
            name.trim(),
            match solution_id {
                Some(_) => " for that Solution",
                None => "",
            }
        )));
    }

    let now = now_millis();
    conn.execute(
        "INSERT INTO work_item_changes (workItemId, solutionId, kind, action, name, detail, createdAt, updatedAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        (
            work_item_id,
            solution_id,
            kind,
            action,
            name.trim(),
            detail,
            now,
            now,
        ),
    )
    .await?;
    last_insert_id(conn).await
}

/// Points an existing entry at a Solution, or back at nobody.
///
/// This is the developer's half of the flow: Product said what they wanted,
/// and this decides where it gets built. The type check runs here too, so a
/// screen cannot be dropped onto a database Solution by assignment when it
/// could not have been created there.
pub async fn assign(conn: &Connection, id: i64, solution_id: Option<i64>) -> Result<()> {
    let Some(existing) = find_by_id(conn, id).await? else {
        return Err(DbError::Validation(format!("no change with id {id}")));
    };
    if let Some(solution_id) = solution_id {
        let Some(solution) = crate::db::solution::find_by_id(conn, solution_id).await? else {
            return Err(DbError::Validation(format!(
                "no Solution with id {solution_id}"
            )));
        };
        let allowed = kinds_for(&solution.solution_type);
        if !allowed.contains(&existing.kind.as_str()) {
            return Err(DbError::Validation(format!(
                "'{}' is a {}, and a {} Solution does not carry those",
                existing.name, existing.kind, solution.solution_type
            )));
        }
    }
    conn.execute(
        "UPDATE work_item_changes SET solutionId = ?1, updatedAt = ?2 WHERE id = ?3",
        (solution_id, now_millis(), id),
    )
    .await?;
    Ok(())
}

pub async fn update(
    conn: &Connection,
    id: i64,
    action: &str,
    name: &str,
    detail: &str,
) -> Result<()> {
    if name.trim().is_empty() {
        return Err(DbError::Validation("it still needs a name".into()));
    }
    if !ACTIONS.contains(&action) {
        return Err(DbError::Validation(format!(
            "action must be one of {ACTIONS:?}, got '{action}'"
        )));
    }
    if find_by_id(conn, id).await?.is_none() {
        return Err(DbError::Validation(format!("no change with id {id}")));
    }
    conn.execute(
        "UPDATE work_item_changes SET action = ?1, name = ?2, detail = ?3, updatedAt = ?4 WHERE id = ?5",
        (action, name.trim(), detail, now_millis(), id),
    )
    .await?;
    Ok(())
}

pub async fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM work_item_changes WHERE id = ?1", (id,))
        .await?;
    Ok(())
}

/// Everything one work item changes, Product's unassigned asks included.
pub async fn list_for_item(conn: &Connection, work_item_id: i64) -> Result<Vec<WorkItemChange>> {
    let mut rows = conn
        .query(
            &format!("{SELECT} WHERE workItemId = ?1 ORDER BY kind, id"),
            (work_item_id,),
        )
        .await?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().await? {
        out.push(row_to_change(row)?);
    }
    Ok(out)
}

/// What one work item changes in one Solution — the shape the build plan and
/// the generation prompt both want.
pub async fn list_for_solution(
    conn: &Connection,
    work_item_id: i64,
    solution_id: i64,
) -> Result<Vec<WorkItemChange>> {
    let mut rows = conn
        .query(
            &format!("{SELECT} WHERE workItemId = ?1 AND solutionId = ?2 ORDER BY kind, id"),
            (work_item_id, solution_id),
        )
        .await?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().await? {
        out.push(row_to_change(row)?);
    }
    Ok(out)
}

/// Everything ever recorded against one Solution, by kind and name.
///
/// **This is the list you tick from.** The platform has no separate catalogue
/// of a Solution's endpoints, screens and tables — and inventing one would mean
/// a second place to keep in step. What it does have is every change anybody
/// has recorded, so the union of those *is* the catalogue, and it grows as the
/// team works rather than needing to be filled in first.
///
/// Deduplicated case-insensitively, keeping the spelling first used: the
/// original is the one the code most likely matches.
pub async fn catalogue_for_solution(
    conn: &Connection,
    solution_id: i64,
) -> Result<Vec<(String, String)>> {
    let mut rows = conn
        .query(
            "SELECT kind, name FROM work_item_changes WHERE solutionId = ?1 ORDER BY kind, id",
            (solution_id,),
        )
        .await?;
    let mut seen: Vec<(String, String)> = Vec::new();
    while let Some(row) = rows.next().await? {
        let kind: String = row.get(0)?;
        let name: String = row.get(1)?;
        if !seen
            .iter()
            .any(|(k, n)| *k == kind && n.eq_ignore_ascii_case(&name))
        {
            seen.push((kind, name));
        }
    }
    Ok(seen)
}

pub async fn find_by_id(conn: &Connection, id: i64) -> Result<Option<WorkItemChange>> {
    let mut rows = conn
        .query(&format!("{SELECT} WHERE id = ?1"), (id,))
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_change(row)?)),
        None => Ok(None),
    }
}

fn row_to_change(row: turso::Row) -> Result<WorkItemChange> {
    Ok(WorkItemChange {
        id: row.get(0)?,
        work_item_id: row.get(1)?,
        solution_id: row.get(2)?,
        kind: row.get(3)?,
        action: row.get(4)?,
        name: row.get(5)?,
        detail: row.get(6)?,
        mockup_path: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    async fn fixture() -> (Connection, i64, i64, i64) {
        let (conn, product_id) = db_with_product().await;
        let item = crate::db::work_item::create(&conn, "Add checkout", "feature", product_id, None, None)
            .await
            .expect("work item");
        let web = crate::db::solution::create(&conn, "Shop Web", product_id, "website", "{}")
            .await
            .expect("website");
        let api = crate::db::solution::create(&conn, "Shop API", product_id, "api", "{}")
            .await
            .expect("api");
        (conn, item, web, api)
    }

    /// Product's half: a screen they want, with no idea yet which repository
    /// grows it. That has to be a legitimate state, or Product cannot record
    /// anything until a developer has done their part.
    #[tokio::test]
    async fn product_can_ask_for_a_screen_before_anyone_knows_where_it_lives() {
        let (conn, item, _web, _api) = fixture().await;
        add(&conn, item, None, "screen", "add", "Basket", "Shows what is in the basket")
            .await
            .expect("add screen");

        let all = list_for_item(&conn, item).await.expect("list");
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].solution_id, None, "unassigned is a real state");
        assert_eq!(all[0].name, "Basket");
    }

    /// The developer's half: the same row, now pointed at a Solution.
    #[tokio::test]
    async fn a_developer_assigns_the_ask_to_a_solution() {
        let (conn, item, web, _api) = fixture().await;
        let id = add(&conn, item, None, "screen", "add", "Basket", "")
            .await
            .expect("add");

        assign(&conn, id, Some(web)).await.expect("assign");

        let mine = list_for_solution(&conn, item, web).await.expect("list");
        assert_eq!(mine.len(), 1);
        assert_eq!(mine[0].name, "Basket");
        // and it can be put back down again
        assign(&conn, id, None).await.expect("unassign");
        assert!(list_for_solution(&conn, item, web).await.expect("list").is_empty());
    }

    /// The type rule. Recording a screen against a database Solution would be
    /// work filed against a repository that will never do it, and nobody finds
    /// out until the branch turns out empty.
    #[tokio::test]
    async fn a_solution_only_carries_what_its_type_can_carry() {
        let (conn, item, web, api) = fixture().await;

        // a website has screens, not tables or endpoints
        add(&conn, item, Some(web), "screen", "add", "Basket", "")
            .await
            .expect("screen on a website");
        let err = add(&conn, item, Some(web), "table", "add", "baskets", "")
            .await
            .expect_err("a website does not own tables");
        assert!(err.to_string().contains("does not carry"), "got: {err}");

        // an API has endpoints and the storage behind them
        add(&conn, item, Some(api), "api", "add", "POST /checkout", "")
            .await
            .expect("endpoint on an api");
        add(&conn, item, Some(api), "table", "add", "orders", "")
            .await
            .expect("an API owns its tables");
        let err = add(&conn, item, Some(api), "screen", "add", "Basket", "")
            .await
            .expect_err("an api has no screens");
        assert!(err.to_string().contains("does not carry"), "got: {err}");
    }

    /// The same rule on assignment, or the check could be walked around by
    /// creating unassigned and then pointing it wherever.
    #[tokio::test]
    async fn assignment_is_checked_against_the_type_too() {
        let (conn, item, _web, api) = fixture().await;
        let screen = add(&conn, item, None, "screen", "add", "Basket", "")
            .await
            .expect("add");

        let err = assign(&conn, screen, Some(api))
            .await
            .expect_err("a screen cannot be assigned to an api Solution");
        assert!(err.to_string().contains("does not carry"), "got: {err}");
    }

    #[tokio::test]
    async fn kinds_follow_the_solution_type() {
        assert_eq!(kinds_for("website"), &["screen"]);
        assert_eq!(kinds_for("api"), &["api", "table"]);
        assert_eq!(kinds_for("database"), &["table"]);
        assert_eq!(kinds_for("application"), &["screen", "table"]);
        // an unknown type gets everything rather than nothing, so a type added
        // later does not silently lose the ability to plan work
        assert_eq!(kinds_for("quantum"), KINDS);
    }

    /// Add and change are different work, and a plan that blurs them is
    /// estimated wrong.
    #[tokio::test]
    async fn adding_and_changing_are_recorded_separately() {
        let (conn, item, web, _api) = fixture().await;
        add(&conn, item, Some(web), "screen", "add", "Basket", "")
            .await
            .expect("add");
        add(&conn, item, Some(web), "screen", "change", "Checkout", "now takes wallets")
            .await
            .expect("change");

        let all = list_for_solution(&conn, item, web).await.expect("list");
        let actions: Vec<&str> = all.iter().map(|c| c.action.as_str()).collect();
        assert!(actions.contains(&"add") && actions.contains(&"change"));
    }

    #[tokio::test]
    async fn names_and_kinds_and_actions_are_validated() {
        let (conn, item, web, _api) = fixture().await;
        assert!(add(&conn, item, Some(web), "screen", "add", "   ", "").await.is_err());
        assert!(add(&conn, item, Some(web), "hologram", "add", "X", "").await.is_err());
        assert!(add(&conn, item, Some(web), "screen", "destroy", "X", "").await.is_err());
        assert!(add(&conn, 9999, None, "screen", "add", "X", "").await.is_err());
        assert!(add(&conn, item, Some(9999), "screen", "add", "X", "").await.is_err());
    }

    /// Two rows for the same endpoint is not a plan, it is a plan and a typo.
    #[tokio::test]
    async fn the_same_thing_cannot_be_added_twice() {
        let (conn, item, _web, api) = fixture().await;
        add(&conn, item, Some(api), "api", "add", "POST /checkout", "")
            .await
            .expect("first");

        let err = add(&conn, item, Some(api), "api", "add", "post /CHECKOUT", "")
            .await
            .expect_err("case is not a difference worth having two rows for");
        assert!(err.to_string().contains("already on this work item"), "got: {err}");
    }

    /// The same name against a *different* Solution is genuinely different
    /// work — an endpoint the API serves and one the web app calls.
    #[tokio::test]
    async fn the_same_name_against_another_solution_is_allowed() {
        let (conn, item, web, api) = fixture().await;
        add(&conn, item, Some(api), "api", "add", "Checkout", "")
            .await
            .expect("on the api");
        add(&conn, item, Some(web), "screen", "add", "Checkout", "")
            .await
            .expect("a screen of the same name on the website is different work");
    }

    /// Screens and pictures were two separate lists, so the model got a pile of
    /// images and a list of names and had to guess the pairing.
    #[tokio::test]
    async fn a_screen_can_name_the_mockup_that_shows_it() {
        let (conn, item, web, _api) = fixture().await;
        let id = add(&conn, item, Some(web), "screen", "add", "Basket", "")
            .await
            .expect("add");

        set_mockup(&conn, id, Some("C:/shots/basket.png"))
            .await
            .expect("link");
        let found = find_by_id(&conn, id).await.expect("find").expect("there");
        assert_eq!(found.mockup_path.as_deref(), Some("C:/shots/basket.png"));

        set_mockup(&conn, id, None).await.expect("unlink");
        assert!(find_by_id(&conn, id).await.expect("f").expect("t").mockup_path.is_none());
    }

    /// The list someone ticks from. There is no separate catalogue of a
    /// Solution's endpoints — inventing one would be a second place to keep in
    /// step — so the union of what has been recorded is it, and it grows as
    /// the team works.
    #[tokio::test]
    async fn a_solutions_catalogue_is_everything_recorded_against_it() {
        let (conn, item, _web, api) = fixture().await;
        let second = crate::db::work_item::create(&conn, "Refunds", "feature", 1, None, None)
            .await
            .expect("second item");

        add(&conn, item, Some(api), "api", "add", "POST /checkout", "").await.expect("a");
        add(&conn, item, Some(api), "table", "add", "orders", "").await.expect("b");
        // a different work item touching the same Solution adds to the same list
        add(&conn, second, Some(api), "api", "change", "POST /refund", "").await.expect("c");

        let catalogue = catalogue_for_solution(&conn, api).await.expect("catalogue");
        let names: Vec<&str> = catalogue.iter().map(|(_, n)| n.as_str()).collect();
        assert!(names.contains(&"POST /checkout"));
        assert!(names.contains(&"POST /refund"));
        assert!(names.contains(&"orders"));
    }

    /// The same endpoint touched by two work items is one entry, spelled the
    /// way it was first written — that spelling is what the code most likely
    /// matches.
    #[tokio::test]
    async fn the_catalogue_lists_each_thing_once() {
        let (conn, item, _web, api) = fixture().await;
        let second = crate::db::work_item::create(&conn, "Refunds", "feature", 1, None, None)
            .await
            .expect("second item");
        add(&conn, item, Some(api), "api", "add", "POST /checkout", "").await.expect("a");
        add(&conn, second, Some(api), "api", "change", "post /CHECKOUT", "").await.expect("b");

        let catalogue = catalogue_for_solution(&conn, api).await.expect("catalogue");
        assert_eq!(catalogue.len(), 1);
        assert_eq!(catalogue[0].1, "POST /checkout", "the first spelling wins");
    }

    #[tokio::test]
    async fn changes_can_be_edited_and_removed() {
        let (conn, item, web, _api) = fixture().await;
        let id = add(&conn, item, Some(web), "screen", "add", "Baskt", "")
            .await
            .expect("add");

        update(&conn, id, "change", "Basket", "spelled properly")
            .await
            .expect("update");
        let found = find_by_id(&conn, id).await.expect("find").expect("there");
        assert_eq!(found.name, "Basket");
        assert_eq!(found.action, "change");
        assert_eq!(found.detail, "spelled properly");

        delete(&conn, id).await.expect("delete");
        assert!(find_by_id(&conn, id).await.expect("find").is_none());
    }
}
