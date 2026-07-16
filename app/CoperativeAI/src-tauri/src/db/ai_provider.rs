//! The `AIProvider` model — see
//! application/claude-only/CoperativeAIdb/AIProvider-model.md.
//!
//! Security rule: the API key value never enters this table — only `keyAlias`,
//! the name of the entry in the OS credential store. Key storage itself lives
//! in the command layer (keyring), not here.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

#[derive(Debug, Clone, PartialEq)]
pub struct AiProvider {
    pub id: i64,
    pub name: String,
    pub api_base_url: String,
    pub models: Vec<String>,
    pub key_alias: String,
    pub created_at: i64,
}

pub async fn create_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_providers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            apiBaseUrl TEXT NOT NULL,
            models TEXT NOT NULL DEFAULT '[]',
            keyAlias TEXT NOT NULL UNIQUE,
            createdAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    Ok(())
}

pub async fn add(
    conn: &Connection,
    name: &str,
    api_base_url: &str,
    models: &[&str],
    key_alias: &str,
) -> Result<i64> {
    if name.trim().is_empty() || key_alias.trim().is_empty() {
        return Err(DbError::Validation(
            "a provider needs a name and a key alias".into(),
        ));
    }
    if !api_base_url.starts_with("https://") {
        return Err(DbError::Validation(format!(
            "apiBaseUrl must be an https URL, got '{api_base_url}'"
        )));
    }
    let models_json = serde_json::to_string(models).expect("models serialize");
    conn.execute(
        "INSERT INTO ai_providers (name, apiBaseUrl, models, keyAlias, createdAt)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        (name, api_base_url, models_json, key_alias, now_millis()),
    )
    .await?;
    last_insert_id(conn).await
}

pub async fn list_all(conn: &Connection) -> Result<Vec<AiProvider>> {
    let mut rows = conn
        .query(
            "SELECT id, name, apiBaseUrl, models, keyAlias, createdAt
             FROM ai_providers ORDER BY id",
            (),
        )
        .await?;
    let mut providers = Vec::new();
    while let Some(row) = rows.next().await? {
        providers.push(row_to_provider(row)?);
    }
    Ok(providers)
}

pub async fn find_by_id(conn: &Connection, id: i64) -> Result<Option<AiProvider>> {
    let mut rows = conn
        .query(
            "SELECT id, name, apiBaseUrl, models, keyAlias, createdAt
             FROM ai_providers WHERE id = ?1",
            (id,),
        )
        .await?;
    match rows.next().await? {
        Some(row) => Ok(Some(row_to_provider(row)?)),
        None => Ok(None),
    }
}

/// Removes a provider. Policies that named it are nulled out — never
/// silently switched to another provider (WorkItemPolicy invariant). The
/// caller (command layer) must also delete the credential-store entry for
/// the provider's keyAlias.
pub async fn remove(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "UPDATE work_item_policies SET providerId = NULL WHERE providerId = ?1",
        (id,),
    )
    .await?;
    conn.execute("DELETE FROM ai_providers WHERE id = ?1", (id,))
        .await?;
    Ok(())
}

fn row_to_provider(row: turso::Row) -> Result<AiProvider> {
    let models_json: String = row.get(3)?;
    Ok(AiProvider {
        id: row.get(0)?,
        name: row.get(1)?,
        api_base_url: row.get(2)?,
        models: serde_json::from_str(&models_json).unwrap_or_default(),
        key_alias: row.get(4)?,
        created_at: row.get(5)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{connect, create_all_tables};

    async fn test_db() -> Connection {
        let conn = connect(":memory:").await.expect("open in-memory db");
        create_all_tables(&conn).await.expect("create tables");
        conn
    }

    #[tokio::test]
    async fn added_provider_is_listed_with_its_models() {
        let conn = test_db().await;
        add(
            &conn,
            "Claude",
            "https://api.anthropic.com",
            &["claude-sonnet-5", "claude-fable-5"],
            "coperativeai/claude",
        )
        .await
        .expect("add");
        let providers = list_all(&conn).await.expect("list");
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].name, "Claude");
        assert_eq!(providers[0].models.len(), 2);
    }

    #[tokio::test]
    async fn non_https_url_is_rejected() {
        let conn = test_db().await;
        let result = add(&conn, "Claude", "http://api.anthropic.com", &[], "alias").await;
        assert!(matches!(result, Err(DbError::Validation(_))));
    }

    #[tokio::test]
    async fn name_and_key_alias_must_be_unique() {
        let conn = test_db().await;
        add(&conn, "Claude", "https://a.example", &[], "alias-1")
            .await
            .expect("add");
        assert!(add(&conn, "Claude", "https://b.example", &[], "alias-2")
            .await
            .is_err());
        assert!(add(&conn, "Other", "https://b.example", &[], "alias-1")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn no_column_ever_holds_a_key_value() {
        // The schema itself is the guard: the only key-related column is the
        // alias. Assert the table has exactly the specced columns.
        let conn = test_db().await;
        let mut rows = conn
            .query("SELECT name FROM pragma_table_info('ai_providers')", ())
            .await
            .expect("table info");
        let mut columns: Vec<String> = Vec::new();
        while let Some(row) = rows.next().await.expect("next") {
            columns.push(row.get(0).expect("column name"));
        }
        assert_eq!(
            columns,
            vec!["id", "name", "apiBaseUrl", "models", "keyAlias", "createdAt"]
        );
    }
}
