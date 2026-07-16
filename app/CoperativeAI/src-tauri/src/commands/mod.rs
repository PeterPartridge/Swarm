//! Tauri command handlers — one file per command group as pages are built.

pub mod repositories;
pub mod work_items;

use tokio::sync::Mutex;
use turso::Connection;

/// The app's single database connection, shared across commands.
pub struct AppDb(pub Mutex<Connection>);

/// Commands surface DbError to the frontend as a plain message string.
pub(crate) fn to_message(e: crate::db::DbError) -> String {
    e.to_string()
}
