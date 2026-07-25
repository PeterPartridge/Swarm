//! The queue that lets you submit a work item and carry on.
//!
//! One task per submission, bounded by a semaphore sized from the Admin
//! setting. Progress is announced as Tauri events rather than polled, the same
//! way terminal output is: the UI asks once and then listens.
//!
//! **On the budget.** `ai_run::plan` reads the spend so far and decides; the
//! ledger row is written only when the call comes back. So with N calls in
//! flight, a call can pass the gate on a spend figure that N-1 others are
//! about to add to — the budget can be overshot by at most those N-1 calls.
//!
//! That is not fixed by a mutex around the gate: holding one from the decision
//! until the ledger write would serialise the whole AI call and remove the
//! concurrency the setting exists to provide. The honest answer is that the
//! **limit is the bound** — at 1, the default, the gate is exact and there is
//! no overshoot at all — and that the Admin screen says so where the number is
//! chosen. No estimated cost is ever written to the ledger to paper over it,
//! because a figure the app invented is worse than a bound it states.

use crate::commands::AppDb;
use crate::db::{ai_job, system_setting};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Semaphore;

/// Held in Tauri state so every submission shares one limit.
pub struct JobRunner {
    permits: Arc<Semaphore>,
}

impl JobRunner {
    /// Sized once at startup. Changing the setting takes effect next launch —
    /// resizing a semaphore under running work is a way to exceed the limit
    /// someone just lowered.
    pub fn new(limit: i64) -> Self {
        JobRunner {
            permits: Arc::new(Semaphore::new(limit.clamp(1, system_setting::AI_CONCURRENCY_MAX) as usize)),
        }
    }

    pub fn available(&self) -> usize {
        self.permits.available_permits()
    }
}

/// Runs one queued job to completion, waiting for a slot first.
///
/// Spawned and not awaited by the caller — that is the whole point: the command
/// that submits returns as soon as the row is written, and the work happens
/// behind it.
pub fn spawn(app: AppHandle, runner: Arc<JobRunner>, job_id: i64, work_item_id: i64) {
    tauri::async_runtime::spawn(async move {
        // The database is fetched from the app handle rather than passed in, so
        // that adding a queue does not mean changing the signature of every
        // command that already takes `State<'_, AppDb>`.
        let db = app.state::<AppDb>();
        let db: &AppDb = db.inner();
        let permits = runner.permits.clone();
        // The queue's whole behaviour in one line: wait here until a slot is
        // free, which is what makes the second submission queue rather than
        // race the first.
        let _permit = match permits.acquire_owned().await {
            Ok(permit) => permit,
            Err(_) => return,
        };

        {
            let conn = db.0.lock().await;
            if ai_job::mark_running(&conn, job_id).await.is_err() {
                return;
            }
        }
        announce(&app);

        let outcome = crate::commands::work_item_plans::run_change_plan(db, work_item_id).await;

        let (state, message) = match outcome {
            // A refusal to guess is not a failure: the AI asked a question and
            // it is now on the work item with the others.
            Ok(result) if result.blocked.is_some() => {
                let blocked = result.blocked.expect("just checked");
                (
                    "blocked",
                    format!("{} {}", blocked.reason, blocked.what_is_needed),
                )
            }
            Ok(result) => (
                "done",
                if result.created.is_empty() {
                    format!("nothing came back ({})", result.reason)
                } else {
                    format!("{} ({})", result.created.join(", "), result.reason)
                },
            ),
            Err(message) => ("failed", message),
        };

        {
            let conn = db.0.lock().await;
            let _ = ai_job::finish(&conn, job_id, state, &message).await;
        }
        announce(&app);
    });
}

/// Tells the UI something moved. Nothing is carried in the event — the list is
/// re-read — so an event that arrives out of order cannot show a stale row.
fn announce(app: &AppHandle) {
    let _ = app.emit("ai-job-changed", ());
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The limit is the bound on how far a budget can be overshot, so it must
    /// hold whatever the setting says — including nonsense edited in by hand.
    #[test]
    fn the_limit_is_clamped_to_something_a_provider_survives() {
        assert_eq!(JobRunner::new(1).available(), 1);
        assert_eq!(JobRunner::new(4).available(), 4);
        assert_eq!(JobRunner::new(0).available(), 1, "never zero, or nothing runs");
        assert_eq!(JobRunner::new(-5).available(), 1);
        assert_eq!(
            JobRunner::new(9999).available(),
            system_setting::AI_CONCURRENCY_MAX as usize
        );
    }

    /// The queue's whole behaviour: the second waits for the first's slot.
    #[tokio::test]
    async fn a_second_job_waits_when_the_limit_is_one() {
        let runner = JobRunner::new(1);
        let first = runner.permits.clone().acquire_owned().await.expect("first slot");
        assert_eq!(runner.available(), 0);

        let permits = runner.permits.clone();
        let waiting = tokio::spawn(async move { permits.acquire_owned().await.is_ok() });
        // Still waiting: nothing has been released.
        assert!(!waiting.is_finished());

        drop(first);
        assert!(waiting.await.expect("join"), "the slot frees the next job");
    }

    /// At two, two run at once — which is what the setting is for.
    #[tokio::test]
    async fn raising_the_limit_lets_more_run_at_once() {
        let runner = JobRunner::new(2);
        let _a = runner.permits.clone().acquire_owned().await.expect("a");
        let _b = runner.permits.clone().acquire_owned().await.expect("b");
        assert_eq!(runner.available(), 0, "both slots taken, a third would wait");
    }
}
