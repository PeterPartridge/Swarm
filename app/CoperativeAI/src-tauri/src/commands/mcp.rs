//! Switching the MCP server on, scoping it, and revoking it.
//!
//! **The listener is not here yet.** This round settles what is offered, the
//! token that guards it, and where that token lives; the thing that answers
//! requests is the next round. So `enabled` currently records an intention
//! rather than a running socket — which is exactly why the panel must not yet
//! claim the server is reachable, and why nothing here says it is.

use super::{to_message, AppDb};
use tauri::State;

/// Where the bearer token is filed in the OS credential store.
const TOKEN_ALIAS: &str = "coperativeai/mcp-server";

/// What is being offered. Never includes the token.
#[tauri::command]
pub async fn get_mcp_offering(
    db: State<'_, AppDb>,
) -> Result<crate::mcp::decide::Offering, String> {
    let conn = db.0.lock().await;
    crate::db::system_setting::mcp_offering(&conn)
        .await
        .map_err(to_message)
}

/// Changes what is offered.
///
/// **A token is made the first time this is switched on, and never silently
/// replaced after.** Regenerating it on every save would break every client
/// that had been configured, with nothing on screen explaining why — so
/// rotation is its own deliberate press.
#[tauri::command]
pub async fn set_mcp_offering(
    db: State<'_, AppDb>,
    mut offering: crate::mcp::decide::Offering,
) -> Result<crate::mcp::decide::Offering, String> {
    if offering.enabled && !crate::ai::keys::stored(TOKEN_ALIAS) {
        let token = crate::mcp::decide::new_token()?;
        crate::ai::keys::store(TOKEN_ALIAS, &token)?;
    }
    offering.token_alias = if offering.enabled { TOKEN_ALIAS.to_string() } else { String::new() };

    let conn = db.0.lock().await;
    crate::db::system_setting::set_mcp_offering(&conn, &offering)
        .await
        .map_err(to_message)?;
    Ok(offering)
}

/// The token, for putting into a client's configuration.
///
/// **A separate call from reading the setting**, so the token is fetched when
/// somebody asks to see it rather than travelling with every poll of the panel.
#[tauri::command]
pub async fn mcp_token(db: State<'_, AppDb>) -> Result<String, String> {
    let offering = {
        let conn = db.0.lock().await;
        crate::db::system_setting::mcp_offering(&conn)
            .await
            .map_err(to_message)?
    };
    if offering.token_alias.trim().is_empty() {
        return Err("there is no token yet — switch the server on first".into());
    }
    crate::ai::keys::read(&offering.token_alias)
}

/// Makes a new token, so every client configured with the old one stops.
///
/// **Revocation is the reason this exists.** Switching the server off stops it
/// answering while it is off; rotating is what makes a token that somebody
/// copied somewhere else useless for good.
#[tauri::command]
pub async fn rotate_mcp_token(db: State<'_, AppDb>) -> Result<String, String> {
    let token = crate::mcp::decide::new_token()?;
    crate::ai::keys::store(TOKEN_ALIAS, &token)?;

    // Written back so a setting that had no alias — one switched off, or from
    // before this existed — is consistent with a token now being present.
    let conn = db.0.lock().await;
    let mut offering = crate::db::system_setting::mcp_offering(&conn)
        .await
        .map_err(to_message)?;
    if offering.enabled {
        offering.token_alias = TOKEN_ALIAS.to_string();
        crate::db::system_setting::set_mcp_offering(&conn, &offering)
            .await
            .map_err(to_message)?;
    }
    Ok(token)
}

/// Forgets the token entirely.
///
/// Used when the server is switched off for good: leaving a usable credential
/// in the store for a server nobody is running is a key with no owner.
#[tauri::command]
pub async fn forget_mcp_token(db: State<'_, AppDb>) -> Result<(), String> {
    crate::ai::keys::delete(TOKEN_ALIAS)?;
    let conn = db.0.lock().await;
    let mut offering = crate::db::system_setting::mcp_offering(&conn)
        .await
        .map_err(to_message)?;
    offering.enabled = false;
    offering.token_alias = String::new();
    crate::db::system_setting::set_mcp_offering(&conn, &offering)
        .await
        .map_err(to_message)
}
