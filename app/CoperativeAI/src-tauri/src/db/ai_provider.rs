//! The `AIProvider` model — see
//! application/claude-only/CoperativeAIdb/AIProvider-model.md.
//!
//! Security rule: the API key value never enters this table — only `keyAlias`,
//! the name of the entry in the OS credential store. Key storage itself lives
//! in the command layer (keyring), not here.

use crate::db::{now_millis, solution_management::last_insert_id, DbError, Result};
use turso::Connection;

/// `anthropic` speaks the Messages API over HTTPS with a key; `ollama` is a
/// local model server with no key and no per-token cost.
pub const KINDS: &[&str] = &["anthropic", "ollama"];

#[derive(Debug, Clone, PartialEq)]
pub struct AiProvider {
    pub id: i64,
    pub name: String,
    pub api_base_url: String,
    pub models: Vec<String>,
    pub key_alias: String,
    pub kind: String,
    /// Whether calls to this provider cost money. A local model is not metered,
    /// which is what makes it a valid handover target when a budget runs out.
    pub metered: bool,
    pub created_at: i64,
}

const SELECT: &str =
    "SELECT id, name, apiBaseUrl, models, keyAlias, kind, metered, createdAt FROM ai_providers";

pub async fn create_table(conn: &Connection) -> Result<()> {
    // Round-2 migration: add kind/metered. Pre-release → drop & recreate when
    // the round-1 table (no `kind`) is present.
    let mut columns: Vec<String> = Vec::new();
    {
        let mut rows = conn
            .query("SELECT name FROM pragma_table_info('ai_providers')", ())
            .await?;
        while let Some(row) = rows.next().await? {
            columns.push(row.get(0)?);
        }
    }
    if !columns.is_empty() && !columns.iter().any(|c| c == "kind") {
        conn.execute("DROP TABLE ai_providers", ()).await?;
    }

    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_providers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            apiBaseUrl TEXT NOT NULL,
            models TEXT NOT NULL DEFAULT '[]',
            keyAlias TEXT NOT NULL UNIQUE,
            kind TEXT NOT NULL DEFAULT 'anthropic',
            metered INTEGER NOT NULL DEFAULT 1,
            createdAt INTEGER NOT NULL
        )",
        (),
    )
    .await?;
    Ok(())
}

/// Only a local Ollama server may be reached over plain HTTP, and only on the
/// loopback address — a remote http:// endpoint would send prompts in clear
/// text across a network, so the https rule still holds for everything else.
fn check_base_url(api_base_url: &str, kind: &str) -> Result<()> {
    if api_base_url.starts_with("https://") {
        return Ok(());
    }
    let loopback = api_base_url.starts_with("http://localhost")
        || api_base_url.starts_with("http://127.0.0.1");
    if kind == "ollama" && loopback {
        return Ok(());
    }
    Err(DbError::Validation(format!(
        "apiBaseUrl must be an https URL (only a local Ollama server may use http://localhost), got '{api_base_url}'"
    )))
}

/// Adds a metered Anthropic provider — the common case.
pub async fn add(
    conn: &Connection,
    name: &str,
    api_base_url: &str,
    models: &[&str],
    key_alias: &str,
) -> Result<i64> {
    add_of_kind(conn, name, api_base_url, models, key_alias, "anthropic", true).await
}

#[allow(clippy::too_many_arguments)]
pub async fn add_of_kind(
    conn: &Connection,
    name: &str,
    api_base_url: &str,
    models: &[&str],
    key_alias: &str,
    kind: &str,
    metered: bool,
) -> Result<i64> {
    if name.trim().is_empty() || key_alias.trim().is_empty() {
        return Err(DbError::Validation(
            "a provider needs a name and a key alias".into(),
        ));
    }
    if !KINDS.contains(&kind) {
        return Err(DbError::Validation(format!(
            "kind must be one of {KINDS:?}, got '{kind}'"
        )));
    }
    check_base_url(api_base_url, kind)?;
    let models_json = serde_json::to_string(models).expect("models serialize");
    conn.execute(
        "INSERT INTO ai_providers (name, apiBaseUrl, models, keyAlias, kind, metered, createdAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        (
            name,
            api_base_url,
            models_json,
            key_alias,
            kind,
            metered as i64,
            now_millis(),
        ),
    )
    .await?;
    last_insert_id(conn).await
}

pub async fn list_all(conn: &Connection) -> Result<Vec<AiProvider>> {
    let mut rows = conn.query(&format!("{SELECT} ORDER BY id"), ()).await?;
    let mut providers = Vec::new();
    while let Some(row) = rows.next().await? {
        providers.push(row_to_provider(row)?);
    }
    Ok(providers)
}

pub async fn find_by_id(conn: &Connection, id: i64) -> Result<Option<AiProvider>> {
    let mut rows = conn.query(&format!("{SELECT} WHERE id = ?1"), (id,)).await?;
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
    let metered: i64 = row.get(6)?;
    Ok(AiProvider {
        id: row.get(0)?,
        name: row.get(1)?,
        api_base_url: row.get(2)?,
        models: serde_json::from_str(&models_json).unwrap_or_default(),
        key_alias: row.get(4)?,
        kind: row.get(5)?,
        metered: metered != 0,
        created_at: row.get(7)?,
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
            vec![
                "id",
                "name",
                "apiBaseUrl",
                "models",
                "keyAlias",
                "kind",
                "metered",
                "createdAt"
            ]
        );
    }

    #[tokio::test]
    async fn a_provider_defaults_to_a_metered_anthropic_endpoint() {
        let conn = test_db().await;
        let id = add(&conn, "Claude", "https://api.anthropic.com", &["m"], "alias")
            .await
            .expect("add");
        let provider = find_by_id(&conn, id).await.expect("find").expect("exists");
        assert_eq!(provider.kind, "anthropic");
        assert!(provider.metered);
    }

    /// A local Ollama server has no TLS, so it is the one allowed exception —
    /// and only on loopback, never a remote http:// host.
    #[tokio::test]
    async fn only_a_local_ollama_may_use_plain_http() {
        let conn = test_db().await;
        add_of_kind(&conn, "Ollama", "http://localhost:11434", &["llama3"], "ollama", "ollama", false)
            .await
            .expect("localhost ollama is allowed");
        add_of_kind(&conn, "Ollama2", "http://127.0.0.1:11434", &["llama3"], "ollama-2", "ollama", false)
            .await
            .expect("loopback ip is allowed");

        // a remote http endpoint would put prompts on the wire in clear text
        assert!(add_of_kind(&conn, "Remote", "http://example.com", &[], "remote", "ollama", false)
            .await
            .is_err());
        // and the exception does not extend to the metered API
        assert!(add_of_kind(&conn, "Claude2", "http://localhost:8080", &[], "c2", "anthropic", true)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn kind_is_validated() {
        let conn = test_db().await;
        assert!(add_of_kind(&conn, "X", "https://a.example", &[], "x", "telepathy", true)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn an_unmetered_provider_round_trips() {
        let conn = test_db().await;
        let id = add_of_kind(&conn, "Ollama", "http://localhost:11434", &["llama3"], "ollama", "ollama", false)
            .await
            .expect("add");
        let provider = find_by_id(&conn, id).await.expect("find").expect("exists");
        assert!(!provider.metered, "a local model costs nothing to call");
        assert_eq!(provider.kind, "ollama");
    }
}
