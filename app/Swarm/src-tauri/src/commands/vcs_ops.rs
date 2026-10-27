//! Committing, pushing, branch history, SSH, and draw.io documents.
//!
//! The database lock is released before anything slow: a push crosses the
//! network and `git log` walks a repository, and holding the connection across
//! either would freeze the rest of the app behind it.

use super::{to_message, AppDb};
use crate::db::{commit_policy, solution};
use crate::design::drawio;
use crate::git::{ssh, vcs};
use serde::Serialize;
use tauri::State;

async fn root_for(db: &State<'_, AppDb>, solution_id: i64) -> Result<String, String> {
    let conn = db.0.lock().await;
    let Some(row) = solution::find_by_id(&conn, solution_id)
        .await
        .map_err(to_message)?
    else {
        return Err("that Solution no longer exists".into());
    };
    row.local_path
        .filter(|p| !p.trim().is_empty())
        .ok_or_else(|| format!("'{}' has no folder on this machine yet", row.name))
}

/// The recent history across every branch, for the picture.
#[tauri::command]
pub async fn branch_history(
    db: State<'_, AppDb>,
    solution_id: i64,
    limit: Option<usize>,
    // Which checkout's history. An agent works on its own branch in its own
    // worktree, so the Solution's folder answers about the default branch —
    // which is the wrong answer to "what has this agent committed?".
    run_id: Option<i64>,
) -> Result<Vec<vcs::Commit>, String> {
    let root = {
        let conn = db.0.lock().await;
        crate::commands::workspace::root_for_run(&conn, solution_id, run_id).await?
    };
    vcs::history(&root, limit.unwrap_or(120))
}

/// The branches a run could be cut from, for the picker on a work item's plan.
///
/// Returns nothing rather than failing when the Solution has no working copy or
/// is not a git repository: the field it feeds falls back to being typed, and a
/// red error over a dropdown that could not be filled would be about the wrong
/// thing.
#[tauri::command]
pub async fn list_solution_branches(
    db: State<'_, AppDb>,
    solution_id: i64,
) -> Result<Vec<String>, String> {
    let Ok(root) = root_for(&db, solution_id).await else {
        return Ok(Vec::new());
    };
    Ok(vcs::list_branches(&root).unwrap_or_default())
}

/// Everything a screen needs to say about one Solution's git situation.
///
/// **One read, both halves.** Where the code lives on this machine and what is
/// on GitHub are two different questions with two different fixes, and a panel
/// that knew only the second told somebody to link a repository when what they
/// needed was `git init`. Absent rather than an error at every step: a Solution
/// with no folder is a normal state, not a failure.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SolutionGitDto {
    pub local_path: Option<String>,
    /// False when there is no folder, or the folder is not a git repository.
    pub is_repo: bool,
    /// A repository with no commit cannot be branched from, so a run still
    /// cannot start — different sentence, different button.
    pub has_commit: bool,
    pub branch: String,
    pub github_url: Option<String>,
    pub github_visibility: Option<String>,
}

#[tauri::command]
pub async fn solution_git_state(
    db: State<'_, AppDb>,
    solution_id: i64,
    // The run to report on, when one is selected. **Its branch and its changes
    // live in its own checkout**, so reading the Solution's folder said "on
    // main, nothing changed" while an agent's work sat finished next door —
    // the same mistake the review, the file reader and the tree each had.
    run_id: Option<i64>,
) -> Result<SolutionGitDto, String> {
    let row = {
        let conn = db.0.lock().await;
        solution::find_by_id(&conn, solution_id)
            .await
            .map_err(to_message)?
            .ok_or("that Solution no longer exists")?
    };
    let local_path = match run_id {
        Some(_) => {
            let conn = db.0.lock().await;
            crate::commands::workspace::root_for_run(&conn, solution_id, run_id)
                .await
                .ok()
        }
        None => row.local_path.filter(|p| !p.trim().is_empty()),
    };
    // A folder that has been deleted underneath us reads as "not a repository"
    // rather than as an error: the panel's job is to offer the fix, and the fix
    // for both is to point it somewhere real.
    let state = match &local_path {
        Some(path) => vcs::repo_state(path).unwrap_or(vcs::RepoState {
            is_repo: false,
            has_commit: false,
            branch: String::new(),
        }),
        None => vcs::RepoState { is_repo: false, has_commit: false, branch: String::new() },
    };
    Ok(SolutionGitDto {
        local_path,
        is_repo: state.is_repo,
        has_commit: state.has_commit,
        branch: state.branch,
        github_url: row.github_url,
        github_visibility: row.github_visibility,
    })
}

/// Makes a Solution's folder a git repository, with a first commit.
///
/// The answer to "`…\hello-world` is not a git repository", which until now was
/// a dead end inside the app: every route out of it — status, worktree, run —
/// refused for the same reason and none of them offered to fix it.
#[tauri::command]
pub async fn init_solution_repo(
    db: State<'_, AppDb>,
    solution_id: i64,
) -> Result<String, String> {
    let root = root_for(&db, solution_id).await?;
    vcs::init_repo(&root, "First commit")
}

/// Commits, with the message someone typed or the file list when they did not.
///
/// **Which checkout is the whole question.** An agent's work is in its own
/// worktree on its own branch; committing in the Solution's folder would commit
/// whatever happens to be uncommitted on the default branch — somebody else's
/// half-finished edit, or nothing at all — and leave the agent's work exactly
/// where it was. Without a run this is your own workspace, which is what it
/// always was and what the editor's git panel means.
#[tauri::command]
pub async fn commit_solution(
    db: State<'_, AppDb>,
    solution_id: i64,
    message: String,
    push: bool,
    run_id: Option<i64>,
) -> Result<vcs::CommitResult, String> {
    let root = {
        let conn = db.0.lock().await;
        crate::commands::workspace::root_for_run(&conn, solution_id, run_id).await?
    };
    vcs::commit_all(&root, &message, push)
}

/// The automatic commit, whose message is only ever the files that changed.
///
/// Separate from `commit_solution` rather than the same call with a blank
/// message, because the two differ in what they may do: this one **refuses
/// unless a policy is on**. A timer or a save handler that could commit
/// regardless of the setting is one bug away from committing for someone who
/// turned it off.
#[tauri::command]
pub async fn auto_commit_solution(
    db: State<'_, AppDb>,
    solution_id: i64,
    trigger: String,
    run_id: Option<i64>,
) -> Result<vcs::CommitResult, String> {
    let policy = {
        let conn = db.0.lock().await;
        commit_policy::get(&conn, solution_id).await.map_err(to_message)?
    };
    let wanted = match trigger.as_str() {
        "save" => policy.mode == "onSave",
        "timer" => policy.mode == "interval",
        other => return Err(format!("unknown trigger '{other}'")),
    };
    if !wanted {
        return Ok(vcs::CommitResult {
            committed: false,
            message: String::new(),
            files: Vec::new(),
            pushed: None,
        });
    }
    let root = {
        let conn = db.0.lock().await;
        crate::commands::workspace::root_for_run(&conn, solution_id, run_id).await?
    };
    // Empty message on purpose: `commit_all` fills in the file list, which is
    // the whole point of an automatic commit.
    vcs::commit_all(&root, "", policy.push)
}

/// Pushes the checkout being looked at.
///
/// **A run's branch is the thing worth pushing.** It is what a reviewer pulls
/// and what a pull request is opened from; pushing the Solution's folder pushes
/// the default branch and leaves the agent's work on this machine.
#[tauri::command]
pub async fn push_solution(
    db: State<'_, AppDb>,
    solution_id: i64,
    run_id: Option<i64>,
) -> Result<String, String> {
    let root = {
        let conn = db.0.lock().await;
        crate::commands::workspace::root_for_run(&conn, solution_id, run_id).await?
    };
    vcs::push(&root)
}


/// Pulls what is on the remote and pushes what is not.
#[tauri::command]
pub async fn sync_solution(
    db: State<'_, AppDb>,
    solution_id: i64,
    run_id: Option<i64>,
) -> Result<String, String> {
    let root = {
        let conn = db.0.lock().await;
        crate::commands::workspace::root_for_run(&conn, solution_id, run_id).await?
    };
    vcs::sync(&root)
}

/// What is uncommitted in the checkout being looked at.
///
/// **"Work to commit", as its own question.** The panel could say which branch
/// and what had been committed, and nothing about what was sitting there
/// waiting — which is the thing somebody is deciding about when they open it.
#[tauri::command]
pub async fn checkout_changes(
    db: State<'_, AppDb>,
    solution_id: i64,
    run_id: Option<i64>,
) -> Result<Vec<crate::files::workspace::FileChange>, String> {
    let root = {
        let conn = db.0.lock().await;
        crate::commands::workspace::root_for_run(&conn, solution_id, run_id).await?
    };
    crate::files::workspace::read_changes(&root)
}

/// What a pull request says, given what the caller typed and what the agent
/// wrote when it finished.
///
/// **The description was empty while the account of the work sat beside it.**
/// An agent's round record is exactly what a reviewer opens a pull request to
/// find out — what was built, how it was proved, what was left behind and what
/// could not be done — and it was being read into the app and then not used for
/// the one place it fits best.
///
/// Typed words win. Somebody who wrote a description meant it, and replacing it
/// with the agent's would be the app deciding it knows better; the record is
/// what fills a description nobody wrote.
fn pull_request_body(typed: &str, record: Option<String>, work_item: Option<(i64, &str)>) -> String {
    // Which work this answers, first and on its own line. A reviewer landing on
    // a branch called `feature/9-checkout` should not have to go and look up
    // what was asked for, and the app is the only thing that knows.
    let asked = work_item
        .map(|(id, title)| format!("**Work item #{id}: {title}**

"))
        .unwrap_or_default();

    if !typed.trim().is_empty() {
        return format!("{asked}{}", typed.trim());
    }
    match record {
        Some(said) => format!(
            "{asked}_Written by the coding agent that made this branch, from its round              record._

{}",
            said.trim()
        ),
        // Nothing more than the work item rather than something invented: a
        // description made of the branch name and a date tells a reviewer
        // nothing they cannot already see.
        None => asked.trim_end().to_string(),
    }
}

/// Opens a pull request from this checkout's branch.
///
/// **The last step of a run, which used to leave the app.** An agent's work ends
/// as a branch; turning it into something a person reviews meant going to a
/// browser and finding the button GitHub offers.
///
/// The branch is read from the checkout rather than passed in, because the
/// branch a pull request is *from* is not a thing anybody should be able to get
/// wrong from a form.
#[tauri::command]
pub async fn open_pull_request(
    db: State<'_, AppDb>,
    solution_id: i64,
    run_id: Option<i64>,
    title: String,
    body: String,
    base: String,
) -> Result<String, String> {
    let (root, solution_root, repo_url, brief_path, work_item) = {
        let conn = db.0.lock().await;
        let Some(row) = solution::find_by_id(&conn, solution_id).await.map_err(to_message)? else {
            return Err("that Solution no longer exists".into());
        };
        let url = row.github_url.clone().filter(|u| !u.trim().is_empty()).ok_or(
            "this Solution is not linked to a repository on GitHub, so there is nowhere to open a \
             pull request. Link or create one on the Git tab first.",
        )?;
        // The brief names where the record sits beside it; a run with no row
        // any more simply has no record to find.
        let brief = match run_id {
            Some(id) => crate::db::change_run::find_by_id(&conn, id)
                .await
                .map_err(to_message)?
                .map(|r| r.brief_path)
                .unwrap_or_default(),
            None => String::new(),
        };
        // The work this run answers, for the title and the first line of the
        // body. A run with no row any more simply names nothing.
        let item = match run_id {
            Some(id) => match crate::db::change_run::find_by_id(&conn, id)
                .await
                .map_err(to_message)?
            {
                Some(r) => crate::db::work_item::find_by_id(&conn, r.work_item_id)
                    .await
                    .map_err(to_message)?
                    .map(|i| (i.id, i.title)),
                None => None,
            },
            None => None,
        };
        (
            crate::commands::workspace::root_for_run(&conn, solution_id, run_id).await?,
            row.local_path.clone().unwrap_or_default(),
            url,
            brief,
            item,
        )
    };

    // **A run inside a sandbox has its work in a clone, and its clone knows no
    // GitHub.** The clone's only remote is a Linux mount path, so a pull
    // request cannot be opened from there. The branch is brought into the
    // Solution's own repository first, and everything after this line then
    // happens where the GitHub remote and this machine's credentials are —
    // with no idea a sandbox was ever involved.
    let root = if crate::tooling::sandbox::is_inside_view(&root) {
        let inside = vcs::repo_state(&root)?;
        if solution_root.trim().is_empty() {
            return Err(
                "this run worked inside the sandbox, and its Solution has no folder on this \
                 machine to bring the branch back into"
                    .into(),
            );
        }
        let repository = solution_root;
        vcs::fetch_branch_from(&repository, &root, &inside.branch)?;
        repository
    } else {
        root
    };

    let state = vcs::repo_state(&root)?;
    if state.branch.trim().is_empty() {
        return Err("this checkout is not on a branch, so there is nothing to open a request for".into());
    }
    let base = if base.trim().is_empty() { "main".to_string() } else { base };
    if base == state.branch {
        return Err(format!(
            "this checkout is on {}, which is also what it would be merged into — a pull request \
             needs two different branches.",
            state.branch
        ));
    }

    // Pushed first, and said plainly if that is what failed: GitHub cannot open
    // a request for a branch it has never seen, and "no commits between" is a
    // confusing way to learn that the push did not happen.
    vcs::push(&root).map_err(|e| format!("could not push {} first: {e}", state.branch))?;

    let token = crate::git::github::get_token()?;
    let said = pull_request_body(
        &body,
        crate::agent::record::read_in(&root, &brief_path),
        work_item.as_ref().map(|(id, title)| (*id, title.as_str())),
    );
    // The work item's own words when nobody typed a title: a request called
    // "hello-world: AskForName" says which branch and nothing about what it is
    // for, which is the half a reviewer needs.
    let named = if title.trim().is_empty() {
        work_item
            .as_ref()
            .map(|(_, t)| t.clone())
            .unwrap_or_else(|| state.branch.clone())
    } else {
        title.trim().to_string()
    };

    let url = crate::git::github::create_pull_request(
        &token,
        &repo_url,
        &state.branch,
        &base,
        &named,
        &said,
    )
    .await?;

    // **Kept, so the link survives the press.** Opening one said its URL once,
    // in a notice that goes when the panel reloads — and then the only way back
    // to a review of your own work was to find it on GitHub.
    if let Some(id) = run_id {
        let conn = db.0.lock().await;
        crate::db::change_run::set_pull_request(&conn, id, &url)
            .await
            .map_err(to_message)?;
    }
    Ok(url)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitPolicyDto {
    pub mode: String,
    pub push: bool,
    pub interval_minutes: i64,
}

#[tauri::command]
pub async fn get_commit_policy(
    db: State<'_, AppDb>,
    solution_id: i64,
) -> Result<CommitPolicyDto, String> {
    let conn = db.0.lock().await;
    let policy = commit_policy::get(&conn, solution_id)
        .await
        .map_err(to_message)?;
    Ok(CommitPolicyDto {
        mode: policy.mode,
        push: policy.push,
        interval_minutes: policy.interval_minutes,
    })
}

#[tauri::command]
pub async fn set_commit_policy(
    db: State<'_, AppDb>,
    solution_id: i64,
    mode: String,
    push: bool,
    interval_minutes: i64,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    commit_policy::set(&conn, solution_id, &mode, push, interval_minutes)
        .await
        .map_err(to_message)
}

/* ── SSH ───────────────────────────────────────────────────────────────── */

#[tauri::command]
pub async fn ssh_status() -> Result<ssh::SshStatus, String> {
    Ok(ssh::status())
}

/// Generates a key pair. Only the public half comes back.
#[tauri::command]
pub async fn generate_ssh_key(comment: String) -> Result<String, String> {
    ssh::generate(&comment)
}

#[tauri::command]
pub async fn test_github_ssh() -> Result<String, String> {
    ssh::test_github()
}

/// Points a Solution's origin at SSH instead of HTTPS.
#[tauri::command]
pub async fn use_ssh_remote(db: State<'_, AppDb>, solution_id: i64) -> Result<String, String> {
    let root = root_for(&db, solution_id).await?;
    ssh::use_ssh_remote(&root)
}

/* ── draw.io ───────────────────────────────────────────────────────────── */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramFile {
    pub path: String,
    pub name: String,
}

/// Where a Product's diagrams live — the folder its framework files were
/// written to, so they are versioned with the code they describe.
async fn product_dir(db: &State<'_, AppDb>, product_id: i64) -> Result<String, String> {
    let conn = db.0.lock().await;
    let Some(product) = crate::db::product::find_by_id(&conn, product_id)
        .await
        .map_err(to_message)?
    else {
        return Err("that Product no longer exists".into());
    };
    let registered = crate::db::solution_management::list_all(&conn)
        .await
        .map_err(to_message)?
        .into_iter()
        .find(|s| s.filename == product.name)
        .map(|s| s.filepath);
    registered.ok_or_else(|| {
        format!(
            "'{}' has no folder yet — generate its framework files first, and the diagrams go \
             beside them",
            product.name
        )
    })
}

#[tauri::command]
pub async fn list_diagrams(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<Vec<DiagramFile>, String> {
    // A Product with no folder has no diagrams, which is not an error worth
    // showing anyone — the panel simply offers to make the first one.
    let Ok(dir) = product_dir(&db, product_id).await else {
        return Ok(Vec::new());
    };
    Ok(drawio::list(&dir)
        .into_iter()
        .map(|path| DiagramFile {
            name: std::path::Path::new(&path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("diagram")
                .to_string(),
            path,
        })
        .collect())
}

/// Writes a draw.io document from nodes and edges.
#[tauri::command]
pub async fn save_diagram(
    db: State<'_, AppDb>,
    product_id: i64,
    name: String,
    nodes: Vec<drawio::Node>,
    edges: Vec<drawio::Edge>,
) -> Result<String, String> {
    let dir = product_dir(&db, product_id).await?;
    let xml = drawio::build(&name, &nodes, &edges);
    drawio::save(&dir, &name, &xml)
}

/// Opens a diagram in whatever draw.io the machine has.
#[tauri::command]
pub async fn open_diagram(path: String) -> Result<(), String> {
    drawio::open(&path)
}

/// The arrow label for a link kind, in the same words the Develop area uses.
/// An arrow reading `callsApi` would be the database's word for it rather than
/// a person's.
fn label_for(kind: &str) -> String {
    match kind {
        "callsApi" => "calls the API of",
        "sharesSchema" => "shares a schema with",
        "publishesEvent" => "publishes events to",
        "buildsOn" => "builds on",
        other => other,
    }
    .to_string()
}

/// The nodes and edges of a diagram drafted from a Product's Solutions.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftedDiagram {
    pub nodes: Vec<drawio::Node>,
    pub edges: Vec<drawio::Edge>,
}

/// A draft in whichever notation was asked for.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftedContent {
    pub format: String,
    pub content: String,
    /// The boxes behind it, so the draw.io builder can go on editing them
    /// rather than parsing its own output back.
    pub nodes: Vec<drawio::Node>,
    pub edges: Vec<drawio::Edge>,
}

/// Drafts an architecture diagram from the Solutions, in either notation.
///
/// One draft, two renderings. Which notation a diagram is written in is a
/// choice made after deciding what is in it — so the boxes are worked out once
/// and the format is applied at the end, and the draw.io and Mermaid halves
/// cannot disagree about what the architecture is.
#[tauri::command]
pub async fn draft_architecture(
    db: State<'_, AppDb>,
    product_id: i64,
    format: String,
) -> Result<DraftedContent, String> {
    let drafted = diagram_from_solutions(db, product_id).await?;
    let content = match format.as_str() {
        "drawio" => drawio::build("Architecture", &drafted.nodes, &drafted.edges),
        "mermaid" => drawio::to_mermaid(&drafted.nodes, &drafted.edges),
        other => {
            return Err(format!(
                "nothing can be drafted as '{other}' yet — choose Mermaid or draw.io"
            ))
        }
    };
    Ok(DraftedContent {
        format,
        content,
        nodes: drafted.nodes,
        edges: drafted.edges,
    })
}

/// Drafts a diagram from the Solutions and the links already recorded.
///
/// Returned rather than written: it is a first draft to look at and correct,
/// and writing straight to a file would overwrite a diagram somebody had
/// already arranged in draw.io.
#[tauri::command]
pub async fn diagram_from_solutions(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<DraftedDiagram, String> {
    let conn = db.0.lock().await;
    let solutions: Vec<(i64, String, String)> = solution::list_by_product(&conn, product_id)
        .await
        .map_err(to_message)?
        .into_iter()
        .map(|s| (s.id, s.name, s.solution_type))
        .collect();
    let links: Vec<(i64, i64, String)> = crate::db::repo_link::list_for_product(&conn, product_id)
        .await
        .map_err(to_message)?
        .into_iter()
        .map(|l| (l.from_solution_id, l.to_solution_id, label_for(&l.kind)))
        .collect();

    let (nodes, edges) = drawio::from_solutions(&solutions, &links);
    Ok(DraftedDiagram { nodes, edges })
}

#[cfg(test)]
mod pull_request_body_tests {
    use super::pull_request_body;

    /// **The description was empty while the account of the work sat beside
    /// it.** A round record is exactly what a reviewer opens a pull request to
    /// find out, and it was being read into the app and then not used in the
    /// one place it fits best.
    #[test]
    fn the_agents_record_fills_a_description_nobody_wrote() {
        let said = pull_request_body(
            "",
            Some("## What I built\nA greeter.\n\n## Technical debt\nNo CI.".into()),
            None,
        );
        assert!(said.contains("A greeter."));
        assert!(said.contains("No CI."));
        // And it says whose words they are, because a reviewer reading a
        // description should know whether a person wrote it.
        assert!(said.starts_with("_Written by the coding agent"));
    }

    /// Somebody who wrote a description meant it. Replacing it with the agent's
    /// would be the app deciding it knows better.
    #[test]
    fn what_somebody_typed_wins() {
        let said = pull_request_body(
            "  Adds the greeter.  ",
            Some("## What I built\nX".into()),
            None,
        );
        assert_eq!(said, "Adds the greeter.");
    }

    /// **Which work this answers, first.** A reviewer landing on a branch
    /// called `feature/9-checkout` should not have to go and look up what was
    /// asked for, and the app is the only thing that knows.
    #[test]
    fn the_work_item_is_named_first_whatever_else_the_body_says() {
        let with_record = pull_request_body(
            "",
            Some("## What I built
A greeter.".into()),
            Some((9, "Ask for a name and greet it")),
        );
        assert!(with_record.starts_with("**Work item #9: Ask for a name and greet it**"));
        assert!(with_record.contains("A greeter."));

        // Typed words still win, and still come after what they are about.
        let typed = pull_request_body("Adds the greeter.", None, Some((9, "Ask for a name")));
        assert!(typed.starts_with("**Work item #9: Ask for a name**"));
        assert!(typed.ends_with("Adds the greeter."));

        // And with nothing else to say, the work item is the whole body rather
        // than a heading over emptiness.
        assert_eq!(
            pull_request_body("", None, Some((9, "Ask for a name"))),
            "**Work item #9: Ask for a name**",
        );
    }

    /// Nothing to say rather than something invented: a description made of the
    /// branch name and a date tells a reviewer nothing they cannot already see.
    #[test]
    fn no_record_and_no_words_is_an_empty_description() {
        assert_eq!(pull_request_body("", None, None), "");
        assert_eq!(pull_request_body("   ", None, None), "");
    }
}