//! Model selection by effort tier.
//!
//! A provider's `models` list is treated as **ordered cheapest → most capable**
//! (AI Settings says so beside the field). The work item's policy sets an effort
//! tier, and that tier picks the model — replacing the previous behaviour of
//! always taking the first model regardless of the task.
//!
//! This implements Project_brief.md Part 4: cheapest model for small
//! well-defined tasks, mid-range for everyday feature work, most capable for
//! complex or architectural work.

/// Picks the model for an effort tier. `None` when the provider has no models.
///
/// low → cheapest, high → most capable, medium → the middle of the list.
/// An unknown tier is treated as `low`, the cautious choice: the cheapest
/// model is the one that cannot cause a surprise bill.
pub fn model_for_effort<'a>(models: &'a [String], effort: &str) -> Option<&'a str> {
    if models.is_empty() {
        return None;
    }
    let last = models.len() - 1;
    let index = match effort {
        "high" => last,
        "medium" => models.len() / 2,
        _ => 0,
    };
    Some(models[index.min(last)].as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn models(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn no_models_means_no_choice() {
        assert_eq!(model_for_effort(&[], "low"), None);
    }

    #[test]
    fn a_single_model_is_used_for_every_tier() {
        let m = models(&["only"]);
        for effort in ["low", "medium", "high"] {
            assert_eq!(model_for_effort(&m, effort), Some("only"));
        }
    }

    #[test]
    fn three_models_map_to_cheapest_middle_and_most_capable() {
        let m = models(&["haiku", "sonnet", "opus"]);
        assert_eq!(model_for_effort(&m, "low"), Some("haiku"));
        assert_eq!(model_for_effort(&m, "medium"), Some("sonnet"));
        assert_eq!(model_for_effort(&m, "high"), Some("opus"));
    }

    #[test]
    fn five_models_spread_across_the_list() {
        let m = models(&["a", "b", "c", "d", "e"]);
        assert_eq!(model_for_effort(&m, "low"), Some("a"));
        assert_eq!(model_for_effort(&m, "medium"), Some("c"));
        assert_eq!(model_for_effort(&m, "high"), Some("e"));
    }

    #[test]
    fn two_models_never_index_past_the_end() {
        let m = models(&["cheap", "dear"]);
        assert_eq!(model_for_effort(&m, "low"), Some("cheap"));
        assert_eq!(model_for_effort(&m, "medium"), Some("dear"));
        assert_eq!(model_for_effort(&m, "high"), Some("dear"));
    }

    /// An unrecognised tier must not pick the expensive end by accident.
    #[test]
    fn an_unknown_tier_falls_back_to_the_cheapest() {
        let m = models(&["haiku", "sonnet", "opus"]);
        assert_eq!(model_for_effort(&m, "extreme"), Some("haiku"));
        assert_eq!(model_for_effort(&m, ""), Some("haiku"));
    }
}
