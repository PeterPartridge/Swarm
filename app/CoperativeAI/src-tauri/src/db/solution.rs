//! The `Solution` model — see
//! application/claude-only/CoperativeAIdb/Solution-model.md. The planning-level
//! Solution a developer links to a Product (distinct from SolutionManagement,
//! which tracks generated solution files on disk).

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

pub const SOLUTION_TYPES: &[&str] = &["website", "api", "database", "application"];

pub const ORIGINS: &[&str] = &["created", "imported"];

#[derive(Debug, Clone, PartialEq)]
pub struct Solution {
    pub id: i64,
    pub name: String,
    pub product_id: i64,
    pub solution_type: String,
    pub answers: String,
    pub origin: String,
    pub github_url: Option<String>,
    pub github_visibility: Option<String>,
    /// Where the code lives on this machine. Null until someone points at it —
    /// a linked GitHub repository is not the same as a working copy.
    pub local_path: Option<String>,
    /// How to run this Solution's tests, when detection gets it wrong or the
    /// language is one nothing here recognises. Null means "work it out".
    pub test_command: Option<String>,
    /// The starter the project was created from ("rust", "react-ts", …). A
    /// record of what it was begun as, not a claim about what it is now — a
    /// repository grows other languages and this does not chase them.
    pub language: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

const SELECT: &str = "SELECT id, name, productId, solutionType, answers, origin, githubUrl, githubVisibility, localPath, testCommand, language, createdAt, updatedAt FROM solutions";

pub async fn create_table(conn: &Connection) -> Result<()> {
    // Round-2 migration: add GitHub link columns. Pre-release → drop & recreate
    // when the round-1 table (no `origin`) is present.
    let columns = crate::db::table_columns(conn, "solutions").await?;
    if !columns.is_empty() && !columns.iter().any(|c| c == "origin") {
        conn.execute("DROP TABLE solutions", ()).await?;
    }

    conn.execute(
        "CREATE TABLE IF NOT EXISTS solutions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            productId INTEGER NOT NULL,
            solutionType TEXT NOT NULL DEFAULT 'application',
            answers TEXT NOT NULL DEFAULT '{}',
            origin TEXT NOT NULL DEFAULT 'created',
            githubUrl TEXT,
            githubVisibility TEXT,
            localPath TEXT,
            testCommand TEXT,
            language TEXT,
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL,
            UNIQUE(productId, name)
        )",
        (),
    )
    .await?;

    // `localPath` is added to an existing table rather than triggering another
    // drop. A Solution's answers and repository link are person-authored — the
    // rule this project settled on is drop what the app can rebuild, preserve
    // what only a person could have written.
    let has_table = !columns.is_empty();
    let dropped = has_table && !columns.iter().any(|c| c == "origin");
    if has_table && !dropped && !columns.iter().any(|c| c == "localPath") {
        conn.execute("ALTER TABLE solutions ADD COLUMN localPath TEXT", ())
            .await?;
    }
    // Same rule for the test command: someone typed it, so it is added rather
    // than recreated around.
    if has_table && !dropped && !columns.iter().any(|c| c == "testCommand") {
        conn.execute("ALTER TABLE solutions ADD COLUMN testCommand TEXT", ())
            .await?;
    }
    if has_table && !dropped && !columns.iter().any(|c| c == "language") {
        conn.execute("ALTER TABLE solutions ADD COLUMN language TEXT", ())
            .await?;
    }
    Ok(())
}

/// Records which starter this Solution was created from.
pub async fn set_language(conn: &Connection, id: i64, language: Option<&str>) -> Result<()> {
    if find_by_id(conn, id).await?.is_none() {
        return Err(DbError::Validation(format!("no Solution with id {id}")));
    }
    let cleaned = language.map(str::trim).filter(|l| !l.is_empty());
    conn.execute(
        "UPDATE solutions SET language = ?1, updatedAt = ?2 WHERE id = ?3",
        (cleaned, now_millis(), id),
    )
    .await?;
    Ok(())
}

/// Records how to run this Solution's tests, replacing detection.
///
/// Blank clears it, which is how someone goes back to detection after trying a
/// command that did not work — without that, a bad guess would be permanent.
pub async fn set_test_command(conn: &Connection, id: i64, command: Option<&str>) -> Result<()> {
    if find_by_id(conn, id).await?.is_none() {
        return Err(DbError::Validation(format!("no Solution with id {id}")));
    }
    let cleaned = command.map(str::trim).filter(|c| !c.is_empty());
    conn.execute(
        "UPDATE solutions SET testCommand = ?1, updatedAt = ?2 WHERE id = ?3",
        (cleaned, now_millis(), id),
    )
    .await?;
    Ok(())
}

/// Points a Solution at the folder its code lives in. Verified to exist here,
/// because a path that is wrong is discovered later as a confusing empty file
/// tree rather than as the mistake it is.
pub async fn set_local_path(conn: &Connection, id: i64, local_path: Option<&str>) -> Result<()> {
    if find_by_id(conn, id).await?.is_none() {
        return Err(DbError::Validation(format!("no Solution with id {id}")));
    }
    if let Some(path) = local_path.filter(|p| !p.trim().is_empty()) {
        if !std::path::Path::new(path).is_dir() {
            return Err(DbError::Validation(format!(
                "there is no folder at {path}"
            )));
        }
    }
    let stored = local_path.filter(|p| !p.trim().is_empty());
    conn.execute(
        "UPDATE solutions SET localPath = ?1, updatedAt = ?2 WHERE id = ?3",
        (stored, now_millis(), id),
    )
    .await?;
    Ok(())
}

/// Links or updates a Solution's GitHub repository. `origin` is "created"
/// (repo we made) or "imported" (an existing repo linked by URL).
pub async fn set_github(
    conn: &Connection,
    id: i64,
    github_url: Option<&str>,
    github_visibility: Option<&str>,
    origin: &str,
) -> Result<()> {
    if !ORIGINS.contains(&origin) {
        return Err(DbError::Validation(format!("origin must be one of {ORIGINS:?}")));
    }
    if find_by_id(conn, id).await?.is_none() {
        return Err(DbError::Validation(format!("no Solution with id {id}")));
    }
    conn.execute(
        "UPDATE solutions SET githubUrl = ?1, githubVisibility = ?2, origin = ?3, updatedAt = ?4 WHERE id = ?5",
        (github_url, github_visibility, origin, now_millis(), id),
    )
    .await?;
    Ok(())
}

pub async fn find_by_id(conn: &Connection, id: i64) -> Result<Option<Solution>> {
    let mut rows = conn
        .query(&format!("{SELECT} WHERE id = ?1"), (id,))
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_solution(row)?)),
        None => Ok(None),
    }
}

pub async fn create(
    conn: &Connection,
    name: &str,
    product_id: i64,
    solution_type: &str,
    answers_json: &str,
) -> Result<i64> {
    if name.trim().is_empty() {
        return Err(DbError::Validation("a Solution needs a name".into()));
    }
    if !SOLUTION_TYPES.contains(&solution_type) {
        return Err(DbError::Validation(format!(
            "solutionType must be one of {SOLUTION_TYPES:?}, got '{solution_type}'"
        )));
    }
    if crate::db::product::find_by_id(conn, product_id).await?.is_none() {
        return Err(DbError::Validation(format!(
            "no Product with id {product_id}"
        )));
    }
    serde_json::from_str::<serde_json::Value>(answers_json)
        .map_err(|e| DbError::Validation(format!("answers are not valid JSON: {e}")))?;
    let now = now_millis();
    conn.execute(
        "INSERT INTO solutions (name, productId, solutionType, answers, createdAt, updatedAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (name, product_id, solution_type, answers_json, now, now),
    )
    .await?;
    last_insert_id(conn).await
}

pub async fn list_all(conn: &Connection) -> Result<Vec<Solution>> {
    query_solutions(conn, &format!("{SELECT} ORDER BY productId, id"), None).await
}

pub async fn list_by_product(conn: &Connection, product_id: i64) -> Result<Vec<Solution>> {
    query_solutions(
        conn,
        &format!("{SELECT} WHERE productId = ?1 ORDER BY id"),
        Some(product_id),
    )
    .await
}

pub async fn delete(conn: &Connection, id: i64) -> Result<()> {
    // Work planned against this Solution is unlinked, never deleted — the work
    // still needs doing, it just no longer knows where it lands.
    conn.execute(
        "UPDATE work_items SET solutionId = NULL WHERE solutionId = ?1",
        (id,),
    )
    .await?;
    // Architecture documents outlive the Solution they were drawn for — often
    // they are the only record of why it was shaped that way — so they are
    // unlinked. Dependency links are not: a link to a deleted Solution is not
    // a dependency, it is a dangling row.
    crate::db::architecture_doc::unlink_solution(conn, id).await?;
    crate::db::repo_link::remove_for_solution(conn, id).await?;
    conn.execute("DELETE FROM solutions WHERE id = ?1", (id,))
        .await?;
    Ok(())
}

async fn query_solutions(
    conn: &Connection,
    sql: &str,
    product_id: Option<i64>,
) -> Result<Vec<Solution>> {
    let mut rows = match product_id {
        Some(pid) => conn.query(sql, (pid,)).await?,
        None => conn.query(sql, ()).await?,
    };
    let mut solutions = Vec::new();
    while let Some(row) = rows.next().await? {
        solutions.push(row_to_solution(row)?);
    }
    Ok(solutions)
}

fn row_to_solution(row: turso::Row) -> Result<Solution> {
    Ok(Solution {
        id: row.get(0)?,
        name: row.get(1)?,
        product_id: row.get(2)?,
        solution_type: row.get(3)?,
        answers: row.get(4)?,
        origin: row.get(5)?,
        github_url: row.get(6)?,
        github_visibility: row.get(7)?,
        local_path: row.get(8)?,
        test_command: row.get(9)?,
        language: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    #[tokio::test]
    async fn created_solution_is_listed_under_its_product() {
        let (conn, product_id) = db_with_product().await;
        create(&conn, "Website", product_id, "website", "{\"language\":\"TS\"}")
            .await
            .expect("create");
        let solutions = list_by_product(&conn, product_id).await.expect("list");
        assert_eq!(solutions.len(), 1);
        assert_eq!(solutions[0].name, "Website");
        assert_eq!(solutions[0].solution_type, "website");
    }

    #[tokio::test]
    async fn solution_requires_existing_product_valid_type_and_name() {
        let (conn, product_id) = db_with_product().await;
        assert!(create(&conn, " ", product_id, "api", "{}").await.is_err());
        assert!(create(&conn, "X", product_id, "desktop", "{}").await.is_err());
        assert!(create(&conn, "X", 999, "api", "{}").await.is_err());
        assert!(create(&conn, "X", product_id, "api", "{bad").await.is_err());
    }

    #[tokio::test]
    async fn name_is_unique_within_a_product() {
        let (conn, product_id) = db_with_product().await;
        create(&conn, "API", product_id, "api", "{}").await.expect("first");
        assert!(create(&conn, "API", product_id, "api", "{}").await.is_err());
        let other = crate::db::product::create(&conn, "Other Product", "{}")
            .await
            .expect("second product");
        create(&conn, "API", other, "api", "{}")
            .await
            .expect("same name under another product is fine");
    }

    #[tokio::test]
    async fn delete_removes_only_the_solution() {
        let (conn, product_id) = db_with_product().await;
        let id = create(&conn, "API", product_id, "api", "{}").await.expect("create");
        delete(&conn, id).await.expect("delete");
        assert!(list_by_product(&conn, product_id).await.expect("list").is_empty());
        assert!(crate::db::product::find_by_id(&conn, product_id)
            .await
            .expect("product")
            .is_some());
    }

    /// The work still needs doing — it just no longer knows where it lands.
    #[tokio::test]
    async fn deleting_a_solution_unlinks_its_work_rather_than_deleting_it() {
        use crate::db::work_item::{self, WorkItemFields};
        let (conn, product_id) = db_with_product().await;
        let id = create(&conn, "API", product_id, "api", "{}").await.expect("create");
        let item = work_item::create(&conn, "Add endpoint", "feature", product_id, None, None)
            .await
            .expect("item");
        work_item::update_item(&conn, item, WorkItemFields { solution_id: Some(id), ..Default::default() })
            .await
            .expect("link");

        delete(&conn, id).await.expect("delete");

        let survivor = work_item::find_by_id(&conn, item).await.expect("q").expect("still there");
        assert_eq!(survivor.title, "Add endpoint");
        assert_eq!(survivor.solution_id, None, "must not dangle at a deleted Solution");
    }

    #[tokio::test]
    async fn new_solution_defaults_to_created_origin_with_no_repo() {
        let (conn, product_id) = db_with_product().await;
        let id = create(&conn, "API", product_id, "api", "{}").await.expect("create");
        let sol = find_by_id(&conn, id).await.expect("find").expect("exists");
        assert_eq!(sol.origin, "created");
        assert_eq!(sol.github_url, None);
        assert_eq!(sol.github_visibility, None);
    }

    /// A round-1 `solutions` table (no `origin`) is dropped and recreated, so
    /// an existing database opens cleanly on the new schema. Pre-release
    /// behaviour: the old rows go with it — see the model brief's debt note.
    #[tokio::test]
    async fn round_one_table_is_migrated_to_the_github_schema() {
        let (conn, product_id) = db_with_product().await;
        conn.execute("DROP TABLE solutions", ()).await.expect("drop");
        conn.execute(
            "CREATE TABLE solutions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                productId INTEGER NOT NULL,
                solutionType TEXT NOT NULL DEFAULT 'application',
                answers TEXT NOT NULL DEFAULT '{}',
                createdAt INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL,
                UNIQUE(productId, name)
            )",
            (),
        )
        .await
        .expect("round-1 table");

        create_table(&conn).await.expect("migrate");

        // The new columns exist and the table is usable again.
        let id = create(&conn, "API", product_id, "api", "{}").await.expect("create");
        let sol = find_by_id(&conn, id).await.expect("find").expect("exists");
        assert_eq!(sol.origin, "created");
        assert_eq!(sol.github_url, None);
    }

    #[tokio::test]
    async fn set_github_links_a_repo_and_validates_origin() {
        let (conn, product_id) = db_with_product().await;
        let id = create(&conn, "API", product_id, "api", "{}").await.expect("create");
        set_github(&conn, id, Some("https://github.com/me/api"), Some("private"), "imported")
            .await
            .expect("link");
        let sol = find_by_id(&conn, id).await.expect("find").expect("exists");
        assert_eq!(sol.github_url.as_deref(), Some("https://github.com/me/api"));
        assert_eq!(sol.github_visibility.as_deref(), Some("private"));
        assert_eq!(sol.origin, "imported");

        assert!(set_github(&conn, id, None, None, "bogus").await.is_err());
        assert!(set_github(&conn, 999, None, None, "created").await.is_err());
    }
}
