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
    pub detected_at: i64,
    pub installed_at: Option<i64>,
}

const SELECT: &str = "SELECT id, providerId, model, state, packPath, validationReport, detectedAt, installedAt FROM model_installs";

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS model_installs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            providerId INTEGER NOT NULL,
            model TEXT NOT NULL,
            state TEXT NOT NULL DEFAULT 'detected',
            packPath TEXT NOT NULL DEFAULT '',
            validationReport TEXT NOT NULL DEFAULT '{}',
            detectedAt INTEGER NOT NULL,
            installedAt INTEGER,
            UNIQUE(providerId, model)
        )",
        (),
    )
    .await?;
    Ok(())
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
        detected_at: row.get(6)?,
        installed_at: row.get(7)?,
    })
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
