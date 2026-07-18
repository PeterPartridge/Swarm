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

/// A prompt split so the stable half can be cached by the API.
///
/// `context` is everything that is identical for every call about the same
/// Product (its brief, strategy, and solutions); `task` is the part that
/// changes per call. Only `context` is marked cacheable, and it is sent first —
/// caching works on a prefix, so anything varying must come after it.
#[derive(Debug, Clone, PartialEq)]
pub struct Prompt {
    pub context: String,
    pub task: String,
}

/// What a call actually consumed. `cache_read_input_tokens` above zero means a
/// previous call's context was reused instead of re-billed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Deserialize)]
pub struct Usage {
    #[serde(default)]
    pub input_tokens: i64,
    #[serde(default)]
    pub output_tokens: i64,
    #[serde(default)]
    pub cache_creation_input_tokens: i64,
    #[serde(default)]
    pub cache_read_input_tokens: i64,
}

#[derive(Deserialize)]
struct ApiResponse {
    #[serde(default)]
    content: Vec<ContentBlock>,
    #[serde(default)]
    stop_reason: Option<String>,
    #[serde(default)]
    usage: Usage,
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

/// The Product context every call about that Product repeats — brief answers,
/// optional strategy, and the connected solutions. Built once and reused as the
/// cacheable prefix of both prompts below (pure — unit tested).
fn product_context(
    product_name: &str,
    product_answers: &str,
    strategy: Option<&str>,
    solutions: &[(String, String, String)], // (name, solutionType, answers JSON)
) -> String {
    let mut context = format!(
        "You are helping a product team plan work.\n\n\
         Product: {product_name}\nProduct brief answers (JSON): {product_answers}\n"
    );
    if let Some(strategy) = strategy {
        if !strategy.trim().is_empty() && strategy.trim() != "{}" {
            context.push_str(&format!("Product strategy (JSON): {strategy}\n"));
        }
    }
    if solutions.is_empty() {
        context.push_str("\nNo solutions are linked to this Product yet.\n");
    } else {
        context.push_str("\nConnected solutions (the systems this work touches):\n");
        for (name, solution_type, answers) in solutions {
            context.push_str(&format!("- {name} ({solution_type}): {answers}\n"));
        }
    }
    context
}

/// Builds the user-story prompt from the feature and its Product context
/// (pure — unit tested).
pub fn build_story_prompt(
    product_name: &str,
    product_answers: &str,
    feature_title: &str,
    feature_description: Option<&str>,
    solutions: &[(String, String, String)], // (name, solutionType, answers JSON)
    clarifications: &[String],
) -> Prompt {
    let context = product_context(product_name, product_answers, None, solutions);
    let mut task = format!("Feature: {feature_title}\n");
    if let Some(description) = feature_description {
        if !description.trim().is_empty() {
            task.push_str(&format!("Feature description: {description}\n"));
        }
    }
    append_clarifications(&mut task, clarifications);
    task.push_str(
        "\nWrite 3-6 user stories covering this feature across the connected solutions. \
         Each story: a title in classic user-story form (\"As a <user>, I want <goal> so that <benefit>\") \
         and a one-to-three sentence description of what done looks like.",
    );
    task.push_str(ESCAPE_HATCH);
    Prompt { context, task }
}

/// Told to the model on every generation. Without this it will guess at a vague
/// item and produce plausible work nobody asked for — the exact failure the
/// framework exists to prevent.
const ESCAPE_HATCH: &str = "\n\nIf this is too vague or contradictory to do well, do NOT guess. \
     Leave \"stories\" empty and fill in \"blocked\" instead: give the reason and, \
     in whatIsNeeded, the single most useful question a person could answer to \
     unblock it. Declining with a good question is a better outcome than \
     inventing work.";

/// Appends any answers a person has already given for this item, so the model
/// does not ask the same question twice.
fn append_clarifications(task: &mut String, clarifications: &[String]) {
    if clarifications.is_empty() {
        return;
    }
    task.push_str("\n\nAnswers already given about this item — treat these as settled:\n");
    for note in clarifications {
        task.push_str(&format!("- {note}\n"));
    }
}

/// Builds the prompt that turns a Deliverable into the work that achieves it.
/// `item_label` is the plain name of the level being generated ("feature",
/// "user story", …) so the wording follows the Product's planning method.
/// `existing` are the titles already under the deliverable, so a second press
/// extends the plan instead of repeating it. (pure — unit tested)
pub fn build_deliverable_prompt(
    product_name: &str,
    product_answers: &str,
    strategy: &str,
    deliverable_name: &str,
    deliverable_description: &str,
    item_label: &str,
    existing: &[String],
    solutions: &[(String, String, String)], // (name, solutionType, answers JSON)
) -> Prompt {
    let context = product_context(product_name, product_answers, Some(strategy), solutions);
    let mut task = format!("Deliverable: {deliverable_name}\n");
    if !deliverable_description.trim().is_empty() {
        task.push_str(&format!(
            "Deliverable description: {deliverable_description}\n"
        ));
    }
    if !existing.is_empty() {
        task.push_str(
            "\nAlready planned under this deliverable — do NOT repeat these, add what is missing:\n",
        );
        for title in existing {
            task.push_str(&format!("- {title}\n"));
        }
    }
    task.push_str(&format!(
        "\nBreak this deliverable into the {item_label}s needed to achieve it. \
         Write 3-6 of them. Each one: a short title naming the outcome, and a \
         one-to-three sentence description of what done looks like. Cover the \
         deliverable across the connected solutions, and keep each one \
         independently deliverable."
    ));
    task.push_str(ESCAPE_HATCH);
    Prompt { context, task }
}

/// What a generation call produced: work, or a refusal with a reason.
///
/// The refusal branch is the framework's answer to AI burning tokens on work it
/// does not understand — the model may decline and say what it needs, instead
/// of guessing and producing something nobody asked for.
#[derive(Debug, Clone, PartialEq)]
pub enum Generated {
    Items(Vec<StoryDraft>),
    Blocked {
        reason: String,
        what_is_needed: String,
    },
}

/// Parses the structured-output JSON (pure — unit tested).
///
/// `blocked` wins over `stories`: a model that filled in both has hedged, and
/// taking the refusal is the safe reading — it costs a question, where taking
/// the guesses costs work built on a misunderstanding.
pub fn parse_generation(text: &str) -> Result<Generated, String> {
    let value: Value = serde_json::from_str(text)
        .map_err(|e| format!("the AI response was not valid JSON: {e}"))?;

    if let Some(blocked) = value.get("blocked").filter(|b| !b.is_null()) {
        let reason = blocked
            .get("reason")
            .and_then(|r| r.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if !reason.is_empty() {
            return Ok(Generated::Blocked {
                reason,
                what_is_needed: blocked
                    .get("whatIsNeeded")
                    .and_then(|w| w.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string(),
            });
        }
    }

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
    Ok(Generated::Items(drafts))
}


/// Calls the provider's Messages API and returns story drafts with what the
/// call consumed.
///
/// The prompt is sent as two content blocks: the Product context first, marked
/// `cache_control: ephemeral` so repeat calls about the same Product read it
/// from cache instead of paying for it again, then the per-call task.
///
/// Caching only engages above the API's minimum cacheable prefix length, so a
/// Product with a short brief and no solutions will report zero cache reads —
/// that is the API declining to cache a small prefix, not a failure here.
pub async fn generate_stories(
    api_base_url: &str,
    api_key: &str,
    model: &str,
    effort: &str,
    prompt: &Prompt,
) -> Result<(Generated, Usage), String> {
    let (json_text, usage) =
        post_structured(api_base_url, api_key, model, effort, prompt, story_schema()).await?;
    Ok((parse_generation(&json_text)?, usage))
}

/// The schema for planning work — a list of items, or the escape hatch.
fn story_schema() -> Value {
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
                    "required": ["title", "description"],
                    "additionalProperties": false
                }
            },
            "blocked": blocked_schema()
        },
        "required": ["stories"],
        "additionalProperties": false
    })
}

/// The escape hatch, shared by every schema. Leave null to produce work; fill
/// it in to decline and say what is missing.
fn blocked_schema() -> Value {
    json!({
        "type": ["object", "null"],
        "properties": {
            "reason": {"type": "string"},
            "whatIsNeeded": {"type": "string"}
        },
        "required": ["reason", "whatIsNeeded"],
        "additionalProperties": false
    })
}

/// One structured-output call: the cacheable context first, the task second,
/// the given schema enforced. Returns the raw JSON text and what it consumed,
/// leaving each caller to parse its own shape.
async fn post_structured(
    api_base_url: &str,
    api_key: &str,
    model: &str,
    effort: &str,
    prompt: &Prompt,
    schema: Value,
) -> Result<(String, Usage), String> {
    let url = format!("{}/v1/messages", api_base_url.trim_end_matches('/'));
    let body = json!({
        "model": model,
        "max_tokens": 16000,
        "output_config": {
            "effort": effort,
            "format": {
                "type": "json_schema",
                "schema": schema
            }
        },
        "messages": [{
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": prompt.context,
                    "cache_control": {"type": "ephemeral"}
                },
                {"type": "text", "text": prompt.task}
            ]
        }]
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
        .map(|b| b.text.clone())
        .ok_or_else(|| "the AI response contained no text".to_string())?;
    Ok((json_text, parsed.usage))
}

/// One proposed way to build a work item.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ArchitectureOption {
    pub name: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub rationale: String,
    #[serde(default)]
    pub tradeoffs: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StrategyDraft {
    pub strategy: String,
    pub options: Vec<ArchitectureOption>,
    pub tech_stack: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GeneratedStrategy {
    Strategy(StrategyDraft),
    Blocked {
        reason: String,
        what_is_needed: String,
    },
}

/// Builds the prompt for "how should we build this?".
///
/// The developer rules are stated as constraints rather than suggestions, and
/// disallowed technologies are called out explicitly — the result is then
/// re-checked against that list by the caller, because a stated constraint is
/// not the same as an obeyed one.
#[allow(clippy::too_many_arguments)]
pub fn build_solution_strategy_prompt(
    product_name: &str,
    product_answers: &str,
    solutions: &[(String, String, String)],
    item_title: &str,
    item_description: Option<&str>,
    rules: &DeveloperRulesPrompt<'_>,
    clarifications: &[String],
) -> Prompt {
    let mut context = product_context(product_name, product_answers, None, solutions);
    context.push_str("\nDeveloper rules — these are constraints, not preferences:\n");
    for (label, value) in [
        ("Coding standards", rules.coding_standards),
        ("Architecture principles", rules.architecture_principles),
        ("Maintainability", rules.maintainability),
        ("Preferred frameworks", rules.preferred_frameworks),
        ("Allowed technologies", rules.allowed_tech),
        ("Constraints on AI", rules.ai_constraints),
    ] {
        if !value.trim().is_empty() {
            context.push_str(&format!("- {label}: {value}\n"));
        }
    }
    if !rules.disallowed_tech.trim().is_empty() {
        context.push_str(&format!(
            "- MUST NOT use, under any circumstances: {}\n",
            rules.disallowed_tech
        ));
    }

    let mut task = format!("Work item: {item_title}\n");
    if let Some(description) = item_description {
        if !description.trim().is_empty() {
            task.push_str(&format!("Description: {description}\n"));
        }
    }
    append_clarifications(&mut task, clarifications);
    task.push_str(
        "\nPropose how to build this. Give: a short written strategy; 2-4 architecture \
         options, each with a name, a kind (windowsService, azureWebApp, azureFunction, \
         api, backgroundWorker, or other), why it fits, and its trade-offs; and the tech \
         stack that follows from the developer rules above. Do not propose anything the \
         rules forbid.",
    );
    task.push_str(ESCAPE_HATCH_STRATEGY);
    Prompt { context, task }
}

/// The developer rules, borrowed for prompt building.
pub struct DeveloperRulesPrompt<'a> {
    pub coding_standards: &'a str,
    pub architecture_principles: &'a str,
    pub maintainability: &'a str,
    pub preferred_frameworks: &'a str,
    pub allowed_tech: &'a str,
    pub disallowed_tech: &'a str,
    pub ai_constraints: &'a str,
}

const ESCAPE_HATCH_STRATEGY: &str = "\n\nIf the item is too vague to design against, do NOT guess. \
     Leave \"strategy\" empty and fill in \"blocked\" with the reason and the single \
     most useful question a person could answer.";

fn strategy_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "strategy": {"type": "string"},
            "techStack": {"type": "string"},
            "options": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "kind": {"type": "string"},
                        "rationale": {"type": "string"},
                        "tradeoffs": {"type": "string"}
                    },
                    "required": ["name", "kind", "rationale", "tradeoffs"],
                    "additionalProperties": false
                }
            },
            "blocked": blocked_schema()
        },
        "required": ["strategy", "techStack", "options"],
        "additionalProperties": false
    })
}

/// Parses a solution-strategy response (pure — unit tested).
pub fn parse_solution_strategy(text: &str) -> Result<GeneratedStrategy, String> {
    let value: Value = serde_json::from_str(text)
        .map_err(|e| format!("the AI response was not valid JSON: {e}"))?;

    if let Some(blocked) = value.get("blocked").filter(|b| !b.is_null()) {
        let reason = blocked
            .get("reason")
            .and_then(|r| r.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if !reason.is_empty() {
            return Ok(GeneratedStrategy::Blocked {
                reason,
                what_is_needed: blocked
                    .get("whatIsNeeded")
                    .and_then(|w| w.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string(),
            });
        }
    }

    let strategy = value
        .get("strategy")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if strategy.is_empty() {
        return Err("the AI response contained no strategy".into());
    }
    let options: Vec<ArchitectureOption> = value
        .get("options")
        .and_then(|o| o.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|o| serde_json::from_value(o.clone()).ok())
                .filter(|o: &ArchitectureOption| !o.name.trim().is_empty())
                .collect()
        })
        .unwrap_or_default();
    Ok(GeneratedStrategy::Strategy(StrategyDraft {
        strategy,
        options,
        tech_stack: value
            .get("techStack")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .trim()
            .to_string(),
    }))
}

/// Calls the provider for a solution strategy.
pub async fn generate_solution_strategy(
    api_base_url: &str,
    api_key: &str,
    model: &str,
    effort: &str,
    prompt: &Prompt,
) -> Result<(GeneratedStrategy, Usage), String> {
    let (json_text, usage) =
        post_structured(api_base_url, api_key, model, effort, prompt, strategy_schema()).await?;
    Ok((parse_solution_strategy(&json_text)?, usage))
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
            &[],
        );
        assert!(prompt.context.contains("Shop App"));
        assert!(prompt.context.contains("Shop API (api)"));
        assert!(prompt.task.contains("Checkout"));
        assert!(prompt.task.contains("One-page checkout"));
        assert!(prompt.task.contains("user stories"));
    }

    #[test]
    fn prompt_handles_no_solutions_and_no_description() {
        let prompt = build_story_prompt("Shop App", "{}", "Checkout", None, &[], &[]);
        assert!(prompt.context.contains("No solutions are linked"));
        assert!(!prompt.task.contains("Feature description"));
    }

    /// The cacheable half must hold only what repeats for a Product, and the
    /// per-call half only what varies — otherwise the cached prefix changes on
    /// every call and the cache never hits.
    #[test]
    fn the_cacheable_context_is_identical_across_calls_about_one_product() {
        let solutions = [("Shop API".into(), "api".into(), "{}".into())];
        let answers = "{\"purpose\":\"sell things\"}";
        let first = build_story_prompt("Shop App", answers, "Checkout", None, &solutions, &[]);
        let second =
            build_story_prompt("Shop App", answers, "Search", Some("Filters"), &solutions, &[]);
        assert_eq!(first.context, second.context, "context must not vary per call");
        assert_ne!(first.task, second.task);

        // and the deliverable prompt shares that same context for the Product
        let deliverable = build_deliverable_prompt(
            "Shop App",
            answers,
            "{}",
            "MVP",
            "",
            "feature",
            &[],
            &solutions,
        );
        assert_eq!(first.context, deliverable.context);
    }

    #[test]
    fn the_task_half_carries_no_product_context() {
        let prompt = build_story_prompt(
            "Shop App",
            "{\"purpose\":\"sell things\"}",
            "Checkout",
            None,
            &[("Shop API".into(), "api".into(), "{}".into())],
            &[],
        );
        assert!(!prompt.task.contains("Shop App"));
        assert!(!prompt.task.contains("Shop API"));
    }

    #[test]
    fn deliverable_prompt_puts_strategy_in_context_and_existing_work_in_the_task() {
        let prompt = build_deliverable_prompt(
            "Shop App",
            "{}",
            "{\"vision\":\"be the best\"}",
            "MVP",
            "first release",
            "feature",
            &["Checkout flow".to_string()],
            &[],
        );
        assert!(prompt.context.contains("be the best"));
        assert!(prompt.task.contains("MVP"));
        assert!(prompt.task.contains("first release"));
        assert!(prompt.task.contains("Checkout flow"));
        assert!(prompt.task.contains("features"));
    }

    #[test]
    fn usage_defaults_to_zero_when_the_api_omits_it() {
        let parsed: ApiResponse =
            serde_json::from_str(r#"{"content":[{"type":"text","text":"{}"}]}"#).expect("parse");
        assert_eq!(parsed.usage, Usage::default());
    }

    #[test]
    fn usage_is_read_from_the_response_including_cache_reads() {
        let parsed: ApiResponse = serde_json::from_str(
            r#"{"content":[],"usage":{"input_tokens":12,"output_tokens":34,
                "cache_creation_input_tokens":56,"cache_read_input_tokens":78}}"#,
        )
        .expect("parse");
        assert_eq!(parsed.usage.input_tokens, 12);
        assert_eq!(parsed.usage.output_tokens, 34);
        assert_eq!(parsed.usage.cache_creation_input_tokens, 56);
        assert_eq!(parsed.usage.cache_read_input_tokens, 78);
    }

    #[test]
    fn parses_structured_story_output() {
        let text = r#"{"stories": [
            {"title": "As a shopper, I want to pay in one step so that checkout is fast", "description": "Single page."},
            {"title": "As a shopper, I want saved cards so that I don't retype", "description": "Stored via the API."}
        ]}"#;
        match parse_generation(text).expect("parse") {
            Generated::Items(stories) => {
                assert_eq!(stories.len(), 2);
                assert!(stories[0].title.starts_with("As a shopper"));
            }
            other => panic!("expected items, got {other:?}"),
        }
    }

    #[test]
    fn rejects_non_json_and_empty_story_lists() {
        assert!(parse_generation("not json").is_err());
        assert!(parse_generation("{\"stories\": []}").is_err());
        assert!(parse_generation("{\"other\": 1}").is_err());
    }

    #[test]
    fn a_normal_response_parses_as_items() {
        let text = r#"{"stories":[{"title":"A","description":"d"}],"blocked":null}"#;
        match parse_generation(text).expect("parse") {
            Generated::Items(items) => assert_eq!(items.len(), 1),
            other => panic!("expected items, got {other:?}"),
        }
    }

    #[test]
    fn the_escape_hatch_is_parsed_with_its_question() {
        let text = r#"{"stories":[],"blocked":{"reason":"No payment provider is named.",
            "whatIsNeeded":"Which payment provider should checkout use?"}}"#;
        match parse_generation(text).expect("parse") {
            Generated::Blocked { reason, what_is_needed } => {
                assert!(reason.contains("payment provider"));
                assert!(what_is_needed.starts_with("Which"));
            }
            other => panic!("expected blocked, got {other:?}"),
        }
    }

    /// A model that filled in both has hedged. Taking the refusal costs a
    /// question; taking the guesses costs work built on a misunderstanding.
    #[test]
    fn a_hedged_response_is_read_as_blocked() {
        let text = r#"{"stories":[{"title":"A guess","description":"d"}],
            "blocked":{"reason":"Not sure what is wanted","whatIsNeeded":"Clarify scope"}}"#;
        assert!(matches!(
            parse_generation(text).expect("parse"),
            Generated::Blocked { .. }
        ));
    }

    /// An empty or absent reason is not a refusal — otherwise a model that
    /// emitted `blocked: {}` would silently discard perfectly good work.
    #[test]
    fn an_empty_block_falls_through_to_the_items() {
        let text = r#"{"stories":[{"title":"A","description":"d"}],
            "blocked":{"reason":"  ","whatIsNeeded":""}}"#;
        match parse_generation(text).expect("parse") {
            Generated::Items(items) => assert_eq!(items.len(), 1),
            other => panic!("expected items, got {other:?}"),
        }
    }

    fn rules<'a>(disallowed: &'a str) -> DeveloperRulesPrompt<'a> {
        DeveloperRulesPrompt {
            coding_standards: "DRY",
            architecture_principles: "",
            maintainability: "",
            preferred_frameworks: "",
            allowed_tech: "Rust",
            disallowed_tech: disallowed,
            ai_constraints: "",
        }
    }

    #[test]
    fn a_strategy_response_parses_into_options() {
        let text = r#"{"strategy":"Run it as a queue consumer.","techStack":"Rust, Azure",
            "options":[
                {"name":"Azure Function","kind":"azureFunction","rationale":"cheap","tradeoffs":"cold starts"},
                {"name":"Worker","kind":"backgroundWorker","rationale":"steady","tradeoffs":"always on"}
            ]}"#;
        match parse_solution_strategy(text).expect("parse") {
            GeneratedStrategy::Strategy(draft) => {
                assert!(draft.strategy.starts_with("Run it"));
                assert_eq!(draft.tech_stack, "Rust, Azure");
                assert_eq!(draft.options.len(), 2);
                assert_eq!(draft.options[0].kind, "azureFunction");
            }
            other => panic!("expected a strategy, got {other:?}"),
        }
    }

    #[test]
    fn a_strategy_can_also_decline() {
        let text = r#"{"strategy":"","techStack":"","options":[],
            "blocked":{"reason":"No throughput given","whatIsNeeded":"How many messages per hour?"}}"#;
        match parse_solution_strategy(text).expect("parse") {
            GeneratedStrategy::Blocked { what_is_needed, .. } => {
                assert!(what_is_needed.contains("messages per hour"))
            }
            other => panic!("expected blocked, got {other:?}"),
        }
    }

    #[test]
    fn an_empty_strategy_without_a_reason_is_an_error_not_a_silent_pass() {
        let text = r#"{"strategy":"   ","techStack":"","options":[]}"#;
        assert!(parse_solution_strategy(text).is_err());
    }

    #[test]
    fn unnamed_options_are_dropped_rather_than_shown_blank() {
        let text = r#"{"strategy":"s","techStack":"","options":[
            {"name":"","kind":"api","rationale":"","tradeoffs":""},
            {"name":"Real one","kind":"api","rationale":"","tradeoffs":""}
        ]}"#;
        match parse_solution_strategy(text).expect("parse") {
            GeneratedStrategy::Strategy(draft) => {
                assert_eq!(draft.options.len(), 1);
                assert_eq!(draft.options[0].name, "Real one");
            }
            other => panic!("expected a strategy, got {other:?}"),
        }
    }

    /// Forbidden technology must be stated as a hard constraint, not left for
    /// the model to infer from the allowed list.
    #[test]
    fn disallowed_technology_is_stated_as_a_prohibition() {
        let prompt = build_solution_strategy_prompt(
            "Shop App", "{}", &[], "Checkout", None, &rules("Java, PHP"), &[],
        );
        assert!(prompt.context.contains("MUST NOT use"), "got: {}", prompt.context);
        assert!(prompt.context.contains("Java, PHP"));
    }

    #[test]
    fn with_nothing_forbidden_no_prohibition_is_invented() {
        let prompt = build_solution_strategy_prompt(
            "Shop App", "{}", &[], "Checkout", None, &rules(""), &[],
        );
        assert!(!prompt.context.contains("MUST NOT use"));
        assert!(prompt.context.contains("Coding standards: DRY"));
    }

    #[test]
    fn the_strategy_prompt_also_offers_the_escape_hatch() {
        let prompt = build_solution_strategy_prompt(
            "Shop App", "{}", &[], "Checkout", None, &rules(""), &[],
        );
        assert!(prompt.task.contains("do NOT guess"));
        assert!(prompt.task.contains("architecture options"));
    }

    #[test]
    fn every_prompt_offers_the_escape_hatch() {
        let story = build_story_prompt("P", "{}", "F", None, &[], &[]);
        let deliverable =
            build_deliverable_prompt("P", "{}", "{}", "D", "", "feature", &[], &[]);
        for prompt in [story, deliverable] {
            assert!(prompt.task.contains("do NOT guess"), "got: {}", prompt.task);
            assert!(prompt.task.contains("blocked"));
        }
    }

    /// Answers already given must reach the model, or it asks the same
    /// question and the same tokens are spent again.
    #[test]
    fn clarifications_are_carried_into_the_prompt() {
        let prompt = build_story_prompt(
            "P",
            "{}",
            "Checkout",
            None,
            &[],
            &["Use Stripe.".to_string(), "Guest checkout is allowed.".to_string()],
        );
        assert!(prompt.task.contains("treat these as settled"));
        assert!(prompt.task.contains("Use Stripe."));
        assert!(prompt.task.contains("Guest checkout is allowed."));
        // and they belong to the per-call half, not the cached context
        assert!(!prompt.context.contains("Use Stripe."));
    }

    /// Live check for prompt caching — the one thing a unit test cannot prove.
    ///
    /// Ignored by default because it spends real money and needs a real key.
    /// To run it, put a key in the environment and ask for ignored tests:
    ///
    /// ```text
    /// ANTHROPIC_API_KEY=sk-... cargo test --  --ignored caching_is_live
    /// ```
    ///
    /// It makes two identical calls: the first writes the cache, the second
    /// must report `cache_read_input_tokens > 0`. If the second reports zero,
    /// the context block is below the API's minimum cacheable length — enlarge
    /// the fixture rather than assuming caching is broken.
    #[tokio::test]
    #[ignore = "spends real money; needs ANTHROPIC_API_KEY"]
    async fn caching_is_live_on_a_repeated_context() {
        let Ok(api_key) = std::env::var("ANTHROPIC_API_KEY") else {
            panic!("set ANTHROPIC_API_KEY to run this check");
        };
        // A context long enough to clear the minimum cacheable prefix.
        let answers = format!("{{\"purpose\":\"{}\"}}", "sell things online. ".repeat(400));
        let solutions = [("Shop API".to_string(), "api".to_string(), answers.clone())];
        let prompt = build_story_prompt("Shop App", &answers, "Checkout", None, &solutions, &[]);

        let (_, first) = generate_stories(
            "https://api.anthropic.com",
            &api_key,
            "claude-haiku-4-5-20251001",
            "low",
            &prompt,
        )
        .await
        .expect("first call");
        let (_, second) = generate_stories(
            "https://api.anthropic.com",
            &api_key,
            "claude-haiku-4-5-20251001",
            "low",
            &prompt,
        )
        .await
        .expect("second call");

        println!(
            "first:  in={} out={} cache_write={} cache_read={}",
            first.input_tokens,
            first.output_tokens,
            first.cache_creation_input_tokens,
            first.cache_read_input_tokens
        );
        println!(
            "second: in={} out={} cache_write={} cache_read={}",
            second.input_tokens,
            second.output_tokens,
            second.cache_creation_input_tokens,
            second.cache_read_input_tokens
        );
        assert!(
            first.cache_creation_input_tokens > 0,
            "the first call should have written the cache"
        );
        assert!(
            second.cache_read_input_tokens > 0,
            "the second call should have read the cached context"
        );
    }
}
