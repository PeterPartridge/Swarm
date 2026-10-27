//! What has to be true before the AI is asked to do something.
//!
//! **Two presses, one shape.** Planning an item and running an agent on it each
//! refuse for a list of reasons, and each used to say them in its own way: the
//! Plan button held its own copy of the rules in the front end, while a run
//! reported one reason at a time from the back end after being pressed. Two
//! lists about readiness, in two shapes, in two places — and the front-end copy
//! had drifted, blocking work with no description that the backend would
//! happily have planned.
//!
//! They are the same idea, so they are one type and one module now. Each list
//! is built here, walked by the press it belongs to, and shown by the panel
//! beside that press. A screen and a button reading the same list cannot
//! disagree about what is missing.
//!
//! What differs between them is only what they check: planning needs somebody
//! to have written down what the work is and permission to *read* it; running
//! needs an approved plan, permission to *edit*, and a repository to branch
//! from.

use super::{to_message, AppDb};
use crate::db::{solution, work_item, work_item_plan};
use crate::git::vcs;
use serde::Serialize;
use tauri::State;

/// One thing that has to be true before a run can start.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gate {
    /// Stable name for the check, for the UI to key and test against.
    pub id: String,
    /// What is being checked, in the affirmative: a list of these reads as the
    /// conditions for starting rather than as a list of complaints.
    pub label: String,
    pub ok: bool,
    /// When it is not met: what is wrong and where to go. Empty when it is met,
    /// because a met check has nothing to say.
    pub detail: String,
}

/// Everything that has to be true before an agent is handed this work.
///
/// **One list, read by the panel and enforced by the press.** There were three
/// gates — an approved plan, permission to edit, a folder with a repository in
/// it — and each said its piece only when Execute was pressed and refused. You
/// could not find out what was missing without failing. Worse, a second copy of
/// these conditions written for a panel would drift from the ones that actually
/// refuse, and then the panel would be confidently wrong.
///
/// So `prepare_run` walks this list and refuses with the first unmet check's own
/// words, and the panel shows the same list. They cannot disagree.
///
/// **What is not here:** whether the coding agent is installed. That is a real
/// requirement and the Execute button checks it, but it is not a reason this
/// path refuses — preparing a run makes a checkout and writes a brief, both of
/// which are useful with no agent anywhere. It belongs to the command that runs
/// afterwards, and is shown beside these rather than counted among them.
#[tauri::command]
pub async fn run_gates(
    db: State<'_, AppDb>,
    work_item_id: i64,
    solution_id: i64,
) -> Result<Vec<Gate>, String> {
    let conn = db.0.lock().await;
    for_run(&conn, work_item_id, solution_id).await
}

pub(crate) async fn for_run(
    conn: &turso::Connection,
    work_item_id: i64,
    solution_id: i64,
) -> Result<Vec<Gate>, String> {
    let mut out = Vec::new();
    let plan = work_item_plan::list_for_item(conn, work_item_id)
        .await
        .map_err(to_message)?
        .into_iter()
        .find(|p| p.solution_id == solution_id);

    let Some(plan) = plan else {
        out.push(unmet(
            "plan",
            "This Solution is on the build plan",
            "that Solution is not marked as affected by this work item — tick it on the build \
             plan first"
                .into(),
        ));
        return Ok(out);
    };
    out.push(met("plan", "This Solution is on the build plan"));

    out.push(if plan.branch_name.trim().is_empty() {
        unmet(
            "branch",
            "The run has a branch of its own",
            "this run has no branch name. Set one on the build plan — a run needs its own \
             branch, because that is what keeps it apart from the others."
                .into(),
        )
    } else {
        met("branch", "The run has a branch of its own")
    });

    // Editing or regenerating the plan sets `approved_at` back to 0, so this is
    // consent to *this* version, not to some earlier one.
    out.push(if plan.approved_at == 0 {
        unmet(
            "approved",
            "The plan has been approved",
            "this plan has not been approved yet. Read it and press Approve on the plan \
             first — a run makes a checkout and hands an agent a brief, so it waits on \
             somebody having agreed to what it says."
                .into(),
        )
    } else {
        met("approved", "The plan has been approved")
    });

    // **May the AI touch this code at all?** `Edit` rather than `Read`, because
    // that is what a run is for; the walk already refuses `Edit` where reading
    // is not allowed, so this is the whole question in one call.
    let verdict = crate::db::ai_permission::verdict(
        conn,
        work_item_id,
        crate::db::work_item_policy::AiUse::Edit,
    )
    .await
    .map_err(to_message)?;
    out.push(if verdict.allowed {
        met("permission", "The AI is allowed to change this code")
    } else {
        unmet(
            "permission",
            "The AI is allowed to change this code",
            crate::db::ai_permission::refusal(&verdict, crate::db::work_item_policy::AiUse::Edit),
        )
    });

    let Some(row) = solution::find_by_id(conn, solution_id).await.map_err(to_message)? else {
        out.push(unmet(
            "folder",
            "The Solution has a folder on this machine",
            "that Solution no longer exists".into(),
        ));
        return Ok(out);
    };
    let Some(root) = row.local_path.clone().filter(|p| !p.trim().is_empty()) else {
        out.push(unmet(
            "folder",
            "The Solution has a folder on this machine",
            format!(
                "'{}' has no folder on this machine, so there is nothing to make a worktree from",
                row.name
            ),
        ));
        return Ok(out);
    };
    out.push(met("folder", "The Solution has a folder on this machine"));

    // **The way out named, not just the fault.** `add_worktree` refuses a folder
    // that is not a repository, and one with no commit for a different reason
    // ("invalid reference: HEAD") — two messages that say what is wrong and
    // nothing about what to do.
    out.push(match vcs::repo_state(&root) {
        Ok(state) if !state.is_repo => unmet(
            "repository",
            "The folder is a git repository with a commit",
            format!(
                "'{}' is not a git repository, so there is no branch to cut a checkout from. \
                 Open the Git tab on this work item and press \"Make it a git repository\".",
                row.name
            ),
        ),
        Ok(state) if !state.has_commit => unmet(
            "repository",
            "The folder is a git repository with a commit",
            format!(
                "'{}' is a git repository with nothing committed, and a checkout has to branch \
                 from a commit. Open the Git tab on this work item and press \"Make the first \
                 commit\".",
                row.name
            ),
        ),
        // A folder that has gone missing, or a git that will not run: the
        // worktree call says so in git's own words, which is more than this
        // check could add.
        _ => met("repository", "The folder is a git repository with a commit"),
    });

    Ok(out)
}


/// Everything that has to be true before the AI is asked to plan this work.
///
/// **The list the Plan button used to keep to itself.** It lived in the front
/// end as a pure function, which made it testable and also made it a second
/// opinion: it refused to plan an item nobody had described, while the backend
/// would have planned one happily. A screen stricter than the thing it drives
/// is a screen blocking work for reasons nothing enforces.
///
/// So the rules moved here, `generate_change_plan` walks them, and the panel
/// shows them. The description gate is kept — planning from a title alone is
/// planning from nothing — and it is now true of the path as well as the page.
///
/// `Read` rather than `Edit`, because planning reads the work and writes a
/// plan; it is a run that changes the code.
#[tauri::command]
pub async fn plan_gates(db: State<'_, AppDb>, work_item_id: i64) -> Result<Vec<Gate>, String> {
    let conn = db.0.lock().await;
    for_plan(&conn, work_item_id).await
}

pub(crate) async fn for_plan(
    conn: &turso::Connection,
    work_item_id: i64,
) -> Result<Vec<Gate>, String> {
    let Some(item) = work_item::find_by_id(conn, work_item_id).await.map_err(to_message)? else {
        return Err("that work item no longer exists".into());
    };

    let mut out = Vec::new();

    const DESCRIBED: &str = "Somebody has said what this is";
    out.push(if item.description.as_deref().unwrap_or("").trim().is_empty() {
        unmet(
            "described",
            DESCRIBED,
            "nobody has described what this is — Product writes that on the item, and an AI \
             given a title alone is planning from nothing."
                .into(),
        )
    } else {
        met("described", DESCRIBED)
    });

    // **Deny by default, said before the press rather than after it.** The same
    // walk the generation gate uses — Solution override, then Product.
    const PERMITTED: &str = "The AI is allowed to read this work";
    let verdict = crate::db::ai_permission::verdict(
        conn,
        work_item_id,
        crate::db::work_item_policy::AiUse::Read,
    )
    .await
    .map_err(to_message)?;
    out.push(if verdict.allowed {
        met("permission", PERMITTED)
    } else {
        unmet(
            "permission",
            PERMITTED,
            crate::db::ai_permission::refusal(&verdict, crate::db::work_item_policy::AiUse::Read),
        )
    });

    // Permitted and nothing to send to are different problems with different
    // fixes, so they are different rows. The item's own routing override can
    // name a provider the permission does not, so both are considered.
    const PROVIDER: &str = "There is an AI provider to send to";
    let own = crate::db::work_item_policy::for_item(conn, work_item_id)
        .await
        .map_err(to_message)?
        .and_then(|p| p.provider_id);
    let area = crate::db::routing_default::for_area(conn, item.product_id, "develop")
        .await
        .map_err(to_message)?
        .and_then(|d| d.provider_id);
    out.push(if own.or(area).or(verdict.provider_id).is_some() {
        met("provider", PROVIDER)
    } else {
        unmet(
            "provider",
            PROVIDER,
            "no provider is named to send to — name one on the policy that permits this, in \
             Admin → AI."
                .into(),
        )
    });

    let plans = work_item_plan::list_for_item(conn, work_item_id)
        .await
        .map_err(to_message)?;

    const ATTACHED: &str = "A Solution is attached";
    out.push(if plans.is_empty() {
        unmet(
            "solution",
            ATTACHED,
            "no Solution is attached — add one under \"What this changes\", or there is no \
             repository for a plan to be about."
                .into(),
        )
    } else {
        met("solution", ATTACHED)
    });

    // Only worth asking once something is attached: with nothing attached there
    // is nowhere for it to have been written.
    if !plans.is_empty() {
        const WRITTEN: &str = "What has to change is written down";
        out.push(if plans.iter().all(|p| p.changes_required.trim().is_empty()) {
            unmet(
                "written",
                WRITTEN,
                "none of the affected Solutions say what has to change yet — write that first, \
                 and the schemas follow from it."
                    .into(),
            )
        } else {
            met("written", WRITTEN)
        });
    }

    Ok(out)
}

/// The first thing on a list that is not true, if there is one.
///
/// **What turns a list into a refusal.** Both presses walk their own list and
/// stop at the first unmet check, returning its own words — so the message
/// somebody gets on being refused is one they have already read on the panel.
pub(crate) fn first_unmet(gates: Vec<Gate>) -> Option<Gate> {
    gates.into_iter().find(|g| !g.ok)
}

fn met(id: &str, label: &str) -> Gate {
    Gate { id: id.into(), label: label.into(), ok: true, detail: String::new() }
}

fn unmet(id: &str, label: &str, detail: String) -> Gate {
    Gate { id: id.into(), label: label.into(), ok: false, detail }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;
    use crate::db::{product_policy, work_item, work_item_plan};

    /// **The list the Plan button used to keep to itself.** It lived in the
    /// front end, which made it a second opinion — and one that had drifted:
    /// it refused to plan an item nobody had described while the backend would
    /// have planned it happily. Same shape as the run's list now, from the same
    /// module, walked by the press it belongs to.
    #[tokio::test]
    async fn planning_needs_a_description_permission_a_provider_and_something_to_plan() {
        let (conn, product_id) = db_with_product().await;
        let item_id = work_item::create(&conn, "Add checkout", "feature", product_id, None, None)
            .await
            .expect("work item");

        // A bare item: described, permission, provider and a Solution all fail.
        let bare = for_plan(&conn, item_id).await.expect("gates");
        assert_eq!(
            bare.iter().map(|g| g.id.as_str()).collect::<Vec<_>>(),
            ["described", "permission", "provider", "solution"],
        );
        assert!(bare.iter().all(|g| !g.ok), "nothing should be met yet: {bare:?}");
        // "What has to change" is not asked while nothing is attached: there is
        // nowhere for it to have been written.
        assert!(bare.iter().all(|g| g.id != "written"));

        work_item::set_description(&conn, item_id, "Take payment and email a receipt.")
            .await
            .expect("describe");
        product_policy::set_policy(&conn, product_id, true, true, true, false, None, "low")
            .await
            .expect("policy");
        let solution_id = crate::db::solution::create(&conn, "Shop API", product_id, "api", "{}")
            .await
            .expect("solution");
        work_item_plan::attach(&conn, item_id, solution_id).await.expect("attach");

        // Described and permitted now. Two things are still outstanding, and
        // they are two rows because they are two problems with two fixes: the
        // policy permits the AI but names nothing to send to, and nobody has
        // written what has to change. "What has to change" is asked at all only
        // now that there is somewhere for it to have been written.
        let attached = for_plan(&conn, item_id).await.expect("gates");
        assert!(attached.iter().any(|g| g.id == "described" && g.ok));
        assert!(attached.iter().any(|g| g.id == "permission" && g.ok));
        assert_eq!(
            attached.iter().filter(|g| !g.ok).map(|g| g.id.as_str()).collect::<Vec<_>>(),
            ["provider", "written"],
        );
        // Refusing gives the first of them, in its own words.
        assert_eq!(first_unmet(attached).map(|g| g.id), Some("provider".into()));
    }

    /// A met check says nothing beyond its own name: a detail on a green row
    /// reads as a warning about something that is fine.
    #[tokio::test]
    async fn a_met_check_has_nothing_to_say() {
        let (conn, product_id) = db_with_product().await;
        let item_id =
            work_item::create(&conn, "Add checkout", "feature", product_id, None, Some("Do it"))
                .await
                .expect("work item");

        let gates = for_plan(&conn, item_id).await.expect("gates");
        assert!(gates.iter().filter(|g| g.ok).all(|g| g.detail.is_empty()));
        assert!(gates.iter().filter(|g| !g.ok).all(|g| !g.detail.is_empty()));
    }

    /// The refusal a press gives is the first unmet check's own words, so what
    /// somebody is told on being refused is what they already read on the panel.
    #[tokio::test]
    async fn the_refusal_is_the_first_unmet_checks_own_words() {
        let (conn, product_id) = db_with_product().await;
        let item_id = work_item::create(&conn, "Add checkout", "feature", product_id, None, None)
            .await
            .expect("work item");

        let gates = for_plan(&conn, item_id).await.expect("gates");
        let first = first_unmet(gates.clone()).expect("something is unmet");
        assert_eq!(first.id, "described");
        assert_eq!(first.detail, gates[0].detail);
        assert!(first_unmet(gates.into_iter().map(|mut g| { g.ok = true; g }).collect()).is_none());
    }
}
