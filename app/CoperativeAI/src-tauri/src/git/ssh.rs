//! Setting up an SSH key for GitHub.
//!
//! **The private key never comes back from this module.** Not to the frontend,
//! not into the database, not into a log. `ssh-keygen` writes it to disk with
//! the permissions ssh expects, and everything here works with the *public*
//! half. That is the same rule the API keys and the GitHub token follow, and it
//! matters more here: a leaked private key is push access to every repository
//! the account can reach.
//!
//! `ssh-keygen` is shelled out to rather than a key being generated in-process.
//! It is present on every machine that has git, it produces the exact on-disk
//! format ssh expects, and a hand-rolled generator is the last place anyone
//! should be inventing anything.

use std::path::{Path, PathBuf};
use std::process::Command;

/// What the machine has, without ever reading the private half.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshStatus {
    /// Whether a key pair exists at the standard path.
    pub has_key: bool,
    /// The path of the private key, for saying where it is. Its *contents* are
    /// never read.
    pub key_path: String,
    /// The public half — the only part that is ever shown or sent anywhere.
    pub public_key: Option<String>,
    /// Whether ssh-keygen is available to make one.
    pub can_generate: bool,
}

fn ssh_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    Some(Path::new(&home).join(".ssh"))
}

/// The key this app makes and looks for.
///
/// Its own name rather than `id_ed25519`, so generating one can never overwrite
/// a key somebody already relies on — which would lock them out of every host
/// that trusts it, with no way back.
const KEY_NAME: &str = "id_ed25519_coperativeai";

pub fn key_path() -> Option<PathBuf> {
    ssh_dir().map(|d| d.join(KEY_NAME))
}

fn have_keygen() -> bool {
    Command::new("ssh-keygen")
        .arg("--help")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok()
}

pub fn status() -> SshStatus {
    let path = key_path();
    let public = path
        .as_ref()
        .map(|p| p.with_extension("pub"))
        .filter(|p| p.is_file())
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|t| t.trim().to_string());

    SshStatus {
        has_key: path.as_ref().map(|p| p.is_file()).unwrap_or(false),
        key_path: path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        public_key: public,
        can_generate: have_keygen(),
    }
}

/// Generates a key pair, returning the public half.
///
/// Refuses to overwrite an existing key. `ssh-keygen -f` on a path that exists
/// prompts, and a prompt nobody can see is a hang — but more importantly,
/// replacing a key silently would lock somebody out of every host that trusts
/// the old one.
///
/// ed25519 rather than RSA: shorter, faster, and what GitHub's own
/// documentation has recommended for years.
pub fn generate(comment: &str) -> Result<String, String> {
    let Some(path) = key_path() else {
        return Err("could not work out where your .ssh folder is".into());
    };
    if path.exists() {
        return Err(format!(
            "{} already exists. Use it, or remove it yourself first — replacing a key here would \
             lock you out of anything else that trusts it.",
            path.display()
        ));
    }
    let Some(dir) = ssh_dir() else {
        return Err("could not work out where your .ssh folder is".into());
    };
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;

    let comment = if comment.trim().is_empty() {
        "coperativeai".to_string()
    } else {
        comment.trim().to_string()
    };
    let output = Command::new("ssh-keygen")
        .args([
            "-t",
            "ed25519",
            "-f",
            &path.to_string_lossy(),
            // No passphrase: a key this app generates is used by git commands
            // the app runs, and a passphrase it cannot supply would make every
            // one of them hang waiting for input nobody can see. Said plainly
            // in the UI rather than hidden here.
            "-N",
            "",
            "-C",
            &comment,
        ])
        .output()
        .map_err(|e| format!("could not run ssh-keygen — is OpenSSH installed? ({e})"))?;

    if !output.status.success() {
        return Err(format!(
            "ssh-keygen failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    std::fs::read_to_string(path.with_extension("pub"))
        .map(|t| t.trim().to_string())
        .map_err(|e| format!("the key was made but its public half could not be read: {e}"))
}

/// Checks that GitHub accepts the key, by asking it.
///
/// GitHub answers a successful SSH authentication with a greeting and **exit
/// code 1**, because it does not offer a shell. Treating that as failure is the
/// classic mistake here, so the greeting is what is checked rather than the
/// status.
pub fn test_github() -> Result<String, String> {
    let output = Command::new("ssh")
        .args([
            "-T",
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            "BatchMode=yes",
            "git@github.com",
        ])
        .output()
        .map_err(|e| format!("could not run ssh: {e}"))?;

    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if text.contains("successfully authenticated") {
        Ok(text.trim().to_string())
    } else {
        Err(format!("GitHub did not recognise the key. It said: {}", text.trim()))
    }
}

/// Rewrites a repository's origin to SSH.
///
/// The reason this exists: a repository cloned over HTTPS keeps asking for a
/// token no matter how well the SSH key is set up, and the connection between
/// those two facts is not obvious to anyone.
pub fn use_ssh_remote(root: &str) -> Result<String, String> {
    let root_path = Path::new(root);
    let current = git(root_path, &["remote", "get-url", "origin"])?;
    let current = current.trim();
    let Some(ssh) = to_ssh_url(current) else {
        return Err(format!(
            "'{current}' is not a GitHub HTTPS URL, so there is nothing to switch"
        ));
    };
    git(root_path, &["remote", "set-url", "origin", &ssh])?;
    Ok(ssh)
}

/// `https://github.com/owner/repo(.git)` → `git@github.com:owner/repo.git`.
pub fn to_ssh_url(https: &str) -> Option<String> {
    let rest = https
        .trim()
        .strip_prefix("https://github.com/")
        .or_else(|| https.trim().strip_prefix("http://github.com/"))?;
    let rest = rest.trim_end_matches('/').trim_end_matches(".git");
    if rest.is_empty() || !rest.contains('/') {
        return None;
    }
    Some(format!("git@github.com:{rest}.git"))
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .current_dir(root)
        .args(args)
        .output()
        .map_err(|e| format!("could not run git: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A repository cloned over HTTPS keeps asking for a token however well the
    /// key is set up, and nobody connects those two facts on their own.
    #[test]
    fn an_https_remote_converts_to_ssh() {
        assert_eq!(
            to_ssh_url("https://github.com/acme/shop-api.git"),
            Some("git@github.com:acme/shop-api.git".into())
        );
        // with no .git, and with a trailing slash
        assert_eq!(
            to_ssh_url("https://github.com/acme/shop-api"),
            Some("git@github.com:acme/shop-api.git".into())
        );
        assert_eq!(
            to_ssh_url("https://github.com/acme/shop-api/"),
            Some("git@github.com:acme/shop-api.git".into())
        );
    }

    /// Anything that is not a GitHub HTTPS URL is left alone. Rewriting a
    /// remote that points at another host, or one already on SSH, would break
    /// a working setup.
    #[test]
    fn anything_else_is_left_alone() {
        assert_eq!(to_ssh_url("git@github.com:acme/shop-api.git"), None);
        assert_eq!(to_ssh_url("https://gitlab.com/acme/shop-api.git"), None);
        assert_eq!(to_ssh_url("https://github.com/"), None);
        assert_eq!(to_ssh_url("https://github.com/justanowner"), None);
        assert_eq!(to_ssh_url(""), None);
    }

    /// The key gets its own name so generating one can never overwrite a key
    /// somebody already relies on.
    #[test]
    fn the_key_has_its_own_name_and_never_takes_the_default() {
        let path = key_path().expect("a home directory");
        let name = path.file_name().and_then(|n| n.to_str()).expect("a name");
        assert_eq!(name, "id_ed25519_coperativeai");
        assert_ne!(name, "id_ed25519", "must not sit on the default key");
        assert_ne!(name, "id_rsa");
    }

    /// The status is the public half and a path, and nothing else. A private
    /// key reaching the frontend is push access to every repository the account
    /// can see.
    #[test]
    fn the_status_never_carries_the_private_key() {
        let status = status();
        let json = serde_json::to_string(&status).expect("serialise");
        assert!(!json.contains("PRIVATE KEY"), "got: {json}");
        assert!(!json.contains("privateKey"), "there is no field for it");
        // and if a key does exist, what is shown is the public one
        if let Some(public) = status.public_key {
            assert!(
                public.starts_with("ssh-") || public.starts_with("ecdsa-"),
                "got: {public}"
            );
        }
    }
}
