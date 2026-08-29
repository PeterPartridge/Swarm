//! Whether the AI may touch a piece of work, and which model does it.
//!
//! **Two questions that were one table.** `work_item_policy` used to hold both
//! *may the AI read this* and *which provider runs it*, per work item — so a
//! new work item was denied until somebody went and permitted it individually,
//! and permission had to be re-granted for every item forever.
//!
//! They are separated here because they belong to different people and
//! different scopes:
//!
//! - **Permission** is governance: a Product's policy, overridden per Solution
//!   where a repository genuinely differs. Set in Admin.
//! - **Routing** — provider and effort — is a working decision: a default per
//!   area (Develop, QA), which a developer may override on one work item.
//!
//! Deny-by-default survives the move. No Solution override and no Product
//! policy still means no: silence is never permission.

use crate::db::{work_item_policy::AiUse, DbError, Result};
use turso::Connection;

/// Where a permission came from, so a refusal can say what to change.
#[derive(Debug, Clone, PartialEq)]
pub enum Source {
    /// A Solution override said so.
    Solution(String),
    /// The Product's policy said so.
    Product,
    /// Nobody has said anything — deny-by-default.
    Nobody,
}

/// The answer to "may the AI do this to this work item", and where it came
/// from.
#[derive(Debug, Clone, PartialEq)]
pub struct Verdict {
    pub allowed: bool,
    pub source: Source,
    /// The provider the permission names, when one is named. A permission with
    /// no provider cannot be acted on — there is nothing to send to.
    pub provider_id: Option<i64>,
    /// The effort the permitting policy asks for, used when the work item does
    /// not override it. Carried here so a caller never has to guess a default.
    pub effort_tier: String,
}

/// **The walk: the work item's Solution, then its Product, then no.**
///
/// A Solution override is total rather than partial — if one exists it is the
/// answer, including when it is more restrictive than the Product's. A partial
/// override, where some flags fall through and others do not, would mean
/// reading two rows to know what is permitted, and the commonest reason to
/// override is to say *less* than the Product does.
pub async fn verdict(conn: &Connection, work_item_id: i64, ai_use: AiUse) -> Result<Verdict> {
    let Some(item) = crate::db::work_item::find_by_id(conn, work_item_id).await? else {
        return Err(DbError::Validation(format!(
            "no work item with id {work_item_id}"
        )));
    };

    if let Some(solution_id) = item.solution_id {
        if let Some(over) = crate::db::solution_policy::for_solution(conn, solution_id).await? {
            let name = crate::db::solution::find_by_id(conn, solution_id)
                .await?
                .map(|s| s.name)
                .unwrap_or_else(|| format!("#{solution_id}"));
            return Ok(Verdict {
                allowed: permits(ai_use, over.allow_read, over.allow_edit, over.allow_generate_tests),
                source: Source::Solution(name),
                provider_id: over.provider_id,
                effort_tier: over.effort_tier,
            });
        }
    }

    match crate::db::product_policy::for_product(conn, item.product_id).await? {
        Some(policy) => Ok(Verdict {
            allowed: permits(
                ai_use,
                policy.allow_read,
                policy.allow_edit,
                policy.allow_generate_tests,
            ),
            source: Source::Product,
            provider_id: policy.provider_id,
            effort_tier: policy.effort_tier,
        }),
        None => Ok(Verdict {
            allowed: false,
            source: Source::Nobody,
            provider_id: None,
            effort_tier: "low".to_string(),
        }),
    }
}

/// **Reading is the floor.** Editing or generating tests both imply reading the
/// item, so neither is permitted while reading is not — otherwise a policy
/// could allow writing a test for work the AI was never allowed to look at.
fn permits(ai_use: AiUse, read: bool, edit: bool, generate_tests: bool) -> bool {
    match ai_use {
        AiUse::Read => read,
        AiUse::Edit => read && edit,
        AiUse::GenerateTests => read && generate_tests,
    }
}

/// What a refusal should tell somebody to go and change.
pub fn refusal(verdict: &Verdict, ai_use: AiUse) -> String {
    let what = match ai_use {
        AiUse::Read => "read this work",
        AiUse::Edit => "change this work",
        AiUse::GenerateTests => "write tests for this work",
    };
    match &verdict.source {
        Source::Nobody => format!(
            "Nobody has said the AI may {what}. Set this Product's AI policy in Admin → AI — nothing is permitted until somebody says so."
        ),
        Source::Product => format!(
            "This Product's AI policy does not let the AI {what}. Change it in Admin → AI, or override it for this Solution."
        ),
        Source::Solution(name) => format!(
            "The AI policy for '{name}' does not let the AI {what}. That Solution overrides the Product's policy — change it in Admin → AI."
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::product::tests::db_with_product;
    use crate::db::{ai_provider, product_policy, solution, solution_policy, work_item};

    async fn setup() -> (Connection, i64, i64, i64, i64) {
        let (conn, product_id) = db_with_product().await;
        let provider = ai_provider::add(&conn, "Claude", "https://a.example", &["m"], "alias")
            .await
            .expect("provider");
        let sol = solution::create(&conn, "API", product_id, "api", "{}")
            .await
            .expect("solution");
        let item = work_item::create(&conn, "Checkout", "feature", product_id, None, None)
            .await
            .expect("item");
        work_item::update_item(
            &conn,
            item,
            work_item::WorkItemFields {
                solution_id: Some(sol),
                ..Default::default()
            },
        )
        .await
        .expect("attach");
        (conn, product_id, sol, item, provider)
    }

    /// **The friction this removes.** A work item used to be denied until
    /// somebody permitted it individually; now permitting the Product permits
    /// its work, and a new item is usable the moment it is created.
    #[tokio::test]
    async fn permitting_the_product_permits_its_work() {
        let (conn, product_id, _sol, item, provider) = setup().await;

        let denied = verdict(&conn, item, AiUse::Read).await.expect("verdict");
        assert!(!denied.allowed);
        assert_eq!(denied.source, Source::Nobody);

        product_policy::set_policy(&conn, product_id, true, true, true, true, Some(provider), "medium")
            .await
            .expect("policy");
        let allowed = verdict(&conn, item, AiUse::Read).await.expect("verdict");
        assert!(allowed.allowed);
        assert_eq!(allowed.source, Source::Product);
        assert_eq!(allowed.provider_id, Some(provider));
    }

    /// A Product with a Rust backend and a React front end may want the AI in
    /// one and not the other — the reason the override exists at all.
    #[tokio::test]
    async fn a_solution_override_wins_over_the_products_policy() {
        let (conn, product_id, sol, item, provider) = setup().await;
        product_policy::set_policy(&conn, product_id, true, true, true, true, Some(provider), "medium")
            .await
            .expect("product policy");

        // The Solution says no, and it is the answer even though the Product
        // says yes — the commonest reason to override is to say less.
        solution_policy::set_policy(&conn, sol, false, false, false, Some(provider), "low")
            .await
            .expect("override");
        let v = verdict(&conn, item, AiUse::Read).await.expect("verdict");
        assert!(!v.allowed);
        assert_eq!(v.source, Source::Solution("API".into()));
        assert!(refusal(&v, AiUse::Read).contains("'API'"), "names the Solution");
    }

    /// An override on one Solution is not an override on another.
    #[tokio::test]
    async fn an_override_does_not_leak_to_another_solution() {
        let (conn, product_id, sol, item, provider) = setup().await;
        product_policy::set_policy(&conn, product_id, true, true, true, true, Some(provider), "medium")
            .await
            .expect("product policy");
        solution_policy::set_policy(&conn, sol, false, false, false, None, "low")
            .await
            .expect("override");

        let other = solution::create(&conn, "Web", product_id, "website", "{}")
            .await
            .expect("other solution");
        let other_item = work_item::create(&conn, "Sign in", "feature", product_id, None, None)
            .await
            .expect("item");
        work_item::update_item(
            &conn,
            other_item,
            work_item::WorkItemFields {
                solution_id: Some(other),
                ..Default::default()
            },
        )
        .await
        .expect("attach");

        assert!(verdict(&conn, other_item, AiUse::Read).await.expect("q").allowed);
        assert!(!verdict(&conn, item, AiUse::Read).await.expect("q").allowed);
    }

    /// Editing or generating tests both imply reading. A policy that allowed
    /// writing a test for work the AI may not look at would be incoherent.
    #[tokio::test]
    async fn reading_is_the_floor_under_the_other_two() {
        let (conn, product_id, _sol, item, provider) = setup().await;
        product_policy::set_policy(&conn, product_id, false, true, true, true, Some(provider), "low")
            .await
            .expect("policy");

        for ai_use in [AiUse::Read, AiUse::Edit, AiUse::GenerateTests] {
            assert!(
                !verdict(&conn, item, ai_use).await.expect("q").allowed,
                "{ai_use:?} must be denied while reading is not allowed"
            );
        }
    }

    /// Work that is not code has no Solution, so it falls to the Product —
    /// which is the only answer available and a real one.
    #[tokio::test]
    async fn work_with_no_solution_reads_the_products_policy() {
        let (conn, product_id, _sol, _item, provider) = setup().await;
        let loose = work_item::create(&conn, "Write the release note", "task", product_id, None, None)
            .await
            .expect("item");
        product_policy::set_policy(&conn, product_id, true, false, false, false, Some(provider), "low")
            .await
            .expect("policy");

        let v = verdict(&conn, loose, AiUse::Read).await.expect("q");
        assert!(v.allowed);
        assert_eq!(v.source, Source::Product);
        // Editing was not granted, and reading alone does not imply it.
        assert!(!verdict(&conn, loose, AiUse::Edit).await.expect("q").allowed);
    }

    /// A refusal that does not say what to change is a refusal somebody has to
    /// go hunting about.
    #[tokio::test]
    async fn a_refusal_says_where_to_go() {
        let (conn, _product_id, _sol, item, _provider) = setup().await;
        let v = verdict(&conn, item, AiUse::GenerateTests).await.expect("q");
        let said = refusal(&v, AiUse::GenerateTests);
        assert!(said.contains("Admin"), "got: {said}");
        assert!(said.contains("write tests"), "names the use: {said}");
    }
}
