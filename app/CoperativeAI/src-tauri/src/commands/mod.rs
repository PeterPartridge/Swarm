//! Tauri command handlers — one file per command group as pages are built.

pub mod ai_settings;
pub mod deliverables;
pub mod github;
pub mod policies;
pub mod products;
pub mod repositories;
pub mod roles;
pub mod strategy;
pub mod settings;
pub mod solutions;
pub mod sprints;
pub mod team_members;
pub mod windows;
pub mod work_items;

use tokio::sync::Mutex;
use turso::Connection;

/// The app's single database connection, shared across commands.
pub struct AppDb(pub Mutex<Connection>);

/// Commands surface DbError to the frontend as a plain message string.
pub(crate) fn to_message(e: crate::db::DbError) -> String {
    e.to_string()
}
