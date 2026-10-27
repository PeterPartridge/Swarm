//! The `ModelInstall` model — which models the platform knows about, and
//! whether each has been through installation.
//!
//! A model appearing on a provider is not the same as a model the platform can
//! use. Ollama will happily list anything that has been pulled, and a provider's
//! model list is typed in by hand; neither says whether that model can produce
//! the structured output the platform depends on. So a newly seen model is
//! recorded as `detected` and **refused** until it has been installed and
//! validated.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

/// `detected` — seen on a provider, not yet usable.
/// `installed` — a capability pack was built and every probe passed.
/// `failed` — installation ran and at least one probe failed; still refused.
pub const STATES: &[&str] = &["detected", "installed", "failed"];

#[derive(Debug, Clone, PartialEq)]
pub struct ModelInstall {
    pub id: i64,
    pub provider_id: i64,
    pub model: String,
    pub state: String,
    /// Where the capability pack was written, relative to the Product folder.
    pub pack_path: String,
    /// JSON report of the last validation run.
    pub validation_report: String,
    /// Whether this model can be shown images.
    ///
    /// Off by default and set by a person, because the platform cannot measure
    /// it cheaply and guessing wrong is expensive both ways: sending pictures
    /// to a text-only model wastes a paid call on an error, and withholding
    /// them from a model that can see silently degrades the work. A capability
    /// nobody has confirmed is treated as absent.
    pub supports_vision: bool,
    pub detected_at: i64,
    pub installed_at: Option<i64>,
}

const SELECT: &str = "SELECT id, providerId, model, state, packPath, validationReport, supportsVision, detectedAt, installedAt FROM model_installs";

pub async fn create_table(conn: &Connection) -> Result<()> {
    let columns = crate::db::table_columns(conn, "model_installs").await?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS model_installs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            providerId INTEGER NOT NULL,
            model TEXT NOT NULL,
            state TEXT NOT NULL DEFAULT 'detected',
            packPath TEXT NOT NULL DEFAULT '',
            validationReport TEXT NOT NULL DEFAULT '{}',
            supportsVision INTEGER NOT NULL DEFAULT 0,
            detectedAt INTEGER NOT NULL,
            installedAt INTEGER,
            UNIQUE(providerId, model)
        )",
        (),
    )
    .await?;

    // Added rather than dropped: an install record is a validation someone
    // waited for, and re-running every probe to gain one column would be a
    // charge for nothing.
    if !columns.is_empty() && !columns.iter().any(|c| c == "supportsVision") {
        conn.execute(
            "ALTER TABLE model_installs ADD COLUMN supportsVision INTEGER NOT NULL DEFAULT 0",
            (),
        )
        .await?;
    }
    Ok(())
}

/// Records whether a model can be shown images.
pub async fn set_supports_vision(
    conn: &Connection,
    provider_id: i64,
    model: &str,
    supports_vision: bool,
) -> Result<()> {
    conn.execute(
        "UPDATE model_installs SET supportsVision = ?1 WHERE providerId = ?2 AND model = ?3",
        (supports_vision as i64, provider_id, model),
    )
    .await?;
    Ok(())
}

/// Whether this model may be sent pictures. Unknown models cannot.
pub async fn supports_vision(conn: &Connection, provider_id: i64, model: &str) -> Result<bool> {
    let mut rows = conn
        .query(
            "SELECT supportsVision FROM model_installs WHERE providerId = ?1 AND model = ?2",
            (provider_id, model),
        )
        .await?;
    match rows.next().await? {
        Some(row) => Ok(row.get::<i64>(0)? != 0),
        None => Ok(false),
    }
}

/// Records any model on this provider the platform has not seen before.
/// Returns the newly detected names, so the UI can say what turned up.
pub async fn sync_for_provider(
    conn: &Connection,
    provider_id: i64,
    models: &[String],
) -> Result<Vec<String>> {
    let known: Vec<String> = {
        let mut rows = conn
            .query(
                "SELECT model FROM model_installs WHERE providerId = ?1",
                (provider_id,),
            )
            .await?;
        let mut names = Vec::new();
        while let Some(row) = rows.next().await? {
            names.push(row.get(0)?);
        }
        names
    };

    let mut newly_detected = Vec::new();
    for model in models {
        if model.trim().is_empty() || known.iter().any(|k| k == model) {
            continue;
        }
        conn.execute(
            "INSERT INTO model_installs (providerId, model, state, detectedAt)
             VALUES (?1, ?2, 'detected', ?3)",
            (provider_id, model.as_str(), now_millis()),
        )
        .await?;
        newly_detected.push(model.clone());
    }
    Ok(newly_detected)
}

/// Whether the platform may use this model. Anything not installed is refused —
/// including a model that was installed once and later failed a re-validation.
pub async fn is_installed(conn: &Connection, provider_id: i64, model: &str) -> Result<bool> {
    Ok(find(conn, provider_id, model)
        .await?
        .is_some_and(|m| m.state == "installed"))
}

pub async fn find(
    conn: &Connection,
    provider_id: i64,
    model: &str,
) -> Result<Option<ModelInstall>> {
    let mut rows = conn
        .query(
            &format!("{SELECT} WHERE providerId = ?1 AND model = ?2"),
            (provider_id, model),
        )
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_install(row)?)),
        None => Ok(None),
    }
}

pub async fn list_all(conn: &Connection) -> Result<Vec<ModelInstall>> {
    let mut rows = conn
        .query(&format!("{SELECT} ORDER BY providerId, model"), ())
        .await?;
    let mut items = Vec::new();
    while let Some(row) = rows.next().await? {
        items.push(row_to_install(row)?);
    }
    Ok(items)
}

/// Records the outcome of an installation attempt.
pub async fn set_result(
    conn: &Connection,
    provider_id: i64,
    model: &str,
    state: &str,
    pack_path: &str,
    validation_report: &str,
) -> Result<i64> {
    if !STATES.contains(&state) {
        return Err(DbError::Validation(format!(
            "state must be one of {STATES:?}, got '{state}'"
        )));
    }
    serde_json::from_str::<serde_json::Value>(validation_report)
        .map_err(|e| DbError::Validation(format!("the validation report is not valid JSON: {e}")))?;

    let existing = find(conn, provider_id, model).await?;
    let detected_at = existing.as_ref().map(|m| m.detected_at).unwrap_or_else(now_millis);
    let installed_at = if state == "installed" {
        Some(now_millis())
    } else {
        None
    };

    conn.execute(
        "DELETE FROM model_installs WHERE providerId = ?1 AND model = ?2",
        (provider_id, model),
    )
    .await?;
    conn.execute(
        "INSERT INTO model_installs (providerId, model, state, packPath, validationReport, detectedAt, installedAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        (
            provider_id,
            model,
            state,
            pack_path,
            validation_report,
            detected_at,
            installed_at,
        ),
    )
    .await?;
    last_insert_id(conn).await
}

fn row_to_install(row: turso::Row) -> Result<ModelInstall> {
    Ok(ModelInstall {
        id: row.get(0)?,
        provider_id: row.get(1)?,
        model: row.get(2)?,
        state: row.get(3)?,
        pack_path: row.get(4)?,
        validation_report: row.get(5)?,
        supports_vision: row.get::<i64>(6)? != 0,
        detected_at: row.get(7)?,
        installed_at: row.get(8)?,
    })
}

#[cfg(test)]
mod vision_tests {
    use super::*;
    use crate::db::{ai_provider, connect, create_all_tables};

    async fn db_with_provider() -> (Connection, i64) {
        let conn = connect(":memory:").await.expect("db");
        create_all_tables(&conn).await.expect("tables");
        let id = ai_provider::add(&conn, "Claude", "https://a.example", &["opus"], "alias")
            .await
            .expect("provider");
        (conn, id)
    }

    /// A capability nobody has confirmed is treated as absent — sending
    /// pictures to a text-only model wastes a paid call on an error.
    #[tokio::test]
    async fn a_model_cannot_be_shown_pictures_until_someone_says_it_can() {
        let (conn, provider) = db_with_provider().await;
        sync_for_provider(&conn, provider, &["opus".to_string()]).await.expect("sync");

        assert!(!supports_vision(&conn, provider, "opus").await.expect("q"));

        set_supports_vision(&conn, provider, "opus", true).await.expect("set");
        assert!(supports_vision(&conn, provider, "opus").await.expect("q"));

        set_supports_vision(&conn, provider, "opus", false).await.expect("unset");
        assert!(!supports_vision(&conn, provider, "opus").await.expect("q"));
    }

    /// An unknown model is not a model that can see.
    #[tokio::test]
    async fn a_model_the_platform_has_never_seen_cannot_be_shown_pictures() {
        let (conn, provider) = db_with_provider().await;
        assert!(!supports_vision(&conn, provider, "never-heard-of-it").await.expect("q"));
    }

    /// An install record is a validation someone waited for; gaining a column
    /// must not cost every probe again.
    #[tokio::test]
    async fn adding_the_vision_column_keeps_existing_installs() {
        let conn = connect(":memory:").await.expect("db");
        conn.execute(
            "CREATE TABLE model_installs (
                id INTEGER PRIMARY KEY AUTOINCREMENT, providerId INTEGER NOT NULL,
                model TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'detected',
                packPath TEXT NOT NULL DEFAULT '', validationReport TEXT NOT NULL DEFAULT '{}',
                detectedAt INTEGER NOT NULL, installedAt INTEGER, UNIQUE(providerId, model)
            )",
            (),
        )
        .await
        .expect("old table");
        conn.execute(
            "INSERT INTO model_installs (providerId, model, state, detectedAt) VALUES (1, 'opus', 'installed', 1)",
            (),
        )
        .await
        .expect("seed");

        create_table(&conn).await.expect("migrate");

        let survivor = find(&conn, 1, "opus").await.expect("q").expect("still there");
        assert_eq!(survivor.state, "installed", "the validation is not thrown away");
        assert!(!survivor.supports_vision, "and the new capability starts off");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;

    async fn provider(conn: &Connection) -> i64 {
        crate::db::ai_provider::add(conn, "Claude", "https://api.anthropic.com", &["haiku"], "alias")
            .await
            .expect("provider")
    }

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[tokio::test]
    async fn a_new_model_is_detected_once_and_not_re_reported() {
        let (conn, _) = db_with_product().await;
        let p = provider(&conn).await;

        let first = sync_for_provider(&conn, p, &names(&["haiku", "opus"]))
            .await
            .expect("sync");
        assert_eq!(first, vec!["haiku", "opus"]);

        let second = sync_for_provider(&conn, p, &names(&["haiku", "opus"]))
            .await
            .expect("sync again");
        assert!(second.is_empty(), "already-known models are not re-detected");

        let third = sync_for_provider(&conn, p, &names(&["haiku", "opus", "sonnet"]))
            .await
            .expect("sync with a new one");
        assert_eq!(third, vec!["sonnet"]);
    }

    /// The whole point: appearing on a provider does not make a model usable.
    #[tokio::test]
    async fn a_detected_model_is_not_usable_until_installed() {
        let (conn, _) = db_with_product().await;
        let p = provider(&conn).await;
        sync_for_provider(&conn, p, &names(&["haiku"])).await.expect("sync");

        assert!(!is_installed(&conn, p, "haiku").await.expect("check"));

        set_result(&conn, p, "haiku", "installed", "packs/haiku", "{\"passed\":true}")
            .await
            .expect("install");
        assert!(is_installed(&conn, p, "haiku").await.expect("check"));
    }

    /// A model that fails validation stays refused — installation having *run*
    /// is not the same as installation having *succeeded*.
    #[tokio::test]
    async fn a_failed_installation_leaves_the_model_refused() {
        let (conn, _) = db_with_product().await;
        let p = provider(&conn).await;
        set_result(&conn, p, "haiku", "failed", "packs/haiku", "{\"passed\":false}")
            .await
            .expect("record failure");

        assert!(!is_installed(&conn, p, "haiku").await.expect("check"));
        let record = find(&conn, p, "haiku").await.expect("find").expect("exists");
        assert_eq!(record.state, "failed");
        assert_eq!(record.installed_at, None);
    }

    /// Re-validating an installed model that now fails must revoke it, not
    /// leave a stale pass in place.
    #[tokio::test]
    async fn a_re_validation_failure_revokes_a_previous_install() {
        let (conn, _) = db_with_product().await;
        let p = provider(&conn).await;
        set_result(&conn, p, "haiku", "installed", "packs/haiku", "{}").await.expect("install");
        assert!(is_installed(&conn, p, "haiku").await.expect("check"));

        set_result(&conn, p, "haiku", "failed", "packs/haiku", "{}").await.expect("fail");
        assert!(!is_installed(&conn, p, "haiku").await.expect("check"));
    }

    #[tokio::test]
    async fn the_first_detection_time_survives_reinstallation() {
        let (conn, _) = db_with_product().await;
        let p = provider(&conn).await;
        sync_for_provider(&conn, p, &names(&["haiku"])).await.expect("sync");
        let detected = find(&conn, p, "haiku").await.expect("find").unwrap().detected_at;

        set_result(&conn, p, "haiku", "installed", "packs/haiku", "{}").await.expect("install");
        let after = find(&conn, p, "haiku").await.expect("find").unwrap();
        assert_eq!(after.detected_at, detected);
        assert!(after.installed_at.is_some());
    }

    #[tokio::test]
    async fn state_and_report_are_validated() {
        let (conn, _) = db_with_product().await;
        let p = provider(&conn).await;
        assert!(set_result(&conn, p, "m", "vibes", "", "{}").await.is_err());
        assert!(set_result(&conn, p, "m", "installed", "", "{not json").await.is_err());
    }

    #[tokio::test]
    async fn models_are_tracked_per_provider() {
        let (conn, _) = db_with_product().await;
        let a = provider(&conn).await;
        let b = crate::db::ai_provider::add_of_kind(
            &conn, "Ollama", "http://localhost:11434", &["m"], "ollama", "ollama", false,
        )
        .await
        .expect("provider");

        sync_for_provider(&conn, a, &names(&["shared"])).await.expect("sync");
        let detected = sync_for_provider(&conn, b, &names(&["shared"])).await.expect("sync");
        assert_eq!(detected, vec!["shared"], "the same name on another provider is new");
    }
}
