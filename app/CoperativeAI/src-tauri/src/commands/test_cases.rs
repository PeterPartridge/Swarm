//! Test-case commands (Test tab): QA's plain-English scenarios, each optionally
//! associated with a Deliverable or a Work Item.
//!
//! **Implementing one is gated on the work item's policy, strictly.** The
//! deny-by-default policy that decides whether AI may touch a piece of work
//! belongs to a *work item*, so a scenario associated with a Deliverable — or
//! with nothing, which the model allows so a test can be written before the
//! work exists — has no policy to ask, and no policy means no. Borrowing the
//! Product policy that covers deliverable planning would be looser than QA
//! asked for and would let AI write tests for work nobody has planned yet.

use super::{to_message, AppDb};
use crate::db::test_case::{self, TestCase};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestCaseDto {
    pub id: i64,
    pub product_id: i64,
    pub title: String,
    pub scenario: String,
    pub state: String,
    pub test_path: Option<String>,
    pub deliverable_id: Option<i64>,
    pub work_item_id: Option<i64>,
    pub test_names: Vec<String>,
    pub last_run_at: Option<i64>,
    pub last_run_outcome: Option<String>,
    pub last_run_summary: Option<String>,
}

impl From<TestCase> for TestCaseDto {
    fn from(t: TestCase) -> Self {
        TestCaseDto {
            id: t.id,
            product_id: t.product_id,
            title: t.title,
            scenario: t.scenario,
            state: t.state,
            test_path: t.test_path,
            deliverable_id: t.deliverable_id,
            work_item_id: t.work_item_id,
            test_names: t.test_names,
            last_run_at: t.last_run_at,
            last_run_outcome: t.last_run_outcome,
            last_run_summary: t.last_run_summary,
        }
    }
}

#[tauri::command]
pub async fn list_test_cases(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Vec<TestCaseDto>, String> {
    let conn = db.0.lock().await;
    let cases = test_case::list_by_product(&conn, product_id)
        .await
        .map_err(to_message)?;
    Ok(cases.into_iter().map(TestCaseDto::from).collect())
}

#[tauri::command]
pub async fn create_test_case(
    db: State<'_, AppDb>,
    product_id: i64,
    title: String,
    scenario: String,
    deliverable_id: Option<i64>,
    work_item_id: Option<i64>,
) -> Result<i64, String> {
    let conn = db.0.lock().await;
    test_case::create(&conn, product_id, &title, &scenario, deliverable_id, work_item_id)
        .await
        .map_err(to_message)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_test_case(
    db: State<'_, AppDb>,
    id: i64,
    title: String,
    scenario: String,
    state: String,
    test_path: Option<String>,
    deliverable_id: Option<i64>,
    work_item_id: Option<i64>,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    test_case::update_case(
        &conn,
        id,
        &test_case::TestCaseUpdate {
            title: &title,
            scenario: &scenario,
            state: &state,
            test_path: test_path.as_deref(),
            deliverable_id,
            work_item_id,
        },
    )
    .await
    .map_err(to_message)
}

#[tauri::command]
pub async fn delete_test_case(db: State<'_, AppDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    test_case::delete(&conn, id).await.map_err(to_message)
}

/// A scenario, and the working copy its test lives in.
///
/// Both things done to a scenario's test — writing one and running one — have
/// to answer the same question first: which repository on this machine does
/// this scenario's work item point at? Resolved once here rather than twice.
#[derive(Debug)]
pub(crate) struct ScenarioPlace {
    pub case: TestCase,
    pub work_item: crate::db::work_item::WorkItem,
    pub solution: crate::db::solution::Solution,
    /// The Solution's working copy — checked non-null so neither a paid call
    /// nor a test run happens when there is nowhere for it to happen.
    pub root: String,
}

/// Walks a scenario to the folder its test belongs in, refusing at whichever
/// link is missing and saying which one it was.
pub(crate) async fn resolve_scenario_place(
    conn: &turso::Connection,
    case: TestCase,
) -> Result<ScenarioPlace, String> {
    use crate::db::{solution, work_item};

    let Some(work_item_id) = case.work_item_id else {
        return Err(format!(
            "'{}' is not associated with a work item, so there is no Solution to find. Associate it with the work item it tests, then try again.",
            case.title
        ));
    };
    let Some(work_item) = work_item::find_by_id(conn, work_item_id)
        .await
        .map_err(to_message)?
    else {
        return Err("this scenario's work item no longer exists".into());
    };
    let Some(solution_id) = work_item.solution_id else {
        return Err(format!(
            "'{}' is not linked to a Solution, so there is no repository for its test. Set the work item's Solution first.",
            work_item.title
        ));
    };
    let Some(solution) = solution::find_by_id(conn, solution_id)
        .await
        .map_err(to_message)?
    else {
        return Err("this work item's Solution no longer exists".into());
    };
    let Some(root) = solution.local_path.clone().filter(|p| !p.trim().is_empty()) else {
        return Err(format!(
            "the Solution '{}' has no working copy on this machine. Point it at a folder in Develop → Solutions, then try again.",
            solution.name
        ));
    };
    Ok(ScenarioPlace {
        case,
        work_item,
        solution,
        root,
    })
}

/// The gate for **running** a scenario's test.
///
/// No AI policy: running a test is not an AI call — no provider, no prompt, no
/// spend. It executes code from a repository the app already runs whole suites
/// from, so a policy here would imply a protection that does not exist.
pub(crate) async fn resolve_test_run(
    conn: &turso::Connection,
    test_case_id: i64,
) -> Result<ScenarioPlace, String> {
    let Some(case) = test_case::find_by_id(conn, test_case_id)
        .await
        .map_err(to_message)?
    else {
        return Err(format!("no test case with id {test_case_id}"));
    };
    if case.state != "implemented" || case.test_path.as_deref().unwrap_or("").trim().is_empty() {
        return Err(format!(
            "'{}' has no test to run yet — implement it first, or record where its test lives.",
            case.title
        ));
    }
    resolve_scenario_place(conn, case).await
}

/// Everything the gates resolve before any content moves: the scenario, the
/// work item it belongs to, the working copy the test lands in, and the
/// provider and effort its policy allows.
pub(crate) struct TestImplementationContext {
    pub case: TestCase,
    pub work_item: crate::db::work_item::WorkItem,
    pub solution: crate::db::solution::Solution,
    /// The Solution's working copy — checked non-null here so the network call
    /// is never paid for when there is nowhere to put the answer.
    pub root: String,
    pub provider: crate::db::ai_provider::AiProvider,
    pub effort_tier: String,
}

/// The deny-by-default gate for implementing one scenario, kept separate from
/// the command so it is unit testable without a credential store or a network.
pub(crate) async fn resolve_test_implementation(
    conn: &turso::Connection,
    test_case_id: i64,
) -> Result<TestImplementationContext, String> {
    use crate::db::work_item_policy;

    let Some(case) = test_case::find_by_id(conn, test_case_id)
        .await
        .map_err(to_message)?
    else {
        return Err(format!("no test case with id {test_case_id}"));
    };
    // Cheaper to refuse here than to pay for a call whose answer cannot land:
    // `write_new_file` will not overwrite, and the existing test is somebody's.
    if case.state == "implemented" {
        return Err(format!(
            "'{}' is already implemented{}. Set it back to designed, or delete the test file, to write it again.",
            case.title,
            case.test_path
                .as_deref()
                .map(|p| format!(" at {p}"))
                .unwrap_or_default()
        ));
    }
    let Some(work_item_id) = case.work_item_id else {
        return Err(format!(
            "'{}' is not associated with a work item, so there is no AI policy to ask (deny-by-default). Associate it with the work item it tests, then try again.",
            case.title
        ));
    };

    // The item's own gate — provider and effort — then the use-specific flag.
    // Checked before the working copy is looked for: a refusal about policy is
    // the more useful one to hear first, and it costs no filesystem work.
    let title = super::work_items::title_of(conn, work_item_id).await?;
    let (provider, effort_tier) =
        super::work_items::resolve_item_ai_gate(conn, work_item_id, &title).await?;
    if !work_item_policy::is_allowed(
        conn,
        work_item_id,
        work_item_policy::AiUse::GenerateTests,
        provider.id,
    )
    .await
    .map_err(to_message)?
    {
        return Err(format!(
            "'{title}''s AI policy does not allow generating tests. Turn that on in the work item's AI policy — reading and editing are not the same permission."
        ));
    }

    let place = resolve_scenario_place(conn, case).await?;
    Ok(TestImplementationContext {
        case: place.case,
        work_item: place.work_item,
        solution: place.solution,
        root: place.root,
        provider,
        effort_tier,
    })
}

/// What implementing a scenario produced, for the Test area to show.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestImplementationResult {
    /// Where the test was written, relative to the Solution's working copy.
    /// Empty when the AI declined.
    pub test_path: String,
    pub provider: String,
    pub model: String,
    /// The router's plain-English explanation of why this provider and model.
    pub reason: String,
    /// Set when the AI declined rather than writing a test that asserts
    /// nothing. `test_path` is then empty and a question is waiting against
    /// the work item.
    pub blocked: Option<super::work_items::BlockedDto>,
}

/// Implements one QA scenario as a real test file.
///
/// The three beats every generation command here follows: gates and routing
/// under the DB lock, the network call without it, then the ledger and the
/// result under it again.
#[tauri::command]
pub async fn implement_test_case(
    db: State<'_, AppDb>,
    test_case_id: i64,
) -> Result<TestImplementationResult, String> {
    use crate::ai::{backend, client};
    use crate::commands::ai_run;
    use crate::db::ai_feedback;

    const PURPOSE: &str = "testImplementation";

    let (context, routed, prompt, product_id, work_item_id) = {
        let conn = db.0.lock().await;
        let context = resolve_test_implementation(&conn, test_case_id).await?;
        let product_id = context.case.product_id;
        let work_item_id = context.work_item.id;
        let routed = ai_run::plan(
            &conn,
            product_id,
            context.provider.id,
            &context.effort_tier,
            PURPOSE,
        )
        .await?;
        // Detected outside the lock's critical work but inside this block for
        // simplicity: reading a few directory entries is not a network call.
        let suites = crate::tooling::test_runner::detect(std::path::Path::new(&context.root));
        // **What has to change in this Solution**, not a work-item-wide notes
        // field. The item's "development details" box was removed on
        // 2026-08-21: the standing conventions live in the Developer Rules and
        // the specifics live per Solution, which is also the only one of the
        // two that is about *this* repository.
        let build_notes = crate::db::work_item_plan::list_for_item(&conn, work_item_id)
            .await
            .map_err(to_message)?
            .into_iter()
            .find(|p| p.solution_id == context.solution.id)
            .map(|p| p.changes_required)
            .unwrap_or_default();
        let prompt = client::build_test_prompt(&client::TestPrompt {
            work_item_title: &context.work_item.title,
            work_item_description: context.work_item.description.as_deref().unwrap_or(""),
            build_notes: &build_notes,
            scenario_title: &context.case.title,
            scenario: &context.case.scenario,
            language: context.solution.language.as_deref(),
            suites: &suites,
        });
        (context, routed, prompt, product_id, work_item_id)
    };

    let started = std::time::Instant::now();
    let result = backend::generate_test(
        &routed.provider,
        &routed.model,
        &routed.effort,
        &prompt,
    )
    .await;
    let latency_ms = started.elapsed().as_millis() as i64;

    let draft = match result {
        Ok((client::GeneratedTest::Test(draft), usage)) => {
            let conn = db.0.lock().await;
            ai_run::record_ok(
                &conn,
                &ai_run::Call {
                    product_id,
                    work_item_id: Some(work_item_id),
                    routed: &routed,
                    purpose: PURPOSE,
                    prompt: &prompt,
                },
                latency_ms,
                &usage,
                &format!("{}\n\n{}", draft.path, draft.contents),
            )
            .await;
            draft
        }
        // Declined: the scenario is too thin to test. That is a question for
        // QA, recorded against the work item through the same channel every
        // other refusal uses, rather than a test that asserts nothing.
        Ok((client::GeneratedTest::Blocked { reason, what_is_needed }, usage)) => {
            let conn = db.0.lock().await;
            ai_run::record_declined(
                &conn,
                &ai_run::Call {
                    product_id,
                    work_item_id: Some(work_item_id),
                    routed: &routed,
                    purpose: PURPOSE,
                    prompt: &prompt,
                },
                latency_ms,
                &usage,
                &reason,
                &what_is_needed,
            )
            .await;
            let feedback_id = ai_feedback::record(
                &conn, work_item_id, "needsInformation", &reason, &what_is_needed, None,
            )
            .await
            .map_err(to_message)?;
            return Ok(TestImplementationResult {
                test_path: String::new(),
                provider: routed.provider.name.clone(),
                model: routed.model.clone(),
                reason: routed.reason.clone(),
                blocked: Some(super::work_items::BlockedDto {
                    reason,
                    what_is_needed,
                    feedback_id,
                }),
            });
        }
        Err(e) => {
            let conn = db.0.lock().await;
            let e = ai_run::record_failure(
                &conn,
                &ai_run::Call {
                    product_id,
                    work_item_id: Some(work_item_id),
                    routed: &routed,
                    purpose: PURPOSE,
                    prompt: &prompt,
                },
                latency_ms,
                e,
            )
            .await;
            return Err(e);
        }
    };

    // The write is the last thing that can fail, and it happens before the
    // scenario is marked implemented — so a refused path leaves the case
    // exactly as it was rather than pointing at a file that was never written.
    crate::files::workspace::write_new_file(&context.root, &draft.path, &draft.contents)?;

    let conn = db.0.lock().await;
    // Through `set_implementation` rather than the general update: this is the
    // outcome of implementing a scenario, not somebody editing one, and
    // restating the title and scenario here is how they get overwritten.
    test_case::set_implementation(&conn, test_case_id, &draft.path, &draft.names)
        .await
        .map_err(to_message)?;

    Ok(TestImplementationResult {
        test_path: draft.path,
        provider: routed.provider.name.clone(),
        model: routed.model.clone(),
        reason: routed.reason.clone(),
        blocked: None,
    })
}

/// What running a scenario's test produced.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestRunResult {
    /// `passed` | `failed` | `skipped` | `errored`.
    pub outcome: String,
    /// A short human summary — counts when a parser read them, and the reason
    /// they are absent when it did not.
    pub summary: String,
    /// **Whether this verdict is about this scenario's own tests.** False means
    /// the whole suite ran and nothing could be attributed, so `outcome` is the
    /// suite's — which may be red for reasons that have nothing to do with this
    /// scenario. The UI must say so rather than showing a bare verdict.
    pub about_this_test: bool,
    /// Whether the run was narrowed to this test rather than the whole suite.
    pub narrowed: bool,
    /// The suite that ran, as a person would type it.
    pub command_line: String,
    /// The runner's full output. Returned, never stored.
    pub output: String,
    pub duration_ms: i64,
}

/// Runs the test written for one scenario, and records how it went.
///
/// **A red result is the expected one before the work is built** — that is the
/// project's own TDD rule, so nothing here treats failure as an error. It runs,
/// it records, and it leaves the reading to the person looking at it.
#[tauri::command]
pub async fn run_test_case(
    db: State<'_, AppDb>,
    test_case_id: i64,
) -> Result<TestRunResult, String> {
    use crate::tooling::test_runner;

    let (place, custom) = {
        let conn = db.0.lock().await;
        let place = resolve_test_run(&conn, test_case_id).await?;
        let custom = place
            .solution
            .test_command
            .clone()
            .filter(|c| !c.trim().is_empty());
        (place, custom)
    };

    let test_path = place.case.test_path.clone().unwrap_or_default();
    let root = place.root.clone();
    let names = place.case.test_names.clone();

    // A Solution's own command replaces detection, exactly as it does for the
    // Test Explorer — somebody typed it because detection got it wrong here.
    let suites = match &custom {
        Some(command) => vec![test_runner::custom_suite(command)],
        None => test_runner::detect(std::path::Path::new(&root)),
    };
    let Some(suite) = test_runner::suite_for(&suites, &test_path).cloned() else {
        return Err(format!(
            "nothing recognisable runs '{test_path}' in {} — set a test command on the Solution and try again.",
            place.solution.name
        ));
    };
    let narrowed = test_runner::narrowed(&suite, &test_path, &names);
    let to_run = narrowed.clone().unwrap_or_else(|| suite.clone());

    // `test_runner::run` shells out and blocks until the runner exits, which
    // for a real suite is seconds to minutes. On the async runtime's own thread
    // that would stall every other command for the duration.
    let run = {
        let root = root.clone();
        let to_run = to_run.clone();
        tokio::task::spawn_blocking(move || {
            test_runner::run(std::path::Path::new(&root), &to_run)
        })
        .await
        .map_err(|e| format!("the test run could not be started: {e}"))?
    };

    // Attribution first: a scenario's own verdict beats the suite's whenever
    // the names can be found in what the runner reported.
    let attributed = test_runner::outcome_for(&names, &run);
    let about_this_test = attributed.is_some() || narrowed.is_some();
    let outcome = attributed.unwrap_or_else(|| match (run.exit_ok, run.counted, run.failed) {
        (_, true, failed) if failed > 0 => "failed".to_string(),
        (true, _, _) => "passed".to_string(),
        (false, _, _) => "failed".to_string(),
    });
    let summary = if run.counted {
        format!("{} passed, {} failed, {} skipped", run.passed, run.failed, run.skipped)
    } else {
        // The existing rule, kept: an invented count is worse than none.
        "by exit code only — no parser recognised this runner's output".to_string()
    };

    {
        let conn = db.0.lock().await;
        test_case::record_run(&conn, test_case_id, &outcome, &summary)
            .await
            .map_err(to_message)?;
    }

    Ok(TestRunResult {
        outcome,
        summary,
        about_this_test,
        narrowed: narrowed.is_some(),
        command_line: to_run.command_line,
        output: run.output,
        duration_ms: run.duration_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::{resolve_test_implementation, resolve_test_run};
    use crate::db::product::tests::db_with_product;
    use crate::db::{ai_provider, deliverable, solution, test_case, work_item, work_item_policy};

    /// A Product, a provider, and a work item with a Solution pointed at a real
    /// folder — everything an implementable scenario needs except the policy,
    /// which each test sets for itself.
    async fn ready_to_implement() -> (turso::Connection, i64, i64, i64) {
        let (conn, product_id) = db_with_product().await;
        let provider = ai_provider::add(
            &conn,
            "Claude",
            "https://api.anthropic.com",
            &["claude-sonnet-5"],
            "coperativeai/claude",
        )
        .await
        .expect("provider");
        let item = work_item::create(&conn, "User login", "feature", product_id, None, None)
            .await
            .expect("work item");
        let root = crate::testing::scratch_str("test-cases", "implement");
        let sol = solution::create(&conn, "Web", product_id, "website", "{}")
            .await
            .expect("solution");
        solution::set_local_path(&conn, sol, Some(&root))
            .await
            .expect("local path");
        work_item::update_item(
            &conn,
            item,
            work_item::WorkItemFields {
                solution_id: Some(sol),
                ..Default::default()
            },
        )
        .await
        .expect("link solution");
        (conn, product_id, item, provider)
    }

    async fn scenario_for(
        conn: &turso::Connection,
        product_id: i64,
        work_item_id: Option<i64>,
        deliverable_id: Option<i64>,
    ) -> i64 {
        test_case::create(
            conn,
            product_id,
            "Wrong password is rejected",
            "Given a registered user, when they enter the wrong password, then they are not signed in.",
            deliverable_id,
            work_item_id,
        )
        .await
        .expect("test case")
    }

    /// **The strict rule.** The policy that decides whether AI may write a test
    /// is a *work item's* policy, so a scenario with no work item has nobody to
    /// ask — and deny-by-default means "nobody to ask" is a refusal, not a
    /// waiver. A Deliverable-linked case is the same: the Product policy that
    /// covers deliverable planning is deliberately coarser, and borrowing it
    /// here would let AI write a test for work that does not exist yet.
    #[tokio::test]
    async fn a_scenario_with_no_work_item_has_no_policy_to_ask() {
        let (conn, product_id, _item, _provider) = ready_to_implement().await;

        let unlinked = scenario_for(&conn, product_id, None, None).await;
        let err = resolve_test_implementation(&conn, unlinked)
            .await
            .err()
            .expect("must refuse");
        assert!(err.contains("work item"), "got: {err}");

        let d = deliverable::create(&conn, product_id, "MVP", "the first release")
            .await
            .expect("deliverable");
        let on_deliverable = scenario_for(&conn, product_id, None, Some(d)).await;
        let err = resolve_test_implementation(&conn, on_deliverable)
            .await
            .err()
            .expect("must refuse");
        assert!(err.contains("work item"), "got: {err}");
    }

    #[tokio::test]
    async fn a_work_item_with_no_ai_policy_refuses_deny_by_default() {
        let (conn, product_id, item, _provider) = ready_to_implement().await;
        let case = scenario_for(&conn, product_id, Some(item), None).await;
        let err = resolve_test_implementation(&conn, case)
            .await
            .err()
            .expect("must refuse");
        assert!(err.contains("deny-by-default"), "got: {err}");
    }

    /// The spec's outstanding test, and the reason this round exists:
    /// `allowGenerateTests` has been a column with a gate and no caller since
    /// round 2. Reading and editing are not permission to write a test.
    #[tokio::test]
    async fn reading_and_editing_are_not_permission_to_write_a_test() {
        let (conn, product_id, item, provider) = ready_to_implement().await;
        let case = scenario_for(&conn, product_id, Some(item), None).await;

        work_item_policy::set_policy(&conn, item, true, true, false, Some(provider), "medium")
            .await
            .expect("policy");
        let err = resolve_test_implementation(&conn, case)
            .await
            .err()
            .expect("must refuse");
        assert!(err.contains("generating tests"), "got: {err}");

        // …and the same policy with the one flag turned on goes through.
        work_item_policy::set_policy(&conn, item, true, true, true, Some(provider), "medium")
            .await
            .expect("policy");
        let context = resolve_test_implementation(&conn, case)
            .await
            .expect("must be allowed");
        assert_eq!(context.provider.id, provider);
        assert_eq!(context.effort_tier, "medium");
        assert_eq!(context.work_item.title, "User login");
    }

    /// A test has to be written *somewhere*. Both halves of "which folder" can
    /// be missing independently, and a refusal that did not say which would
    /// send someone looking in the wrong place.
    #[tokio::test]
    async fn a_test_needs_a_solution_and_a_working_copy_to_land_in() {
        let (conn, product_id, item, provider) = ready_to_implement().await;
        let case = scenario_for(&conn, product_id, Some(item), None).await;
        work_item_policy::set_policy(&conn, item, true, true, true, Some(provider), "medium")
            .await
            .expect("policy");

        // The Solution is there but nobody has pointed it at a working copy.
        let sol = work_item::find_by_id(&conn, item)
            .await
            .expect("query")
            .expect("item")
            .solution_id
            .expect("solution");
        solution::set_local_path(&conn, sol, None)
            .await
            .expect("clear path");
        let err = resolve_test_implementation(&conn, case)
            .await
            .err()
            .expect("must refuse");
        assert!(err.contains("working copy"), "got: {err}");

        // No Solution on the work item at all.
        work_item::update_item(
            &conn,
            item,
            work_item::WorkItemFields {
                solution_id: None,
                ..Default::default()
            },
        )
        .await
        .expect("unlink");
        let err = resolve_test_implementation(&conn, case)
            .await
            .err()
            .expect("must refuse");
        assert!(err.contains("Solution"), "got: {err}");
    }

    /// Running is not an AI call — no provider, no prompt, no spend — so it has
    /// no policy gate. What it does need is a test to run and somewhere to run
    /// it, and each of those can be missing on its own.
    #[tokio::test]
    async fn there_has_to_be_a_test_before_there_is_anything_to_run() {
        let (conn, product_id, item, _provider) = ready_to_implement().await;
        let case = scenario_for(&conn, product_id, Some(item), None).await;

        // Still designed — nothing has been written yet.
        let err = resolve_test_run(&conn, case).await.expect_err("must refuse");
        assert!(err.contains("no test"), "got: {err}");

        // Implemented, and it names a file: this resolves, with no AI policy
        // anywhere in sight — the policy above was never set in this test.
        test_case::set_implementation(&conn, case, "src/login.test.ts", &["signs in".to_string()])
            .await
            .expect("implemented");
        let place = resolve_test_run(&conn, case).await.expect("must resolve");
        assert_eq!(place.case.test_path.as_deref(), Some("src/login.test.ts"));
        assert_eq!(place.case.test_names, vec!["signs in".to_string()]);
    }

    #[tokio::test]
    async fn a_test_with_nowhere_to_run_is_refused_by_name() {
        let (conn, product_id, item, _provider) = ready_to_implement().await;
        let case = scenario_for(&conn, product_id, Some(item), None).await;
        test_case::set_implementation(&conn, case, "src/login.test.ts", &[])
            .await
            .expect("implemented");

        let sol = work_item::find_by_id(&conn, item)
            .await
            .expect("q")
            .expect("item")
            .solution_id
            .expect("solution");
        solution::set_local_path(&conn, sol, None).await.expect("clear");
        let err = resolve_test_run(&conn, case).await.expect_err("must refuse");
        assert!(err.contains("working copy"), "got: {err}");
    }

    /// A scenario already implemented is not re-implemented by a second press:
    /// the file it names is somebody's work, and `write_new_file` would refuse
    /// to overwrite it anyway — better to say so before paying for a call.
    #[tokio::test]
    async fn an_implemented_scenario_is_not_written_twice() {
        let (conn, product_id, item, provider) = ready_to_implement().await;
        let case = scenario_for(&conn, product_id, Some(item), None).await;
        work_item_policy::set_policy(&conn, item, true, true, true, Some(provider), "medium")
            .await
            .expect("policy");
        test_case::update_case(
            &conn,
            case,
            &test_case::TestCaseUpdate {
                title: "Wrong password is rejected",
                scenario: "the scenario, unchanged",
                state: "implemented",
                test_path: Some("src/login.test.ts"),
                deliverable_id: None,
                work_item_id: Some(item),
            },
        )
        .await
        .expect("mark implemented");

        let err = resolve_test_implementation(&conn, case)
            .await
            .err()
            .expect("must refuse");
        assert!(err.contains("already"), "got: {err}");
    }
}
