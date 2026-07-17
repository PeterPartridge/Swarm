//! Claude Messages API client (raw HTTP — no official Rust SDK).
//! Request shape per the Claude API reference: POST {base}/v1/messages with
//! x-api-key + anthropic-version headers; structured outputs via
//! output_config.format (json_schema) so story generation returns
//! guaranteed-parseable JSON; stop_reason "refusal" is handled before
//! reading content.

use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct StoryDraft {
    pub title: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Deserialize)]
struct ApiResponse {
    #[serde(default)]
    content: Vec<ContentBlock>,
    #[serde(default)]
    stop_reason: Option<String>,
}

#[derive(Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    #[serde(default)]
    text: String,
}

#[derive(Deserialize)]
struct ApiError {
    error: ApiErrorBody,
}

#[derive(Deserialize)]
struct ApiErrorBody {
    message: String,
}

/// Builds the user-story prompt from the feature and its Product context
/// (pure — unit tested).
pub fn build_story_prompt(
    product_name: &str,
    product_answers: &str,
    feature_title: &str,
    feature_description: Option<&str>,
    solutions: &[(String, String, String)], // (name, solutionType, answers JSON)
) -> String {
    let mut prompt = format!(
        "You are helping a product team plan work. Write user stories for the feature below.\n\n\
         Product: {product_name}\nProduct brief answers (JSON): {product_answers}\n\n\
         Feature: {feature_title}\n"
    );
    if let Some(description) = feature_description {
        if !description.trim().is_empty() {
            prompt.push_str(&format!("Feature description: {description}\n"));
        }
    }
    if solutions.is_empty() {
        prompt.push_str("\nNo solutions are linked to this Product yet.\n");
    } else {
        prompt.push_str("\nConnected solutions (the systems this feature touches):\n");
        for (name, solution_type, answers) in solutions {
            prompt.push_str(&format!("- {name} ({solution_type}): {answers}\n"));
        }
    }
    prompt.push_str(
        "\nWrite 3-6 user stories covering this feature across the connected solutions. \
         Each story: a title in classic user-story form (\"As a <user>, I want <goal> so that <benefit>\") \
         and a one-to-three sentence description of what done looks like.",
    );
    prompt
}

/// Parses the structured-output JSON into story drafts (pure — unit tested).
pub fn parse_stories(text: &str) -> Result<Vec<StoryDraft>, String> {
    let value: Value = serde_json::from_str(text)
        .map_err(|e| format!("the AI response was not valid JSON: {e}"))?;
    let stories = value
        .get("stories")
        .and_then(|s| s.as_array())
        .ok_or_else(|| "the AI response had no 'stories' array".to_string())?;
    let drafts: Vec<StoryDraft> = stories
        .iter()
        .filter_map(|s| serde_json::from_value(s.clone()).ok())
        .filter(|d: &StoryDraft| !d.title.trim().is_empty())
        .collect();
    if drafts.is_empty() {
        return Err("the AI response contained no usable stories".to_string());
    }
    Ok(drafts)
}

/// Calls the provider's Messages API and returns story drafts.
pub async fn generate_stories(
    api_base_url: &str,
    api_key: &str,
    model: &str,
    effort: &str,
    prompt: &str,
) -> Result<Vec<StoryDraft>, String> {
    let url = format!("{}/v1/messages", api_base_url.trim_end_matches('/'));
    let body = json!({
        "model": model,
        "max_tokens": 16000,
        "output_config": {
            "effort": effort,
            "format": {
                "type": "json_schema",
                "schema": {
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
                                "required": ["title", "description"],
                                "additionalProperties": false
                            }
                        }
                    },
                    "required": ["stories"],
                    "additionalProperties": false
                }
            }
        },
        "messages": [{"role": "user", "content": prompt}]
    });

    let response = http_client()?
        .post(&url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("could not reach the AI provider: {e}"))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("could not read the AI provider's response: {e}"))?;
    if !status.is_success() {
        let message = serde_json::from_str::<ApiError>(&text)
            .map(|e| e.error.message)
            .unwrap_or(text);
        return Err(format!("the AI provider returned an error ({status}): {message}"));
    }

    let parsed: ApiResponse = serde_json::from_str(&text)
        .map_err(|e| format!("unexpected response shape from the AI provider: {e}"))?;
    if parsed.stop_reason.as_deref() == Some("refusal") {
        return Err("the AI provider declined this request (safety refusal) — rephrase the feature or try another model".into());
    }
    let json_text = parsed
        .content
        .iter()
        .find(|b| b.block_type == "text")
        .map(|b| b.text.as_str())
        .ok_or_else(|| "the AI response contained no text".to_string())?;
    parse_stories(json_text)
}

/// Minimal connectivity check: one tiny Messages call.
pub async fn test_connection(api_base_url: &str, api_key: &str, model: &str) -> Result<(), String> {
    let url = format!("{}/v1/messages", api_base_url.trim_end_matches('/'));
    let body = json!({
        "model": model,
        "max_tokens": 16,
        "messages": [{"role": "user", "content": "Reply with the single word OK."}]
    });
    let response = http_client()?
        .post(&url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("could not reach the AI provider: {e}"))?;
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let text = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<ApiError>(&text)
        .map(|e| e.error.message)
        .unwrap_or(text);
    Err(format!("the AI provider returned an error ({status}): {message}"))
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("could not build the HTTP client: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_includes_feature_product_and_solutions() {
        let prompt = build_story_prompt(
            "Shop App",
            "{\"purpose\":\"sell things\"}",
            "Checkout",
            Some("One-page checkout"),
            &[("Shop API".into(), "api".into(), "{\"language\":\"Go\"}".into())],
        );
        assert!(prompt.contains("Shop App"));
        assert!(prompt.contains("Checkout"));
        assert!(prompt.contains("One-page checkout"));
        assert!(prompt.contains("Shop API (api)"));
        assert!(prompt.contains("user stories"));
    }

    #[test]
    fn prompt_handles_no_solutions_and_no_description() {
        let prompt = build_story_prompt("Shop App", "{}", "Checkout", None, &[]);
        assert!(prompt.contains("No solutions are linked"));
        assert!(!prompt.contains("Feature description"));
    }

    #[test]
    fn parses_structured_story_output() {
        let text = r#"{"stories": [
            {"title": "As a shopper, I want to pay in one step so that checkout is fast", "description": "Single page."},
            {"title": "As a shopper, I want saved cards so that I don't retype", "description": "Stored via the API."}
        ]}"#;
        let stories = parse_stories(text).expect("parse");
        assert_eq!(stories.len(), 2);
        assert!(stories[0].title.starts_with("As a shopper"));
    }

    #[test]
    fn rejects_non_json_and_empty_story_lists() {
        assert!(parse_stories("not json").is_err());
        assert!(parse_stories("{\"stories\": []}").is_err());
        assert!(parse_stories("{\"other\": 1}").is_err());
    }
}
