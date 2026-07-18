//! Estimating what an AI call will cost and how long it will take.
//!
//! Two sources, and the UI is told which was used:
//!
//! - **`priceTable`** — a per-purpose baseline token count adjusted for how much
//!   the work item actually says, priced from the editable price table. These
//!   are honest guesses and will be wrong in both directions.
//! - **`history`** — the median of real recorded calls of the same kind on the
//!   same model, once there are enough of them to mean anything.
//!
//! The threshold matters: a median of three calls is noise wearing the costume
//! of data. Below `MIN_SAMPLES` the price table is used and labelled as such,
//! so a confident-looking number is never shown on the strength of a handful of
//! runs.

use crate::db::ai_usage::TokenCounts;
use crate::db::model_price::{self, ModelPrice};

/// Recorded calls needed before history beats the baseline.
pub const MIN_SAMPLES: usize = 20;

/// Baseline total tokens per purpose, before adjusting for item size. Round
/// numbers on purpose — they are stated guesses, not measurements, and the
/// `source` field says so wherever they are shown.
fn baseline_tokens(purpose: &str) -> i64 {
    match purpose {
        "storyGeneration" => 4_000,
        "deliverablePlanning" => 6_000,
        "solutionStrategy" => 9_000,
        _ => 5_000,
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Source {
    PriceTable,
    History,
}

impl Source {
    pub fn as_str(self) -> &'static str {
        match self {
            Source::PriceTable => "priceTable",
            Source::History => "history",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Estimate {
    pub model: String,
    pub tokens: i64,
    pub cost_micropence: i64,
    pub minutes: i64,
    pub source: Source,
    /// False when this would breach what is left of the AI budget.
    pub affordable: bool,
}

/// How much the work item says about itself, as a multiplier on the baseline.
/// A one-line item and a page of detail do not cost the same, and length is the
/// only signal available before the call is made.
pub fn size_factor(title: &str, description: Option<&str>) -> f64 {
    let described = description.unwrap_or("").trim().len();
    let total = title.trim().len() + described;
    if total < 60 {
        0.7
    } else if total < 400 {
        1.0
    } else {
        1.5
    }
}

/// The median of recorded totals, or `None` when there are too few to trust.
pub fn median_tokens(totals: &[i64]) -> Option<i64> {
    if totals.len() < MIN_SAMPLES {
        return None;
    }
    let mut sorted = totals.to_vec();
    sorted.sort_unstable();
    let middle = sorted.len() / 2;
    Some(if sorted.len() % 2 == 0 {
        (sorted[middle - 1] + sorted[middle]) / 2
    } else {
        sorted[middle]
    })
}

/// Builds one estimate.
///
/// `remaining_micropence` is what is left of the AI budget; a zero or negative
/// budget means "not limited by money", matching how the router reads it, so an
/// unset budget never marks everything unaffordable.
pub fn estimate(
    model: &str,
    purpose: &str,
    size: f64,
    price: Option<&ModelPrice>,
    history: &[i64],
    ai_budget_micropence: i64,
    spent_micropence: i64,
) -> Estimate {
    let (tokens, source) = match median_tokens(history) {
        Some(median) => (median, Source::History),
        None => (
            ((baseline_tokens(purpose) as f64) * size).round() as i64,
            Source::PriceTable,
        ),
    };

    // Output is the expensive half and the smaller one; splitting the estimate
    // 3:1 keeps the pricing honest rather than charging every token at the
    // input rate.
    let output_tokens = tokens / 4;
    let counts = TokenCounts {
        input_tokens: tokens - output_tokens,
        output_tokens,
        ..Default::default()
    };
    let cost_micropence = model_price::cost_micropence(price, &counts);

    let per_second = price.map(|p| p.tokens_per_second).unwrap_or(0).max(1);
    // Round up: a call that takes 40 seconds is better described as "1 min"
    // than "0 min".
    let minutes = ((tokens as f64 / per_second as f64) / 60.0).ceil() as i64;

    let affordable = if ai_budget_micropence <= 0 {
        true
    } else {
        cost_micropence <= (ai_budget_micropence - spent_micropence).max(0)
    };

    Estimate {
        model: model.to_string(),
        tokens,
        cost_micropence,
        minutes: minutes.max(1),
        source,
        affordable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn price(input: i64, output: i64, tps: i64) -> ModelPrice {
        ModelPrice {
            id: 1,
            provider_id: 1,
            model: "m".into(),
            input_pence_per_mtok: input,
            output_pence_per_mtok: output,
            tokens_per_second: tps,
            updated_at: 0,
        }
    }

    #[test]
    fn a_thin_item_estimates_lower_than_a_detailed_one() {
        assert!(size_factor("Fix", None) < size_factor("Checkout", Some(&"x".repeat(200))));
        assert!(
            size_factor("Checkout", Some(&"x".repeat(200)))
                < size_factor("Checkout", Some(&"x".repeat(900)))
        );
    }

    /// A median of a handful of calls is noise wearing the costume of data.
    #[test]
    fn history_is_ignored_until_there_is_enough_of_it() {
        let few: Vec<i64> = (0..MIN_SAMPLES as i64 - 1).map(|_| 10_000).collect();
        assert_eq!(median_tokens(&few), None);

        let enough: Vec<i64> = (0..MIN_SAMPLES as i64).map(|_| 10_000).collect();
        assert_eq!(median_tokens(&enough), Some(10_000));
    }

    #[test]
    fn the_median_ignores_outliers_that_would_drag_a_mean() {
        let mut totals: Vec<i64> = (0..MIN_SAMPLES as i64).map(|_| 1_000).collect();
        totals.push(9_000_000); // one runaway call
        assert_eq!(median_tokens(&totals), Some(1_000));
    }

    #[test]
    fn with_no_history_the_estimate_comes_from_the_price_table_and_says_so() {
        let p = price(80, 400, 100);
        let e = estimate("haiku", "storyGeneration", 1.0, Some(&p), &[], 0, 0);
        assert_eq!(e.source, Source::PriceTable);
        assert_eq!(e.tokens, 4_000);
        // 3000 input @80 + 1000 output @400 = 240_000 + 400_000 micropence
        assert_eq!(e.cost_micropence, 640_000);
    }

    #[test]
    fn with_enough_history_the_estimate_uses_it_and_says_so() {
        let p = price(80, 400, 100);
        let history: Vec<i64> = (0..MIN_SAMPLES as i64).map(|_| 12_345).collect();
        let e = estimate("haiku", "storyGeneration", 1.0, Some(&p), &history, 0, 0);
        assert_eq!(e.source, Source::History);
        assert_eq!(e.tokens, 12_345, "real usage beats the baseline once it is real");
    }

    #[test]
    fn a_dearer_model_costs_more_for_the_same_work() {
        let cheap = price(80, 400, 100);
        let dear = price(1_500, 7_500, 60);
        let a = estimate("haiku", "storyGeneration", 1.0, Some(&cheap), &[], 0, 0);
        let b = estimate("opus", "storyGeneration", 1.0, Some(&dear), &[], 0, 0);
        assert!(b.cost_micropence > a.cost_micropence);
        assert!(b.minutes >= a.minutes, "and the slower model takes longer");
    }

    #[test]
    fn time_never_reads_as_zero_minutes() {
        let p = price(80, 400, 100_000); // absurdly fast
        let e = estimate("m", "storyGeneration", 1.0, Some(&p), &[], 0, 0);
        assert_eq!(e.minutes, 1);
    }

    /// An unset budget means "not limited by money", exactly as the router
    /// reads it — otherwise leaving the field blank would mark every option
    /// unaffordable.
    #[test]
    fn an_unset_budget_never_makes_an_option_unaffordable() {
        let p = price(1_500, 7_500, 60);
        let e = estimate("opus", "solutionStrategy", 1.5, Some(&p), &[], 0, 0);
        assert!(e.affordable);
    }

    #[test]
    fn an_option_that_would_breach_the_remaining_budget_is_marked_unaffordable() {
        let p = price(1_500, 7_500, 60);
        // budget 1_000_000 micropence, nearly all spent
        let e = estimate("opus", "solutionStrategy", 1.0, Some(&p), &[], 1_000_000, 999_000);
        assert!(!e.affordable);

        let fresh = estimate("opus", "solutionStrategy", 1.0, Some(&p), &[], 100_000_000, 0);
        assert!(fresh.affordable);
    }

    #[test]
    fn an_unpriced_model_estimates_free_rather_than_failing() {
        let e = estimate("llama3", "storyGeneration", 1.0, None, &[], 500, 0);
        assert_eq!(e.cost_micropence, 0);
        assert!(e.affordable, "a local model is always affordable");
        assert!(e.minutes >= 1);
    }
}
