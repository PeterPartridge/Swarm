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
//!
//! **Three words are not enough, and the right three depend on the Solution.**
//! "Screen, API, table" described a web app talking to a database and nothing
//! else. A front end has services and view models; an API has incoming models,
//! outgoing models and the data models behind them; a database has views and
//! stored procedures. So the vocabulary is a table rather than a triple, every
//! entry belongs to one of three families — **UI, logic, models** — and each
//! Solution type carries its own subset.
//!
//! The three old ids are still in the table under their own names, so every row
//! ever written stays valid and there is nothing to migrate.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

/// The three families every kind belongs to, in the order they are shown and
/// written: what you see, what it does, what it holds.
pub const GROUPS: &[(&str, &str)] = &[("ui", "UI"), ("logic", "Logic"), ("models", "Models")];

/// One sort of thing that can be added or changed inside a Solution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Kind {
    /// Stored in the row. Never change one of these — old rows carry it.
    pub id: &'static str,
    /// Singular, against one entry.
    pub label: &'static str,
    /// Plural, as the heading over a list of them in the brief.
    pub heading: &'static str,
    /// Which of `GROUPS` it sits under.
    pub group: &'static str,
    /// The shape of a name, shown as the placeholder. A worked example beats a
    /// description: somebody typing "checkout" where "POST /checkout" was
    /// meant produces a plan that reads as two different endpoints.
    pub example: &'static str,
}

/// Every kind, ordered by family. The order here is the order the brief's
/// headings come out in, so it reads UI first, then behaviour, then data.
pub const KINDS: &[Kind] = &[
    // ── UI: what somebody looks at ──────────────────────────────────────
    Kind { id: "screen", label: "Screen", heading: "Screens", group: "ui", example: "Basket" },
    Kind { id: "component", label: "Component", heading: "Components", group: "ui", example: "PriceTag" },
    Kind { id: "route", label: "Route", heading: "Routes", group: "ui", example: "/basket" },
    Kind { id: "style", label: "Style or theme", heading: "Styles and themes", group: "ui", example: "dark theme" },
    // ── Logic: what it does ─────────────────────────────────────────────
    Kind { id: "api", label: "Endpoint", heading: "Endpoints", group: "logic", example: "POST /checkout" },
    Kind { id: "service", label: "Service", heading: "Services", group: "logic", example: "BasketService" },
    Kind { id: "job", label: "Background job", heading: "Background jobs", group: "logic", example: "nightly reconcile" },
    Kind { id: "integration", label: "Integration", heading: "Integrations", group: "logic", example: "Stripe" },
    Kind { id: "procedure", label: "Stored procedure", heading: "Stored procedures", group: "logic", example: "sp_settle_orders" },
    // ── Models: what it holds and passes around ─────────────────────────
    Kind { id: "viewModel", label: "View model", heading: "View models", group: "models", example: "BasketView" },
    Kind { id: "requestModel", label: "Incoming model", heading: "Incoming models", group: "models", example: "CheckoutRequest" },
    Kind { id: "responseModel", label: "Outgoing model", heading: "Outgoing models", group: "models", example: "CheckoutResponse" },
    Kind { id: "dataModel", label: "Data model", heading: "Data models", group: "models", example: "Order" },
    Kind { id: "table", label: "Database table", heading: "Database tables", group: "models", example: "orders" },
    Kind { id: "view", label: "Database view", heading: "Database views", group: "models", example: "v_open_orders" },
    Kind { id: "migration", label: "Migration", heading: "Migrations", group: "models", example: "add orders.settled_at" },
];

/// A website is a front end: it has screens, the code behind them, and the
/// shapes it sends to and receives from somebody else's API — but it owns no
/// storage of its own.
const WEBSITE: &[&str] = &[
    "screen", "component", "route", "style", "service", "integration", "viewModel",
    "requestModel", "responseModel",
];

/// A desktop or mobile app is a front end that does own storage, and usually
/// does work while nobody is looking at it.
const APPLICATION: &[&str] = &[
    "screen", "component", "route", "style", "service", "job", "integration", "viewModel",
    "dataModel", "table", "migration",
];

/// An API serves endpoints, does the work behind them, and almost always owns
/// the storage underneath — incoming and outgoing shapes are separate from the
/// data model on purpose, because conflating them is how a database column ends
/// up in a public response.
const API: &[&str] = &[
    "api", "service", "job", "integration", "requestModel", "responseModel", "dataModel",
    "table", "view", "migration",
];

/// A database Solution holds data and the logic that runs inside the engine.
const DATABASE: &[&str] = &["table", "view", "procedure", "dataModel", "migration"];

/// Everything, for a Solution type this does not recognise.
const ALL: &[&str] = &[
    "screen", "component", "route", "style", "api", "service", "job", "integration",
    "procedure", "viewModel", "requestModel", "responseModel", "dataModel", "table", "view",
    "migration",
];

/// Looks a kind up by its stored id.
pub fn kind(id: &str) -> Option<&'static Kind> {
    KINDS.iter().find(|k| k.id == id)
}

/// The readable plurals for a set of ids, for a message somebody has to act on.
/// "it can have: screens, components, routes" is a sentence; the raw ids are a
/// list of identifiers that happens to be printable.
fn headings(ids: &[&str]) -> Vec<String> {
    ids.iter()
        .map(|id| kind(id).map(|k| k.heading.to_lowercase()).unwrap_or_else(|| (*id).to_string()))
        .collect()
}

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
pub fn kinds_for(solution_type: &str) -> &'static [&'static str] {
    match solution_type {
        "website" => WEBSITE,
        "application" => APPLICATION,
        "api" => API,
        "database" => DATABASE,
        // An unknown type gets everything rather than nothing: a Solution type
        // added later should not silently lose the ability to plan work.
        _ => ALL,
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
        let what = self::kind(kind).map(|k| k.label).unwrap_or(kind);
        return Err(DbError::Validation(format!("a {what} needs a name")));
    }
    if self::kind(kind).is_none() {
        return Err(DbError::Validation(format!(
            "'{kind}' is not a kind of change — it must be one of: {}",
            ALL.join(", ")
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
                "a {} Solution does not carry {} — it can have: {}",
                solution.solution_type,
                self::kind(kind).map(|k| k.heading).unwrap_or(kind).to_lowercase(),
                headings(allowed).join(", ")
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

/// One entry in a batch, and what became of it.
#[derive(Debug, Clone, PartialEq)]
pub struct AddOutcome {
    pub kind: String,
    pub name: String,
    /// The new row, or None when nothing was written.
    pub id: Option<i64>,
    /// Why not, in the model's own words. None when it went in.
    pub refused: Option<String>,
}

/// Adds several things at once, and says what happened to each.
///
/// **One refusal must not take the rest down with it.** Ticking eight screens
/// where one is already on the item is the ordinary case, not an error — the
/// other seven are what somebody meant, and failing the lot would leave them
/// hunting for which one was the duplicate. So each is attempted on its own and
/// every refusal comes back named, rather than being swallowed or thrown.
pub async fn add_many(
    conn: &Connection,
    work_item_id: i64,
    entries: &[(Option<i64>, String, String, String, String)],
) -> Result<Vec<AddOutcome>> {
    let mut out = Vec::with_capacity(entries.len());
    for (solution_id, kind, action, name, detail) in entries {
        match add(conn, work_item_id, *solution_id, kind, action, name, detail).await {
            Ok(id) => out.push(AddOutcome {
                kind: kind.clone(),
                name: name.clone(),
                id: Some(id),
                refused: None,
            }),
            // A validation refusal is reported; anything else is a real
            // failure of the database and stops the batch.
            Err(DbError::Validation(why)) => out.push(AddOutcome {
                kind: kind.clone(),
                name: name.clone(),
                id: None,
                refused: Some(why),
            }),
            Err(e) => return Err(e),
        }
    }
    Ok(out)
}

/// Rewrites the detail on several rows at once — the shared "what needs to
/// change" written once against everything just ticked.
pub async fn set_detail_many(conn: &Connection, ids: &[i64], detail: &str) -> Result<()> {
    for id in ids {
        let Some(existing) = find_by_id(conn, *id).await? else {
            continue;
        };
        update(conn, *id, &existing.action, &existing.name, detail).await?;
    }
    Ok(())
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
                existing.name,
                kind(&existing.kind)
                    .map(|k| k.label.to_lowercase())
                    .unwrap_or_else(|| existing.kind.clone()),
                solution.solution_type
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

        // a website has screens and the code behind them, but owns no storage
        add(&conn, item, Some(web), "screen", "add", "Basket", "")
            .await
            .expect("screen on a website");
        add(&conn, item, Some(web), "service", "add", "BasketService", "")
            .await
            .expect("a front end has services");
        let err = add(&conn, item, Some(web), "table", "add", "baskets", "")
            .await
            .expect_err("a website does not own tables");
        assert!(err.to_string().contains("does not carry"), "got: {err}");

        // an API has endpoints, the shapes either side of them, and storage
        add(&conn, item, Some(api), "api", "add", "POST /checkout", "")
            .await
            .expect("endpoint on an api");
        add(&conn, item, Some(api), "requestModel", "add", "CheckoutRequest", "")
            .await
            .expect("what comes in");
        add(&conn, item, Some(api), "table", "add", "orders", "")
            .await
            .expect("an API owns its tables");
        let err = add(&conn, item, Some(api), "screen", "add", "Basket", "")
            .await
            .expect_err("an api has no screens");
        assert!(err.to_string().contains("does not carry"), "got: {err}");
    }

    /// The message somebody has to act on is made of words, not identifiers:
    /// "it can have: screens, components" beats a printed `&["screen", …]`.
    #[tokio::test]
    async fn a_refused_kind_is_explained_in_words() {
        let (conn, item, web, _api) = fixture().await;
        let err = add(&conn, item, Some(web), "table", "add", "baskets", "")
            .await
            .expect_err("refused");
        let said = err.to_string();
        assert!(said.contains("does not carry database tables"), "got: {said}");
        assert!(said.contains("screens"), "it names what the type can have: {said}");
        assert!(!said.contains("viewModel"), "ids do not leak into prose: {said}");
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

    /// "UI, logic and models" is not cut and dry — what those words mean
    /// depends on what is being built, so each type carries its own set.
    #[tokio::test]
    async fn kinds_follow_the_solution_type() {
        // a front end: screens and the services behind them, no storage
        assert!(kinds_for("website").contains(&"screen"));
        assert!(kinds_for("website").contains(&"service"));
        assert!(kinds_for("website").contains(&"viewModel"));
        assert!(!kinds_for("website").contains(&"table"));

        // an API: what comes in and what goes out are not the data model
        for id in ["api", "requestModel", "responseModel", "dataModel", "table"] {
            assert!(kinds_for("api").contains(&id), "an api should carry {id}");
        }
        assert!(!kinds_for("api").contains(&"screen"));

        assert!(kinds_for("database").contains(&"procedure"));
        assert!(!kinds_for("database").contains(&"api"));

        // a desktop or mobile app is a front end that does own storage
        assert!(kinds_for("application").contains(&"screen"));
        assert!(kinds_for("application").contains(&"table"));

        // an unknown type gets everything rather than nothing, so a type added
        // later does not silently lose the ability to plan work
        assert_eq!(kinds_for("quantum"), ALL);
    }

    /// `ALL` is written out by hand so it can be a `const`, which means it can
    /// fall behind `KINDS`. This is the only thing stopping that.
    #[tokio::test]
    async fn every_kind_is_in_the_everything_list() {
        let ids: Vec<&str> = KINDS.iter().map(|k| k.id).collect();
        assert_eq!(ids, ALL, "ALL must list exactly KINDS, in the same order");
    }

    /// Every kind sits under one of the three families the form groups by, and
    /// every per-type list names kinds that exist.
    #[tokio::test]
    async fn the_vocabulary_is_internally_consistent() {
        for k in KINDS {
            assert!(
                GROUPS.iter().any(|(id, _)| *id == k.group),
                "{} is in group '{}', which is not one of GROUPS",
                k.id,
                k.group
            );
            assert!(!k.example.is_empty(), "{} needs a worked example", k.id);
        }
        for solution_type in ["website", "application", "api", "database", "quantum"] {
            for id in kinds_for(solution_type) {
                assert!(kind(id).is_some(), "{solution_type} offers unknown kind {id}");
            }
        }
    }

    /// The three original ids are still in the table under their own names, so
    /// every row ever written stays valid and there is nothing to migrate.
    #[tokio::test]
    async fn the_original_three_still_mean_what_they_meant() {
        assert_eq!(kind("screen").expect("screen").heading, "Screens");
        assert_eq!(kind("api").expect("api").heading, "Endpoints");
        assert_eq!(kind("table").expect("table").heading, "Database tables");
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

    /// Ticking eight screens where one is already on the item is the ordinary
    /// case, not an error. Failing the lot would leave somebody hunting for
    /// which one was the duplicate.
    #[tokio::test]
    async fn one_refusal_does_not_take_the_batch_down() {
        let (conn, item, web, _api) = fixture().await;
        add(&conn, item, Some(web), "screen", "add", "Basket", "")
            .await
            .expect("already there");

        let outcomes = add_many(
            &conn,
            item,
            &[
                (Some(web), "screen".into(), "change".into(), "Basket".into(), "d".into()),
                (Some(web), "screen".into(), "change".into(), "Checkout".into(), "d".into()),
                (Some(web), "table".into(), "add".into(), "orders".into(), "d".into()),
                (Some(web), "component".into(), "add".into(), "PriceTag".into(), "d".into()),
            ],
        )
        .await
        .expect("the batch itself does not fail");

        assert_eq!(outcomes.len(), 4);
        assert!(outcomes[0].refused.as_deref().unwrap().contains("already on this"));
        assert!(outcomes[1].id.is_some(), "the good ones still land");
        assert!(outcomes[2].refused.as_deref().unwrap().contains("does not carry"));
        assert!(outcomes[3].id.is_some());
    }

    /// The point of ticking five things and writing the detail once.
    #[tokio::test]
    async fn one_detail_can_be_written_across_everything_ticked() {
        let (conn, item, web, _api) = fixture().await;
        let outcomes = add_many(
            &conn,
            item,
            &[
                (Some(web), "screen".into(), "change".into(), "Basket".into(), String::new()),
                (Some(web), "screen".into(), "change".into(), "Checkout".into(), String::new()),
            ],
        )
        .await
        .expect("batch");
        let ids: Vec<i64> = outcomes.iter().filter_map(|o| o.id).collect();

        set_detail_many(&conn, &ids, "Totals move into a shared component")
            .await
            .expect("detail");

        for id in ids {
            let row = find_by_id(&conn, id).await.expect("find").expect("there");
            assert_eq!(row.detail, "Totals move into a shared component");
            assert_eq!(row.action, "change", "the action is not disturbed");
        }
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
