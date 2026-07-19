//! The `SolutionStrategy` model — how the AI proposes to build a work item.
//!
//! One strategy per work item: a written approach, a set of architecture
//! options to choose between, and the tech stack that follows from the
//! developer rules. The options are stored as JSON because their shape is the
//! AI's to fill in; the *choice* is a column, because that is the developer's
//! decision and the app has to know it.

use crate::db::{now_millis, DbError, Result};
use turso::Connection;

/// The kinds of component the AI may propose. Not exhaustive — `other` exists
/// so a sensible proposal is never forced into a wrong box.
pub const ARCHITECTURE_KINDS: &[&str] = &[
    "windowsService",
    "azureWebApp",
    "azureFunction",
    "api",
    "backgroundWorker",
    "other",
];

#[derive(Debug, Clone, PartialEq)]
pub struct SolutionStrategy {
    pub id: i64,
    pub work_item_id: i64,
    pub strategy: String,
    /// JSON array of {name, kind, rationale, tradeoffs}.
    pub architecture_options: String,
    pub chosen_option_index: Option<i64>,
    /// Prose, for a person to read.
    pub tech_stack: String,
    /// JSON array of the technologies the AI proposes to **use**. The rule
    /// check runs against this and never against the prose — the first live run
    /// flagged a strategy whose tech stack ended "No Java or PHP anywhere",
    /// i.e. it obeyed the rule and was reported for saying so.
    pub technologies: String,
    /// Ledger row that paid for this, so cost is traceable to what it bought.
    pub ai_usage_id: Option<i64>,
    pub generated_at: i64,
}

const SELECT: &str = "SELECT id, workItemId, strategy, architectureOptions, chosenOptionIndex, techStack, technologies, aiUsageId, generatedAt FROM solution_strategies";

pub async fn create_table(conn: &Connection) -> Result<()> {
    // Adds `technologies`. Pre-release → drop & recreate; strategies are
    // regenerated from the AI anyway, so nothing irreplaceable is lost.
    let mut columns: Vec<String> = Vec::new();
    {
        let mut rows = conn
            .query("SELECT name FROM pragma_table_info('solution_strategies')", ())
            .await?;
        while let Some(row) = rows.next().await? {
            columns.push(row.get(0)?);
        }
    }
    if !columns.is_empty() && !columns.iter().any(|c| c == "technologies") {
        conn.execute("DROP TABLE solution_strategies", ()).await?;
    }

    conn.execute(
        "CREATE TABLE IF NOT EXISTS solution_strategies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workItemId INTEGER NOT NULL UNIQUE,
            strategy TEXT NOT NULL DEFAULT '',
            architectureOptions TEXT NOT NULL DEFAULT '[]',
            chosenOptionIndex INTEGER,
            techStack TEXT NOT NULL DEFAULT '',
            technologies TEXT NOT NULL DEFAULT '[]',
            aiUsageId INTEGER,
            generatedAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    Ok(())
}

/// Stores a freshly generated strategy, replacing any previous one for the item.
/// Regenerating deliberately clears the chosen option: the choice was made about
/// options that no longer exist.
#[allow(clippy::too_many_arguments)]
pub async fn set_strategy(
    conn: &Connection,
    work_item_id: i64,
    strategy: &str,
    architecture_options_json: &str,
    tech_stack: &str,
    technologies_json: &str,
    ai_usage_id: Option<i64>,
) -> Result<()> {
    if crate::db::work_item::find_by_id(conn, work_item_id).await?.is_none() {
        return Err(DbError::Validation(format!(
            "no work item with id {work_item_id}"
        )));
    }
    serde_json::from_str::<serde_json::Value>(architecture_options_json)
        .map_err(|e| DbError::Validation(format!("architecture options are not valid JSON: {e}")))?;

    conn.execute(
        "DELETE FROM solution_strategies WHERE workItemId = ?1",
        (work_item_id,),
    )
    .await?;
    conn.execute(
        "INSERT INTO solution_strategies (workItemId, strategy, architectureOptions, chosenOptionIndex, techStack, technologies, aiUsageId, generatedAt)
         VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7)",
        (
            work_item_id,
            strategy,
            architecture_options_json,
            tech_stack,
            technologies_json,
            ai_usage_id,
            now_millis(),
        ),
    )
    .await?;
    Ok(())
}

/// Records which option the developer picked. `None` clears the choice.
pub async fn choose_option(conn: &Connection, work_item_id: i64, index: Option<i64>) -> Result<()> {
    let Some(existing) = get_for_item(conn, work_item_id).await? else {
        return Err(DbError::Validation(format!(
            "no solution strategy for work item {work_item_id}"
        )));
    };
    if let Some(index) = index {
        let options: Vec<serde_json::Value> =
            serde_json::from_str(&existing.architecture_options).unwrap_or_default();
        if index < 0 || index as usize >= options.len() {
            return Err(DbError::Validation(format!(
                "there is no architecture option {index} to choose"
            )));
        }
    }
    conn.execute(
        "UPDATE solution_strategies SET chosenOptionIndex = ?1 WHERE workItemId = ?2",
        (index, work_item_id),
    )
    .await?;
    Ok(())
}

pub async fn get_for_item(conn: &Connection, work_item_id: i64) -> Result<Option<SolutionStrategy>> {
    let mut rows = conn
        .query(&format!("{SELECT} WHERE workItemId = ?1"), (work_item_id,))
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(SolutionStrategy {
            id: row.get(0)?,
            work_item_id: row.get(1)?,
            strategy: row.get(2)?,
            architecture_options: row.get(3)?,
            chosen_option_index: row.get(4)?,
            tech_stack: row.get(5)?,
            technologies: row.get(6)?,
            ai_usage_id: row.get(7)?,
            generated_at: row.get(8)?,
        })),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    const OPTIONS: &str = r#"[
        {"name":"Azure Function","kind":"azureFunction","rationale":"cheap at low volume","tradeoffs":"cold starts"},
        {"name":"Background worker","kind":"backgroundWorker","rationale":"steady throughput","tradeoffs":"always on"}
    ]"#;

    async fn item(conn: &Connection, product_id: i64) -> i64 {
        crate::db::work_item::create(conn, "Checkout", "feature", product_id, None, None)
            .await
            .expect("item")
    }

    #[tokio::test]
    async fn a_strategy_round_trips_with_its_options() {
        let (conn, product_id) = db_with_product().await;
        let item_id = item(&conn, product_id).await;
        set_strategy(&conn, item_id, "Build it as a queue consumer.", OPTIONS, "Rust, Azure", "[\"Rust\"]", Some(4))
            .await
            .expect("set");

        let stored = get_for_item(&conn, item_id).await.expect("get").expect("exists");
        assert!(stored.strategy.starts_with("Build it"));
        assert_eq!(stored.tech_stack, "Rust, Azure");
        assert_eq!(stored.ai_usage_id, Some(4));
        assert_eq!(stored.chosen_option_index, None);
    }

    #[tokio::test]
    async fn a_strategy_needs_a_real_item_and_valid_option_json() {
        let (conn, product_id) = db_with_product().await;
        let item_id = item(&conn, product_id).await;
        assert!(set_strategy(&conn, 999, "s", OPTIONS, "", "[]", None).await.is_err());
        assert!(set_strategy(&conn, item_id, "s", "{not json", "", "[]", None).await.is_err());
    }

    #[tokio::test]
    async fn choosing_an_option_is_recorded_and_bounds_checked() {
        let (conn, product_id) = db_with_product().await;
        let item_id = item(&conn, product_id).await;
        set_strategy(&conn, item_id, "s", OPTIONS, "", "[]", None).await.expect("set");

        choose_option(&conn, item_id, Some(1)).await.expect("choose");
        assert_eq!(
            get_for_item(&conn, item_id).await.expect("get").unwrap().chosen_option_index,
            Some(1)
        );

        assert!(choose_option(&conn, item_id, Some(5)).await.is_err());
        assert!(choose_option(&conn, item_id, Some(-1)).await.is_err());
        assert!(choose_option(&conn, 999, Some(0)).await.is_err());

        choose_option(&conn, item_id, None).await.expect("clear");
        assert_eq!(
            get_for_item(&conn, item_id).await.expect("get").unwrap().chosen_option_index,
            None
        );
    }

    /// The choice was made about options that no longer exist, so keeping it
    /// would silently point at a different architecture than the one picked.
    #[tokio::test]
    async fn regenerating_clears_a_previous_choice() {
        let (conn, product_id) = db_with_product().await;
        let item_id = item(&conn, product_id).await;
        set_strategy(&conn, item_id, "first", OPTIONS, "", "[]", None).await.expect("set");
        choose_option(&conn, item_id, Some(1)).await.expect("choose");

        set_strategy(&conn, item_id, "second", OPTIONS, "", "[]", None).await.expect("regenerate");
        let stored = get_for_item(&conn, item_id).await.expect("get").unwrap();
        assert_eq!(stored.strategy, "second");
        assert_eq!(stored.chosen_option_index, None, "a stale choice must not survive");
    }
}
