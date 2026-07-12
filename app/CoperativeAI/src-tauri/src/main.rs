// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let data_dir = handle
                    .path()
                    .app_data_dir()
                    .expect("resolve app data dir");
                std::fs::create_dir_all(&data_dir).expect("create app data dir");
                let db_path = data_dir.join("coperativeai.db");

                let conn = db::connect(db_path.to_str().expect("db path is valid utf8"))
                    .await
                    .expect("open CoperativeAIdb");
                db::role::create_table(&conn)
                    .await
                    .expect("create roles table");
                db::role::seed_defaults(&conn)
                    .await
                    .expect("seed default roles");
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running CoperativeAI");
}
