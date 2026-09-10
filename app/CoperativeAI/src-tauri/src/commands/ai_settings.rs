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
    pub kind: String,
    pub metered: bool,
}

fn to_dto(p: AiProvider) -> AiProviderDto {
    let key_stored = keys::stored(&p.key_alias);
    AiProviderDto {
        id: p.id,
        name: p.name,
        api_base_url: p.api_base_url,
        models: p.models,
        key_stored,
        kind: p.kind,
        metered: p.metered,
    }
}

/// Adds a local Ollama provider. No API key — it is a local process — and not
/// metered, which is what makes it a valid handover target when a budget runs
/// out. Models are read from the server so the user picks what is installed.
#[tauri::command]
pub async fn add_ollama_provider(
    db: State<'_, AppDb>,
    name: String,
    api_base_url: String,
) -> Result<i64, String> {
    let models = crate::ai::ollama::list_models(&api_base_url, None)
        .await
        // Now that hosted Ollama exists, the likeliest way to reach this error is
        // typing the hosted address into the free form. "401" alone would send
        // someone hunting a local server that was never the problem.
        .map_err(|e| {
            if e.contains("401") || e.contains("403") {
                format!(
                    "{api_base_url} refused an unauthenticated request — that looks like a \
                     hosted Ollama, which needs an API key. Add it with the hosted form instead; \
                     note it is metered."
                )
            } else {
                e
            }
        })?;
    if models.is_empty() {
        return Err(format!(
            "{api_base_url} is reachable but has no models pulled — run `ollama pull <model>` first"
        ));
    }
    let alias = format!("coperativeai/{}", name.trim().to_lowercase().replace(' ', "-"));
    let model_refs: Vec<&str> = models.iter().map(String::as_str).collect();
    let conn = db.0.lock().await;
    ai_provider::add_of_kind(
        &conn,
        &name,
        &api_base_url,
        &model_refs,
        &alias,
        "ollama",
        false,
    )
    .await
    .map_err(to_message)
}

/// Adds a hosted Ollama provider — Ollama's cloud rather than a local process.
///
/// Same kind as a local one, because the API is identical and only the bearer
/// token differs. What is *not* the same is the money: this is somebody else's
/// hardware being paid for, so it is stored **metered**, and every call goes
/// through the same budget gate and lands in the same ledger as Claude. Marking
/// it free because its sibling is free would let a Product spend past its budget
/// on a provider chosen precisely because the budget ran out.
///
/// Any free allowance the account has is not modelled: no API reports how much
/// of one is left, so the app would be guessing. Metered-from-the-first-call
/// overstates early spend rather than understating it — the safe direction when
/// the alternative is a budget that silently does nothing.
#[tauri::command]
pub async fn add_ollama_cloud_provider(
    db: State<'_, AppDb>,
    name: String,
    api_base_url: String,
    api_key: String,
) -> Result<i64, String> {
    if api_key.trim().is_empty() {
        return Err("a hosted Ollama needs an API key — a local one at http://localhost:11434 does not".into());
    }
    // Asked before the row exists, so a wrong key or URL is a refusal rather
    // than a provider that fails the first time real work depends on it.
    let models = crate::ai::ollama::list_models(&api_base_url, Some(&api_key)).await?;
    if models.is_empty() {
        return Err(format!("{api_base_url} answered but offered no models"));
    }

    let alias = format!("coperativeai/{}", name.trim().to_lowercase().replace(' ', "-"));
    let model_refs: Vec<&str> = models.iter().map(String::as_str).collect();
    let conn = db.0.lock().await;
    let id = ai_provider::add_of_kind(
        &conn,
        &name,
        &api_base_url,
        &model_refs,
        &alias,
        "ollama",
        true,
    )
    .await
    .map_err(to_message)?;
    // Same order as the Anthropic path: the row first, then the key, and the row
    // rolled back if the credential store refuses — so the two never disagree.
    if let Err(e) = keys::store(&alias, &api_key) {
        let _ = ai_provider::remove(&conn, id).await;
        return Err(e);
    }
    Ok(id)
}

/// The three models the Complexity setting names, in tier order.
async fn tier_models(conn: &turso::Connection) -> Result<Vec<String>, String> {
    Ok(crate::db::system_setting::claude_tiers(conn)
        .await
        .map_err(to_message)?
        .iter()
        .map(|t| t.model.clone())
        .collect())
}

/// What Claude does for each size of job — one setting for both ways of
/// reaching it.
///
/// Saving also writes the three models onto every Claude provider, because
/// that list is what the router indexes to pick a model. Deriving it here
/// keeps one source of truth: the setting is the answer, and the provider row
/// is a consequence of it rather than a second place to disagree.
#[tauri::command]
pub async fn get_claude_tiers(
    db: State<'_, AppDb>,
) -> Result<Vec<crate::db::system_setting::ClaudeTier>, String> {
    let conn = db.0.lock().await;
    crate::db::system_setting::claude_tiers(&conn)
        .await
        .map(|t| t.to_vec())
        .map_err(to_message)
}

#[tauri::command]
pub async fn set_claude_tiers(
    db: State<'_, AppDb>,
    tiers: Vec<crate::db::system_setting::ClaudeTier>,
) -> Result<(), String> {
    let three: crate::db::system_setting::ClaudeTiers = tiers
        .try_into()
        .map_err(|_| "there must be exactly three: low, medium and high".to_string())?;

    let conn = db.0.lock().await;
    crate::db::system_setting::set_claude_tiers(&conn, &three)
        .await
        .map_err(to_message)?;

    // The router picks a model by indexing the provider's own list, so the
    // setting is pushed out to every Claude provider rather than being read
    // in a second place at call time.
    let models: Vec<String> = three.iter().map(|t| t.model.clone()).collect();
    for provider in ai_provider::list_all(&conn).await.map_err(to_message)? {
        if provider.kind == "anthropic" || provider.kind == "claudeCode" {
            ai_provider::set_models(&conn, provider.id, &models)
                .await
                .map_err(to_message)?;
        }
    }
    Ok(())
}

/// Whether calls that cost money may be made at all.
///
/// Off until somebody says otherwise. A Claude plan and API credits are
/// separate purchases, so a person with the plan and no credits has no use for
/// a metered provider — and a fresh install should not be able to spend before
/// anyone has agreed it may.
#[tauri::command]
pub async fn get_paid_api_allowed(db: State<'_, AppDb>) -> Result<bool, String> {
    let conn = db.0.lock().await;
    crate::db::system_setting::paid_api_allowed(&conn)
        .await
        .map_err(to_message)
}

#[tauri::command]
pub async fn set_paid_api_allowed(db: State<'_, AppDb>, allowed: bool) -> Result<(), String> {
    let conn = db.0.lock().await;
    crate::db::system_setting::set_paid_api_allowed(&conn, allowed)
        .await
        .map_err(to_message)
}

/// Whether the `claude` CLI on this machine can run, for the setup steps.
///
/// Separate from `test_ai_provider` because the setup guide has to answer this
/// *before* a provider exists — the first step is installing it, and a check
/// that needed the thing it is checking for would be no use.
///
/// **It reports the sign-in too, and that turned out to be free.** This used to
/// say the sign-in could not be established without a real turn that spends plan
/// allowance — which was wrong, and wrong in the direction that hurt: `claude
/// --version` answers happily while the session is dead, so a panel that only
/// asked that showed a working install right up until the first real turn
/// failed. `claude auth status` answers directly, runs no model, and comes back
/// in about a second.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeStatus {
    pub installed: bool,
    /// What `claude --version` printed, when it ran.
    pub version: String,
    /// Which copy answered. Worth showing: the Claude desktop app keeps its own
    /// under `%APPDATA%` and npm puts different ones on the PATH, so "installed"
    /// is only half an answer without saying *which*.
    pub path: String,
    /// Why it did not, in words that say what to do next.
    pub problem: String,
    /// Whether it is signed in. **Installed and signed in are separate
    /// answers**, and a panel that runs them together is the reason an expired
    /// session looked like a healthy provider.
    pub signed_in: bool,
    /// How — a subscription, an API key, or nothing.
    pub auth_method: String,
}

/// The last answer, and when it was given.
///
/// **Because asking costs two seconds.** Answering this runs the CLI twice —
/// `--version`, then `auth status` — and each spawn of a 200 MB binary takes
/// most of a second. The build plan asks on every refresh, and a refresh
/// happens whenever anything about the work changes, so a panel that should
/// appear at once was waiting on the same two questions being asked again.
///
/// Thirty seconds, not forever: an install can break between one look and the
/// next — that has happened twice on this machine — and a cached "it is fine"
/// outliving the truth is worse than a slow answer. Anything that needs the
/// current state rather than the recent one passes `refresh`.
static LAST_PROBE: std::sync::Mutex<Option<(String, std::time::Instant, ClaudeCodeStatus)>> =
    std::sync::Mutex::new(None);

/// How long an answer about the CLI stays good enough to reuse.
const PROBE_FRESH: std::time::Duration = std::time::Duration::from_secs(30);

#[tauri::command]
pub async fn claude_code_status(
    executable: String,
    // Ask again rather than reusing the recent answer. The setup panel's Test
    // button means "find out now", and a cached refusal after somebody has just
    // fixed their install is the confusing half of caching.
    refresh: Option<bool>,
) -> Result<ClaudeCodeStatus, String> {
    if refresh != Some(true) {
        if let Ok(held) = LAST_PROBE.lock() {
            if let Some((exe, at, status)) = held.as_ref() {
                if exe == &executable && at.elapsed() < PROBE_FRESH {
                    return Ok(status.clone());
                }
            }
        }
    }

    let status = probe(&executable).await;
    if let Ok(mut held) = LAST_PROBE.lock() {
        *held = Some((executable, std::time::Instant::now(), status.clone()));
    }
    Ok(status)
}

async fn probe(executable: &str) -> ClaudeCodeStatus {
    match crate::ai::claude_code::discover(executable).await {
        Ok((path, version)) => {
            // Asked only once something is there to ask. A failure here is not
            // a failure of the panel: an older CLI may not know the subcommand,
            // and "installed, sign-in unknown" is still a useful answer.
            //
            // Asked *at the copy already found*, rather than by searching for
            // it again: discovery runs the binary, and running a 200 MB
            // executable twice to answer one question is a second nobody gets
            // back.
            let auth = crate::ai::claude_code::auth_status_at(&path).await.ok();
            ClaudeCodeStatus {
                installed: true,
                version,
                path: path.display().to_string(),
                problem: String::new(),
                signed_in: auth.as_ref().is_some_and(|a| a.logged_in),
                auth_method: auth.map(|a| a.auth_method).unwrap_or_default(),
            }
        }
        // Not an error: "it is not installed" is the answer to this question,
        // not a failure to answer it. A thrown error would make the guide show
        // a red alert where it should be showing step one.
        Err(problem) => ClaudeCodeStatus {
            installed: false,
            version: String::new(),
            path: String::new(),
            problem,
            signed_in: false,
            auth_method: String::new(),
        },
    }
}

/// Installs Claude Code, for the setup button.
///
/// Its own command rather than part of `add_claude_code_provider`, because
/// installing software on somebody's machine is a different kind of act from
/// writing a row, and the setup panel reports the two as separate steps.
#[tauri::command]
pub async fn install_claude_code() -> Result<String, String> {
    crate::ai::claude_code::install().await
}

/// Adds Claude via the `claude` CLI on this machine.
///
/// This is the provider for a Claude Pro or Max subscription and no API credits.
/// The subscription pays for the CLI; the Messages API bills credits against an
/// API key and cannot read a subscription — so with no credits, the metered
/// Anthropic provider simply will not work, and this one will.
///
/// No key is stored, because there is nothing to store: the CLI holds its own
/// sign-in. Not metered, for the reason spelled out in `ai::claude_code` — the
/// plan's allowance is charged where this app cannot see it, and inventing a
/// figure would put money in the ledger that nobody actually spent per call.
///
/// `executable` is a path for installs that are not on `PATH`; empty means
/// `claude`. It is checked before the row is written, so a typo is a refusal
/// rather than a provider that fails on first use.
#[tauri::command]
pub async fn add_claude_code_provider(
    db: State<'_, AppDb>,
    name: String,
    executable: String,
) -> Result<i64, String> {
    crate::ai::claude_code::version(&executable).await?;

    let alias = format!("coperativeai/{}", name.trim().to_lowercase().replace(' ', "-"));
    let conn = db.0.lock().await;
    let models = tier_models(&conn).await?;
    let model_refs: Vec<&str> = models.iter().map(String::as_str).collect();
    ai_provider::add_of_kind(
        &conn,
        &name,
        executable.trim(),
        &model_refs,
        &alias,
        "claudeCode",
        false,
    )
    .await
    .map_err(to_message)
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
    api_key: String,
) -> Result<i64, String> {
    if api_key.trim().is_empty() {
        return Err("an API key is required".into());
    }
    let alias = format!("coperativeai/{}", name.trim().to_lowercase().replace(' ', "-"));
    let conn = db.0.lock().await;
    // Which models this provider offers is the Complexity setting's answer, not
    // a second one collected here — two places to say it is two places to
    // disagree.
    let models = tier_models(&conn).await?;
    let model_refs: Vec<&str> = models.iter().map(String::as_str).collect();
    let id = ai_provider::add(&conn, &name, &api_base_url, &model_refs, &alias)
        .await
        .map_err(to_message)?;
    // Key goes to the OS credential store only after the row is valid; if
    // storing fails, roll the row back so DB and store stay consistent.
    if let Err(e) = keys::store(&alias, &api_key) {
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
    keys::delete(&provider.key_alias)?;
    ai_provider::remove(&conn, id).await.map_err(to_message)
}

#[tauri::command]
pub async fn test_ai_provider(db: State<'_, AppDb>, id: i64) -> Result<String, String> {
    let (kind, base_url, key_alias, model) = {
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
        (provider.kind, provider.api_base_url, provider.key_alias, model)
    };

    // A local provider has no key and speaks a different protocol. Testing it
    // through the Anthropic client fetches a key that was never stored and
    // fails demanding one — which reads as "Ollama wants an API key" when it
    // does not. Reaching its model list is the honest test: it proves the
    // server is up and the chosen model is actually pulled.
    if kind == "ollama" {
        // Hosted Ollama needs its bearer token even to list models; a local one
        // has no key stored and must not be asked for one.
        let key = if keys::stored(&key_alias) {
            Some(keys::read(&key_alias)?)
        } else {
            None
        };
        let installed = crate::ai::ollama::list_models(&base_url, key.as_deref()).await?;
        return if installed.iter().any(|m| m == &model) {
            Ok(format!("Connection OK — {model} is pulled and ready"))
        } else {
            Err(format!(
                "Reached Ollama at {base_url}, but '{model}' is not pulled. Run `ollama pull {model}`."
            ))
        };
    }

    // The CLI has no endpoint and no key, so there is no connection to test —
    // only whether it is installed and runnable. Saying so, rather than
    // reporting "Connection OK", keeps the Test button from implying it proved
    // the sign-in as well; a real turn would prove that, and would spend plan
    // allowance on every press.
    if kind == "claudeCode" {
        let version = crate::ai::claude_code::version(&base_url).await?;
        return Ok(format!(
            "Claude Code is installed ({version}). It runs on your own subscription, \
             so nothing here is billed to API credits — and this check cannot tell \
             whether you are signed in. If a call fails, run `claude` in a terminal once."
        ));
    }

    let key = keys::read(&key_alias)?;
    client::test_connection(&base_url, &key, &model).await?;
    Ok(format!("Connection OK ({model})"))
}

/// The three ways an agent can be run, for the picker in Admin.
#[tauri::command]
pub fn agent_run_modes() -> Vec<(String, String)> {
    crate::agent::handover::RUN_MODES
        .iter()
        .map(|(id, label)| ((*id).to_string(), (*label).to_string()))
        .collect()
}

/// What this machine can actually offer, mode by mode.
///
/// **Asked for, never volunteered.** It runs two external tools and a cold WSL
/// answers in seconds, so it happens when somebody opens the panel or presses
/// "check again" — not on every render, and not on a timer. Nothing is
/// remembered between calls either: the configuration underneath can be changed
/// outside this app, and a remembered answer is a claim about a machine that
/// has moved on.
#[tauri::command]
pub async fn sandbox_report(
    db: State<'_, AppDb>,
) -> Result<crate::tooling::sandbox::Report, String> {
    let chosen = {
        let conn = db.0.lock().await;
        crate::db::system_setting::agent_sandbox(&conn)
            .await
            .map_err(to_message)?
    };
    // The lock is released first: both of these shell out, and holding the
    // database while a virtual machine boots would freeze the whole app.
    let (wsl, docker) = tokio::join!(
        crate::tooling::sandbox_detect::wsl(),
        crate::tooling::sandbox_detect::docker()
    );
    Ok(crate::tooling::sandbox::report(&chosen, &wsl, &docker))
}

/// Builds the boundary a mode needs — the one thing here that changes this
/// machine.
///
/// **Detection runs again first, deliberately.** The panel's report is a
/// moment old and the machine may have moved on: a distribution created in a
/// terminal, an engine started, WSL updated. Planning from what is true now is
/// what makes pressing this twice safe — an existing distribution gets
/// configured rather than made again.
#[tauri::command]
pub async fn set_up_sandbox(
    mode: String,
) -> Result<crate::tooling::sandbox_provision::Provisioned, String> {
    match crate::tooling::sandbox::Mode::from_setting(&mode) {
        crate::tooling::sandbox::Mode::Wsl => {
            let found = crate::tooling::sandbox_detect::wsl().await;
            Ok(crate::tooling::sandbox_provision::provision_wsl(&found).await)
        }
        crate::tooling::sandbox::Mode::Docker => {
            let found = crate::tooling::sandbox_detect::docker().await;
            Ok(crate::tooling::sandbox_provision::provision_docker(&found).await)
        }
        crate::tooling::sandbox::Mode::Off => {
            Err("there is nothing to set up for running on this machine".into())
        }
    }
}

#[tauri::command]
pub async fn get_agent_run_mode(db: State<'_, AppDb>) -> Result<String, String> {
    let conn = db.0.lock().await;
    crate::db::system_setting::agent_run_mode(&conn)
        .await
        .map_err(to_message)
}

/// **A deliberate press, not a default that arrives with an update.** "Never
/// ask" hands a shell the run of the machine; the option says so in the words
/// the flag uses, and the setting is somebody choosing it.
#[tauri::command]
pub async fn set_agent_run_mode(db: State<'_, AppDb>, mode: String) -> Result<(), String> {
    let conn = db.0.lock().await;
    crate::db::system_setting::set_agent_run_mode(&conn, &mode)
        .await
        .map_err(to_message)
}
