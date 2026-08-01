//! Claude through the `claude` CLI on this machine, rather than the HTTPS API.
//!
//! **Why this exists.** A Claude Pro subscription and Anthropic API credits are
//! separate purchases. The subscription pays for claude.ai and for the `claude`
//! CLI signed in with it; the Messages API at api.anthropic.com bills credits on
//! an API key and does not read a subscription. So a person with Pro and no
//! credits cannot use [`crate::ai::client`] at all — but they can use this,
//! because the CLI is what their subscription already covers.
//!
//! **The cost consequence, which is deliberate.** Nothing here reports token
//! counts or a price: the CLI bills against the plan's allowance, and the app
//! cannot see how much of that allowance a call consumed. [`Usage`] therefore
//! comes back zero, exactly as it does for a local model, and providers of this
//! kind are stored `metered: false`. That is not a claim the call was free — it
//! is the app refusing to invent a figure it has no way to know. The same rule
//! already governs the handover path, which shows no spend for work Claude Code
//! did.
//!
//! **Why the prompt asks for JSON instead of a schema parameter.** The API
//! constrains output with `output_config.format`; the CLI has no equivalent we
//! can rely on, so the schema is stated in the prompt and the reply is mined for
//! its JSON object. [`extract_json`] does that mining, and is the part worth
//! testing — a model that wraps its answer in prose or a fence must not read as
//! a failure.

use crate::ai::client::{
    parse_change_plan, parse_design, parse_diagram, parse_generation, parse_pal,
    parse_solution_strategy, Generated, GeneratedChangePlan, GeneratedDesign, GeneratedDiagram,
    GeneratedPal, GeneratedStrategy, Prompt, Usage,
};
use crate::ai::ollama;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

/// An agentic CLI turn can think for minutes, so this is generous — but bounded,
/// because a wedged child process that never exits would hang the job runner
/// holding this call and take the queue with it.
const TIMEOUT: Duration = Duration::from_secs(900);

/// The executable to run. Stored in the provider's `apiBaseUrl` column because a
/// CLI provider has no URL, and a configurable path is what that field is for
/// here — some installs are not on `PATH`.
fn executable(configured: &str) -> &str {
    let trimmed = configured.trim();
    if trimmed.is_empty() {
        "claude"
    } else {
        trimmed
    }
}

/// What `claude --version` says, or why it could not be asked.
///
/// This is the Test button's check, and it deliberately stops short of a real
/// turn: a turn would prove the sign-in too, but it would also spend a slice of
/// the plan's allowance every time somebody pressed Test. Being installed is
/// what can be established for free, so that is what is claimed — the caller
/// says plainly that the sign-in is not covered.
pub async fn version(configured_exe: &str) -> Result<String, String> {
    let exe = executable(configured_exe);
    let output = tokio::time::timeout(
        Duration::from_secs(30),
        tokio::process::Command::new(exe).arg("--version").output(),
    )
    .await
    .map_err(|_| format!("'{exe} --version' did not answer within 30 seconds"))?
    .map_err(|e| {
        format!(
            "could not run '{exe}' ({e}). Install Claude Code with \
             `npm i -g @anthropic-ai/claude-code`, then run `claude` once to sign in."
        )
    })?;

    let printed = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = if stderr.trim().is_empty() { &printed } else { stderr.trim() };
        // The shipped case worth naming: the npm wrapper installs but its native
        // binary does not, so `claude` exists on PATH and still cannot run.
        return Err(format!(
            "'{exe}' is on the path but would not run: {}",
            detail.chars().take(300).collect::<String>()
        ));
    }
    Ok(if printed.is_empty() {
        "installed".to_string()
    } else {
        printed
    })
}

/// Installs Claude Code globally with npm, and returns what npm said.
///
/// Run on a press, never on its own. This is a global install on somebody's
/// machine — the one step of the setup that changes anything outside this app —
/// so it happens because a button was pressed and its output is handed back
/// whole rather than reduced to "done".
///
/// **Repairs the shipped half-install too.** The npm wrapper can land without
/// its platform-native binary (`--ignore-scripts`, `--omit=optional`, some pnpm
/// configs), which leaves `claude` on PATH and unable to run — the exact state
/// this machine was in. Installing over the top runs the postinstall that was
/// skipped, so one path covers "missing" and "broken".
pub async fn install() -> Result<String, String> {
    // Ten minutes: a cold global install pulling a platform binary is slow on a
    // thin connection, and a timeout that fires mid-install leaves a worse mess
    // than waiting does.
    let output = tokio::time::timeout(
        Duration::from_secs(600),
        npm_command().args(["install", "-g", "@anthropic-ai/claude-code"]).output(),
    )
    .await
    .map_err(|_| "npm did not finish within ten minutes and was given up on".to_string())?
    .map_err(|e| {
        format!(
            "could not run npm ({e}). Node and npm have to be installed for this — \
             the app cannot install them for you."
        )
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = if stderr.trim().is_empty() { &stdout } else { stderr.trim() };
        // npm's own words, trimmed to something readable: they name the real
        // problem (permissions, a proxy, a registry that is unreachable) far
        // better than anything this app could infer from an exit code.
        return Err(format!(
            "npm could not install Claude Code: {}",
            tail(detail, 600)
        ));
    }
    Ok(if stdout.is_empty() { "installed".into() } else { tail(&stdout, 600) })
}

/// npm is a shell script on Windows, so it is invoked through the shell rather
/// than spawned directly — `Command::new("npm")` fails there with "program not
/// found" even when npm is plainly on PATH.
fn npm_command() -> tokio::process::Command {
    if cfg!(windows) {
        let mut c = tokio::process::Command::new("cmd");
        c.arg("/C").arg("npm");
        c
    } else {
        tokio::process::Command::new("npm")
    }
}

/// The **end** of a long output, not the beginning: npm's summary and its errors
/// are the last thing it prints, and a head would show the banner instead.
fn tail(text: &str, limit: usize) -> String {
    let trimmed = text.trim();
    let count = trimmed.chars().count();
    if count <= limit {
        return trimmed.to_string();
    }
    let kept: String = trimmed.chars().skip(count - limit).collect();
    format!("…{kept}")
}

/// Pulls the JSON object out of whatever the CLI printed.
///
/// The API can be told to emit nothing but JSON; the CLI cannot, so its reply may
/// carry a sentence of preamble or a ```json fence. Scanning for the outermost
/// balanced object is what makes those replies usable instead of errors. Braces
/// inside strings are skipped, so a JSON value containing `}` does not truncate
/// the match.
pub(crate) fn extract_json(output: &str) -> Result<&str, String> {
    let bytes = output.as_bytes();
    let start = output
        .find('{')
        .ok_or_else(|| short_failure("no JSON object", output))?;

    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (offset, &byte) in bytes.iter().enumerate().skip(start) {
        if in_string {
            match byte {
                _ if escaped => escaped = false,
                b'\\' => escaped = true,
                b'"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match byte {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Ok(&output[start..=offset]);
                }
            }
            _ => {}
        }
    }
    Err(short_failure("an unterminated JSON object", output))
}

/// Failures quote a bounded slice of the output: the whole thing could be pages
/// of an agent's reasoning, and an error message that long is unreadable.
fn short_failure(what: &str, output: &str) -> String {
    let trimmed = output.trim();
    let head: String = trimmed.chars().take(300).collect();
    format!(
        "Claude Code printed {what}. Its reply began: {head}{}",
        if trimmed.chars().count() > 300 { "…" } else { "" }
    )
}

/// The prompt sent to the CLI: the same two halves the other providers get, plus
/// the schema as an instruction, since there is no parameter to pass it as.
pub(crate) fn cli_prompt(prompt: &Prompt, schema: &serde_json::Value) -> String {
    format!(
        "{}\n\n{}\n\nReply with one JSON object and nothing else — no prose before \
         or after it, no code fence. It must conform to this JSON Schema:\n{}",
        prompt.context,
        prompt.task,
        serde_json::to_string_pretty(schema).unwrap_or_else(|_| schema.to_string()),
    )
}

/// One `claude --print` turn, returning what it printed.
///
/// The prompt goes in on stdin rather than as an argument: it routinely runs to
/// thousands of characters, which on Windows would meet the command-line length
/// limit, and passing it as an argument would also mean quoting text that
/// contains whatever the user wrote.
async fn print_turn(
    configured_exe: &str,
    model: &str,
    prompt: &Prompt,
    schema: serde_json::Value,
) -> Result<String, String> {
    let exe = executable(configured_exe);
    let mut command = tokio::process::Command::new(exe);
    command
        .arg("--print")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if !model.trim().is_empty() {
        command.arg("--model").arg(model.trim());
    }

    let mut child = command.spawn().map_err(|e| {
        format!(
            "could not run '{exe}' ({e}). Claude Code has to be installed and signed in \
             for this provider — `npm i -g @anthropic-ai/claude-code`, then `claude` once \
             to sign in with your subscription."
        )
    })?;

    // Written and dropped before waiting: the child reads until stdin closes, so
    // holding the pipe open would deadlock — it waiting for input, us for output.
    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "could not write to Claude Code's input".to_string())?;
        stdin
            .write_all(cli_prompt(prompt, &schema).as_bytes())
            .await
            .map_err(|e| format!("could not send the prompt to Claude Code: {e}"))?;
        stdin
            .shutdown()
            .await
            .map_err(|e| format!("could not finish sending the prompt to Claude Code: {e}"))?;
    }

    let finished = tokio::time::timeout(TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| {
            format!(
                "Claude Code did not finish within {} minutes and was given up on",
                TIMEOUT.as_secs() / 60
            )
        })?
        .map_err(|e| format!("could not read Claude Code's output: {e}"))?;

    let stdout = String::from_utf8_lossy(&finished.stdout).into_owned();
    if !finished.status.success() {
        let stderr = String::from_utf8_lossy(&finished.stderr);
        let detail = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        return Err(format!(
            "Claude Code exited with an error: {}",
            detail.chars().take(400).collect::<String>()
        ));
    }
    Ok(stdout)
}

/// Zero, always — see the module note. The subscription was charged, and by how
/// much is not something this process can find out.
fn unmetered() -> Usage {
    Usage {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
    }
}

/// Runs one turn and hands the JSON it printed to `parse`.
async fn turn<T>(
    exe: &str,
    model: &str,
    prompt: &Prompt,
    schema: serde_json::Value,
    parse: fn(&str) -> Result<T, String>,
) -> Result<(T, Usage), String> {
    let output = print_turn(exe, model, prompt, schema).await?;
    let json = extract_json(&output)?;
    Ok((parse(json)?, unmetered()))
}

pub async fn generate_stories(
    exe: &str,
    model: &str,
    prompt: &Prompt,
) -> Result<(Generated, Usage), String> {
    turn(exe, model, prompt, ollama::story_schema(), parse_generation).await
}

pub async fn generate_solution_strategy(
    exe: &str,
    model: &str,
    prompt: &Prompt,
) -> Result<(GeneratedStrategy, Usage), String> {
    turn(
        exe,
        model,
        prompt,
        ollama::strategy_schema(),
        parse_solution_strategy,
    )
    .await
}

pub async fn generate_design(
    exe: &str,
    model: &str,
    prompt: &Prompt,
) -> Result<(GeneratedDesign, Usage), String> {
    turn(exe, model, prompt, ollama::design_schema(), parse_design).await
}

pub async fn generate_diagram(
    exe: &str,
    model: &str,
    prompt: &Prompt,
    format: &str,
) -> Result<(GeneratedDiagram, Usage), String> {
    // Not routed through `turn`: `parse_diagram` also needs the format, to know
    // which shape it is reading back.
    let with_format = Prompt {
        context: prompt.context.clone(),
        task: format!("{}\n\nProduce the diagram as {format}.", prompt.task),
    };
    let output = print_turn(exe, model, &with_format, ollama::diagram_schema()).await?;
    let json = extract_json(&output)?;
    Ok((parse_diagram(json, format)?, unmetered()))
}

pub async fn generate_pal(
    exe: &str,
    model: &str,
    prompt: &Prompt,
) -> Result<(GeneratedPal, Usage), String> {
    turn(exe, model, prompt, ollama::pal_schema(), parse_pal).await
}

/// Change plans, minus the mockups.
///
/// The CLI reads files from disk, not base64 in a prompt, so images cannot be
/// attached the way both HTTP providers attach them. Rather than drop them
/// silently — which would produce a plan that quietly ignored the design — the
/// caller is told, and can pick a provider that can see.
pub async fn generate_change_plan(
    exe: &str,
    model: &str,
    prompt: &Prompt,
    images: &[crate::ai::vision::LoadedImage],
) -> Result<(GeneratedChangePlan, Usage), String> {
    if !images.is_empty() {
        return Err(format!(
            "this work item has {} mockup{} attached, and Claude Code cannot be shown \
             images this way — plan it with a metered Claude provider, or remove the \
             mockups first",
            images.len(),
            if images.len() == 1 { "" } else { "s" }
        ));
    }
    turn(
        exe,
        model,
        prompt,
        ollama::change_plan_schema(),
        parse_change_plan,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prompt() -> Prompt {
        Prompt {
            context: "the context".into(),
            task: "the task".into(),
        }
    }

    /// The plain case: the CLI did as it was asked.
    #[test]
    fn a_bare_object_is_taken_whole() {
        assert_eq!(extract_json(r#"{"stories":[]}"#), Ok(r#"{"stories":[]}"#));
    }

    /// The reason this function exists. The API can be *made* to emit only JSON;
    /// the CLI cannot, so a fence or a sentence of preamble is the normal case,
    /// not a malformed reply.
    #[test]
    fn prose_and_a_code_fence_around_the_object_are_ignored() {
        let reply = "Here is the plan you asked for:\n\n```json\n{\"a\": 1}\n```\n\nHope that helps!";
        assert_eq!(extract_json(reply), Ok("{\"a\": 1}"));
    }

    /// Nesting must not stop at the first closing brace, or every plan with a
    /// nested object would be truncated into invalid JSON.
    #[test]
    fn a_nested_object_is_kept_to_its_own_end() {
        let reply = r#"note {"outer": {"inner": {"deep": true}}, "after": 2} end"#;
        assert_eq!(
            extract_json(reply),
            Ok(r#"{"outer": {"inner": {"deep": true}}, "after": 2}"#)
        );
    }

    /// A brace inside a string is not structure. Change plans carry code
    /// snippets, so this is the case that would bite in practice.
    #[test]
    fn braces_inside_strings_do_not_end_the_object() {
        let reply = r#"{"code": "fn main() { let x = 1; }", "ok": true}"#;
        assert_eq!(extract_json(reply), Ok(reply));
    }

    /// An escaped quote must not be read as the end of the string, which would
    /// put the scanner back into structure mode inside a string.
    #[test]
    fn an_escaped_quote_does_not_end_the_string() {
        let reply = r#"{"quoted": "he said \"}\" loudly", "ok": true}"#;
        assert_eq!(extract_json(reply), Ok(reply));
    }

    /// Truncated output is a failure, and the message shows the beginning of the
    /// reply so the cause is visible without re-running anything.
    #[test]
    fn a_truncated_object_fails_and_quotes_what_arrived() {
        let err = extract_json(r#"{"stories": [{"title": "half"#).expect_err("must fail");
        assert!(err.contains("unterminated"), "got: {err}");
        assert!(err.contains("half"), "should quote the reply: {err}");
    }

    /// A refusal or a usage message contains no object at all.
    #[test]
    fn output_with_no_object_fails_by_name() {
        let err = extract_json("I can't help with that.").expect_err("must fail");
        assert!(err.contains("no JSON object"), "got: {err}");
    }

    /// An enormous reply must not become an enormous error message.
    #[test]
    fn a_long_reply_is_quoted_only_briefly() {
        let err = extract_json(&"x".repeat(10_000)).expect_err("must fail");
        assert!(err.len() < 500, "the message should stay readable: {} chars", err.len());
        assert!(err.ends_with('…'), "and should say it was cut: {err}");
    }

    /// The schema has to reach the model somehow, and for this provider the
    /// prompt is the only channel — so it must actually be in there, along with
    /// both halves of the prompt.
    #[test]
    fn the_prompt_carries_the_schema_and_both_halves() {
        let text = cli_prompt(&prompt(), &ollama::story_schema());
        assert!(text.contains("the context"));
        assert!(text.contains("the task"));
        assert!(text.contains("\"stories\""), "the schema must be included: {text}");
    }

    /// An empty path means the one on `PATH`; a configured path wins.
    #[test]
    fn the_executable_falls_back_to_the_one_on_path() {
        assert_eq!(executable(""), "claude");
        assert_eq!(executable("   "), "claude");
        assert_eq!(executable(" C:/tools/claude.cmd "), "C:/tools/claude.cmd");
    }

    /// Usage is zero because the app cannot see what the subscription was
    /// charged. Asserting it keeps a later "helpful" estimate from being added:
    /// a made-up figure here would show up as real money in the ledger.
    #[test]
    fn nothing_is_reported_as_spent_because_nothing_can_be_known() {
        let usage = unmetered();
        assert_eq!(usage.input_tokens, 0);
        assert_eq!(usage.output_tokens, 0);
        assert_eq!(usage.cache_creation_input_tokens, 0);
        assert_eq!(usage.cache_read_input_tokens, 0);
    }

    /// Mockups cannot ride along, and the caller is told rather than getting a
    /// plan that silently ignored the design it was supposed to implement.
    #[tokio::test]
    async fn mockups_are_refused_rather_than_dropped() {
        let images = vec![crate::ai::vision::LoadedImage {
            name: "mock.png".into(),
            media_type: "image/png".into(),
            base64: "AAAA".into(),
        }];
        let err = generate_change_plan("claude", "m", &prompt(), &images)
            .await
            .expect_err("must refuse");
        assert!(err.contains("cannot be shown"), "got: {err}");
        assert!(err.contains("1 mockup"), "should count them: {err}");
    }

    /// A missing CLI is the most likely first failure, so the message has to say
    /// how to fix it instead of surfacing a bare OS error.
    #[tokio::test]
    async fn a_missing_executable_explains_how_to_install_it() {
        let err = generate_stories("claude-code-that-is-not-installed", "m", &prompt())
            .await
            .expect_err("must fail");
        assert!(err.contains("claude-code-that-is-not-installed"), "got: {err}");
        assert!(err.contains("npm i -g"), "should say how to install: {err}");
        assert!(err.contains("sign in"), "and that signing in is needed: {err}");
    }
}
