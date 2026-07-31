//! Submitting work to the AI and watching the queue.

use super::{to_message, AppDb};
use crate::db::{ai_job, system_setting};
use crate::agent::jobs::JobRunner;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiJobDto {
    pub id: i64,
    pub work_item_id: i64,
    /// Carried so the queue can name the work rather than show a number.
    pub work_item_title: String,
    pub purpose: String,
    pub state: String,
    pub message: String,
    pub submitted_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
}

/// Recent AI jobs across every Product, for the topbar's notifications.
///
/// Titles are resolved from every work item at once rather than one query per
/// row — the bell opens on a click and a query per notification would be felt.
#[tauri::command]
pub async fn list_recent_ai_jobs(db: State<'_, AppDb>) -> Result<Vec<AiJobDto>, String> {
    let conn = db.0.lock().await;
    let jobs = ai_job::list_recent(&conn, 20).await.map_err(to_message)?;
    let items = crate::db::work_item::list_all(&conn)
        .await
        .map_err(to_message)?;

    Ok(jobs
        .into_iter()
        .map(|j| AiJobDto {
            work_item_title: items
                .iter()
                .find(|i| i.id == j.work_item_id)
                .map(|i| i.title.clone())
                .unwrap_or_else(|| format!("#{}", j.work_item_id)),
            id: j.id,
            work_item_id: j.work_item_id,
            purpose: j.purpose,
            state: j.state,
            message: j.message,
            submitted_at: j.submitted_at,
            started_at: j.started_at,
            finished_at: j.finished_at,
        })
        .collect())
}

/// Stops a queued or running AI job.
///
/// **What this can and cannot do, which is the whole point of the message it
/// returns.** A *queued* job has not reached a provider, so stopping it costs
/// nothing and there is nothing to be said. A *running* one has a request in
/// flight: aborting the task stops this app waiting, and for the local paths —
/// Ollama, or Claude Code, where the child process is killed — that really is
/// the end of it. For a metered HTTPS provider it is not: the request already
/// left, and the model may generate and charge for a reply nobody is listening
/// for.
///
/// That reply never comes back, so `ai_run::record` never runs and **the spend
/// does not reach the ledger**. The app says so rather than quietly
/// understating the bill, and it does not invent a figure to fill the gap —
/// the same rule that keeps estimated costs out of the ledger everywhere else.
#[tauri::command]
pub async fn cancel_ai_job(
    db: State<'_, AppDb>,
    runner: State<'_, Arc<JobRunner>>,
    id: i64,
) -> Result<String, String> {
    // The row first, then the task: aborting at an arbitrary await point means
    // the task may never write anything again, so the database has to be right
    // before the task can stop being able to correct it.
    let was = {
        let conn = db.0.lock().await;
        ai_job::cancel(&conn, id, "cancelled").await.map_err(to_message)?
    };
    let Some(was) = was else {
        return Ok("That job had already finished, so there was nothing to stop.".into());
    };
    runner.abort(id);

    Ok(if was == "queued" {
        "Stopped before it reached a provider, so nothing was spent.".into()
    } else {
        "Stopped waiting for it. If it had already reached a paid provider that call \
         may still be charged — and because no reply came back, it will not appear in \
         the ledger."
            .into()
    })
}

/// Queues a work item for planning and returns at once.
///
/// The whole point: this writes a row, starts a task behind it and comes back,
/// so the next work item can be written up and submitted while this one runs.
#[tauri::command]
pub async fn submit_for_planning(
    app: AppHandle,
    db: State<'_, AppDb>,
    runner: State<'_, Arc<JobRunner>>,
    work_item_id: i64,
) -> Result<i64, String> {
    let job_id = {
        let conn = db.0.lock().await;
        ai_job::submit(&conn, work_item_id, "changePlan")
            .await
            .map_err(to_message)?
    };
    crate::agent::jobs::spawn(app, runner.inner().clone(), job_id, work_item_id);
    Ok(job_id)
}

#[tauri::command]
pub async fn list_ai_jobs(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Vec<AiJobDto>, String> {
    let conn = db.0.lock().await;
    let jobs = ai_job::list_for_product(&conn, product_id)
        .await
        .map_err(to_message)?;
    // Titles in one pass rather than a lookup per row.
    let items = crate::db::work_item::list_by_product(&conn, product_id)
        .await
        .map_err(to_message)?;

    Ok(jobs
        .into_iter()
        .map(|j| AiJobDto {
            work_item_title: items
                .iter()
                .find(|i| i.id == j.work_item_id)
                .map(|i| i.title.clone())
                .unwrap_or_else(|| format!("#{}", j.work_item_id)),
            id: j.id,
            work_item_id: j.work_item_id,
            purpose: j.purpose,
            state: j.state,
            message: j.message,
            submitted_at: j.submitted_at,
            started_at: j.started_at,
            finished_at: j.finished_at,
        })
        .collect())
}

/// The limit, and how many slots are free right now.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Concurrency {
    pub limit: i64,
    /// Free slots — so the panel can say "2 running, 1 free" rather than
    /// leaving someone to count.
    pub available: i64,
}

#[tauri::command]
pub async fn get_ai_concurrency(
    db: State<'_, AppDb>,
    runner: State<'_, Arc<JobRunner>>,
) -> Result<Concurrency, String> {
    let conn = db.0.lock().await;
    Ok(Concurrency {
        limit: system_setting::ai_concurrency(&conn)
            .await
            .map_err(to_message)?,
        available: runner.available() as i64,
    })
}

/// Sets how many AI calls may run at once.
///
/// Takes effect next launch: resizing the limit under running work is a way to
/// exceed the number somebody has just lowered.
#[tauri::command]
pub async fn set_ai_concurrency(db: State<'_, AppDb>, limit: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    system_setting::set_ai_concurrency(&conn, limit)
        .await
        .map_err(to_message)
}
