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
//! **A digest is what makes the reading worth anything a second time.** Reading
//! a script once says what it did that day; recognising it again is what says
//! nobody changed it afterwards. So every fetch is hashed, and a source can
//! carry the digest it is expected to have — set once, checked every time after.
//! `sha2` is already compiled here for tauri's own codegen, so this is a real
//! SHA-256 rather than something home-made presented as a fingerprint.
//!
//! **The first fetch is still trust.** A digest nobody set yet cannot verify
//! anything — it can only be shown, so it can be compared against what whoever
//! wrote the policy said it should be, and then pinned. That gap is said out
//! loud rather than papered over: an unpinned source is checked against nothing.

use sha2::{Digest, Sha256};
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
    /// SHA-256 of the whole file, lowercase hex.
    ///
    /// **Of the bytes, never of `text`.** `text` stops at what is worth
    /// reading, and a digest of the readable part would match two files that
    /// differ only after the cut — which is exactly where somebody hiding
    /// something would put it.
    pub digest: String,
    /// Whether it was checked against a digest set beforehand, or only shown.
    pub verified: bool,
}

/// What a file is, said in a way it can be recognised by again.
pub fn digest(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    // Written out here rather than pulled in as another crate: sixteen
    // characters of format string against a dependency is not a trade.
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Whether a digest is one this app could ever have produced.
///
/// Refused at the point it is typed rather than at the point it fails to
/// match: a mistyped digest and a changed policy would otherwise arrive as the
/// same message, and only one of them is an attack.
pub fn is_digest(said: &str) -> bool {
    let said = said.trim();
    said.len() == 64 && said.chars().all(|c| c.is_ascii_hexdigit())
}

/// The moving part of a GitHub address, when it has one.
///
/// **A branch is a script that can change after somebody approved it.** GitHub
/// addresses carry their ref in the path, so the one case this app can actually
/// tell apart is worth telling apart: `.../blob/main/policy.json` is a promise
/// about wherever `main` points today, and `.../blob/<commit>/policy.json` is a
/// promise about a file. Said by name, because "use a commit instead" is only
/// useful advice if it says which part to replace.
pub fn moving_github_ref(from: &str) -> Option<String> {
    let from = from.trim();
    let rest = from.split_once("://").map(|(_, rest)| rest)?;
    let (host, path) = rest.split_once('/')?;
    let host = host.to_lowercase();
    if host != "github.com"
        && host != "www.github.com"
        && host != "raw.githubusercontent.com"
        && host != "raw.github.com"
    {
        return None;
    }
    let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
    // owner / repo / [blob|raw|refs/heads] / <ref> / …
    let at = match parts.get(2) {
        Some(&"blob") | Some(&"raw") => 3,
        // raw.githubusercontent.com puts the ref straight after the repository.
        _ if host.starts_with("raw.") => 2,
        _ => return None,
    };
    let named = parts.get(at)?;
    // `refs/heads/main` names a branch just as plainly as `main` does.
    let named = if *named == "refs" { parts.get(at + 2)? } else { named };
    let is_commit = named.len() == 40 && named.chars().all(|c| c.is_ascii_hexdigit());
    (!is_commit).then(|| (*named).to_string())
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
        from.split_once("://")
            .map(|(_scheme, rest)| rest)
            .unwrap_or("")
            .trim_end_matches('/')
            .split_once('/')
            .map(|(_host, path)| path)
            .unwrap_or("")
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
///
/// **Checked before it is written, when there is something to check it
/// against.** A file that failed its digest is not saved anywhere, because the
/// next press of "Run it" reads from the folder rather than from here — leaving
/// the rejected copy on disk under the name the good one goes by would be
/// handing it over a moment later.
pub async fn fetch(from: &str, folder: &str, expected: &str) -> Result<Fetched, String> {
    let from = from.trim();
    let folder = folder.trim();
    let expected = expected.trim().to_lowercase();
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

    let got = digest(&bytes);
    if !expected.is_empty() && got != expected {
        // Both digests, because the useful question afterwards is whether this
        // is a policy that moved on purpose or one that moved on somebody
        // else's purpose — and that is answered by comparing them, not by
        // being told they differ.
        return Err(format!(
            "{from} is not the policy that was pinned, so nothing was saved.\nexpected {expected}\n     got {got}\nIf it was meant to change, read the new one and pin it again."
        ));
    }

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
        digest: got,
        verified: !expected.is_empty(),
    })
}

/// Runs the policy where the agent will run.
///
/// **Only where a boundary already exists.** Under WSL the distribution is
/// always there, so the policy can be applied once and stay applied. Under
/// Docker a container belongs to a run and does not exist between them — so
/// there is nothing here to run it in, and applying it belongs to the run
/// rather than to this button. Said rather than silently skipped.
///
/// **Hashed again here, against what was read rather than against the
/// setting.** Fetching and running are deliberately two presses, which means
/// the file sits on this machine between them under a name anybody can predict.
/// Checking the digest at fetch time alone would leave the whole point of
/// separating them — that a person reads it in between — as the window in which
/// to swap it. So what runs is checked to be what was shown.
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
            // Checked here rather than at fetch alone: the mode refusals above
            // are about whether it would run at all, and there is no sense
            // asking whether a file is unchanged before asking that.
            if !fetched.digest.is_empty() {
                let now = std::fs::read(&fetched.path)
                    .map_err(|e| format!("could not read back {}: {e}", fetched.path))?;
                if digest(&now) != fetched.digest {
                    return Err(format!(
                        "{} has changed since it was fetched, so it was not run. Fetch it again \
                         and read it.",
                        fetched.path
                    ));
                }
            }

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
        assert!(fetch("https://example.com/p.json", "  ", "").await.is_err());
        assert!(fetch("  ", "C:\\tmp", "").await.is_err());
    }

    /// Against the published SHA-256 of the empty input and of "abc", so this
    /// is checked against the standard rather than against itself.
    #[test]
    fn a_digest_is_the_one_everybody_else_computes() {
        assert_eq!(
            digest(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            digest(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        // **And over a real policy, against the tools somebody would check it
        // with.** A digest nobody else computes the same way is worse than
        // none: whoever published the policy will have hashed it with
        // `sha256sum` or `certutil`, and the whole mechanism rests on the two
        // numbers being comparable by eye. Both were run on these exact bytes
        // and both said this.
        assert_eq!(
            digest(br#"{"deny": ["secrets", ".env"]}"#),
            "6735dbe6458e78a03b4b67990a9d015db5b7ad677c8db976b7b5104d92e2ae6b"
        );
    }

    #[test]
    fn a_digest_is_told_from_a_typo() {
        assert!(is_digest(&digest(b"anything")));
        assert!(is_digest(&digest(b"anything").to_uppercase()));
        assert!(!is_digest(""));
        assert!(!is_digest("abc123"));
        // Sixty-four characters, but not all of them hexadecimal.
        assert!(!is_digest(&"z".repeat(64)));
    }

    /// **A branch is a script that can change after somebody approved it.**
    #[test]
    fn a_github_address_that_names_a_branch_is_recognised_as_moving() {
        let commit = "a".repeat(40);
        for moving in [
            "https://github.com/o/r/blob/main/policy.json",
            "https://raw.githubusercontent.com/o/r/main/policy.json",
            "https://github.com/o/r/raw/release-2/deep/policy.json",
            "https://raw.githubusercontent.com/o/r/refs/heads/main/policy.json",
        ] {
            assert!(moving_github_ref(moving).is_some(), "{moving} should be moving");
        }
        for pinned in [
            format!("https://github.com/o/r/blob/{commit}/policy.json"),
            format!("https://raw.githubusercontent.com/o/r/{commit}/policy.json"),
        ] {
            assert_eq!(moving_github_ref(&pinned), None, "{pinned} is pinned");
        }
        // Somewhere else entirely is not this check's business to judge.
        assert_eq!(moving_github_ref("https://example.com/main/policy.json"), None);
        assert_eq!(moving_github_ref(r"C:\work\policy.json"), None);
    }

    /// **The rejected copy is never written.** "Run it" reads from the folder,
    /// so saving a file that failed its digest under the name the good one goes
    /// by would be handing it over a press later.
    #[tokio::test]
    async fn a_policy_that_is_not_the_one_pinned_is_neither_saved_nor_returned() {
        let folder = std::env::temp_dir().join("coperativeai-digest-refuse");
        let _ = std::fs::remove_dir_all(&folder);
        let source = folder.join("source").join("p.json");
        std::fs::create_dir_all(source.parent().expect("a parent")).expect("somewhere to put it");
        std::fs::write(&source, b"{\"deny\": [\"secrets\"]}").expect("a policy to fetch");

        let into = folder.join("into");
        let refused = fetch(
            &source.to_string_lossy(),
            &into.to_string_lossy(),
            &digest(b"a different policy entirely"),
        )
        .await
        .expect_err("it is not the pinned policy");
        assert!(refused.contains("not the policy that was pinned"), "{refused}");
        // Both digests, so the question "did it change on purpose?" is answerable.
        assert!(refused.contains(&digest(b"{\"deny\": [\"secrets\"]}")), "{refused}");
        assert!(!into.join("p.json").exists(), "the refused copy must not be left behind");

        // And the same file, correctly pinned, goes through and says so.
        let good = fetch(
            &source.to_string_lossy(),
            &into.to_string_lossy(),
            &digest(b"{\"deny\": [\"secrets\"]}"),
        )
        .await
        .expect("the pinned policy");
        assert!(good.verified);
        assert_eq!(good.digest, digest(b"{\"deny\": [\"secrets\"]}"));
        let _ = std::fs::remove_dir_all(&folder);
    }

    /// An unpinned source is checked against nothing, and says so rather than
    /// letting a digest on screen read as a digest that was verified.
    #[tokio::test]
    async fn an_unpinned_policy_is_shown_but_not_claimed_to_be_verified() {
        let folder = std::env::temp_dir().join("coperativeai-digest-first");
        let _ = std::fs::remove_dir_all(&folder);
        let source = folder.join("p.json");
        std::fs::create_dir_all(&folder).expect("somewhere to put it");
        std::fs::write(&source, b"{}").expect("a policy to fetch");

        let got = fetch(
            &source.to_string_lossy(),
            &folder.join("into").to_string_lossy(),
            "",
        )
        .await
        .expect("an ordinary first fetch");
        assert!(!got.verified, "nothing was set to check it against");
        assert_eq!(got.digest, digest(b"{}"));
        let _ = std::fs::remove_dir_all(&folder);
    }

    /// **The gap between the two presses is the one worth closing.** Fetch and
    /// run are separate so a person can read it in between, which is also the
    /// window in which the file on disk could be swapped.
    #[tokio::test]
    async fn a_policy_changed_between_being_read_and_being_run_is_not_run() {
        let folder = std::env::temp_dir().join("coperativeai-digest-swap");
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).expect("somewhere to put it");
        let at = folder.join("p.json");
        std::fs::write(&at, b"chmod 000 secrets").expect("what was read");

        let fetched = Fetched {
            path: at.to_string_lossy().to_string(),
            bytes: 17,
            text: "chmod 000 secrets".into(),
            truncated: false,
            digest: digest(b"chmod 000 secrets"),
            verified: true,
        };
        // Swapped after it was shown, before it is run.
        std::fs::write(&at, b"chmod 777 /").expect("what would run instead");

        let refused = install(&fetched, crate::tooling::sandbox::Mode::Wsl, "sh p.json")
            .await
            .expect_err("what runs must be what was shown");
        assert!(refused.contains("has changed since it was fetched"), "{refused}");
        let _ = std::fs::remove_dir_all(&folder);
    }

    /// **Plain http is refused.** What is fetched runs as root inside the
    /// boundary, and over http it is a script anybody on the path can rewrite.
    #[tokio::test]
    async fn an_address_that_is_not_https_is_refused_before_anything_is_fetched() {
        let refused = fetch("http://example.com/p.json", "C:\\tmp", "")
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
            digest: digest(b"{}"),
            verified: false,
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
            let fetched = fetch(&script.to_string_lossy(), &folder.to_string_lossy(), "")
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
        let fetched = Fetched {
            path: "p".into(),
            bytes: 0,
            text: String::new(),
            truncated: false,
            // Nothing to re-check against, so the command is the only refusal.
            digest: String::new(),
            verified: false,
        };
        assert!(install(&fetched, crate::tooling::sandbox::Mode::Wsl, "   ").await.is_err());
    }
}
