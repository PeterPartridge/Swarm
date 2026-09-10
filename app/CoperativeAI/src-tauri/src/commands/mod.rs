//! Tauri command handlers — one file per command group as pages are built.

pub mod ai_run;
pub mod ai_settings;
pub mod architecture;
pub mod build_info;
pub mod budgets;
pub mod capacity;
pub mod debugging;
pub mod deliverables;
pub mod design;
pub mod emit;
pub mod feedback;
pub mod github;
pub mod inspectors;
pub mod lifecycle;
pub mod logging;
pub mod gates;
pub mod jobs;
pub mod models;
pub mod policies;
pub mod products;
pub mod recommendations;
pub mod runs;
pub mod repositories;
pub mod roles;
pub mod strategies;
pub mod strategy;
pub mod settings;
pub mod solutions;
pub mod sprints;
pub mod team_members;
pub mod my_spaces;
pub mod terminals;
pub mod test_cases;
pub mod windows;
pub mod work_item_plans;
pub mod vcs_ops;
pub mod work_item_changes;
pub mod work_items;
pub mod workspace;

use tokio::sync::Mutex;
use turso::Connection;

/// The app's single database connection, shared across commands.
pub struct AppDb(pub Mutex<Connection>);

/// Commands surface DbError to the frontend as a plain message string.
pub(crate) fn to_message(e: crate::db::DbError) -> String {
    e.to_string()
}

/// Where commands run on somebody's behalf go, for this press.
///
/// **Resolved up here because down there it cannot be.** The three places that
/// start such a command are synchronous and hold no database handle; the
/// command layer holds one already. Reading it per press rather than once at
/// startup is also what lets the setting take effect without a restart.
///
/// A read that fails lands on `Off`. That is the mode with no boundary at all,
/// which reads like the wrong way to fail until you ask what the alternative
/// says: any other answer would have the app assert a boundary it could not
/// even read the name of.
pub(crate) async fn sandbox_mode(conn: &Connection) -> crate::tooling::sandbox::Mode {
    let stored = crate::db::system_setting::agent_sandbox(conn).await.unwrap_or_default();
    crate::tooling::sandbox::Mode::from_setting(&stored)
}
