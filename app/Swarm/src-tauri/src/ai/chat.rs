//! The chat on the app's home screen: what it is asked, the shape it must
//! answer in, and reading that answer back.
//!
//! **The AI proposes; the app decides.** A reply carries text and a list of
//! actions, each named from the list the app offered for this turn. Nothing
//! here runs one — the screen checks every action against the person's role
//! and asks before anything hard to undo, so a model that names an action it
//! was not offered gets a refusal on screen, never a side effect.
//!
//! Pure on purpose: the provider call is `ai::backend::chat`, the gate and the
//! ledger are `commands::chat`. What is left can be tested without a model.

use crate::ai::client::Prompt;
use serde::Deserialize;
use serde_json::{json, Value};

/// One line of the conversation so far.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ChatLine {
    /// `"person"` or `"ai"`.
    pub from: String,
    pub text: String,
}

/// An action the app offers the AI this turn — already narrowed to what the
/// active person may do, so the model is never told about a door it cannot use.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ActionOffer {
    pub name: String,
    pub description: String,
    /// The arguments, described in words for the model, e.g. `{"hive": one of …}`.
    pub args: String,
}

/// An action the AI asked for. `args` is JSON text, as the model wrote it:
/// the screen parses and checks it, because the screen is what runs it.
#[derive(Debug, Clone, PartialEq)]
pub struct ProposedAction {
    pub name: String,
    pub args: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ChatReply {
    pub reply: String,
    pub actions: Vec<ProposedAction>,
}

/// Builds the prompt.
///
/// The context — the app, the Product and the offered actions — is the same
/// for every turn about this Product, so it goes first where it can be cached.
/// The conversation is the task, because it changes every turn.
pub fn build_chat_prompt(
    product_name: &str,
    product_answers: &str,
    hives: &[String],
    offers: &[ActionOffer],
    history: &[ChatLine],
) -> Prompt {
    let mut context = format!(
        "You are the assistant on the home screen of Swarm, a desktop workspace where \
         Product, Developers and QA plan, build and test software. The person uses you \
         to set their workstation up and to get things done in the app.\n\n\
         The conversation is about the Product \"{product_name}\". What its brief says:\n\
         {product_answers}\n\n\
         The work areas (Hives) this person may open: {}.\n\n",
        if hives.is_empty() { "none".to_string() } else { hives.join(", ") },
    );
    if offers.is_empty() {
        context.push_str(
            "There are no actions you may take this turn. Answer in words, and put \
             nothing in \"actions\".\n",
        );
    } else {
        context.push_str(
            "The only actions you may take are these. Name one exactly, and write its \
             \"args\" as a JSON object in a string. The app checks each one and asks \
             the person before anything hard to undo, so say in your reply what you \
             are asking it to do:\n",
        );
        for offer in offers {
            context.push_str(&format!(
                "- {}: {} Args: {}\n",
                offer.name, offer.description, offer.args
            ));
        }
    }
    context.push_str(
        "\nIf you are asked for something no action covers, say so plainly rather than \
         pretending it was done.",
    );

    let mut task = String::from("The conversation so far:\n");
    for line in history {
        let who = if line.from == "ai" { "You" } else { "Person" };
        task.push_str(&format!("{who}: {}\n", line.text));
    }
    task.push_str("\nWrite your next reply.");

    Prompt { context, task }
}

pub fn chat_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "reply": {"type": "string"},
            "actions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        // A JSON *string*: each action's arguments differ, and
                        // a strict schema cannot hold an open object.
                        "args": {"type": "string"}
                    },
                    "required": ["name", "args"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["reply", "actions"],
        "additionalProperties": false
    })
}

#[derive(Deserialize)]
struct RawReply {
    reply: String,
    #[serde(default)]
    actions: Vec<RawAction>,
}

#[derive(Deserialize)]
struct RawAction {
    name: String,
    #[serde(default)]
    args: String,
}

/// Reads the model's JSON answer.
pub fn parse_chat(text: &str) -> Result<ChatReply, String> {
    let raw: RawReply = serde_json::from_str(text.trim())
        .map_err(|e| format!("the AI's reply was not the expected shape: {e}"))?;
    let reply = raw.reply.trim().to_string();
    if reply.is_empty() {
        return Err("the AI sent back an empty reply".into());
    }
    Ok(ChatReply {
        reply,
        actions: raw
            .actions
            .into_iter()
            .map(|a| ProposedAction {
                name: a.name.trim().to_string(),
                args: a.args,
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn offer(name: &str) -> ActionOffer {
        ActionOffer {
            name: name.into(),
            description: format!("does {name}"),
            args: "{}".into(),
        }
    }

    fn line(from: &str, text: &str) -> ChatLine {
        ChatLine { from: from.into(), text: text.into() }
    }

    #[test]
    fn the_context_names_the_product_the_hives_and_every_offered_action() {
        let prompt = build_chat_prompt(
            "Shop App",
            r#"{"purpose":"sell shoes"}"#,
            &["product".into(), "develop".into()],
            &[offer("openHive"), offer("setTheme")],
            &[line("person", "hello")],
        );
        for expected in ["Shop App", "sell shoes", "product", "develop", "openHive", "does setTheme"] {
            assert!(prompt.context.contains(expected), "context is missing {expected:?}");
        }
    }

    /// The conversation is the task and stays out of the cached context —
    /// otherwise every turn would re-bill the prefix it was meant to reuse.
    #[test]
    fn the_conversation_is_the_task_in_order() {
        let prompt = build_chat_prompt(
            "Shop App",
            "{}",
            &[],
            &[],
            &[line("person", "first"), line("ai", "second"), line("person", "third")],
        );
        let first = prompt.task.find("first").expect("first");
        let second = prompt.task.find("second").expect("second");
        let third = prompt.task.find("third").expect("third");
        assert!(first < second && second < third);
        assert!(!prompt.context.contains("third"));
    }

    /// With nothing offered the model must be told so, rather than left to
    /// guess at actions from the description of the app.
    #[test]
    fn says_so_when_no_action_is_offered() {
        let prompt = build_chat_prompt("Shop App", "{}", &[], &[], &[line("person", "hi")]);
        assert!(prompt.context.contains("no actions"));
    }

    #[test]
    fn reads_a_reply_with_actions() {
        let parsed = parse_chat(
            r#"{"reply":"Opening Develop.","actions":[{"name":"openHive","args":"{\"hive\":\"develop\"}"}]}"#,
        )
        .expect("parses");
        assert_eq!(parsed.reply, "Opening Develop.");
        assert_eq!(
            parsed.actions,
            [ProposedAction { name: "openHive".into(), args: r#"{"hive":"develop"}"#.into() }]
        );
    }

    #[test]
    fn reads_a_reply_with_no_actions() {
        let parsed = parse_chat(r#"{"reply":"Hello.","actions":[]}"#).expect("parses");
        assert!(parsed.actions.is_empty());
    }

    /// An empty reply would leave the person looking at nothing after paying
    /// for a turn; malformed JSON is the provider's failure, said as one.
    #[test]
    fn refuses_an_empty_reply_and_malformed_json() {
        assert!(parse_chat(r#"{"reply":"  ","actions":[]}"#).is_err());
        assert!(parse_chat("not json").is_err());
    }

    #[test]
    fn the_schema_requires_both_fields() {
        let schema = chat_schema();
        assert_eq!(schema["required"], json!(["reply", "actions"]));
        assert_eq!(schema["properties"]["actions"]["items"]["required"], json!(["name", "args"]));
    }
}
