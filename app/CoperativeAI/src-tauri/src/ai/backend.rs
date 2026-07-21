//! One entry point for generation, whichever provider the router chose.
//!
//! Callers pass the provider row and get drafts plus usage back; whether that
//! meant an HTTPS call with a key from the credential store or a local Ollama
//! process is this module's problem, not theirs. Keeping the dispatch here is
//! what let the handover feature land without touching the call sites.

use crate::ai::client::{
    Generated, GeneratedChangePlan, GeneratedDesign, GeneratedDiagram, GeneratedPal,
    GeneratedStrategy, Prompt, Usage,
};
use crate::ai::{client, keys, ollama};
use crate::db::ai_provider::AiProvider;

/// Generates work items from a prompt using the given provider.
///
/// The key is fetched here rather than by the caller so that a local provider,
/// which has no key, does not force every call site to know that.
pub async fn generate_stories(
    provider: &AiProvider,
    model: &str,
    effort: &str,
    prompt: &Prompt,
) -> Result<(Generated, Usage), String> {
    match provider.kind.as_str() {
        "ollama" => ollama::generate_stories(&provider.api_base_url, model, prompt).await,
        "anthropic" => {
            let api_key = keys::get_key(&provider.key_alias)?;
            client::generate_stories(&provider.api_base_url, &api_key, model, effort, prompt).await
        }
        other => Err(unknown_kind(provider, other)),
    }
}

/// Generates a solution strategy, whichever provider the router chose.
///
/// This dispatch is why a budget handover mid-design works: without it the
/// request went out in the metered provider's shape regardless of who was
/// actually running it, so a Product past its handover threshold could not
/// design anything.
pub async fn generate_solution_strategy(
    provider: &AiProvider,
    model: &str,
    effort: &str,
    prompt: &Prompt,
) -> Result<(GeneratedStrategy, Usage), String> {
    match provider.kind.as_str() {
        "ollama" => ollama::generate_solution_strategy(&provider.api_base_url, model, prompt).await,
        "anthropic" => {
            let api_key = keys::get_key(&provider.key_alias)?;
            client::generate_solution_strategy(&provider.api_base_url, &api_key, model, effort, prompt)
                .await
        }
        other => Err(unknown_kind(provider, other)),
    }
}

/// Generates design or marketing work, whichever provider the router chose.
/// Dispatched by kind for the same reason as strategy: a Product past its
/// handover threshold must still be able to do design work.
pub async fn generate_design(
    provider: &AiProvider,
    model: &str,
    effort: &str,
    prompt: &Prompt,
) -> Result<(GeneratedDesign, Usage), String> {
    match provider.kind.as_str() {
        "ollama" => ollama::generate_design(&provider.api_base_url, model, prompt).await,
        "anthropic" => {
            let api_key = keys::get_key(&provider.key_alias)?;
            client::generate_design(&provider.api_base_url, &api_key, model, effort, prompt).await
        }
        other => Err(unknown_kind(provider, other)),
    }
}

/// Generates an architecture document, whichever provider the router chose.
pub async fn generate_diagram(
    provider: &AiProvider,
    model: &str,
    effort: &str,
    prompt: &Prompt,
    format: &str,
) -> Result<(GeneratedDiagram, Usage), String> {
    match provider.kind.as_str() {
        "ollama" => ollama::generate_diagram(&provider.api_base_url, model, prompt, format).await,
        "anthropic" => {
            let api_key = keys::get_key(&provider.key_alias)?;
            client::generate_diagram(&provider.api_base_url, &api_key, model, effort, prompt, format)
                .await
        }
        other => Err(unknown_kind(provider, other)),
    }
}

/// The coding pal, whichever provider the router chose. Dispatched by kind for
/// the same reason as everything else: a Product past its handover threshold
/// still gets a pal, just a local one.
pub async fn generate_pal(
    provider: &AiProvider,
    model: &str,
    effort: &str,
    prompt: &Prompt,
) -> Result<(GeneratedPal, Usage), String> {
    match provider.kind.as_str() {
        "ollama" => ollama::generate_pal(&provider.api_base_url, model, prompt).await,
        "anthropic" => {
            let api_key = keys::get_key(&provider.key_alias)?;
            client::generate_pal(&provider.api_base_url, &api_key, model, effort, prompt).await
        }
        other => Err(unknown_kind(provider, other)),
    }
}

/// Generates a work item's change plan, whichever provider the router chose.
pub async fn generate_change_plan(
    provider: &AiProvider,
    model: &str,
    effort: &str,
    prompt: &Prompt,
) -> Result<(GeneratedChangePlan, Usage), String> {
    match provider.kind.as_str() {
        "ollama" => ollama::generate_change_plan(&provider.api_base_url, model, prompt).await,
        "anthropic" => {
            let api_key = keys::get_key(&provider.key_alias)?;
            client::generate_change_plan(&provider.api_base_url, &api_key, model, effort, prompt)
                .await
        }
        other => Err(unknown_kind(provider, other)),
    }
}

fn unknown_kind(provider: &AiProvider, kind: &str) -> String {
    format!(
        "provider '{}' has an unknown kind '{kind}' — remove and re-add it in AI Settings",
        provider.name
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider(kind: &str) -> AiProvider {
        AiProvider {
            id: 1,
            name: "Mystery".into(),
            api_base_url: "https://example.invalid".into(),
            models: vec!["m".into()],
            key_alias: "alias".into(),
            kind: kind.into(),
            metered: true,
            created_at: 0,
        }
    }

    fn prompt() -> Prompt {
        Prompt {
            context: "c".into(),
            task: "t".into(),
        }
    }

    /// An unknown kind must fail with an explanation rather than silently
    /// falling through to the metered path and spending money.
    #[tokio::test]
    async fn an_unknown_provider_kind_is_refused_by_name() {
        let err = generate_stories(&provider("telepathy"), "m", "low", &prompt())
            .await
            .expect_err("must refuse");
        assert!(err.contains("unknown kind"), "got: {err}");
        assert!(err.contains("Mystery"), "the message should name the provider: {err}");
    }

    /// Both generations must dispatch on kind. Strategy generation originally
    /// called the Claude client unconditionally, so a budget handover sent
    /// Claude's body to Ollama's URL and a Product past its threshold could not
    /// design anything. Refusing an unknown kind on *both* paths is the cheap
    /// proof that neither is hard-wired to one provider.
    #[tokio::test]
    async fn strategy_generation_dispatches_on_kind_too() {
        let err = generate_solution_strategy(&provider("telepathy"), "m", "low", &prompt())
            .await
            .expect_err("must refuse");
        assert!(err.contains("unknown kind"), "got: {err}");
    }

    /// A local provider must not be asked for a key. `get_key` would fail for
    /// an alias that was never stored, so reaching the network at all proves
    /// the Ollama branch was taken.
    #[tokio::test]
    async fn a_local_provider_is_never_asked_for_a_key() {
        let mut local = provider("ollama");
        local.api_base_url = "http://127.0.0.1:1".into(); // nothing listening
        local.key_alias = "never-stored".into();

        for err in [
            generate_stories(&local, "m", "low", &prompt()).await.expect_err("no server"),
            generate_solution_strategy(&local, "m", "low", &prompt()).await.expect_err("no server"),
        ] {
            assert!(
                err.contains("could not reach Ollama"),
                "should have failed reaching the server, not fetching a key: {err}"
            );
        }
    }
}
