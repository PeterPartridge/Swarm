//! The steps a work item goes through, written by the people who work it.
//!
//! **Three gates, because three different teams hand over.** Product finishes
//! with an item and gives it to Develop; Develop finishes and gives it to QA;
//! QA finishes and it is releasable. Each handover is somebody's checklist, and
//! nothing here says what is on it: a team that writes "spike the API" and a
//! team that writes "signed off by legal" are both right, and an app that
//! shipped a default list would be telling them how to work.
//!
//! **The gates are fixed, the steps are not.** The handovers are the shape of
//! the framework — Product → Develop → QA is the tripod this whole app is —
//! whereas what each team does before letting go is theirs. So the three are a
//! constant and the steps are a table.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

/// One handover, and who owns the steps leading up to it.
pub struct Gate {
    pub id: &'static str,
    /// What the list is called on screen.
    pub label: &'static str,
    /// The area whose people tick these off — and the only area besides Product
    /// that sees them. Product sees the whole life of an item; Develop and QA
    /// see the part they are responsible for, which is the point of the split.
    pub owner: &'static str,
}

pub const GATES: &[Gate] = &[
    Gate {
        id: "toDevelop",
        label: "Before Product hands it to Develop",
        owner: "product",
    },
    Gate {
        id: "toTest",
        label: "Before it is ready for QA",
        owner: "develop",
    },
    Gate {
        id: "toRelease",
        label: "Before it is ready to release",
        owner: "test",
    },
];

pub fn gate(id: &str) -> Option<&'static Gate> {
    GATES.iter().find(|g| g.id == id)
}

#[derive(Debug, Clone, PartialEq)]
pub struct Step {
    pub id: i64,
    pub product_id: i64,
    pub gate: String,
    pub name: String,
    /// Where it sits in its gate's list. A checklist is read in order.
    pub position: i64,
}

const SELECT: &str = "SELECT id, productId, gate, name, position FROM lifecycle_steps";

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS lifecycle_steps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            productId INTEGER NOT NULL,
            gate TEXT NOT NULL,
            name TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0
        )",
        (),
    )
    .await?;
    // What each work item has done. A row is a tick; no row is not done, which
    // means a step added later starts unticked on every existing item without
    // anything having to backfill it.
    conn.execute(
        "CREATE TABLE IF NOT EXISTS work_item_steps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workItemId INTEGER NOT NULL,
            stepId INTEGER NOT NULL,
            doneAt INTEGER NOT NULL,
            UNIQUE(workItemId, stepId)
        )",
        (),
    )
    .await?;
    Ok(())
}

/// Replaces one gate's checklist, keeping the ticks on steps that survive.
///
/// **Matched by name rather than replaced wholesale.** Reordering a list or
/// adding a step to the middle of it must not un-tick what teams have already
/// done — a tick is a record that somebody did something, and losing it because
/// the list was edited would make the checklist untrustworthy. A step that is
/// genuinely gone takes its ticks with it, which is correct: there is nothing
/// left for them to be about.
pub async fn set_steps(
    conn: &Connection,
    product_id: i64,
    gate_id: &str,
    names: &[String],
) -> Result<()> {
    if gate(gate_id).is_none() {
        let ids: Vec<&str> = GATES.iter().map(|g| g.id).collect();
        return Err(DbError::Validation(format!(
            "gate must be one of {ids:?}, got '{gate_id}'"
        )));
    }
    let cleaned: Vec<String> = names
        .iter()
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .collect();

    let existing: Vec<Step> = list_steps(conn, product_id)
        .await?
        .into_iter()
        .filter(|s| s.gate == gate_id)
        .collect();

    for (position, name) in cleaned.iter().enumerate() {
        match existing.iter().find(|s| s.name == *name) {
            Some(kept) => {
                conn.execute(
                    "UPDATE lifecycle_steps SET position = ?1 WHERE id = ?2",
                    (position as i64, kept.id),
                )
                .await?;
            }
            None => {
                conn.execute(
                    "INSERT INTO lifecycle_steps (productId, gate, name, position) VALUES (?1, ?2, ?3, ?4)",
                    (product_id, gate_id, name.as_str(), position as i64),
                )
                .await?;
            }
        }
    }

    for gone in existing.iter().filter(|s| !cleaned.contains(&s.name)) {
        conn.execute("DELETE FROM work_item_steps WHERE stepId = ?1", (gone.id,))
            .await?;
        conn.execute("DELETE FROM lifecycle_steps WHERE id = ?1", (gone.id,))
            .await?;
    }
    Ok(())
}

/// Every step this Product has, in gate order and then in list order.
pub async fn list_steps(conn: &Connection, product_id: i64) -> Result<Vec<Step>> {
    let mut rows = conn
        .query(
            &format!("{SELECT} WHERE productId = ?1 ORDER BY gate, position, id"),
            (product_id,),
        )
        .await?;
    let mut steps = Vec::new();
    while let Some(row) = rows.next().await? {
        steps.push(Step {
            id: row.get(0)?,
            product_id: row.get(1)?,
            gate: row.get(2)?,
            name: row.get(3)?,
            position: row.get(4)?,
        });
    }
    Ok(steps)
}

/// Ticks a step off for one work item, or takes the tick back.
///
/// Idempotent in both directions: pressing a tick twice is a double-click, and
/// un-ticking something that was never ticked is not an error.
pub async fn tick(
    conn: &Connection,
    work_item_id: i64,
    step_id: i64,
    done: bool,
) -> Result<()> {
    if !done {
        conn.execute(
            "DELETE FROM work_item_steps WHERE workItemId = ?1 AND stepId = ?2",
            (work_item_id, step_id),
        )
        .await?;
        return Ok(());
    }
    // **Scoped, and this is not style.** A `Rows` held open across the write
    // below leaves the connection mid-read, and the INSERT goes nowhere — no
    // error, no row. The same trap this project has hit before, and the reason
    // every read here is a block that ends before anything is written.
    let known = {
        let mut rows = conn
            .query("SELECT id FROM lifecycle_steps WHERE id = ?1", (step_id,))
            .await?;
        rows.next().await?.is_some()
    };
    if !known {
        return Err(DbError::Validation(format!("no lifecycle step with id {step_id}")));
    }
    if done_steps(conn, work_item_id).await?.contains(&step_id) {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO work_item_steps (workItemId, stepId, doneAt) VALUES (?1, ?2, ?3)",
        (work_item_id, step_id, now_millis()),
    )
    .await?;
    let _ = last_insert_id(conn).await?;
    Ok(())
}

/// The steps this work item has ticked off.
pub async fn done_steps(conn: &Connection, work_item_id: i64) -> Result<Vec<i64>> {
    let mut rows = conn
        .query(
            "SELECT stepId FROM work_item_steps WHERE workItemId = ?1",
            (work_item_id,),
        )
        .await?;
    let mut ids = Vec::new();
    while let Some(row) = rows.next().await? {
        ids.push(row.get(0)?);
    }
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    /// A real database with a Product in it, because the steps hang off one.
    async fn conn() -> (Connection, i64) {
        db_with_product().await
    }

    #[tokio::test]
    async fn a_gate_holds_the_steps_it_was_given_in_order() {
        let (conn, product) = conn().await;
        set_steps(
            &conn,
            product,
            "toDevelop",
            &["Story written".into(), "Mockups attached".into()],
        )
        .await
        .expect("set");

        let steps = list_steps(&conn, product).await.expect("list");
        assert_eq!(
            steps.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
            ["Story written", "Mockups attached"]
        );
        assert!(steps.iter().all(|s| s.gate == "toDevelop"));
    }

    /// The three handovers are the framework's shape; anything else is a typo
    /// or a fourth team nobody agreed to.
    #[tokio::test]
    async fn an_unknown_gate_is_refused() {
        let (conn, product) = conn().await;
        let err = set_steps(&conn, product, "toMarketing", &["x".into()])
            .await
            .expect_err("refused");
        assert!(format!("{err}").contains("toDevelop"), "names the real ones");
    }

    /// **A tick is a record that somebody did something.** Reordering the list
    /// or adding a step to the middle of it must not quietly undo that.
    #[tokio::test]
    async fn editing_the_list_keeps_the_ticks_that_still_have_a_step() {
        let (conn, product) = conn().await;
        set_steps(
            &conn,
            product,
            "toTest",
            &["Unit tests pass".into(), "Reviewed".into()],
        )
        .await
        .expect("set");
        let steps = list_steps(&conn, product).await.expect("list");
        let reviewed = steps.iter().find(|s| s.name == "Reviewed").expect("step");
        tick(&conn, 9, reviewed.id, true).await.expect("tick");

        // Reordered, with one added in front and one taken away.
        set_steps(
            &conn,
            product,
            "toTest",
            &["Branch merged".into(), "Reviewed".into()],
        )
        .await
        .expect("re-set");

        let after = list_steps(&conn, product).await.expect("list");
        let still = after.iter().find(|s| s.name == "Reviewed").expect("kept");
        assert_eq!(still.id, reviewed.id, "the same step, not a new one");
        assert_eq!(still.position, 1, "moved down the list");
        assert_eq!(
            done_steps(&conn, 9).await.expect("done"),
            vec![reviewed.id],
            "and it is still ticked"
        );
    }

    /// A step that is gone takes its ticks with it — there is nothing left for
    /// them to be about, and a tick against a step nobody can see is a row that
    /// can only confuse a later count.
    #[tokio::test]
    async fn a_removed_step_takes_its_ticks_with_it() {
        let (conn, product) = conn().await;
        set_steps(&conn, product, "toRelease", &["Signed off".into()])
            .await
            .expect("set");
        let step = list_steps(&conn, product).await.expect("list")[0].clone();
        tick(&conn, 9, step.id, true).await.expect("tick");

        set_steps(&conn, product, "toRelease", &[]).await.expect("cleared");

        assert!(list_steps(&conn, product).await.expect("list").is_empty());
        assert!(done_steps(&conn, 9).await.expect("done").is_empty());
    }

    #[tokio::test]
    async fn ticking_twice_is_one_tick_and_unticking_is_allowed() {
        let (conn, product) = conn().await;
        set_steps(&conn, product, "toDevelop", &["Story written".into()])
            .await
            .expect("set");
        let step = list_steps(&conn, product).await.expect("list")[0].clone();

        tick(&conn, 9, step.id, true).await.expect("first");
        tick(&conn, 9, step.id, true).await.expect("second");
        assert_eq!(done_steps(&conn, 9).await.expect("done").len(), 1);

        tick(&conn, 9, step.id, false).await.expect("untick");
        assert!(done_steps(&conn, 9).await.expect("done").is_empty());
        // Un-ticking what was never ticked is not an error.
        tick(&conn, 9, step.id, false).await.expect("again");
    }

    #[tokio::test]
    async fn a_step_that_does_not_exist_cannot_be_ticked() {
        let (conn, product) = conn().await;
        assert!(tick(&conn, 9, 404, true).await.is_err());
    }
}
