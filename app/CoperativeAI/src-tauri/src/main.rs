// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Grouped by what each area is for, rather than eighteen files in a row: git
// and the things that authenticate to it, the drawing tools, the agent pipeline,
// the command runners, and the file readers/writers. `db` and `commands` were
// already folders; `terminal` and `ai` too.
mod agent;
mod ai;
mod commands;
mod db;
mod debug;
mod design;
mod files;
mod git;
mod terminal;
/// Scratch folders for the tests that need a real filesystem. Test-only, so it
/// is not compiled into the shipped binary.
#[cfg(test)]
mod testing;
mod tooling;

use std::path::PathBuf;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            app.manage(commands::terminals::Terminals::default());
            app.manage(commands::debugging::DebugSessions::default());
            // The queue is sized once, from the setting, and any job left
            // "running" by a previous launch is failed here: a process that is
            // gone is not still working, and the row would block its work item
            // from ever being submitted again.
            let limit = tauri::async_runtime::block_on(async {
                let db = app.state::<commands::AppDb>();
                let conn = db.0.lock().await;
                let _ = db::ai_job::fail_interrupted(&conn).await;
                db::system_setting::ai_concurrency(&conn)
                    .await
                    .unwrap_or(db::system_setting::AI_CONCURRENCY_DEFAULT)
            });
            app.manage(std::sync::Arc::new(agent::jobs::JobRunner::new(limit)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::work_items::list_work_items,
            commands::work_items::create_work_item,
            commands::work_items::update_work_item_status,
            commands::work_items::update_work_item,
            commands::work_items::delete_work_item,
            commands::feedback::ask_product_question,
            commands::work_item_plans::list_work_item_plans,
            commands::work_item_plans::attach_solution_to_work_item,
            commands::work_item_plans::save_work_item_plan,
            commands::work_item_plans::set_plan_approval,
            commands::work_item_plans::detach_work_item_plan,
            commands::work_item_plans::generate_change_plan,
            commands::work_items::list_work_item_links,
            commands::work_items::link_work_items,
            commands::work_items::unlink_work_items,
            commands::work_items::generate_user_stories,
            commands::work_items::generate_deliverable_work,
            commands::products::list_products,
            commands::products::create_product,
            commands::products::get_product,
            commands::products::get_product_scaffold,
            commands::products::update_product_answers,
            commands::products::delete_product,
            commands::emit::generate_framework_files,
            commands::feedback::list_ai_feedback,
            commands::feedback::list_open_questions,
            commands::feedback::resolve_ai_feedback,
            commands::solutions::list_solutions,
            commands::solutions::create_solution,
            commands::solutions::create_solution_with_starter,
            commands::solutions::list_starters,
            commands::work_item_changes::list_work_item_changes,
            commands::work_item_changes::add_work_item_change,
            commands::work_item_changes::add_work_item_changes,
            commands::work_item_changes::set_work_item_change_detail,
            commands::work_item_changes::assign_work_item_change,
            commands::work_item_changes::update_work_item_change,
            commands::work_item_changes::delete_work_item_change,
            commands::work_item_changes::change_kinds,
            commands::work_item_changes::change_kinds_for_solution,
            commands::work_item_changes::set_change_mockup,
            commands::work_item_changes::solution_catalogue,
            commands::work_item_changes::suggest_change_names,
            commands::work_item_plans::write_work_item_files,
            commands::jobs::submit_for_planning,
            commands::jobs::cancel_ai_job,
            commands::jobs::list_ai_jobs,
            commands::jobs::list_recent_ai_jobs,
            commands::jobs::get_ai_concurrency,
            commands::jobs::set_ai_concurrency,
            commands::runs::list_runs,
            commands::runs::start_run,
            commands::runs::discard_run_worktree,
            commands::runs::list_run_worktrees,
            commands::runs::preview_run_merge,
            commands::runs::merge_run_branch,
            commands::runs::abort_run_merge,
            commands::runs::list_abandoned_worktrees,
            commands::runs::remove_worktree_at,
            commands::solutions::start_existing_solution,
            commands::vcs_ops::branch_history,
            commands::vcs_ops::commit_solution,
            commands::vcs_ops::auto_commit_solution,
            commands::vcs_ops::push_solution,
            commands::vcs_ops::get_commit_policy,
            commands::vcs_ops::set_commit_policy,
            commands::vcs_ops::ssh_status,
            commands::vcs_ops::generate_ssh_key,
            commands::vcs_ops::test_github_ssh,
            commands::vcs_ops::use_ssh_remote,
            commands::vcs_ops::list_diagrams,
            commands::vcs_ops::save_diagram,
            commands::vcs_ops::open_diagram,
            commands::vcs_ops::diagram_from_solutions,
            commands::vcs_ops::draft_architecture,
            commands::solutions::delete_solution,
            commands::github::github_status,
            commands::github::set_github_token,
            commands::github::remove_github_token,
            commands::github::link_solution_repo,
            commands::github::create_solution_repo,
            commands::design::list_design_assets,
            commands::design::save_design_asset,
            commands::design::delete_design_asset,
            commands::design::figma_status,
            commands::design::set_figma_token,
            commands::design::clear_figma_token,
            commands::design::read_figma_file,
            commands::design::push_design_tokens,
            commands::design::post_figma_comment,
            commands::design::generate_design_strategy,
            commands::design::emit_design_files,
            commands::architecture::list_architecture_docs,
            commands::architecture::save_architecture_doc,
            commands::architecture::delete_architecture_doc,
            commands::architecture::list_repo_links,
            commands::architecture::link_solutions,
            commands::architecture::unlink_solutions,
            commands::architecture::solutions_reached_by,
            commands::architecture::generate_architecture_doc,
            commands::workspace::set_solution_path,
            commands::workspace::read_solution_tree,
            commands::workspace::read_solution_file,
            commands::workspace::review_solution_changes,
            commands::workspace::write_solution_file,
            commands::workspace::create_solution_file,
            commands::workspace::create_solution_folder,
            commands::workspace::ask_coding_pal,
            commands::workspace::prepare_handover,
            commands::workspace::settle_change_run,
            commands::team_members::list_team_members,
            commands::team_members::add_team_member,
            commands::team_members::set_member_role,
            commands::team_members::remove_team_member,
            commands::roles::list_roles,
            commands::roles::create_role,
            commands::roles::update_role,
            commands::roles::delete_role,
            commands::roles::get_active_member,
            commands::roles::set_active_member,
            commands::roles::get_active_permissions,
            commands::deliverables::list_deliverables,
            commands::deliverables::create_deliverable,
            commands::deliverables::delete_deliverable,
            commands::deliverables::set_deliverable_dependency,
            commands::recommendations::recommend_for_work_item,
            commands::strategies::get_developer_rules,
            commands::strategies::rule_templates,
            commands::strategies::set_developer_rules,
            commands::strategies::get_solution_strategy,
            commands::strategies::generate_solution_strategy,
            commands::strategies::choose_architecture_option,
            commands::strategy::get_strategy,
            commands::strategy::save_strategy,
            commands::test_cases::list_test_cases,
            commands::test_cases::create_test_case,
            commands::test_cases::update_test_case,
            commands::test_cases::delete_test_case,
            commands::test_cases::implement_test_case,
            commands::test_cases::run_test_case,
            commands::sprints::list_sprints,
            commands::sprints::create_sprint,
            commands::sprints::remove_sprint,
            commands::capacity::get_sprint_load,
            commands::capacity::set_sprint_capacity,
            commands::settings::get_planning_hierarchy,
            commands::settings::set_planning_hierarchy,
            commands::settings::get_roadmap_mode,
            commands::settings::set_roadmap_mode,
            commands::windows::open_screen_window,
            commands::windows::open_console_window,
            commands::budgets::get_product_budget,
            commands::budgets::set_product_budget,
            commands::budgets::get_spend_summary,
            commands::budgets::list_ai_calls,
            commands::budgets::list_model_prices,
            commands::budgets::set_model_price,
            commands::budgets::delete_model_price,
            commands::models::list_model_status,
            commands::models::refresh_provider_models,
            commands::models::install_model,
            commands::models::set_model_vision,
            commands::inspectors::product_git_overview,
            commands::inspectors::product_changed_files,
            commands::inspectors::read_conflict_sides,
            commands::inspectors::mark_conflict_resolved,
            commands::inspectors::list_test_suites,
            commands::inspectors::run_solution_tests,
            commands::inspectors::run_test_suite,
            commands::inspectors::set_solution_test_command,
            commands::inspectors::suggest_dev_command,
            commands::inspectors::set_solution_run_command,
            commands::inspectors::set_solution_start_from,
            commands::my_spaces::open_my_space,
            commands::my_spaces::list_my_spaces,
            commands::my_spaces::close_my_space,
            commands::terminals::open_terminal,
            commands::terminals::open_claude_sign_in,
            commands::terminals::open_debugger_install,
            commands::terminals::open_terminal_at,
            commands::terminals::write_terminal,
            commands::terminals::resize_terminal,
            commands::terminals::close_terminal,
            commands::terminals::list_terminals,
            commands::terminals::attach_terminal,
            commands::debugging::debug_adapters,
            commands::debugging::debug_check,
            commands::debugging::debug_start,
            commands::debugging::debug_set_breakpoints,
            commands::debugging::debug_resume,
            commands::debugging::debug_stack,
            commands::debugging::debug_variables,
            commands::debugging::debug_expand,
            commands::debugging::debug_restart_frame,
            commands::debugging::debug_threads,
            commands::debugging::debug_evaluate,
            commands::debugging::debug_set_variable,
            commands::debugging::debug_set_expression,
            commands::debugging::debug_stop,
            commands::workspace::file_properties,
            commands::ai_settings::list_ai_providers,
            commands::ai_settings::add_ai_provider,
            commands::ai_settings::add_ollama_provider,
            commands::ai_settings::add_claude_code_provider,
            commands::ai_settings::add_ollama_cloud_provider,
            commands::ai_settings::claude_code_status,
            commands::ai_settings::install_claude_code,
            commands::ai_settings::get_paid_api_allowed,
            commands::ai_settings::get_claude_tiers,
            commands::ai_settings::set_claude_tiers,
            commands::ai_settings::set_paid_api_allowed,
            commands::ai_settings::remove_ai_provider,
            commands::ai_settings::test_ai_provider,
            commands::policies::get_work_item_policy,
            commands::policies::set_work_item_policy,
            commands::policies::get_product_policy,
            commands::policies::set_product_policy,
            commands::repositories::list_repositories,
            commands::repositories::add_repository,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CoperativeAI");
}
