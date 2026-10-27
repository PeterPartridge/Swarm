//! Which build of the app this is.

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    pub version: String,
    /// Epoch milliseconds, stamped in by `build.rs` at compile time.
    pub built_at: i64,
}

/// **The app saying which copy of itself is running.**
///
/// An installed desktop app and a rebuilt one are two binaries on one machine,
/// and until this existed nothing on screen told them apart — so "I pressed it
/// and nothing happened" could mean a bug, or could mean a build from before
/// the fix, and no one could tell which. Read once, shown in Admin, and written
/// to the activity log at startup so a log always says which binary wrote it.
#[tauri::command]
pub fn app_build() -> BuildInfo {
    BuildInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        built_at: env!("BUILD_AT").parse().unwrap_or(0),
    }
}
