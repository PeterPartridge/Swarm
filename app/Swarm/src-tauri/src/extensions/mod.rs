//! Extensions — the Hives and Cells a person installs from Admin. See
//! application/ai-only/Hives/extensions.md.
//!
//! `catalogue` reads the standard file, `fetch` gets it from a URL, and the
//! table of what is installed is `db::installed_extension`. What being
//! installed *changes* is decided here, purely, so the rules are tests rather
//! than something read out of a command.

pub mod catalogue;
pub mod fetch;
pub mod store;

/// Whether what the person approved is exactly what the source asks for.
///
/// **The same set, not a subset.** A Hive's permissions are approved as a set,
/// on the review screen. If the source asks for something different by the
/// time Install runs (it is read again), the person has not seen what is being
/// installed, so it is refused and they review it again.
pub fn approval_matches(asked: &[catalogue::PermissionOffer], approved: &[String]) -> Result<(), String> {
    let mut asked: Vec<&str> = asked.iter().map(|p| p.id.as_str()).collect();
    let mut approved: Vec<&str> = approved.iter().map(String::as_str).collect();
    asked.sort_unstable();
    asked.dedup();
    approved.sort_unstable();
    approved.dedup();
    if asked == approved {
        Ok(())
    } else {
        Err("What this Hive asks to do has changed since you reviewed it. Read the source and review it again.".into())
    }
}

/// The Hives the active user may open: installed, and granted or Admin.
///
/// **Not installed beats granted**, Admin included — an uninstalled Hive is
/// not there to open. Kept in installed order, since that is the order Admin
/// put them in.
pub fn openable_hives(installed: &[String], granted: &[String], sees_all: bool) -> Vec<String> {
    installed
        .iter()
        .filter(|id| sees_all || granted.contains(id))
        .cloned()
        .collect()
}

/// Whether the sandbox setting may be set to `mode`.
///
/// `off` is always a choice — it is not a cell, it is this machine. Anything
/// else must be an installed cell.
pub fn may_choose_sandbox(mode: &str, installed_cells: &[String]) -> Result<(), String> {
    if mode == "off" || installed_cells.iter().any(|c| c == mode) {
        Ok(())
    } else {
        Err(not_installed(mode))
    }
}

/// Whether an agent run may start in `mode`.
///
/// **With no cell installed, an agent run is refused rather than run on this
/// machine** (open question O1, answered (a) on 2026-10-29). With one
/// installed, `off` stays the choice it is today. This is for agent runs only:
/// the terminal, the test runner and the inspectors are the person's own
/// commands and still run where the setting says.
pub fn may_run_agent(mode: &str, installed_cells: &[String]) -> Result<(), String> {
    if mode == "off" && installed_cells.is_empty() {
        return Err("No cell is installed, so agents are not run on this machine. \
                    Install one in Admin → Extensions."
            .into());
    }
    may_choose_sandbox(mode, installed_cells)
}

/// Whether an extension may be removed, given the sandbox setting.
///
/// **The cell the setting names cannot be removed.** The terminal and the test
/// runner run where the setting says, and would be pointed at a place that is
/// no longer installed. Choosing another place first keeps the setting true.
pub fn may_remove(kind: &str, id: &str, sandbox_setting: &str) -> Result<(), String> {
    if kind == "cell" && sandbox_setting.trim() == id {
        return Err(format!(
            "The {id} cell is where commands run now. Choose another place under \
             Admin → AI first, then remove it."
        ));
    }
    Ok(())
}

fn not_installed(mode: &str) -> String {
    format!(
        "The {mode} cell is not installed. Install it in Admin → Extensions, \
         or choose another place to run."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_granted_hive_that_is_not_installed_is_not_openable() {
        let installed = ids(&["product", "test"]);
        assert_eq!(openable_hives(&installed, &ids(&["develop", "test"]), false), ["test"]);
    }

    /// Admin sees every *installed* Hive — not every Hive this Swarm contains.
    #[test]
    fn seeing_all_means_every_installed_hive() {
        let installed = ids(&["product", "develop"]);
        assert_eq!(openable_hives(&installed, &[], true), ["product", "develop"]);
        assert!(openable_hives(&[], &ids(&["product"]), true).is_empty());
    }

    #[test]
    fn off_can_always_be_chosen_and_a_cell_only_when_installed() {
        assert!(may_choose_sandbox("off", &[]).is_ok());
        assert!(may_choose_sandbox("docker", &ids(&["docker"])).is_ok());
        let refused = may_choose_sandbox("docker", &ids(&["wsl"])).unwrap_err();
        assert!(refused.contains("Admin → Extensions"), "{refused}");
    }

    /// O1 (a): a new Swarm, with no cell, does not run agents unprotected.
    #[test]
    fn an_agent_run_with_no_cell_installed_is_refused() {
        let refused = may_run_agent("off", &[]).unwrap_err();
        assert!(refused.contains("No cell is installed"), "{refused}");
        assert!(refused.contains("Admin → Extensions"), "{refused}");
    }

    /// An existing install keeps its cells, so `off` carries on as today.
    #[test]
    fn an_agent_run_on_off_proceeds_once_any_cell_is_installed() {
        assert!(may_run_agent("off", &ids(&["wsl"])).is_ok());
        assert!(may_run_agent("wsl", &ids(&["wsl"])).is_ok());
    }

    fn offers(ids: &[&str]) -> Vec<catalogue::PermissionOffer> {
        ids.iter()
            .map(|id| catalogue::PermissionOffer { id: id.to_string(), means: String::new() })
            .collect()
    }

    #[test]
    fn an_approval_must_be_exactly_what_is_asked() {
        let asked = offers(&["products:read", "workItems:write"]);
        assert!(approval_matches(&asked, &ids(&["workItems:write", "products:read"])).is_ok());
        assert!(approval_matches(&asked, &ids(&["products:read"])).is_err());
        assert!(approval_matches(&asked, &ids(&["products:read", "workItems:write", "testCases:read"])).is_err());
        assert!(approval_matches(&[], &[]).is_ok());
    }

    #[test]
    fn the_cell_in_use_cannot_be_removed() {
        assert!(may_remove("cell", "docker", "docker").unwrap_err().contains("Admin → AI"));
        assert!(may_remove("cell", "wsl", "docker").is_ok());
        // a Hive is never "in use" by the sandbox setting, whatever its id
        assert!(may_remove("hive", "docker", "docker").is_ok());
    }

    #[test]
    fn an_agent_run_in_an_uninstalled_cell_is_refused() {
        assert!(may_run_agent("docker", &ids(&["wsl"])).unwrap_err().contains("docker cell"));
    }
}
