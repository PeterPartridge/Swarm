//! AI Settings commands: providers with OS-credential-store keys.
//! The key value exists only between the UI form, this command, and the
//! credential store — the database gets an alias (db::ai_provider rule).

use super::{to_message, AppDb};
use crate::ai::{client, keys};
use crate::db::ai_provider::{self, AiProvider};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderDto {
    pub id: i64,
    pub name: String,
    pub api_base_url: String,
    pub models: Vec<String>,
    pub key_stored: bool,
}

fn to_dto(p: AiProvider) -> AiProviderDto {
    let key_stored = keys::key_stored(&p.key_alias);
    AiProviderDto {
        id: p.id,
        name: p.name,
        api_base_url: p.api_base_url,
        models: p.models,
        key_stored,
    }
}

#[tauri::command]
pub async fn list_ai_providers(db: State<'_, AppDb>) -> Result<Vec<AiProviderDto>, String> {
    let conn = db.0.lock().await;
    let providers = ai_provider::list_all(&conn).await.map_err(to_message)?;
    Ok(providers.into_iter().map(to_dto).collect())
}

#[tauri::command]
pub async fn add_ai_provider(
    db: State<'_, AppDb>,
    name: String,
    api_base_url: String,
    models: Vec<String>,
    api_key: String,
) -> Result<i64, String> {
    if api_key.trim().is_empty() {
        return Err("an API key is required".into());
    }
    let alias = format!("coperativeai/{}", name.trim().to_lowercase().replace(' ', "-"));
    let conn = db.0.lock().await;
    let model_refs: Vec<&str> = models.iter().map(String::as_str).collect();
    let id = ai_provider::add(&conn, &name, &api_base_url, &model_refs, &alias)
        .await
        .map_err(to_message)?;
    // Key goes to the OS credential store only after the row is valid; if
    // storing fails, roll the row back so DB and store stay consistent.
    if let Err(e) = keys::store_key(&alias, &api_key) {
        let _ = ai_provider::remove(&conn, id).await;
        return Err(e);
    }
    Ok(id)
}

#[tauri::command]
pub async fn remove_ai_provider(db: State<'_, AppDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    let Some(provider) = ai_provider::find_by_id(&conn, id).await.map_err(to_message)? else {
        return Err(format!("no AI provider with id {id}"));
    };
    keys::delete_key(&provider.key_alias)?;
    ai_provider::remove(&conn, id).await.map_err(to_message)
}

#[tauri::command]
pub async fn test_ai_provider(db: State<'_, AppDb>, id: i64) -> Result<String, String> {
    let (base_url, key, model) = {
        let conn = db.0.lock().await;
        let Some(provider) = ai_provider::find_by_id(&conn, id).await.map_err(to_message)?
        else {
            return Err(format!("no AI provider with id {id}"));
        };
        let model = provider
            .models
            .first()
            .cloned()
            .ok_or_else(|| "this provider has no models configured".to_string())?;
        let key = keys::get_key(&provider.key_alias)?;
        (provider.api_base_url, key, model)
    };
    client::test_connection(&base_url, &key, &model).await?;
    Ok(format!("Connection OK ({model})"))
}
