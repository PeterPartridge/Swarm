//! Which AI runs each area's work — Main and Secondary, per area.
//!
//! **The missing half of a feature that was already half there.** The routing
//! table has existed for a while and nothing ever wrote to it from the UI, so
//! every area fell back to whatever the permitting policy happened to name.
//! That is why "I can't select a model" was a true statement about an app that
//! already had a table for the answer.
//!
//! **A cell is a platform, not a provider row.** Somebody setting this up wants
//! to say "Develop uses Claude Code" — not to create a provider, remember its
//! name, and then point an area at it. So each cell takes a platform and the
//! fields that platform needs, and this module finds or makes the provider row
//! behind it. Six cells can therefore share one provider rather than making six
//! identical ones, which is what happens if each cell insists on its own.

use super::{to_message, AppDb};
use crate::db::{ai_provider, routing_default};
use serde::Serialize;
use tauri::State;

/// The platforms a cell can be set to.
///
/// **Three, not two, because "Ollama" is two different decisions.** A local
/// server costs nothing and needs a URL; the hosted one costs money and needs a
/// key. Collapsing them into one option would hide the only difference that
/// matters, which is the bill.
const PLATFORMS: &[&str] = &["claudeCode", "ollamaLocal", "ollamaCloud"];

/// What one cell holds.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AreaProviderDto {
    pub area: String,
    pub slot: String,
    /// The platform, or `"none"` — which is the honest state of a cell nobody
    /// has set, and the default for every Secondary.
    pub platform: String,
    pub provider_id: Option<i64>,
    pub provider_name: String,
    pub api_base_url: String,
    /// Whether using this cell spends money. Shown, never inferred by the page.
    pub metered: bool,
    pub models: Vec<String>,
}

/// Which platform an existing provider row represents.
///
/// **A row that matches nothing known is reported as itself rather than as
/// `none`.** Saying "not set" about a provider somebody is being billed for
/// would be the worst kind of wrong.
fn platform_of(provider: &ai_provider::AiProvider) -> String {
    match (provider.kind.as_str(), provider.metered) {
        ("claudeCode", _) => "claudeCode".into(),
        ("ollama", true) => "ollamaCloud".into(),
        ("ollama", false) => "ollamaLocal".into(),
        (other, _) => other.into(),
    }
}

/// All six cells, always — set or not.
///
/// **Every cell is returned even when empty.** A page that only received the
/// configured ones would have to invent the shape of the grid, and an area
/// missing from a list reads as an area that does not exist rather than one
/// nobody has set.
#[tauri::command]
pub async fn get_ai_routing(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Vec<AreaProviderDto>, String> {
    let conn = db.0.lock().await;
    let providers = ai_provider::list_all(&conn).await.map_err(to_message)?;

    let mut cells = Vec::with_capacity(routing_default::AREAS.len() * routing_default::SLOTS.len());
    for area in routing_default::AREAS {
        for slot in routing_default::SLOTS {
            let set = routing_default::for_slot(&conn, product_id, area, slot)
                .await
                .map_err(to_message)?;
            let provider = set
                .as_ref()
                .and_then(|r| r.provider_id)
                .and_then(|id| providers.iter().find(|p| p.id == id));
            cells.push(match provider {
                Some(p) => AreaProviderDto {
                    area: (*area).into(),
                    slot: (*slot).into(),
                    platform: platform_of(p),
                    provider_id: Some(p.id),
                    provider_name: p.name.clone(),
                    api_base_url: p.api_base_url.clone(),
                    metered: p.metered,
                    models: p.models.clone(),
                },
                // Either nothing is set, or something is set that names a
                // provider which has since been deleted. Both are "not set" to
                // a reader, and the second must not render as a live cell.
                None => AreaProviderDto {
                    area: (*area).into(),
                    slot: (*slot).into(),
                    platform: "none".into(),
                    provider_id: None,
                    provider_name: String::new(),
                    api_base_url: String::new(),
                    metered: false,
                    models: Vec::new(),
                },
            });
        }
    }
    Ok(cells)
}

/// Points one cell at a platform, making the provider row if it is needed.
///
/// **Found before it is made.** Six cells pointing at the same local Ollama
/// should be one provider row, not six — otherwise the providers list fills up
/// with duplicates nobody created on purpose, and the ledger reports the same
/// server under six names.
#[tauri::command]
pub async fn set_area_provider(
    db: State<'_, AppDb>,
    product_id: i64,
    area: String,
    slot: String,
    platform: String,
    api_base_url: String,
    api_key: String,
) -> Result<i64, String> {
    if !PLATFORMS.contains(&platform.as_str()) {
        return Err(format!("'{platform}' is not a platform this app can set up"));
    }
    let url = api_base_url.trim().to_string();

    let (kind, metered, needs_key, label) = match platform.as_str() {
        // **No URL and no key.** Claude Code is the signed-in plan; asking for
        // either would be asking for something that does not exist.
        "claudeCode" => ("claudeCode", false, false, "Claude Code (my plan)"),
        "ollamaLocal" => ("ollama", false, false, "Ollama (local)"),
        "ollamaCloud" => ("ollama", true, true, "Ollama Cloud"),
        other => return Err(format!("'{other}' is not a platform this app can set up")),
    };

    if kind == "ollama" && url.is_empty() {
        return Err("an Ollama server needs an address".into());
    }
    if needs_key && api_key.trim().is_empty() {
        return Err(
            "the hosted Ollama needs an API key — a local server at http://localhost:11434 does not"
                .into(),
        );
    }

    // The models have to come from somewhere real. Asking the server is also
    // what proves the address and the key before a row exists to be wrong.
    let models: Vec<String> = if kind == "ollama" {
        let key = if needs_key { Some(api_key.trim()) } else { None };
        let found = crate::ai::ollama::list_models(&url, key).await?;
        if found.is_empty() {
            return Err(format!(
                "{url} answered but offered no models — pull one first, or check the address"
            ));
        }
        found
    } else {
        // Claude Code's three are the tiers the Complexity setting names, which
        // is the one place they are decided.
        let conn = db.0.lock().await;
        crate::db::system_setting::claude_tiers(&conn)
            .await
            .map_err(to_message)?
            .iter()
            .map(|t| t.model.clone())
            .collect()
    };

    let conn = db.0.lock().await;
    let existing = ai_provider::list_all(&conn).await.map_err(to_message)?;
    let matching = existing
        .iter()
        .find(|p| p.kind == kind && p.api_base_url == url && p.metered == metered);

    let provider_id = match matching {
        Some(p) => {
            // Re-read rather than left alone: a server that has had a model
            // pulled since this provider was added should show it.
            ai_provider::set_models(&conn, p.id, &models)
                .await
                .map_err(to_message)?;
            p.id
        }
        None => {
            let alias = format!(
                "coperativeai/{}",
                label.to_lowercase().replace([' ', '(', ')'], "-")
            );
            let refs: Vec<&str> = models.iter().map(String::as_str).collect();
            let id = ai_provider::add_of_kind(&conn, label, &url, &refs, &alias, kind, metered)
                .await
                .map_err(to_message)?;
            // Same order as every other provider in this app: the row first,
            // then the key, and the row removed if the credential store refuses
            // — so the two never disagree.
            if needs_key {
                if let Err(e) = crate::ai::keys::store(&alias, api_key.trim()) {
                    let _ = ai_provider::remove(&conn, id).await;
                    return Err(e);
                }
            }
            id
        }
    };

    // The effort tier stays at the area's existing choice, or `low` for a cell
    // being set for the first time. **This page is not where effort is decided**
    // — the work item's own effort level is, which is the whole point of having
    // tiers at all.
    let effort = routing_default::for_slot(&conn, product_id, &area, &slot)
        .await
        .map_err(to_message)?
        .map(|r| r.effort_tier)
        .unwrap_or_else(|| "low".to_string());

    routing_default::set_default(&conn, product_id, &area, &slot, Some(provider_id), &effort)
        .await
        .map_err(to_message)?;
    Ok(provider_id)
}

/// Empties one cell.
///
/// **The provider row is left alone.** Another cell may point at it, and
/// deleting a provider because one area stopped using it would take the others
/// down with it. Clearing a cell is a statement about the cell.
#[tauri::command]
pub async fn clear_area_provider(
    db: State<'_, AppDb>,
    product_id: i64,
    area: String,
    slot: String,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    routing_default::clear(&conn, product_id, &area, &slot)
        .await
        .map_err(to_message)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A provider row that matches nothing known is still reported as itself.
    /// Calling a provider somebody is billed for "not set" is the worst
    /// available wrong answer.
    #[test]
    fn a_provider_is_named_by_the_platform_it_is() {
        let make = |kind: &str, metered: bool| ai_provider::AiProvider {
            id: 1,
            name: "x".into(),
            api_base_url: String::new(),
            models: vec![],
            key_alias: "a".into(),
            kind: kind.into(),
            metered,
            created_at: 0,
        };
        assert_eq!(platform_of(&make("claudeCode", false)), "claudeCode");
        assert_eq!(platform_of(&make("ollama", false)), "ollamaLocal");
        assert_eq!(platform_of(&make("ollama", true)), "ollamaCloud");
        // Not one of the three the page offers, so it reports as what it is
        // rather than as nothing.
        assert_eq!(platform_of(&make("anthropic", true)), "anthropic");
    }

    /// The three the page offers, and nothing else.
    #[test]
    fn only_the_platforms_this_app_can_set_up_are_accepted() {
        assert!(PLATFORMS.contains(&"claudeCode"));
        assert!(PLATFORMS.contains(&"ollamaLocal"));
        assert!(PLATFORMS.contains(&"ollamaCloud"));
        assert_eq!(PLATFORMS.len(), 3);
        // `none` is a state a cell can be in, never a platform to set it to —
        // clearing is its own command.
        assert!(!PLATFORMS.contains(&"none"));
    }
}
