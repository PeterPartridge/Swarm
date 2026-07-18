//! One entry point for generation, whichever provider the router chose.
//!
//! Callers pass the provider row and get drafts plus usage back; whether that
//! meant an HTTPS call with a key from the credential store or a local Ollama
//! process is this module's problem, not theirs. Keeping the dispatch here is
//! what let the handover feature land without touching the call sites.

use crate::ai::client::{Generated, Prompt, Usage};
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
        other => Err(format!(
            "provider '{}' has an unknown kind '{other}' — remove and re-add it in AI Settings",
            provider.name
        )),
    }
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

    /// An unknown kind must fail with an explanation rather than silently
    /// falling through to the metered path and spending money.
    #[tokio::test]
    async fn an_unknown_provider_kind_is_refused_by_name() {
        let prompt = Prompt {
            context: "c".into(),
            task: "t".into(),
        };
        let err = generate_stories(&provider("telepathy"), "m", "low", &prompt)
            .await
            .expect_err("must refuse");
        assert!(err.contains("unknown kind"), "got: {err}");
        assert!(err.contains("Mystery"), "the message should name the provider: {err}");
    }
}
