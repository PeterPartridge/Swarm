//! Ollama client — a locally hosted model server, used as the handover target
//! when a Product's AI budget runs out.
//!
//! Differences from the Claude client that matter here: no API key (it is a
//! local process), structured output is requested via a top-level `format`
//! holding the JSON schema rather than `output_config`, and token counts come
//! back as `prompt_eval_count` / `eval_count`. Cost is always zero — nothing
//! leaves the machine.

use crate::ai::client::{parse_stories, Prompt, StoryDraft, Usage};
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;

#[derive(Deserialize)]
struct ChatResponse {
    #[serde(default)]
    message: ChatMessage,
    #[serde(default)]
    prompt_eval_count: i64,
    #[serde(default)]
    eval_count: i64,
}

#[derive(Deserialize, Default)]
struct ChatMessage {
    #[serde(default)]
    content: String,
}

#[derive(Deserialize)]
struct TagsResponse {
    #[serde(default)]
    models: Vec<TagEntry>,
}

#[derive(Deserialize)]
struct TagEntry {
    name: String,
}

/// Local calls can be slow on modest hardware — a small model on CPU may take
/// minutes, so this timeout is deliberately far longer than the API client's.
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("could not build the HTTP client: {e}"))
}

/// The JSON schema Ollama is asked to conform to — the same shape the Claude
/// path requests, so `parse_stories` handles both responses unchanged.
pub fn story_schema() -> serde_json::Value {
    json!({
        "type": "object",
        "properties": {
            "stories": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "description": {"type": "string"}
                    },
                    "required": ["title", "description"]
                }
            }
        },
        "required": ["stories"]
    })
}

/// The POST /api/chat request body (pure — unit tested without a server).
pub fn chat_body(model: &str, prompt: &Prompt) -> serde_json::Value {
    json!({
        "model": model,
        "stream": false,
        "format": story_schema(),
        "messages": [
            // Sent as two messages mirroring the cached split on the Claude
            // side, so both providers see the same content in the same order.
            {"role": "user", "content": prompt.context},
            {"role": "user", "content": prompt.task}
        ]
    })
}

/// Generates drafts from a local model. Returns the same pair as the Claude
/// client so callers do not care which backend ran.
pub async fn generate_stories(
    api_base_url: &str,
    model: &str,
    prompt: &Prompt,
) -> Result<(Vec<StoryDraft>, Usage), String> {
    let url = format!("{}/api/chat", api_base_url.trim_end_matches('/'));
    let response = client()?
        .post(&url)
        .json(&chat_body(model, prompt))
        .send()
        .await
        .map_err(|e| {
            format!("could not reach Ollama at {api_base_url} — is it running? ({e})")
        })?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("could not read Ollama's response: {e}"))?;
    if !status.is_success() {
        return Err(format!("Ollama returned an error ({status}): {text}"));
    }

    let parsed: ChatResponse = serde_json::from_str(&text)
        .map_err(|e| format!("unexpected response shape from Ollama: {e}"))?;
    let drafts = parse_stories(&parsed.message.content)?;
    Ok((
        drafts,
        Usage {
            input_tokens: parsed.prompt_eval_count,
            output_tokens: parsed.eval_count,
            // A local model has no prompt cache to read from or write to.
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
        },
    ))
}

/// Lists the models the local server has pulled — used by AI Settings so the
/// user picks from what is actually installed rather than typing a guess.
pub async fn list_models(api_base_url: &str) -> Result<Vec<String>, String> {
    let url = format!("{}/api/tags", api_base_url.trim_end_matches('/'));
    let response = client()?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("could not reach Ollama at {api_base_url} — is it running? ({e})"))?;
    if !response.status().is_success() {
        return Err(format!("Ollama returned an error ({})", response.status()));
    }
    let text = response
        .text()
        .await
        .map_err(|e| format!("could not read Ollama's response: {e}"))?;
    let parsed: TagsResponse = serde_json::from_str(&text)
        .map_err(|e| format!("unexpected response shape from Ollama: {e}"))?;
    Ok(parsed.models.into_iter().map(|m| m.name).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prompt() -> Prompt {
        Prompt {
            context: "Product: Shop App".into(),
            task: "Feature: Checkout".into(),
        }
    }

    #[test]
    fn chat_body_asks_for_structured_output_without_streaming() {
        let body = chat_body("llama3", &prompt());
        assert_eq!(body["model"], "llama3");
        assert_eq!(body["stream"], false);
        assert_eq!(body["format"]["required"][0], "stories");
    }

    #[test]
    fn chat_body_sends_context_before_task() {
        let body = chat_body("llama3", &prompt());
        assert_eq!(body["messages"][0]["content"], "Product: Shop App");
        assert_eq!(body["messages"][1]["content"], "Feature: Checkout");
    }

    #[test]
    fn token_counts_are_read_from_ollamas_field_names() {
        let parsed: ChatResponse = serde_json::from_str(
            r#"{"message":{"content":"{}"},"prompt_eval_count":120,"eval_count":45}"#,
        )
        .expect("parse");
        assert_eq!(parsed.prompt_eval_count, 120);
        assert_eq!(parsed.eval_count, 45);
    }

    #[test]
    fn a_response_without_counts_defaults_to_zero_rather_than_failing() {
        let parsed: ChatResponse =
            serde_json::from_str(r#"{"message":{"content":"{}"}}"#).expect("parse");
        assert_eq!(parsed.prompt_eval_count, 0);
        assert_eq!(parsed.eval_count, 0);
    }

    /// Ollama returns the JSON as a string in `message.content`, so the shared
    /// parser must handle it exactly as it handles Claude's text block.
    #[test]
    fn the_shared_parser_reads_an_ollama_content_string() {
        let content = r#"{"stories":[{"title":"As a shopper...","description":"One page."}]}"#;
        let drafts = parse_stories(content).expect("parse");
        assert_eq!(drafts.len(), 1);
    }

    /// Live check against a local server. Ignored by default because it needs
    /// Ollama running with a model pulled:
    ///
    /// ```text
    /// ollama serve & ollama pull llama3
    /// OLLAMA_MODEL=llama3 cargo test -- --ignored ollama_is_live
    /// ```
    #[tokio::test]
    #[ignore = "needs a local Ollama server with a model pulled"]
    async fn ollama_is_live_and_returns_parseable_work() {
        let base = std::env::var("OLLAMA_URL").unwrap_or_else(|_| "http://localhost:11434".into());
        let model = std::env::var("OLLAMA_MODEL").unwrap_or_else(|_| "llama3".into());

        let installed = list_models(&base).await.expect("list models");
        println!("installed models: {installed:?}");
        assert!(!installed.is_empty(), "no models pulled on the local server");

        let prompt = Prompt {
            context: "Product: Shop App. A small online shop selling coffee.".into(),
            task: "Deliverable: MVP launch\n\nBreak this into 3 features. Each: a short \
                   title and a one-sentence description of what done looks like."
                .into(),
        };
        let (drafts, usage) = generate_stories(&base, &model, &prompt)
            .await
            .expect("generate");
        println!("drafts: {drafts:?}");
        println!("usage: in={} out={}", usage.input_tokens, usage.output_tokens);
        assert!(!drafts.is_empty());
        assert!(usage.output_tokens > 0, "the server should report eval_count");
    }
}
