//! The "generate framework files" command — turns what the app holds into the
//! briefs and specs the framework reads, under the Product's scaffold folder.

use super::{to_message, AppDb};
use crate::db::{deliverable, emitted_file, product, solution, solution_management, work_item};
use crate::emit::{self, EmitFile, EmitReport};
use std::collections::HashMap;
use tauri::State;

/// Finds where a Product was scaffolded. Emission has nowhere to go without it.
async fn scaffold_root(
    conn: &turso::Connection,
    product_name: &str,
) -> Result<String, String> {
    let entries = solution_management::list_all(conn).await.map_err(to_message)?;
    entries
        .into_iter()
        .find(|s| s.filename == product_name)
        .map(|s| s.filepath)
        .ok_or_else(|| {
            format!(
                "'{product_name}' has no folder on disk. Create the Product with a folder, \
                 or scaffold it first, then generate again."
            )
        })
}

/// Builds the file set for a Product from the database.
async fn build_files(
    conn: &turso::Connection,
    product_id: i64,
    product_name: &str,
) -> Result<Vec<EmitFile>, String> {
    let mut files = Vec::new();

    // One solution spec per Solution, in its own folder beside the brief.
    for s in solution::list_by_product(conn, product_id)
        .await
        .map_err(to_message)?
    {
        let stem = emit::safe_stem(&s.name);
        files.push(EmitFile {
            rel_path: format!("{stem}/application-spec.json"),
            contents: emit::solution_spec(
                &s.name,
                &s.solution_type,
                &s.answers,
                product_name,
                s.github_url.as_deref(),
            ),
        });
    }

    // One page brief per planned feature, named by its deliverable where it has
    // one so the folder reads like the plan.
    let deliverables = deliverable::list_by_product(conn, product_id)
        .await
        .map_err(to_message)?;
    let deliverable_name = |id: Option<i64>| -> Option<String> {
        id.and_then(|id| deliverables.iter().find(|d| d.id == id))
            .map(|d| d.name.clone())
    };
    for item in work_item::list_by_product(conn, product_id)
        .await
        .map_err(to_message)?
        .into_iter()
        .filter(|i| i.item_type == "feature")
    {
        let stem = emit::safe_stem(&item.title);
        files.push(EmitFile {
            rel_path: format!(".CoperativeAI/pages/{stem}.md"),
            contents: emit::page_brief(
                &item.title,
                item.description.as_deref(),
                product_name,
                deliverable_name(item.deliverable_id).as_deref(),
            ),
        });
    }
    Ok(files)
}

/// Generates the framework files for a Product and reports what happened to
/// each: written, already up to date, or left alone because it had been edited.
#[tauri::command]
pub async fn generate_framework_files(
    db: State<'_, AppDb>,
    product_id: i64,
) -> Result<EmitReport, String> {
    // Gather everything under the lock, write without it, then record.
    let (root, files, known) = {
        let conn = db.0.lock().await;
        let Some(product_row) = product::find_by_id(&conn, product_id)
            .await
            .map_err(to_message)?
        else {
            return Err("that Product no longer exists".into());
        };
        let root = scaffold_root(&conn, &product_row.name).await?;
        let files = build_files(&conn, product_id, &product_row.name).await?;
        let known: HashMap<String, String> = emitted_file::list_for_product(&conn, product_id)
            .await
            .map_err(to_message)?
            .into_iter()
            .map(|f| (f.rel_path, f.content_hash))
            .collect();
        (root, files, known)
    };

    if files.is_empty() {
        return Err(
            "nothing to generate yet — add a Solution or plan a feature for this Product first"
                .into(),
        );
    }

    let (report, recorded) = emit::write_files(&root, &files, &known)?;

    let conn = db.0.lock().await;
    for (rel_path, hash) in recorded {
        emitted_file::record(&conn, product_id, &rel_path, &hash)
            .await
            .map_err(to_message)?;
    }
    Ok(report)
}
