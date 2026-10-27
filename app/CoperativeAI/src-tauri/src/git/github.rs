//! GitHub integration: a Personal Access Token stored in the OS credential
//! store (never the DB/config/logs, same rule as AI keys) plus the two REST
//! calls we need — verify the token and create a repository. The request-body
//! builder is a pure function so it's unit-tested without the network.

use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

const KEY_ALIAS: &str = "coperativeai/github";
const API: &str = "https://api.github.com";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("CoperativeAI", KEY_ALIAS)
        .map_err(|e| format!("credential store unavailable: {e}"))
}

pub fn store_token(token: &str) -> Result<(), String> {
    entry()?
        .set_password(token)
        .map_err(|e| format!("could not store the GitHub token: {e}"))
}

pub fn get_token() -> Result<String, String> {
    entry()?.get_password().map_err(|e| match e {
        keyring::Error::NoEntry => "no GitHub token is stored — add one in the Develop area".into(),
        other => format!("could not read the GitHub token: {other}"),
    })
}

pub fn token_stored() -> bool {
    entry().map(|e| e.get_password().is_ok()).unwrap_or(false)
}

pub fn delete_token() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("could not remove the GitHub token: {e}")),
    }
}

/// The POST /user/repos request body (pure — unit tested).
pub fn repo_create_body(name: &str, private: bool, description: &str) -> Value {
    json!({
        "name": name,
        "private": private,
        "description": description,
        "auto_init": true,
    })
}

#[derive(Deserialize)]
struct GithubUser {
    login: String,
}

#[derive(Deserialize)]
struct GithubRepo {
    html_url: String,
}

#[derive(Deserialize)]
struct GithubError {
    message: String,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("CoperativeAI")
        .build()
        .map_err(|e| format!("could not build the HTTP client: {e}"))
}

/// Verifies the token and returns the authenticated login.
pub async fn verify(token: &str) -> Result<String, String> {
    let resp = client()?
        .get(format!("{API}/user"))
        .header("authorization", format!("Bearer {token}"))
        .header("accept", "application/vnd.github+json")
        .header("x-github-api-version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("could not reach GitHub: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(github_message(status, &text));
    }
    let user: GithubUser = serde_json::from_str(&text)
        .map_err(|e| format!("unexpected GitHub response: {e}"))?;
    Ok(user.login)
}

/// Creates a repository under the authenticated user; returns its html_url.
pub async fn create_repo(
    token: &str,
    name: &str,
    private: bool,
    description: &str,
) -> Result<String, String> {
    if name.trim().is_empty() {
        return Err("a repository name is required".into());
    }
    let resp = client()?
        .post(format!("{API}/user/repos"))
        .header("authorization", format!("Bearer {token}"))
        .header("accept", "application/vnd.github+json")
        .header("x-github-api-version", "2022-11-28")
        .json(&repo_create_body(name, private, description))
        .send()
        .await
        .map_err(|e| format!("could not reach GitHub: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(github_message(status, &text));
    }
    let repo: GithubRepo = serde_json::from_str(&text)
        .map_err(|e| format!("unexpected GitHub response: {e}"))?;
    Ok(repo.html_url)
}


/// Opens a pull request for a branch.
///
/// **The last step of a run, and the one that left the app.** An agent's work
/// ends as a branch pushed to GitHub, and turning that into something a person
/// reviews meant going to a browser, finding the repository and pressing the
/// button GitHub offers. This is that button.
pub async fn create_pull_request(
    token: &str,
    repo_url: &str,
    head: &str,
    base: &str,
    title: &str,
    body: &str,
) -> Result<String, String> {
    let slug = owner_and_repo(repo_url)?;
    let resp = client()?
        .post(format!("{API}/repos/{slug}/pulls"))
        .header("authorization", format!("Bearer {token}"))
        .header("accept", "application/vnd.github+json")
        .header("x-github-api-version", "2022-11-28")
        .json(&serde_json::json!({
            "title": title,
            "body": body,
            "head": head,
            "base": base,
        }))
        .send()
        .await
        .map_err(|e| format!("could not reach GitHub: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(github_message(status, &text));
    }
    let made: GithubRepo = serde_json::from_str(&text)
        .map_err(|e| format!("unexpected GitHub response: {e}"))?;
    Ok(made.html_url)
}

/// `owner/repo`, from whatever shape the stored URL is in.
///
/// Both forms are stored in practice — the browser URL GitHub shows and the
/// clone URL it offers — and a trailing `.git` or slash is common in both.
pub fn owner_and_repo(url: &str) -> Result<String, String> {
    let trimmed = url
        .trim()
        .trim_end_matches('/')
        .trim_end_matches(".git")
        .replace("git@github.com:", "https://github.com/");
    let after = trimmed
        .split("github.com")
        .nth(1)
        .ok_or("that repository URL is not a github.com one")?
        .trim_start_matches(['/', ':']);
    let mut parts = after.split('/').filter(|p| !p.is_empty());
    match (parts.next(), parts.next()) {
        (Some(owner), Some(repo)) => Ok(format!("{owner}/{repo}")),
        _ => Err(format!("could not read an owner and repository out of {url}")),
    }
}

fn github_message(status: reqwest::StatusCode, body: &str) -> String {
    let detail = serde_json::from_str::<GithubError>(body)
        .map(|e| e.message)
        .unwrap_or_else(|_| body.to_string());
    format!("GitHub returned an error ({status}): {detail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_repo_body_sets_private_true_and_auto_init() {
        let body = repo_create_body("my-repo", true, "desc");
        assert_eq!(body["name"], "my-repo");
        assert_eq!(body["private"], true);
        assert_eq!(body["description"], "desc");
        assert_eq!(body["auto_init"], true);
    }

    #[test]
    fn public_repo_body_sets_private_false() {
        let body = repo_create_body("open-repo", false, "");
        assert_eq!(body["private"], false);
    }
}

#[cfg(test)]
mod pull_request_tests {
    use super::owner_and_repo;

    /// **Both shapes are stored in practice.** The browser URL GitHub shows and
    /// the clone URL it offers are both what people paste, and a trailing
    /// `.git` or slash comes with them. Getting this wrong means a pull request
    /// posted at a URL that 404s, which reads as "GitHub refused" rather than
    /// as "we asked the wrong address".
    #[test]
    fn an_owner_and_repository_are_read_out_of_every_shape_people_paste() {
        for url in [
            "https://github.com/me/hello-world",
            "https://github.com/me/hello-world/",
            "https://github.com/me/hello-world.git",
            "http://github.com/me/hello-world",
            "git@github.com:me/hello-world.git",
            "  https://github.com/me/hello-world  ",
        ] {
            assert_eq!(owner_and_repo(url).as_deref(), Ok("me/hello-world"), "for {url}");
        }
    }

    /// Somewhere else, or not a repository: said as itself rather than guessed
    /// at, because a guess here posts to a stranger's repository.
    #[test]
    fn anything_that_is_not_a_github_repository_is_refused() {
        assert!(owner_and_repo("https://gitlab.com/me/hello").is_err());
        assert!(owner_and_repo("https://github.com/me").is_err());
        assert!(owner_and_repo("").is_err());
    }
}