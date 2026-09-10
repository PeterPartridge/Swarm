//! Fetching a policy, showing it, and running it — three acts, kept apart.
//!
//! **Fetched on this machine, never by the sandbox.** The thing being fetched
//! is a script that will run as root inside the boundary, so it is pulled where
//! it can be read first rather than by the thing it is meant to bind. Reading it
//! is the only safeguard there is against a policy somebody else wrote: it can
//! weaken a boundary as easily as strengthen one.
//!
//! **Three presses, not one.** Fetch, then read, then run. A single button that
//! did all three would make the reading optional, and the reading is the point.
//!
//! **No checksum is offered, because none can honestly be given here.** This
//! project has no hashing crate, and a weak digest presented as a fingerprint
//! would be worse than none — it would look like integrity. What is offered
//! instead is the file itself, in full, and its size. A GitHub source pinned to
//! a commit is the one form that carries real integrity, and that is the reason
//! to prefer it.

use std::path::Path;

/// Where a Solution keeps the list of what an agent may not reach.
pub const POLICY_FILE: &str = ".coperativeai/policy.json";

/// What an agent may not reach, as the repository states it.
///
/// **A list of what, never a script of how.** The two boundaries enforce it in
/// completely different ways — permissions under WSL, mounts under Docker — and
/// a container cannot run a script before it exists. Saying *what* is the only
/// form both can honour.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Policy {
    /// Paths in the working copy an agent must not reach, relative to the
    /// repository root.
    #[serde(default)]
    pub deny: Vec<String>,
}

/// Reads a Solution's policy, or nothing when it has none.
///
/// A repository with no policy is the ordinary case, not a failure — most work
/// has nothing to hide from the agent doing it.
pub fn read_policy(repo_root: &Path) -> Result<Policy, String> {
    let at = repo_root.join(POLICY_FILE.replace('/', std::path::MAIN_SEPARATOR_STR));
    if !at.is_file() {
        return Ok(Policy::default());
    }
    let text = std::fs::read_to_string(&at)
        .map_err(|e| format!("could not read {}: {e}", at.display()))?;
    serde_json::from_str(&text).map_err(|e| {
        // The line is the useful part: a policy nobody can parse is one nobody
        // can fix, and the whole file being "invalid" says nothing.
        format!("{POLICY_FILE} could not be read — {e}")
    })
}

/// The denied paths, refusing any that would reach outside the working copy.
///
/// **A rule that climbs out of the repository is refused rather than ignored.**
/// Silently dropping it would leave somebody believing a path was protected
/// when nothing had been done about it at all.
pub fn deny_paths(policy: &Policy) -> Result<Vec<String>, String> {
    let mut out = Vec::with_capacity(policy.deny.len());
    for rule in &policy.deny {
        let cleaned = rule.trim().replace('\\', "/");
        let cleaned = cleaned.trim_matches('/').to_string();
        if cleaned.is_empty() {
            continue;
        }
        // A denied path becomes a shell argument inside the distribution, and
        // the lesson from the config that nearly shipped with an apostrophe in
        // it is that broken quoting is not a loud failure — it is a half-run
        // command leaving a boundary that looks applied.
        if cleaned.contains('\'') {
            return Err(format!(
                "'{rule}' has a quote in it, and this app will not try to spell that safely for \
                 a shell. Renaming the path is the way through."
            ));
        }
        if cleaned.starts_with("..")
            || cleaned.split('/').any(|part| part == "..")
            || cleaned.contains(':')
        {
            return Err(format!(
                "'{rule}' reaches outside the working copy, so it was refused rather than \
                 quietly ignored — a rule that does nothing is worse than no rule"
            ));
        }
        out.push(cleaned);
    }
    Ok(out)
}

/// What was fetched, and what it says.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fetched {
    /// Where it landed on this machine.
    pub path: String,
    pub bytes: usize,
    /// What it says, for reading before it is run.
    pub text: String,
    /// Whether `text` is only the beginning of it.
    pub truncated: bool,
}

/// Enough of a file to judge it by. A policy that needs more than this to
/// understand is one nobody was going to read anyway.
const SHOW_AT_MOST: usize = 64 * 1024;

/// What to call the file once it is here.
///
/// Taken from the source so a person can recognise it, sanitised because it
/// becomes a path on this machine, and never empty.
pub fn file_name_for(from: &str) -> String {
    let from = from.trim();
    // **The host is not a file name.** An address with nothing after the host
    // has no name to take, and taking one anyway gives files called
    // `example.com`, which tells nobody anything about what they are reading.
    let source = if is_address(from) {
        match from
            .splitn(2, "://")
            .nth(1)
            .unwrap_or("")
            .trim_end_matches('/')
            .split_once('/')
        {
            Some((_host, path)) => path,
            None => "",
        }
    } else {
        from
    };
    let tail = source
        .trim_end_matches('/')
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .split('?')
        .next()
        .unwrap_or("");
    let cleaned: String = tail
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let cleaned = cleaned.trim_matches(['-', '.']).to_string();
    if cleaned.is_empty() {
        "policy.json".to_string()
    } else {
        cleaned
    }
}

/// The file as something to read, and whether that is all of it.
pub fn readable(bytes: &[u8]) -> (String, bool) {
    let truncated = bytes.len() > SHOW_AT_MOST;
    let slice = if truncated { &bytes[..SHOW_AT_MOST] } else { bytes };
    (String::from_utf8_lossy(slice).into_owned(), truncated)
}

/// Whether a source is fetched over the network or copied from here.
pub fn is_address(from: &str) -> bool {
    let from = from.trim().to_lowercase();
    from.starts_with("https://") || from.starts_with("http://")
}

/// Brings the policy to this machine and says what it contains.
///
/// **`https` only for an address.** What is being fetched runs as root inside
/// the boundary; over plain http it is a script anybody on the path can rewrite.
pub async fn fetch(from: &str, folder: &str) -> Result<Fetched, String> {
    let from = from.trim();
    let folder = folder.trim();
    if from.is_empty() {
        return Err("there is no policy source set — say where it comes from first".into());
    }
    if folder.is_empty() {
        return Err("say which folder it should be downloaded into".into());
    }

    let bytes: Vec<u8> = if is_address(from) {
        if !from.to_lowercase().starts_with("https://") {
            return Err(
                "a policy is fetched and then run as root, so it has to come over https".into(),
            );
        }
        let said = reqwest::get(from)
            .await
            .map_err(|e| format!("could not fetch {from}: {e}"))?;
        if !said.status().is_success() {
            return Err(format!("{from} answered {}", said.status()));
        }
        said.bytes()
            .await
            .map_err(|e| format!("could not read what {from} sent: {e}"))?
            .to_vec()
    } else {
        std::fs::read(from).map_err(|e| format!("could not read {from}: {e}"))?
    };

    let target = Path::new(folder).join(file_name_for(from));
    std::fs::create_dir_all(folder)
        .map_err(|e| format!("could not make {folder}: {e}"))?;
    std::fs::write(&target, &bytes)
        .map_err(|e| format!("could not write {}: {e}", target.display()))?;

    let (text, truncated) = readable(&bytes);
    Ok(Fetched {
        path: target.to_string_lossy().to_string(),
        bytes: bytes.len(),
        text,
        truncated,
    })
}

/// Runs the policy where the agent will run.
///
/// **Only where a boundary already exists.** Under WSL the distribution is
/// always there, so the policy can be applied once and stay applied. Under
/// Docker a container belongs to a run and does not exist between them — so
/// there is nothing here to run it in, and applying it belongs to the run
/// rather than to this button. Said rather than silently skipped.
pub async fn install(
    fetched: &Fetched,
    mode: crate::tooling::sandbox::Mode,
    command: &str,
) -> Result<String, String> {
    let command = command.trim();
    if command.is_empty() {
        return Err("there is no command to run — say what installs the policy".into());
    }
    match mode {
        crate::tooling::sandbox::Mode::Off => Err(
            "with agents running on this machine there is no separate user to keep anything \
             from, so a policy would restrict nothing. Choose a sandbox first."
                .into(),
        ),
        crate::tooling::sandbox::Mode::Docker => Err(
            "a container belongs to a run and does not exist between runs, so there is nothing \
             here to install into. Under Docker the policy is applied when a run starts."
                .into(),
        ),
        crate::tooling::sandbox::Mode::Wsl => {
            let inside_dir = "/work/policy";
            let name = Path::new(&fetched.path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "policy.json".to_string());

            // Put it where the command will find it, through the same view of
            // the distribution the rest of this app already uses.
            let landing = crate::tooling::sandbox::windows_view(inside_dir);
            std::fs::create_dir_all(&landing)
                .map_err(|e| format!("could not make {inside_dir} inside the sandbox: {e}"))?;
            std::fs::copy(&fetched.path, Path::new(&landing).join(&name))
                .map_err(|e| format!("could not put the policy inside the sandbox: {e}"))?;

            crate::tooling::sandbox_run::run_as_root(&format!(
                "cd '{inside_dir}' && {command}"
            ))
            .await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_is_named_after_where_it_came_from() {
        assert_eq!(file_name_for("https://example.com/policies/strict.json"), "strict.json");
        assert_eq!(file_name_for(r"C:\work\my policy.json"), "my-policy.json");
        // A query string is not part of the name.
        assert_eq!(file_name_for("https://example.com/p.json?ref=main"), "p.json");
    }

    /// A source that names nothing still has to land somewhere.
    #[test]
    fn a_source_with_no_name_gets_one() {
        assert_eq!(file_name_for("https://example.com/"), "policy.json");
        assert_eq!(file_name_for("https://example.com/???"), "policy.json");
    }

    /// It becomes a path on this machine, so it cannot carry one.
    #[test]
    fn a_name_cannot_climb_out_of_the_folder_it_is_put_in() {
        for nasty in ["https://e.com/../../etc/passwd", r"C:\x\..\..\windows\system32"] {
            let name = file_name_for(nasty);
            assert!(!name.contains(".."), "{nasty} became {name}");
            assert!(!name.contains('/') && !name.contains('\\'), "{nasty} became {name}");
        }
    }

    #[test]
    fn an_address_is_told_from_a_file() {
        assert!(is_address("https://example.com/p.json"));
        assert!(is_address("HTTPS://EXAMPLE.COM/p.json"));
        assert!(!is_address(r"C:\work\p.json"));
        assert!(!is_address("/home/me/p.json"));
    }

    /// **Read before it is run, so it has to be readable.** A file too big to
    /// show is shown as much of as is worth reading, and said to be partial.
    #[test]
    fn a_long_policy_is_shown_as_far_as_it_is_worth_reading() {
        let long = vec![b'x'; SHOW_AT_MOST + 10];
        let (text, truncated) = readable(&long);
        assert!(truncated);
        assert_eq!(text.len(), SHOW_AT_MOST);

        let short = b"{\"deny\": []}";
        let (text, truncated) = readable(short);
        assert!(!truncated);
        assert_eq!(text, "{\"deny\": []}");
    }

    /// **Refused rather than ignored.** A rule that silently does nothing
    /// leaves somebody believing a path is protected when nothing was done.
    #[test]
    fn a_rule_that_reaches_outside_the_working_copy_is_refused() {
        for bad in ["../secrets", "a/../../b", "C:/secrets"] {
            let policy = Policy { deny: vec![bad.into()] };
            assert!(deny_paths(&policy).is_err(), "{bad} should be refused");
        }
    }

    /// A path becomes a shell argument inside the distribution; a quote in it
    /// would break the quoting and leave a boundary that looks applied.
    #[test]
    fn a_rule_with_a_quote_in_it_is_refused_rather_than_guessed_at() {
        let policy = Policy { deny: vec!["Nick's secrets".into()] };
        assert!(deny_paths(&policy).is_err());
    }

    #[test]
    fn rules_are_tidied_without_being_changed() {
        let policy = Policy {
            deny: vec!["  secrets/  ".into(), "config\\keys.json".into(), "  ".into()],
        };
        assert_eq!(
            deny_paths(&policy).expect("ordinary rules"),
            vec!["secrets".to_string(), "config/keys.json".to_string()]
        );
    }

    /// A repository with no policy is the ordinary case, not a failure — most
    /// work has nothing to hide from the agent doing it.
    #[test]
    fn a_repository_with_no_policy_denies_nothing() {
        let nowhere = std::env::temp_dir().join("coperativeai-no-policy-here");
        let _ = std::fs::create_dir_all(&nowhere);
        assert_eq!(read_policy(&nowhere).expect("no policy is fine"), Policy::default());
    }

    #[tokio::test]
    async fn nothing_is_fetched_without_somewhere_to_put_it() {
        assert!(fetch("https://example.com/p.json", "  ").await.is_err());
        assert!(fetch("  ", "C:\\tmp").await.is_err());
    }

    /// **Plain http is refused.** What is fetched runs as root inside the
    /// boundary, and over http it is a script anybody on the path can rewrite.
    #[tokio::test]
    async fn an_address_that_is_not_https_is_refused_before_anything_is_fetched() {
        let refused = fetch("http://example.com/p.json", "C:\\tmp")
            .await
            .expect_err("http must not be fetched");
        assert!(refused.contains("https"), "{refused}");
    }

    /// Off has no separate user, so a policy there would restrict nothing —
    /// said rather than run and quietly achieving nothing.
    #[tokio::test]
    async fn a_policy_is_refused_where_it_could_not_restrict_anything() {
        let fetched = Fetched {
            path: "C:\\tmp\\p.json".into(),
            bytes: 2,
            text: "{}".into(),
            truncated: false,
        };
        let refused = install(&fetched, crate::tooling::sandbox::Mode::Off, "sh p.json")
            .await
            .expect_err("nothing to restrict against");
        assert!(refused.contains("no separate user"), "{refused}");

        // And a container does not exist between runs, so there is nothing
        // here to install into.
        let later = install(&fetched, crate::tooling::sandbox::Mode::Docker, "sh p.json")
            .await
            .expect_err("no container outside a run");
        assert!(later.contains("when a run starts"), "{later}");
    }

    /// **The whole loop, against the real distribution.**
    ///
    /// Fetches a policy from a file, runs it inside the boundary as root, and
    /// then checks the thing that matters: that the agent really cannot read
    /// what the policy protected. Ignored by default because it needs the
    /// distribution this machine has, and it changes what is inside it.
    #[test]
    #[ignore = "runs a real policy inside the distribution on this machine"]
    fn a_policy_fetched_and_run_actually_restricts_the_agent() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        runtime.block_on(async {
            let folder = std::env::temp_dir().join("coperativeai-policy-probe");
            let script = std::env::temp_dir().join("polprobe").join("apply.sh");
            let fetched = fetch(&script.to_string_lossy(), &folder.to_string_lossy())
                .await
                .expect("a policy on this machine");
            println!("fetched {} bytes to {}", fetched.bytes, fetched.path);
            assert!(fetched.text.contains("chmod 000"), "it should be readable before it runs");

            let said = install(&fetched, crate::tooling::sandbox::Mode::Wsl, "sh apply.sh")
                .await
                .expect("the policy runs");
            println!("{said}");

            // The claim, asked of the agent rather than of the flags.
            let tried = crate::tooling::sandbox_run::read_as_agent(
                "cat /work/runs/secrets/keys.txt 2>&1; echo ---; ls /work/runs/secrets 2>&1",
            )
            .await
            .unwrap_or_else(|said| said);
            println!("{tried}");
            assert!(
                tried.contains("Permission denied"),
                "the agent must not be able to read what the policy protected: {tried}"
            );
        });
    }

    #[tokio::test]
    async fn a_policy_with_no_command_is_not_run() {
        let fetched = Fetched { path: "p".into(), bytes: 0, text: String::new(), truncated: false };
        assert!(install(&fetched, crate::tooling::sandbox::Mode::Wsl, "   ").await.is_err());
    }
}
