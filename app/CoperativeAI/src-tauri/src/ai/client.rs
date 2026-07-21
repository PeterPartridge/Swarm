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
    /// Prose, for a person to read.
    pub tech_stack: String,
    /// The technologies the AI intends to **use**, as data.
    ///
    /// This exists because checking the prose does not work. The first live run
    /// produced a tech stack ending "No Java or PHP anywhere" — the model had
    /// obeyed the prohibition perfectly and was flagged for saying so. A rule
    /// check that fires on correct behaviour trains people to ignore it, so the
    /// check runs against this list and never against the writing.
    pub technologies: Vec<String>,
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
         api, backgroundWorker, or other), why it fits, and its trade-offs; the tech \
         stack that follows from the developer rules above; and \"technologies\", a plain \
         list of every technology you are actually proposing to USE. List only what you \
         are using — do not list anything you are avoiding or rejecting. Do not propose \
         anything the rules forbid.",
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
            // Checked against the forbidden list — see StrategyDraft.
            "technologies": {"type": "array", "items": {"type": "string"}},
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
        "required": ["strategy", "techStack", "technologies", "options"],
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
        technologies: value
            .get("technologies")
            .and_then(|t| t.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|t| t.as_str())
                    .map(|t| t.trim().to_string())
                    .filter(|t| !t.is_empty())
                    .collect()
            })
            .unwrap_or_default(),
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

/// What a design generation produced: the strategy prose plus the artefacts
/// that follow from it — a token set, flows, a component list.
#[derive(Debug, Clone, PartialEq)]
pub struct DesignDraft {
    pub strategy: String,
    /// Token document as JSON text. Empty when the round didn't produce one.
    pub tokens: String,
    pub flows: Vec<NamedArtefact>,
    pub components: String,
    /// Named prose artefacts — marketing's campaigns, launch plan, messaging.
    pub assets: Vec<NamedAsset>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct NamedAsset {
    pub name: String,
    /// Validated against the asset kinds on save, not here.
    pub kind: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct NamedArtefact {
    pub name: String,
    /// Mermaid source.
    pub diagram: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GeneratedDesign {
    Design(Box<DesignDraft>),
    Blocked {
        reason: String,
        what_is_needed: String,
    },
}

/// Builds the prompt for design or marketing work.
///
/// `figma` is the digest of an existing design file, when one is linked — the
/// reduced form, never the raw document. It is placed in the **context** half
/// rather than the task half so prompt caching covers it: a design file is the
/// most expensive thing in this prompt and the least likely to change between
/// two questions about it.
pub fn build_design_prompt(
    product_name: &str,
    product_answers: &str,
    strategy: &str,
    area: &str,
    brief: &str,
    figma: Option<&str>,
    solutions: &[(String, String, String)],
) -> Prompt {
    let mut context = product_context(product_name, product_answers, Some(strategy), solutions);
    if let Some(digest) = figma.filter(|d| !d.trim().is_empty()) {
        context.push_str("\nAn existing design file is linked to this Product:\n");
        context.push_str(digest);
    }

    let task = match area {
        "marketing" => format!(
            "{brief}\n\nWork out how this Product is taken to market. Give a written \
             strategy covering the target audience, positioning and pricing approach. \
             Then fill \"assets\" with the artefacts a person could pick up and use: \
             1-3 campaign ideas (kind \"campaign\", one entry each), a launch plan \
             (kind \"launchPlan\"), and the core messaging (kind \"messaging\") — each \
             with a short name and Markdown content. Leave \"tokens\", \"flows\" and \
             \"components\" empty. Ground every claim in what the Product actually is — \
             do not invent features it does not have."
        ),
        _ => format!(
            "{brief}\n\nWork out the design direction. Give: a written strategy covering \
             branding and visual direction; \"tokens\", a JSON object of design tokens \
             (colours as hex strings, plus type and spacing scales) nested by group; \
             \"flows\", 1-4 user flows each with a name and a Mermaid diagram starting \
             with \"flowchart TD\"; and \"components\", the component inventory as \
             Markdown. Mermaid must be raw source with no code fences. Leave \
             \"assets\" empty."
        ),
    };
    let mut task = task;
    task.push_str(ESCAPE_HATCH_DESIGN);
    Prompt { context, task }
}

const ESCAPE_HATCH_DESIGN: &str = "\n\nIf the Product is described too vaguely to design or \
     market honestly, do NOT invent a direction. Leave \"strategy\" empty and fill in \
     \"blocked\" with the reason and the single most useful question a person could answer.";

fn design_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "strategy": {"type": "string"},
            // A JSON *string*, not an object: the shape of a token set is the
            // designer's to decide, and pinning it in the schema would force
            // every Product into one vocabulary.
            "tokens": {"type": "string"},
            "flows": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "diagram": {"type": "string"}
                    },
                    "required": ["name", "diagram"],
                    "additionalProperties": false
                }
            },
            "components": {"type": "string"},
            "assets": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "kind": {"type": "string"},
                        "content": {"type": "string"}
                    },
                    "required": ["name", "kind", "content"],
                    "additionalProperties": false
                }
            },
            "blocked": blocked_schema()
        },
        "required": ["strategy", "tokens", "flows", "components", "assets"],
        "additionalProperties": false
    })
}

/// Parses a design response (pure — unit tested).
///
/// Mermaid and JSON both arrive fenced often enough that stripping fences here
/// is worth more than being strict: the alternative is a valid diagram rejected
/// by `design_asset::save` for wearing a ```mermaid jacket.
pub fn parse_design(text: &str) -> Result<GeneratedDesign, String> {
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
            return Ok(GeneratedDesign::Blocked {
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
    let flows: Vec<NamedArtefact> = value
        .get("flows")
        .and_then(|f| f.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|f| serde_json::from_value::<NamedArtefact>(f.clone()).ok())
                .map(|f| NamedArtefact {
                    name: f.name.trim().to_string(),
                    diagram: strip_fence(&f.diagram),
                })
                .filter(|f| !f.name.is_empty() && !f.diagram.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let assets: Vec<NamedAsset> = value
        .get("assets")
        .and_then(|a| a.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|a| serde_json::from_value::<NamedAsset>(a.clone()).ok())
                .map(|a| NamedAsset {
                    name: a.name.trim().to_string(),
                    kind: a.kind.trim().to_string(),
                    content: a.content.trim().to_string(),
                })
                .filter(|a| !a.name.is_empty() && !a.content.is_empty())
                .collect()
        })
        .unwrap_or_default();

    Ok(GeneratedDesign::Design(Box::new(DesignDraft {
        strategy,
        tokens: strip_fence(value.get("tokens").and_then(|t| t.as_str()).unwrap_or("")),
        flows,
        components: value
            .get("components")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .trim()
            .to_string(),
        assets,
    })))
}

/// Removes a surrounding ```lang fence if there is one.
fn strip_fence(text: &str) -> String {
    let trimmed = text.trim();
    let Some(rest) = trimmed.strip_prefix("```") else {
        return trimmed.to_string();
    };
    // drop the language tag on the opening line, and the closing fence
    let body = rest.split_once('\n').map(|(_, b)| b).unwrap_or("");
    body.trim_end()
        .strip_suffix("```")
        .unwrap_or(body)
        .trim()
        .to_string()
}

/// Calls the provider for design or marketing work.
pub async fn generate_design(
    api_base_url: &str,
    api_key: &str,
    model: &str,
    effort: &str,
    prompt: &Prompt,
) -> Result<(GeneratedDesign, Usage), String> {
    let (json_text, usage) =
        post_structured(api_base_url, api_key, model, effort, prompt, design_schema()).await?;
    Ok((parse_design(&json_text)?, usage))
}

/// An architecture document the AI drew.
#[derive(Debug, Clone, PartialEq)]
pub struct DiagramDraft {
    pub name: String,
    pub content: String,
    pub format: String,
    /// What the diagram is saying, in prose. Stored beside it so a reader who
    /// cannot parse Mermaid in their head still gets the point.
    pub explanation: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GeneratedDiagram {
    Diagram(Box<DiagramDraft>),
    Blocked {
        reason: String,
        what_is_needed: String,
    },
}

/// Builds the prompt for an architecture document.
///
/// The existing documents travel in the context half rather than the task half:
/// they are the expensive, stable part, and a second diagram for the same
/// Product should agree with the first rather than contradict it.
#[allow(clippy::too_many_arguments)]
pub fn build_architecture_prompt(
    product_name: &str,
    product_answers: &str,
    strategy: &str,
    solutions: &[(String, String, String)],
    links: &[String],
    existing: &[(String, String)], // (name, content)
    kind: &str,
    format: &str,
    brief: &str,
) -> Prompt {
    let mut context = product_context(product_name, product_answers, Some(strategy), solutions);
    if !links.is_empty() {
        context.push_str("\nHow these systems already depend on one another:\n");
        for line in links {
            context.push_str(&format!("- {line}\n"));
        }
    }
    if !existing.is_empty() {
        context.push_str("\nArchitecture already documented for this Product:\n");
        for (name, content) in existing {
            context.push_str(&format!("--- {name} ---\n{content}\n"));
        }
        context.push_str(
            "\nA new diagram must agree with these. If it contradicts one, say so in the \
             explanation rather than quietly drawing something different.\n",
        );
    }

    let notation = match format {
        "plantuml" => "PlantUML, starting with @startuml and ending with @enduml",
        "jsonGraph" => {
            "a JSON object with \"nodes\" (each with a string \"id\" and \"label\") and \
             \"edges\" (each with \"from\" and \"to\" matching node ids)"
        }
        _ => "Mermaid, starting with a diagram type such as \"flowchart TD\" or \"sequenceDiagram\"",
    };
    let subject = match kind {
        "systemInteraction" => "how the systems interact",
        "componentMap" => "the components and what they contain",
        "apiContract" => "the API surface and who calls what",
        "eventFlow" => "the events, who publishes them and who consumes them",
        _ => "the infrastructure this runs on",
    };

    let mut task = format!(
        "{brief}\n\nDraw {subject}. Return the diagram as raw {notation} — no code fences, no \
         commentary inside the diagram. Give it a short name, and an explanation in plain \
         English of what it is saying, for a reader who cannot parse the notation in their head. \
         Draw only what this Product actually has; do not invent systems."
    );
    task.push_str(ESCAPE_HATCH_DIAGRAM);
    Prompt { context, task }
}

const ESCAPE_HATCH_DIAGRAM: &str = "\n\nIf the Product's systems are described too vaguely to \
     draw honestly, do NOT invent an architecture. Leave \"content\" empty and fill in \
     \"blocked\" with the reason and the single most useful question a person could answer.";

fn diagram_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "content": {"type": "string"},
            "explanation": {"type": "string"},
            "blocked": blocked_schema()
        },
        "required": ["name", "content", "explanation"],
        "additionalProperties": false
    })
}

/// Parses an architecture response (pure — unit tested). The declared format is
/// the caller's, not the model's: it was asked for one notation, and letting it
/// answer in another would defeat the check that follows.
pub fn parse_diagram(text: &str, format: &str) -> Result<GeneratedDiagram, String> {
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
            return Ok(GeneratedDiagram::Blocked {
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

    let content = strip_fence(value.get("content").and_then(|c| c.as_str()).unwrap_or(""));
    if content.is_empty() {
        return Err("the AI response contained no diagram".into());
    }
    let name = value
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    Ok(GeneratedDiagram::Diagram(Box::new(DiagramDraft {
        name: if name.is_empty() { "Untitled".into() } else { name },
        content,
        format: format.to_string(),
        explanation: value
            .get("explanation")
            .and_then(|e| e.as_str())
            .unwrap_or("")
            .trim()
            .to_string(),
    })))
}

/// Calls the provider for an architecture document.
pub async fn generate_diagram(
    api_base_url: &str,
    api_key: &str,
    model: &str,
    effort: &str,
    prompt: &Prompt,
    format: &str,
) -> Result<(GeneratedDiagram, Usage), String> {
    let (json_text, usage) =
        post_structured(api_base_url, api_key, model, effort, prompt, diagram_schema()).await?;
    Ok((parse_diagram(&json_text, format)?, usage))
}

/// What the coding pal came back with.
#[derive(Debug, Clone, PartialEq)]
pub struct PalDraft {
    /// Always present — even a revision says what it did and why.
    pub explanation: String,
    /// The complete revised file, when the action changes code. Empty for
    /// actions that only talk. It replaces the file wholesale, so the prompt
    /// warns that an elided line is a deleted line.
    pub replacement: String,
    /// Technologies the revised code uses — checked against the rules.
    pub technologies: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GeneratedPal {
    Answer(Box<PalDraft>),
    Blocked {
        reason: String,
        what_is_needed: String,
    },
}

/// The actions the pal offers. A closed list, validated before any money is
/// spent — an unknown action is a caller bug, not a prompt.
pub const PAL_ACTIONS: &[&str] = &["explain", "refactor", "docs", "tests"];

/// Builds the coding-pal prompt.
///
/// The file travels in the **context** half: it is the most expensive part of
/// the prompt and the least likely to change across several questions about
/// the same code, so caching covers it. `rules_doc` is
/// `pack::developer_rules_doc` output — the same rendering the capability pack
/// and the handover brief use, so the pal reads the rules in the same words
/// every other agent does.
pub fn build_pal_prompt(
    file_path: &str,
    file_content: &str,
    rules_doc: &str,
    action: &str,
    instruction: &str,
    selection: Option<&str>,
) -> Prompt {
    let mut context = String::new();
    context.push_str(rules_doc);
    context.push_str(&format!("\nFile `{file_path}`:\n```\n{file_content}\n```\n"));

    let mut task = String::new();
    if let Some(selected) = selection.filter(|s| !s.trim().is_empty()) {
        task.push_str(&format!(
            "The developer selected this part of the file:\n```\n{selected}\n```\n\
             Focus there — but a revision must still return the whole file.\n\n"
        ));
    }
    if !instruction.trim().is_empty() {
        task.push_str(&format!("Instruction: {instruction}\n\n"));
    }
    task.push_str(match action {
        "refactor" => {
            "Revise the file accordingly. Return the COMPLETE revised file in \
             \"replacement\" — it replaces the file wholesale, so an elided line is a \
             deleted line. Explain what changed and why in \"explanation\", and list in \
             \"technologies\" every technology the revised code uses. Do not introduce \
             anything the developer rules forbid."
        }
        "docs" => {
            "Add documentation comments to this file, in its own language's convention. \
             Return the COMPLETE revised file in \"replacement\" — it replaces the file \
             wholesale. Change nothing but comments. Summarise what you documented in \
             \"explanation\", and list the file's technologies in \"technologies\"."
        }
        "tests" => {
            "Write tests for this code. Tests usually belong in a file of their own and \
             this tool only saves the open one — so put the test code in \"explanation\", \
             with a note saying where it should live, and leave \"replacement\" empty."
        }
        _ => {
            "Explain what this code does, how it is shaped, and anything a developer \
             new to it should be warned about. Leave \"replacement\" empty."
        }
    });
    task.push_str(ESCAPE_HATCH_PAL);
    Prompt { context, task }
}

const ESCAPE_HATCH_PAL: &str = "\n\nIf the instruction is too vague or contradicts the \
     developer rules, do NOT guess. Leave \"explanation\" and \"replacement\" empty and \
     fill in \"blocked\" with the reason and the single most useful question.";

fn pal_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "explanation": {"type": "string"},
            "replacement": {"type": "string"},
            "technologies": {"type": "array", "items": {"type": "string"}},
            "blocked": blocked_schema()
        },
        "required": ["explanation", "replacement", "technologies"],
        "additionalProperties": false
    })
}

/// Parses a pal response (pure — unit tested).
pub fn parse_pal(text: &str) -> Result<GeneratedPal, String> {
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
            return Ok(GeneratedPal::Blocked {
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

    let explanation = value
        .get("explanation")
        .and_then(|e| e.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if explanation.is_empty() {
        return Err("the AI response explained nothing".into());
    }
    Ok(GeneratedPal::Answer(Box::new(PalDraft {
        explanation,
        replacement: strip_fence(
            value.get("replacement").and_then(|r| r.as_str()).unwrap_or(""),
        ),
        technologies: value
            .get("technologies")
            .and_then(|t| t.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|t| t.as_str())
                    .map(|t| t.trim().to_string())
                    .filter(|t| !t.is_empty())
                    .collect()
            })
            .unwrap_or_default(),
    })))
}

/// Calls the provider for the coding pal.
pub async fn generate_pal(
    api_base_url: &str,
    api_key: &str,
    model: &str,
    effort: &str,
    prompt: &Prompt,
) -> Result<(GeneratedPal, Usage), String> {
    let (json_text, usage) =
        post_structured(api_base_url, api_key, model, effort, prompt, pal_schema()).await?;
    Ok((parse_pal(&json_text)?, usage))
}

/// What one Solution must change, as schemas rather than code.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct SolutionChange {
    /// Which Solution this is for, by name — matched back to an id by the
    /// caller, because a model cannot be trusted with a database key.
    pub solution: String,
    /// The API surface: endpoints, payloads, status codes.
    pub api_schema: String,
    /// The UI: pages, their fields, and what they call.
    pub page_schema: String,
    /// Paths the work is expected to touch.
    pub files_to_change: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GeneratedChangePlan {
    Plan(Vec<SolutionChange>),
    Blocked {
        reason: String,
        what_is_needed: String,
    },
}

/// One Solution's written plan, borrowed for prompt building.
pub struct SolutionPlanPrompt<'a> {
    pub name: &'a str,
    pub solution_type: &'a str,
    pub changes_required: &'a str,
    pub unit_tests: &'a str,
    pub mockups: &'a [String],
}

/// Builds the prompt that turns a written work-item plan into schemas.
///
/// The whole point of the surrounding feature is that Product and the
/// developers have already answered enough questions; this prompt is where
/// that pays off, so the answers travel in the **context** half along with the
/// rules and architecture, and the task half is only the ask.
#[allow(clippy::too_many_arguments)]
pub fn build_change_plan_prompt(
    product_name: &str,
    product_answers: &str,
    strategy: &str,
    item_title: &str,
    item_description: Option<&str>,
    rules: &DeveloperRulesPrompt<'_>,
    architecture: &[(String, String)],
    clarifications: &[String],
    plans: &[SolutionPlanPrompt<'_>],
) -> Prompt {
    let mut context = product_context(product_name, product_answers, Some(strategy), &[]);

    context.push_str("\nDeveloper rules — constraints, not preferences:\n");
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

    if !architecture.is_empty() {
        context.push_str("\nHow the system is put together:\n");
        for (name, content) in architecture {
            context.push_str(&format!("--- {name} ---\n{content}\n"));
        }
    }
    append_clarifications(&mut context, clarifications);

    let mut task = format!("Work item: {item_title}\n");
    if let Some(description) = item_description {
        if !description.trim().is_empty() {
            task.push_str(&format!("Description: {description}\n"));
        }
    }
    task.push_str("\nThe team has written what each affected Solution needs:\n\n");
    for plan in plans {
        task.push_str(&format!("### {} ({})\n", plan.name, plan.solution_type));
        task.push_str(&format!(
            "Changes required: {}\n",
            if plan.changes_required.trim().is_empty() {
                "(not written yet)"
            } else {
                plan.changes_required
            }
        ));
        if !plan.unit_tests.trim().is_empty() {
            task.push_str(&format!("Must be proved by: {}\n", plan.unit_tests));
        }
        // Named, never described: this platform sends text, so a mockup is a
        // fact about the work rather than something the model can look at.
        if !plan.mockups.is_empty() {
            task.push_str(&format!(
                "UI mockups exist for this Solution ({}). You cannot see them — \
                 if the layout matters and the written changes do not describe it, \
                 say so rather than inventing one.\n",
                plan.mockups.join(", ")
            ));
        }
        task.push('\n');
    }
    task.push_str(
        "For EACH Solution above, give the schemas a developer would build from: \
         \"apiSchema\" (endpoints, their payloads and status codes — empty if this \
         Solution has no API), \"pageSchema\" (pages, their fields, and which \
         endpoints they call — empty if it has no UI), and \"filesToChange\" (the \
         paths you expect this work to touch). Name each Solution exactly as it is \
         written above. Design only what this work item asks for.",
    );
    task.push_str(ESCAPE_HATCH_CHANGE_PLAN);
    Prompt { context, task }
}

const ESCAPE_HATCH_CHANGE_PLAN: &str = "\n\nIf what the team has written is too \
     vague or contradictory to design from, do NOT invent the missing half. Return \
     an empty \"solutions\" list and fill in \"blocked\" with the reason and the \
     single most useful question a person could answer.";

fn change_plan_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "solutions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "solution": {"type": "string"},
                        "apiSchema": {"type": "string"},
                        "pageSchema": {"type": "string"},
                        "filesToChange": {"type": "string"}
                    },
                    "required": ["solution", "apiSchema", "pageSchema", "filesToChange"],
                    "additionalProperties": false
                }
            },
            "blocked": blocked_schema()
        },
        "required": ["solutions"],
        "additionalProperties": false
    })
}

/// Parses a change-plan response (pure — unit tested).
pub fn parse_change_plan(text: &str) -> Result<GeneratedChangePlan, String> {
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
            return Ok(GeneratedChangePlan::Blocked {
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

    let solutions: Vec<SolutionChange> = value
        .get("solutions")
        .and_then(|s| s.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|s| {
                    Some(SolutionChange {
                        solution: s.get("solution")?.as_str()?.trim().to_string(),
                        api_schema: strip_fence(s.get("apiSchema").and_then(|v| v.as_str()).unwrap_or("")),
                        page_schema: strip_fence(s.get("pageSchema").and_then(|v| v.as_str()).unwrap_or("")),
                        files_to_change: s
                            .get("filesToChange")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .trim()
                            .to_string(),
                    })
                })
                .filter(|s| !s.solution.is_empty())
                .collect()
        })
        .unwrap_or_default();

    if solutions.is_empty() {
        return Err("the AI response contained no solution changes".into());
    }
    Ok(GeneratedChangePlan::Plan(solutions))
}

/// Calls the provider for a work item's change plan.
pub async fn generate_change_plan(
    api_base_url: &str,
    api_key: &str,
    model: &str,
    effort: &str,
    prompt: &Prompt,
) -> Result<(GeneratedChangePlan, Usage), String> {
    let (json_text, usage) =
        post_structured(api_base_url, api_key, model, effort, prompt, change_plan_schema()).await?;
    Ok((parse_change_plan(&json_text)?, usage))
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

    /// The declared format is the caller's, not the model's. It was asked for
    /// one notation; letting the response redeclare it would defeat the check
    /// that runs next.
    #[test]
    fn a_diagram_keeps_the_format_it_was_asked_for() {
        let response = json!({
            "name": "How it fits",
            "content": "```mermaid\nflowchart TD\n  Web --> Api\n```",
            "explanation": "The web app calls the API."
        })
        .to_string();

        let GeneratedDiagram::Diagram(draft) = parse_diagram(&response, "mermaid").expect("parse")
        else {
            panic!("expected a diagram");
        };
        assert_eq!(draft.content, "flowchart TD\n  Web --> Api", "fence stripped");
        assert_eq!(draft.format, "mermaid");
        assert_eq!(draft.explanation, "The web app calls the API.");
    }

    /// A model answering in the wrong notation parses fine here — the format
    /// check is `diagram::check`'s job, and it runs before anything is stored.
    /// This test pins the division of labour so neither side starts guessing.
    #[test]
    fn the_parser_does_not_judge_notation_but_the_checker_does() {
        let response = json!({
            "name": "Infra",
            "content": "flowchart TD\n  A --> B",
            "explanation": ""
        })
        .to_string();

        let GeneratedDiagram::Diagram(draft) = parse_diagram(&response, "plantuml").expect("parse")
        else {
            panic!("expected a diagram");
        };
        assert_eq!(draft.format, "plantuml", "the parser takes the caller's word");
        assert!(
            crate::diagram::check(&draft.format, &draft.content).is_err(),
            "and the checker catches that it is not PlantUML"
        );
    }

    #[test]
    fn a_nameless_diagram_gets_a_placeholder_rather_than_an_empty_title() {
        let response = json!({ "name": "  ", "content": "flowchart TD\n A-->B", "explanation": "" });
        let GeneratedDiagram::Diagram(draft) =
            parse_diagram(&response.to_string(), "mermaid").expect("parse")
        else {
            panic!("expected a diagram");
        };
        assert_eq!(draft.name, "Untitled");
    }

    #[test]
    fn an_empty_diagram_is_an_error_and_a_refusal_is_a_question() {
        let empty = json!({ "name": "X", "content": "   ", "explanation": "" }).to_string();
        assert!(parse_diagram(&empty, "mermaid").is_err());

        let blocked = json!({
            "name": "", "content": "", "explanation": "",
            "blocked": { "reason": "No systems described.", "whatIsNeeded": "What talks to what?" }
        })
        .to_string();
        match parse_diagram(&blocked, "mermaid").expect("parse") {
            GeneratedDiagram::Blocked { reason, .. } => assert!(reason.contains("No systems")),
            other => panic!("expected Blocked, got {other:?}"),
        }
    }

    /// A second diagram should agree with the first rather than contradict it,
    /// so what already exists travels in the cacheable half.
    #[test]
    fn existing_architecture_is_given_as_context_to_agree_with() {
        let prompt = build_architecture_prompt(
            "Shop",
            "{}",
            "{}",
            &[],
            &["Web callsApi API".to_string()],
            &[("How it fits".to_string(), "flowchart TD\n Web-->Api".to_string())],
            "componentMap",
            "mermaid",
            "Draw the components",
        );
        assert!(prompt.context.contains("Web callsApi API"));
        assert!(prompt.context.contains("How it fits"));
        assert!(prompt.context.contains("must agree"));
        assert!(prompt.task.contains("Draw the components"));
        assert!(prompt.task.contains("Mermaid"));
        assert!(!prompt.task.contains("How it fits"), "context, not task");
    }

    /// The point of the whole feature: the questions Product already answered
    /// are clarifications on the item, so they reach the prompt without anyone
    /// re-typing them — in the cacheable half, with the rules.
    #[test]
    fn a_change_plan_prompt_carries_the_answers_and_asks_per_solution() {
        let rules = DeveloperRulesPrompt {
            coding_standards: "",
            architecture_principles: "",
            maintainability: "",
            preferred_frameworks: "",
            allowed_tech: "",
            disallowed_tech: "jQuery",
            ai_constraints: "",
        };
        let plans = [
            SolutionPlanPrompt {
                name: "Shop API",
                solution_type: "api",
                changes_required: "Add POST /checkout",
                unit_tests: "It charges once",
                mockups: &[],
            },
            SolutionPlanPrompt {
                name: "Shop Web",
                solution_type: "website",
                changes_required: "",
                mockups: &["C:/shots/basket.png".to_string()],
                unit_tests: "",
            },
        ];
        let prompt = build_change_plan_prompt(
            "Shop", "{}", "{}", "Add checkout", Some("Take payment"), &rules,
            &[("How it fits".into(), "flowchart TD".into())],
            &["Card payments only, no wallets.".to_string()],
            &plans,
        );

        assert!(prompt.context.contains("Card payments only"), "answers travel");
        assert!(prompt.context.contains("MUST NOT use"));
        assert!(prompt.context.contains("How it fits"));
        assert!(prompt.task.contains("Add POST /checkout"));
        assert!(prompt.task.contains("It charges once"));
        // a Solution with nothing written says so rather than looking complete
        assert!(prompt.task.contains("(not written yet)"));
        // and the mockup is named as a fact, with the model told it cannot see it
        assert!(prompt.task.contains("basket.png"));
        assert!(prompt.task.contains("You cannot see them"));
    }

    #[test]
    fn a_change_plan_parses_per_solution_with_fences_stripped() {
        let response = json!({
            "solutions": [
                {
                    "solution": "Shop API",
                    "apiSchema": "```json\n{\"POST /checkout\": {}}\n```",
                    "pageSchema": "",
                    "filesToChange": "src/api/checkout.rs"
                },
                { "solution": "  ", "apiSchema": "x", "pageSchema": "", "filesToChange": "" }
            ]
        })
        .to_string();

        let GeneratedChangePlan::Plan(changes) = parse_change_plan(&response).expect("parse") else {
            panic!("expected a plan");
        };
        assert_eq!(changes.len(), 1, "a nameless entry cannot be matched to a Solution");
        assert_eq!(changes[0].solution, "Shop API");
        assert_eq!(changes[0].api_schema, "{\"POST /checkout\": {}}");
    }

    #[test]
    fn an_empty_change_plan_is_an_error_and_a_refusal_is_a_question() {
        assert!(parse_change_plan(&json!({ "solutions": [] }).to_string()).is_err());

        let blocked = json!({
            "solutions": [],
            "blocked": { "reason": "No payment provider named.", "whatIsNeeded": "Which provider?" }
        })
        .to_string();
        match parse_change_plan(&blocked).expect("parse") {
            GeneratedChangePlan::Blocked { reason, .. } => assert!(reason.contains("payment")),
            other => panic!("expected Blocked, got {other:?}"),
        }
    }

    /// The file is the expensive, stable half of a pal prompt — several
    /// questions about the same code should hit the cache, not re-bill it.
    #[test]
    fn the_pal_carries_the_file_and_rules_in_the_cacheable_half() {
        let prompt = build_pal_prompt(
            "src/main.rs",
            "fn main() {}",
            "# Developer rules\n- MUST NOT use: jQuery\n",
            "refactor",
            "split this up",
            Some("fn main"),
        );
        assert!(prompt.context.contains("fn main() {}"));
        assert!(prompt.context.contains("jQuery"));
        assert!(!prompt.task.contains("Developer rules"));
        assert!(prompt.task.contains("split this up"));
        assert!(prompt.task.contains("fn main"), "the selection travels in the task");
        assert!(prompt.task.contains("elided line is a deleted line"));
    }

    /// Tests belong in a file of their own and the editor only saves the open
    /// one — so the tests action must not produce a replacement that would
    /// overwrite the code under test with its own tests.
    #[test]
    fn the_tests_action_asks_for_no_replacement() {
        let tests = build_pal_prompt("a.rs", "code", "", "tests", "", None);
        assert!(tests.task.contains("leave \"replacement\" empty"));

        let explain = build_pal_prompt("a.rs", "code", "", "explain", "", None);
        assert!(explain.task.contains("Leave \"replacement\" empty"));
    }

    #[test]
    fn a_pal_answer_parses_with_its_fence_stripped() {
        let response = json!({
            "explanation": "Split the function in two.",
            "replacement": "```rust\nfn main() { helper(); }\n```",
            "technologies": ["Rust", ""]
        })
        .to_string();

        let GeneratedPal::Answer(draft) = parse_pal(&response).expect("parse") else {
            panic!("expected an answer");
        };
        assert_eq!(draft.replacement, "fn main() { helper(); }");
        assert_eq!(draft.technologies, vec!["Rust"]);
    }

    #[test]
    fn a_pal_that_explains_nothing_is_an_error_and_a_refusal_is_a_question() {
        let empty = json!({ "explanation": " ", "replacement": "", "technologies": [] });
        assert!(parse_pal(&empty.to_string()).is_err());

        let blocked = json!({
            "explanation": "", "replacement": "", "technologies": [],
            "blocked": { "reason": "The instruction contradicts the rules.", "whatIsNeeded": "Which wins?" }
        })
        .to_string();
        match parse_pal(&blocked).expect("parse") {
            GeneratedPal::Blocked { reason, .. } => assert!(reason.contains("contradicts")),
            other => panic!("expected Blocked, got {other:?}"),
        }
    }

    /// Mermaid and JSON arrive fenced often enough that stripping is worth more
    /// than strictness — a fenced diagram is a valid diagram wearing a jacket,
    /// and `design_asset::save` would reject it for that alone.
    #[test]
    fn fenced_diagrams_and_tokens_are_unwrapped() {
        let response = json!({
            "strategy": "Warm and plain.",
            "tokens": "```json\n{\"colour\":{\"primary\":\"#1f6feb\"}}\n```",
            "flows": [
                { "name": "Sign-up", "diagram": "```mermaid\nflowchart TD\n  A --> B\n```" },
                { "name": "Checkout", "diagram": "flowchart TD\n  C --> D" }
            ],
            "components": "- Button\n- Field"
        })
        .to_string();

        let GeneratedDesign::Design(draft) = parse_design(&response).expect("parse") else {
            panic!("expected a design");
        };
        // r##"…"## because the hex colour contains `"#`
        assert_eq!(draft.tokens, r##"{"colour":{"primary":"#1f6feb"}}"##);
        assert_eq!(draft.flows[0].diagram, "flowchart TD\n  A --> B");
        assert_eq!(
            draft.flows[1].diagram, "flowchart TD\n  C --> D",
            "an unfenced diagram must pass through untouched"
        );
    }

    /// Marketing's artefacts arrive in the same response as the strategy;
    /// incomplete ones are dropped rather than stored half-made.
    #[test]
    fn marketing_assets_are_collected_and_incomplete_ones_dropped() {
        let response = json!({
            "strategy": "Sell to small teams.",
            "tokens": "",
            "flows": [],
            "components": "",
            "assets": [
                { "name": "Launch on the forum", "kind": "campaign", "content": "Post where the users already are." },
                { "name": "  ", "kind": "campaign", "content": "nameless" },
                { "name": "Empty", "kind": "messaging", "content": "  " }
            ]
        })
        .to_string();

        let GeneratedDesign::Design(draft) = parse_design(&response).expect("parse") else {
            panic!("expected a design");
        };
        assert_eq!(draft.assets.len(), 1);
        assert_eq!(draft.assets[0].kind, "campaign");
        assert_eq!(draft.assets[0].name, "Launch on the forum");
    }

    /// Marketing asks for artefacts; design is told to leave them empty.
    #[test]
    fn only_the_marketing_task_asks_for_assets() {
        let marketing = build_design_prompt("S", "{}", "{}", "marketing", "Go", None, &[]);
        let design = build_design_prompt("S", "{}", "{}", "design", "Go", None, &[]);

        assert!(marketing.task.contains("\"campaign\""));
        assert!(marketing.task.contains("launchPlan"));
        assert!(design.task.contains("Leave \"assets\" empty"));
    }

    #[test]
    fn a_design_response_without_a_strategy_is_an_error_not_an_empty_design() {
        let response = json!({ "strategy": "  ", "tokens": "", "flows": [], "components": "" });
        assert!(parse_design(&response.to_string()).is_err());
    }

    /// Same rule as everywhere else: a refusal beats a guess.
    #[test]
    fn a_blocked_design_is_a_question_not_a_failure() {
        let response = json!({
            "strategy": "",
            "tokens": "",
            "flows": [],
            "components": "",
            "blocked": { "reason": "No idea who this is for.", "whatIsNeeded": "Who are the users?" }
        })
        .to_string();

        match parse_design(&response).expect("parse") {
            GeneratedDesign::Blocked { reason, what_is_needed } => {
                assert!(reason.contains("No idea"));
                assert!(what_is_needed.contains("users"));
            }
            other => panic!("expected Blocked, got {other:?}"),
        }
    }

    #[test]
    fn nameless_or_empty_flows_are_dropped_rather_than_stored() {
        let response = json!({
            "strategy": "S",
            "tokens": "{}",
            "flows": [
                { "name": "  ", "diagram": "flowchart TD\n A-->B" },
                { "name": "Real", "diagram": "   " },
                { "name": "Kept", "diagram": "flowchart TD\n A-->B" }
            ],
            "components": ""
        })
        .to_string();

        let GeneratedDesign::Design(draft) = parse_design(&response).expect("parse") else {
            panic!("expected a design");
        };
        assert_eq!(draft.flows.len(), 1);
        assert_eq!(draft.flows[0].name, "Kept");
    }

    /// A design file is the most expensive thing in this prompt and the least
    /// likely to change between two questions about it, so it belongs in the
    /// cacheable half. Putting it in the task would re-bill it every time.
    #[test]
    fn a_linked_design_file_goes_in_the_cacheable_context_not_the_task() {
        let prompt = build_design_prompt(
            "Shop App",
            "{}",
            "{}",
            "design",
            "Refresh the look",
            Some("Figma file: Checkout\nPage \"Flows\"\n  Screens: Basket"),
            &[],
        );
        assert!(prompt.context.contains("Figma file: Checkout"));
        assert!(!prompt.task.contains("Figma file"));
        assert!(prompt.task.contains("Refresh the look"));
    }

    /// Marketing and design ask for different things; sharing a builder must
    /// not mean sharing a task.
    #[test]
    fn marketing_and_design_ask_for_different_work() {
        let marketing =
            build_design_prompt("S", "{}", "{}", "marketing", "Launch it", None, &[]);
        let design = build_design_prompt("S", "{}", "{}", "design", "Launch it", None, &[]);

        assert!(marketing.task.contains("pricing"));
        assert!(!marketing.task.contains("Mermaid"));
        assert!(design.task.contains("Mermaid"));
        assert!(!design.task.contains("pricing"));
        // both keep the escape hatch
        assert!(marketing.task.contains("do NOT invent"));
        assert!(design.task.contains("do NOT invent"));
    }

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
