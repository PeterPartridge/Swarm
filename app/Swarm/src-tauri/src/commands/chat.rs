//! The home-screen chat's one command: a turn of conversation about a Product.
//!
//! **No way around the gates.** A turn is checked against the Product's AI
//! policy (deny-by-default), routed and budgeted by `ai_run::plan`, and written
//! to the ledger under its own purpose, exactly as every other AI call is. The
//! chat is about a Product because that is what the policy, the budget and the
//! ledger are all kept against.
//!
//! **It runs nothing.** The reply names actions; the screen checks each one
//! against the person's role and asks before anything hard to undo. This
//! command never touches what an action would change.

use super::{ai_run, AppDb};
use crate::ai::{backend, chat};
use serde::Serialize;
use tauri::State;

const PURPOSE: &str = "chat";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposedActionDto {
    pub name: String,
    /// JSON text, as the model wrote it; the screen parses and checks it.
    pub args: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurn {
    pub reply: String,
    pub actions: Vec<ProposedActionDto>,
    pub provider: String,
    pub model: String,
    pub reason: String,
}

/// One turn: the conversation so far, the actions the screen offers this
/// person, and the Hives they may open. Refused before any content moves when
/// the Product's AI policy does not allow it.
#[tauri::command]
pub async fn chat_turn(
    db: State<'_, AppDb>,
    product_id: i64,
    history: Vec<chat::ChatLine>,
    offers: Vec<chat::ActionOffer>,
    hives: Vec<String>,
) -> Result<ChatTurn, String> {
    match history.last() {
        Some(line) if line.from == "person" => {}
        _ => return Err("there is nothing from you to answer yet".into()),
    }

    let (routed, prompt) = {
        let conn = db.0.lock().await;
        let (product, provider_id, effort_tier) =
            ai_run::product_policy_gate(&conn, product_id, "chat about it").await?;
        let routed = ai_run::plan(&conn, product_id, provider_id, &effort_tier, PURPOSE).await?;
        let prompt =
            chat::build_chat_prompt(&product.name, &product.answers, &hives, &offers, &history);
        (routed, prompt)
    };

    let started = std::time::Instant::now();
    let result = backend::chat(&routed.provider, &routed.model, &routed.effort, &prompt).await;
    let latency_ms = started.elapsed().as_millis() as i64;

    let conn = db.0.lock().await;
    let call = ai_run::Call {
        product_id,
        work_item_id: None,
        routed: &routed,
        purpose: PURPOSE,
        prompt: &prompt,
    };
    match result {
        Ok((reply, usage)) => {
            ai_run::record_ok(&conn, &call, latency_ms, &usage, &reply.reply).await;
            Ok(ChatTurn {
                reply: reply.reply,
                actions: reply
                    .actions
                    .into_iter()
                    .map(|a| ProposedActionDto { name: a.name, args: a.args })
                    .collect(),
                provider: routed.provider.name.clone(),
                model: routed.model.clone(),
                reason: routed.reason.clone(),
            })
        }
        Err(e) => Err(ai_run::record_failure(&conn, &call, latency_ms, e).await),
    }
}
