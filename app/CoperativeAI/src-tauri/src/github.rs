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
