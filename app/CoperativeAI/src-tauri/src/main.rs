// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod terminal;

use std::path::PathBuf;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // COPERATIVEAI_DATA_DIR overrides the OS app-data folder — see the
            // solution spec's infrastructure.settings entry of the same name.
            let data_dir = std::env::var("COPERATIVEAI_DATA_DIR")
                .map(PathBuf::from)
                .or_else(|_| app.path().app_data_dir())
                .expect("resolve app data directory");
            std::fs::create_dir_all(&data_dir).expect("create app data directory");
            let db_path = data_dir.join("CoperativeAIdb.db");

            let conn = tauri::async_runtime::block_on(async {
                let conn = db::connect(db_path.to_str().expect("utf-8 db path"))
                    .await
                    .expect("open CoperativeAIdb");
                db::create_all_tables(&conn)
                    .await
                    .expect("create CoperativeAIdb tables");
                conn
            });
            app.manage(commands::AppDb(tokio::sync::Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::work_items::list_work_items,
            commands::work_items::create_work_item,
            commands::work_items::update_work_item_status,
            commands::work_items::delete_work_item,
            commands::repositories::list_repositories,
            commands::repositories::add_repository,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CoperativeAI");
}
