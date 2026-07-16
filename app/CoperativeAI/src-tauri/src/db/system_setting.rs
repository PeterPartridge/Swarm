//! The `SystemSetting` model — see
//! application/claude-only/CoperativeAIdb/SystemSetting-model.md.
//! Never store secrets here (solution security rule — keys live in the OS
//! credential store).

use crate::db::{now_millis, DbError, Result};
use turso::Connection;

pub const PLANNING_HIERARCHY_KEY: &str = "planningHierarchy";
pub const ROADMAP_MODE_KEY: &str = "roadmapMode";

/// The three valid "How Products are planned" presets; the first is the default.
pub const HIERARCHY_PRESETS: &[&[&str]] = &[
    &["epic", "feature", "userStory", "task"],
    &["feature", "userStory", "task"],
    &["feature", "task"],
];

pub const ROADMAP_MODES: &[&str] = &["sprints", "kanban"];

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS system_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL UNIQUE,
            value TEXT NOT NULL DEFAULT 'null',
            updatedAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    Ok(())
}

pub async fn get(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut rows = conn
        .query("SELECT value FROM system_settings WHERE key = ?1", (key,))
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}

pub async fn set(conn: &Connection, key: &str, value_json: &str) -> Result<()> {
    serde_json::from_str::<serde_json::Value>(value_json)
        .map_err(|e| DbError::Validation(format!("setting value is not valid JSON: {e}")))?;
    conn.execute(
        "DELETE FROM system_settings WHERE key = ?1",
        (key,),
    )
    .await?;
    conn.execute(
        "INSERT INTO system_settings (key, value, updatedAt) VALUES (?1, ?2, ?3)",
        (key, value_json, now_millis()),
    )
    .await?;
    Ok(())
}

/// The active planning hierarchy — the stored preset, or the default when unset.
pub async fn get_planning_hierarchy(conn: &Connection) -> Result<Vec<String>> {
    match get(conn, PLANNING_HIERARCHY_KEY).await? {
        Some(json) => Ok(serde_json::from_str(&json).unwrap_or_else(|_| default_hierarchy())),
        None => Ok(default_hierarchy()),
    }
}

/// Only the three presets are valid (SystemSetting invariant).
pub async fn set_planning_hierarchy(conn: &Connection, hierarchy: &[String]) -> Result<()> {
    let as_strs: Vec<&str> = hierarchy.iter().map(String::as_str).collect();
    if !HIERARCHY_PRESETS.contains(&as_strs.as_slice()) {
        return Err(DbError::Validation(format!(
            "planningHierarchy must be one of the presets {HIERARCHY_PRESETS:?}, got {hierarchy:?}"
        )));
    }
    let json = serde_json::to_string(hierarchy).expect("hierarchy serialize");
    set(conn, PLANNING_HIERARCHY_KEY, &json).await
}

pub async fn get_roadmap_mode(conn: &Connection) -> Result<String> {
    match get(conn, ROADMAP_MODE_KEY).await? {
        Some(json) => Ok(serde_json::from_str(&json).unwrap_or_else(|_| "sprints".to_string())),
        None => Ok("sprints".to_string()),
    }
}

pub async fn set_roadmap_mode(conn: &Connection, mode: &str) -> Result<()> {
    if !ROADMAP_MODES.contains(&mode) {
        return Err(DbError::Validation(format!(
            "roadmapMode must be one of {ROADMAP_MODES:?}, got '{mode}'"
        )));
    }
    let json = serde_json::to_string(mode).expect("mode serialize");
    set(conn, ROADMAP_MODE_KEY, &json).await
}

fn default_hierarchy() -> Vec<String> {
    HIERARCHY_PRESETS[0].iter().map(|s| s.to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connect;

    async fn test_db() -> Connection {
        let conn = connect(":memory:").await.expect("open in-memory db");
        create_table(&conn).await.expect("create table");
        conn
    }

    #[tokio::test]
    async fn unset_hierarchy_falls_back_to_the_default_preset() {
        let conn = test_db().await;
        let hierarchy = get_planning_hierarchy(&conn).await.expect("get");
        assert_eq!(hierarchy, vec!["epic", "feature", "userStory", "task"]);
        assert_eq!(get_roadmap_mode(&conn).await.expect("get"), "sprints");
    }

    #[tokio::test]
    async fn only_the_three_presets_are_accepted() {
        let conn = test_db().await;
        let valid: Vec<String> = ["feature", "task"].iter().map(|s| s.to_string()).collect();
        set_planning_hierarchy(&conn, &valid).await.expect("valid preset");
        assert_eq!(get_planning_hierarchy(&conn).await.expect("get"), valid);

        let invalid: Vec<String> = ["task", "epic"].iter().map(|s| s.to_string()).collect();
        assert!(set_planning_hierarchy(&conn, &invalid).await.is_err());
    }

    #[tokio::test]
    async fn roadmap_mode_is_validated_and_persisted() {
        let conn = test_db().await;
        set_roadmap_mode(&conn, "kanban").await.expect("valid mode");
        assert_eq!(get_roadmap_mode(&conn).await.expect("get"), "kanban");
        assert!(set_roadmap_mode(&conn, "gantt").await.is_err());
    }

    #[tokio::test]
    async fn non_json_values_are_rejected() {
        let conn = test_db().await;
        assert!(set(&conn, "anything", "{not json").await.is_err());
    }
}
