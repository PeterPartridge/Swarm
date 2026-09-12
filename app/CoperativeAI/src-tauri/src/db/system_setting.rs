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
pub async fn planning_hierarchy(conn: &Connection) -> Result<Vec<String>> {
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

/// How many AI calls may be in flight at once.
///
/// One by default: the safe answer, and the one that keeps a local Ollama model
/// from thrashing — it serves a request at a time regardless. Raising it is a
/// deliberate decision about spend and load, which is why it sits in Admin
/// beside the budget rather than being guessed from the hardware.
pub const AI_CONCURRENCY_KEY: &str = "aiConcurrency";
pub const AI_CONCURRENCY_DEFAULT: i64 = 1;
/// Eight is past the point where any provider stays happy, and far past where a
/// budget is still meaningfully checked between calls.
pub const AI_CONCURRENCY_MAX: i64 = 8;

/// Whether calls that cost money may be made at all.
///
/// **Off by default, which is the whole point.** A Claude plan and API credits
/// are separate purchases, and somebody with the plan and no credits has no use
/// for a metered provider — every call it makes fails, and every prompt asking
/// them to set one up is noise. Defaulting to off also means a fresh install
/// cannot spend anything before a person has said it may.
///
/// It governs *every* metered provider, not only Claude's API: a hosted Ollama
/// bills for somebody else's hardware just as surely. Turning it on is the
/// deliberate act that opts into being charged.
pub const API_USAGE_KEY: &str = "allowPaidApiCalls";
const AGENT_RUN_MODE_KEY: &str = "agentRunMode";

/// How much the agent stops to ask — see `agent::handover::RUN_MODES`.
///
/// **Defaults to the middle one, not to Claude Code's default.** This app
/// exists to hand work to agents, and an agent that asks before writing a file
/// in the checkout it was made for is asking about the one thing it was sent
/// there to do. It still stops for everything that is not an edit.
pub async fn agent_run_mode(conn: &Connection) -> Result<String> {
    Ok(match get(conn, AGENT_RUN_MODE_KEY).await? {
        Some(json) => serde_json::from_str::<String>(&json).unwrap_or_else(|_| "acceptEdits".into()),
        None => "acceptEdits".into(),
    })
}

pub async fn set_agent_run_mode(conn: &Connection, mode: &str) -> Result<()> {
    if !crate::agent::handover::RUN_MODES.iter().any(|(id, _)| *id == mode) {
        let ids: Vec<&str> = crate::agent::handover::RUN_MODES.iter().map(|(id, _)| *id).collect();
        return Err(crate::db::DbError::Validation(format!(
            "run mode must be one of {ids:?}, got '{mode}'"
        )));
    }
    let json = serde_json::to_string(mode).expect("string serialize");
    set(conn, AGENT_RUN_MODE_KEY, &json).await
}

const AGENT_SANDBOX_KEY: &str = "agentSandbox";

/// Where commands run on somebody's behalf actually run — see
/// `tooling::sandbox::SANDBOXES`.
///
/// **Defaults to off, and stays off until somebody says otherwise.** The other
/// two need something installed and configured on the machine; arriving with an
/// update and quietly moving where an agent runs would break work that was
/// running perfectly well. It is the setting beside this one — how much the
/// agent stops to ask — that this exists to make defensible, and the two are
/// pressed separately on purpose.
pub async fn agent_sandbox(conn: &Connection) -> Result<String> {
    Ok(match get(conn, AGENT_SANDBOX_KEY).await? {
        Some(json) => serde_json::from_str::<String>(&json).unwrap_or_else(|_| "off".into()),
        None => "off".into(),
    })
}

pub async fn set_agent_sandbox(conn: &Connection, mode: &str) -> Result<()> {
    if !crate::tooling::sandbox::SANDBOXES.iter().any(|(id, _)| *id == mode) {
        let ids: Vec<&str> = crate::tooling::sandbox::SANDBOXES.iter().map(|(id, _)| *id).collect();
        return Err(crate::db::DbError::Validation(format!(
            "sandbox must be one of {ids:?}, got '{mode}'"
        )));
    }
    let json = serde_json::to_string(mode).expect("string serialize");
    set(conn, AGENT_SANDBOX_KEY, &json).await
}

const AGENT_POLICY_KEY: &str = "agentPolicySource";

/// Where an agent policy comes from, what installs it, and where it lands.
///
/// **Three fields rather than one path, because fetching and running are two
/// different acts.** The first says where to get it, the second what to do with
/// it once it is here, and the third where "here" is — and separating them is
/// what lets the thing be read before it is run, which is the only safeguard
/// there is against a policy somebody else wrote.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPolicySource {
    /// A URL, or a path to a file on this machine. Empty means no policy.
    pub from: String,
    /// The command that installs it, run where the agent will run.
    pub command: String,
    /// The folder it is downloaded into.
    pub folder: String,
    /// The SHA-256 it is expected to have, or empty for "whatever arrives".
    ///
    /// **Defaulted, because it was added after sources were already saved.**
    /// Without this a stored source from before the field existed would fail to
    /// parse, and the parse failure is swallowed into a default — so somebody's
    /// policy source would quietly empty itself on upgrade.
    #[serde(default)]
    pub expect_digest: String,
}

pub async fn agent_policy_source(conn: &Connection) -> Result<AgentPolicySource> {
    Ok(match get(conn, AGENT_POLICY_KEY).await? {
        Some(json) => serde_json::from_str(&json).unwrap_or_default(),
        None => AgentPolicySource::default(),
    })
}

/// **Refused rather than stored when it cannot be honoured.** A source that is
/// neither a URL nor a file on this machine is a setting that will fail at the
/// worst moment — when a run is starting — instead of here, where somebody is
/// looking at it.
pub async fn set_agent_policy_source(
    conn: &Connection,
    source: &AgentPolicySource,
) -> Result<()> {
    let from = source.from.trim();
    if !from.is_empty() {
        let is_url = from.starts_with("https://") || from.starts_with("http://");
        if is_url {
            // **https, because this is fetched and then run.** A policy served
            // over plain http is one anybody on the path can rewrite, and the
            // thing they would be rewriting runs as root inside the boundary.
            if !from.starts_with("https://") {
                return Err(crate::db::DbError::Validation(
                    "a policy is fetched and then run, so it has to come over https".into(),
                ));
            }
        } else if !std::path::Path::new(from).is_file() {
            return Err(crate::db::DbError::Validation(format!(
                "'{from}' is neither an https address nor a file on this machine"
            )));
        }
        if source.folder.trim().is_empty() {
            return Err(crate::db::DbError::Validation(
                "say which folder it should be downloaded into".into(),
            ));
        }
        // **A mistyped digest and a changed policy must not arrive as the same
        // message.** One of them is somebody's thumb; the other is the thing
        // this whole mechanism exists to catch, and they would be indis-
        // tinguishable if a typo were allowed to be stored and fail at fetch.
        let expected = source.expect_digest.trim();
        if !expected.is_empty() && !crate::tooling::sandbox_policy::is_digest(expected) {
            return Err(crate::db::DbError::Validation(
                "a digest is 64 hexadecimal characters — that is not one, so it was not stored"
                    .into(),
            ));
        }
        // **A branch is refused unless a digest pins it.** What is fetched runs
        // as root inside the boundary, and a branch means "whatever that points
        // at when the button is next pressed" — which is a different file from
        // the one somebody read, on whatever day its author chooses.
        if expected.is_empty() {
            if let Some(moving) = crate::tooling::sandbox_policy::moving_github_ref(from) {
                return Err(crate::db::DbError::Validation(format!(
                    "'{moving}' is a branch, and this is fetched and run as root — so it would be \
                     whatever that branch points at next, not what you read. Put the commit id in \
                     the address instead of '{moving}', or fetch it once and pin its digest."
                )));
            }
        }
    }
    let json = serde_json::to_string(source).expect("struct serialize");
    set(conn, AGENT_POLICY_KEY, &json).await
}

const AGENT_POLICY_INSTALLED_KEY: &str = "agentPolicyInstalled";

/// The policy script that was last run into the boundary.
///
/// **A separate thing from the Solution's `policy.json`, and recorded
/// separately because blurring the two would be a lie about cause.** The
/// Solution's file is a deny list read on every run and enforced by whichever
/// boundary is in force. This is an imperative script, app-wide, run as root
/// into the WSL distribution by a press in Admin — it produces no deny list and
/// under Docker it never runs at all. What bounded a run and what was once
/// installed into the distribution are different claims, and a run's record has
/// to keep them apart.
///
/// **What was run, never what is still in force.** Nothing here watches the
/// distribution afterwards. Somebody with root inside it can undo every
/// permission this set, and re-running set-up rewrites the user and the run
/// space. So this says a script ran, when, and which one — and the panel says
/// exactly that, rather than "the policy is applied".
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPolicy {
    /// Where the script came from. Empty means none has ever been run.
    pub from: String,
    /// The SHA-256 of what actually ran.
    pub digest: String,
    /// The boundary it was run into — only ever `wsl` today.
    pub mode: String,
    /// When it ran, in milliseconds since the epoch.
    pub at: i64,
}

pub async fn installed_policy(conn: &Connection) -> Result<InstalledPolicy> {
    Ok(match get(conn, AGENT_POLICY_INSTALLED_KEY).await? {
        Some(json) => serde_json::from_str(&json).unwrap_or_default(),
        None => InstalledPolicy::default(),
    })
}

pub async fn set_installed_policy(conn: &Connection, ran: &InstalledPolicy) -> Result<()> {
    let json = serde_json::to_string(ran).expect("struct serialize");
    set(conn, AGENT_POLICY_INSTALLED_KEY, &json).await
}

/// Forgets what was installed, because the boundary it was installed into is
/// being built again.
///
/// **Cleared rather than left to age.** Set-up rewrites the agent user and the
/// run space, which is where a policy script does its work — so a record kept
/// across it would go on naming a script whose effects may no longer exist.
/// A blank record says "nothing was run into this boundary", which is the one
/// thing that stays true.
pub async fn forget_installed_policy(conn: &Connection) -> Result<()> {
    set(conn, AGENT_POLICY_INSTALLED_KEY, "").await
}

const MCP_SERVER_KEY: &str = "mcpServer";

/// What the MCP server is offering, as stored.
///
/// **The token is not in here, and that is the point of `tokenAlias`.** This
/// struct is written to the database; the bearer token goes to the OS
/// credential store like every other key in this app, and only the name it is
/// filed under is kept alongside the rest of the setting.
pub async fn mcp_offering(conn: &Connection) -> Result<crate::mcp::decide::Offering> {
    Ok(match get(conn, MCP_SERVER_KEY).await? {
        // A stored value that cannot be parsed reads as "offering nothing",
        // which is the same as a fresh install — the safe direction, since the
        // alternative is a half-read setting that serves something.
        Some(json) => serde_json::from_str(&json).unwrap_or_default(),
        None => crate::mcp::decide::Offering::default(),
    })
}

pub async fn set_mcp_offering(
    conn: &Connection,
    offering: &crate::mcp::decide::Offering,
) -> Result<()> {
    if offering.enabled {
        // **Refused here rather than at the moment somebody connects.** A
        // server switched on with nothing to check against would admit the
        // first caller to guess an empty token.
        if offering.token_alias.trim().is_empty() {
            return Err(crate::db::DbError::Validation(
                "this server cannot be switched on without a token".into(),
            ));
        }
        if offering.port < 1024 {
            return Err(crate::db::DbError::Validation(
                "choose a port above 1023 — the low ones need privileges this app does not have \
                 and should not want"
                    .into(),
            ));
        }
    }
    let json = serde_json::to_string(offering).expect("struct serialize");
    set(conn, MCP_SERVER_KEY, &json).await
}

pub async fn paid_api_allowed(conn: &Connection) -> Result<bool> {
    Ok(match get(conn, API_USAGE_KEY).await? {
        Some(json) => serde_json::from_str::<bool>(&json).unwrap_or(false),
        None => false,
    })
}

pub async fn set_paid_api_allowed(conn: &Connection, allowed: bool) -> Result<()> {
    let json = serde_json::to_string(&allowed).expect("bool serialize");
    set(conn, API_USAGE_KEY, &json).await
}

/// What Claude does for each size of job: which model, and how hard it thinks.
///
/// **One setting, not one per provider.** A Claude API provider and Claude Code
/// on a plan are two ways of reaching the same models, so asking for the choice
/// twice invited them to drift apart — and nobody wants "high complexity" to
/// mean one thing through the API and another through the plan.
///
/// Complexity comes from the work item; this says what to do about it. Keeping
/// the two apart is the point: a work item's author knows the job is hard, and
/// this page decides what "hard" costs.
pub const CLAUDE_TIERS_KEY: &str = "claudeTiers";

/// The efforts Claude accepts, cheapest first. Fixed rather than free text: a
/// typo in `output_config.effort` fails the call rather than degrading.
///
/// **This list was wrong, and the app was the poorer for it.** It held three,
/// so "high" was the most this app could ever ask for — while every model it
/// offers goes two levels further. `xhigh` and `max` are not new inventions
/// here: they are what `--effort` lists and what the Messages API documents.
/// Not every model takes every level, which is [`crate::ai::effort`]'s job.
pub const EFFORTS: &[&str] = &["low", "medium", "high", "xhigh", "max"];

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ClaudeTier {
    pub model: String,
    pub effort: String,
}

/// One per complexity, in `work_item_policy::EFFORT_TIERS` order.
pub type ClaudeTiers = [ClaudeTier; 3];

/// The Project brief's own answer, used until somebody changes it: Sonnet for
/// small and everyday work, Fable for architecture and complex UI.
pub fn default_claude_tiers() -> ClaudeTiers {
    [
        ClaudeTier { model: "claude-sonnet-5".into(), effort: "low".into() },
        ClaudeTier { model: "claude-sonnet-5".into(), effort: "medium".into() },
        // `xhigh`, not `high`, on Anthropic's own recommendation: xhigh is the
        // documented starting point for coding and agentic work, which is
        // exactly what this row is for — architecture and cross-file change.
        // It costs meaningfully more than high, which is why it is the top row
        // alone and why the setting sits in front of you rather than in here.
        ClaudeTier { model: "claude-fable-5".into(), effort: "xhigh".into() },
    ]
}

pub async fn claude_tiers(conn: &Connection) -> Result<ClaudeTiers> {
    Ok(match get(conn, CLAUDE_TIERS_KEY).await? {
        // A stored value that will not parse is treated as unset rather than
        // fatal: the defaults work, and refusing to run over a bad settings row
        // would be a worse failure than quietly using them.
        Some(json) => tiers_from_json(&json),
        None => default_claude_tiers(),
    })
}

/// Reads a stored value, keeping whatever of it still fits.
///
/// **Read as a list, not a fixed array.** This briefly stored six rows, and
/// parsing straight into `[ClaudeTier; 3]` would reject that outright — losing
/// models somebody chose, silently, to a change of mind about how many rows
/// there are. A value that will not parse at all falls back to the defaults
/// rather than being fatal: refusing to run over one settings row would be the
/// worse failure.
fn tiers_from_json(json: &str) -> ClaudeTiers {
    let Ok(stored) = serde_json::from_str::<Vec<ClaudeTier>>(json) else {
        return default_claude_tiers();
    };
    let mut tiers = default_claude_tiers();
    for (slot, kept) in tiers.iter_mut().zip(stored) {
        *slot = kept;
    }
    tiers
}

pub async fn set_claude_tiers(conn: &Connection, tiers: &ClaudeTiers) -> Result<()> {
    for tier in tiers {
        if tier.model.trim().is_empty() {
            return Err(DbError::Validation("every complexity needs a model".into()));
        }
        if !EFFORTS.contains(&tier.effort.as_str()) {
            return Err(DbError::Validation(format!(
                "effort must be one of {EFFORTS:?}, got '{}'",
                tier.effort
            )));
        }
    }
    let json = serde_json::to_string(tiers).expect("tiers serialize");
    set(conn, CLAUDE_TIERS_KEY, &json).await
}

/// The model and effort for one complexity.
///
/// An unknown word is treated as `low` — the cautious choice, and the same rule
/// `ai::tiering` already uses for a tier it does not recognise.
pub fn tier_for(tiers: &ClaudeTiers, complexity: &str) -> ClaudeTier {
    let index = crate::db::work_item_policy::EFFORT_TIERS
        .iter()
        .position(|t| *t == complexity)
        .unwrap_or(0);
    tiers[index.min(tiers.len() - 1)].clone()
}

pub async fn ai_concurrency(conn: &Connection) -> Result<i64> {
    let raw = match get(conn, AI_CONCURRENCY_KEY).await? {
        Some(json) => serde_json::from_str::<i64>(&json).unwrap_or(AI_CONCURRENCY_DEFAULT),
        None => AI_CONCURRENCY_DEFAULT,
    };
    // Clamped on read as well as write: a value edited into the database by
    // hand must not be able to open a hundred connections.
    Ok(raw.clamp(1, AI_CONCURRENCY_MAX))
}

pub async fn set_ai_concurrency(conn: &Connection, limit: i64) -> Result<()> {
    if !(1..=AI_CONCURRENCY_MAX).contains(&limit) {
        return Err(DbError::Validation(format!(
            "how many at once must be between 1 and {AI_CONCURRENCY_MAX}, got {limit}"
        )));
    }
    let json = serde_json::to_string(&limit).expect("limit serialize");
    set(conn, AI_CONCURRENCY_KEY, &json).await
}

pub async fn roadmap_mode(conn: &Connection) -> Result<String> {
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

    /// **The six-row shape must not cost somebody their models.** This briefly
    /// stored six tiers; parsing straight into a three-slot array would reject
    /// that whole value and silently fall back to defaults.
    #[test]
    fn a_stored_six_row_value_keeps_its_first_three() {
        let stored = serde_json::to_string(&vec![
            ClaudeTier { model: "mine-1".into(), effort: "low".into() },
            ClaudeTier { model: "mine-2".into(), effort: "medium".into() },
            ClaudeTier { model: "mine-3".into(), effort: "max".into() },
            ClaudeTier { model: "dropped".into(), effort: "high".into() },
            ClaudeTier { model: "dropped".into(), effort: "high".into() },
            ClaudeTier { model: "dropped".into(), effort: "high".into() },
        ])
        .unwrap();

        let tiers = tiers_from_json(&stored);
        assert_eq!(tiers[0].model, "mine-1");
        assert_eq!(tiers[2].model, "mine-3");
        assert_eq!(tiers[2].effort, "max");
    }

    /// A value too short fills the rest from the defaults rather than failing.
    #[test]
    fn a_short_stored_value_is_topped_up_from_the_defaults() {
        let stored = r#"[{"model":"mine","effort":"low"}]"#;
        let tiers = tiers_from_json(stored);
        assert_eq!(tiers[0].model, "mine");
        assert_eq!(tiers[2], default_claude_tiers()[2]);
    }

    /// Nonsense in the settings row must not stop the app running.
    #[test]
    fn an_unreadable_stored_value_falls_back_to_the_defaults() {
        assert_eq!(tiers_from_json("not json at all"), default_claude_tiers());
    }

    /// **The two levels the app could not previously ask for.** A save has to
    /// accept them, or the ceiling is merely moved from the form to the check.
    #[tokio::test]
    async fn the_top_two_efforts_can_be_saved() {
        let conn = test_db().await;
        let mut tiers = default_claude_tiers();
        tiers[2].effort = "max".into();
        tiers[1].effort = "xhigh".into();

        set_claude_tiers(&conn, &tiers).await.expect("xhigh and max are real levels");
        let read = claude_tiers(&conn).await.unwrap();
        assert_eq!(read[2].effort, "max");
        assert_eq!(read[1].effort, "xhigh");
    }

    /// …but a word that is not a level still has to be refused, or a typo
    /// becomes a failed call much later somewhere else.
    #[tokio::test]
    async fn a_word_that_is_not_an_effort_is_refused() {
        let conn = test_db().await;
        let mut tiers = default_claude_tiers();
        tiers[2].effort = "ultra".into();
        assert!(set_claude_tiers(&conn, &tiers).await.is_err());
    }

    async fn test_db() -> Connection {
        let conn = connect(":memory:").await.expect("open in-memory db");
        create_table(&conn).await.expect("create table");
        conn
    }

    /// A fresh install runs where it always did, and says so by name rather
    /// than by an empty value somebody has to interpret.
    #[tokio::test]
    async fn a_machine_that_has_never_chosen_runs_where_it_always_did() {
        let conn = test_db().await;
        assert_eq!(agent_sandbox(&conn).await.expect("get"), "off");
    }

    #[tokio::test]
    async fn a_chosen_sandbox_is_kept_and_a_made_up_one_is_refused() {
        let conn = test_db().await;
        set_agent_sandbox(&conn, "docker").await.expect("docker is one of the three");
        assert_eq!(agent_sandbox(&conn).await.expect("get"), "docker");

        assert!(
            set_agent_sandbox(&conn, "chroot").await.is_err(),
            "a name the app cannot honour must be refused where it is written, not where it runs"
        );
        assert_eq!(
            agent_sandbox(&conn).await.expect("get"),
            "docker",
            "a refused write must leave the previous choice alone"
        );
    }

    #[tokio::test]
    async fn unset_hierarchy_falls_back_to_the_default_preset() {
        let conn = test_db().await;
        let hierarchy = planning_hierarchy(&conn).await.expect("get");
        assert_eq!(hierarchy, vec!["epic", "feature", "userStory", "task"]);
        assert_eq!(roadmap_mode(&conn).await.expect("get"), "sprints");
    }

    #[tokio::test]
    async fn only_the_three_presets_are_accepted() {
        let conn = test_db().await;
        let valid: Vec<String> = ["feature", "task"].iter().map(|s| s.to_string()).collect();
        set_planning_hierarchy(&conn, &valid).await.expect("valid preset");
        assert_eq!(planning_hierarchy(&conn).await.expect("get"), valid);

        let invalid: Vec<String> = ["task", "epic"].iter().map(|s| s.to_string()).collect();
        assert!(set_planning_hierarchy(&conn, &invalid).await.is_err());
    }

    #[tokio::test]
    async fn roadmap_mode_is_validated_and_persisted() {
        let conn = test_db().await;
        set_roadmap_mode(&conn, "kanban").await.expect("valid mode");
        assert_eq!(roadmap_mode(&conn).await.expect("get"), "kanban");
        assert!(set_roadmap_mode(&conn, "gantt").await.is_err());
    }

    #[tokio::test]
    async fn non_json_values_are_rejected() {
        let conn = test_db().await;
        assert!(set(&conn, "anything", "{not json").await.is_err());
    }
}
