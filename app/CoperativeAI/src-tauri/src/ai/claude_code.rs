//! Claude through the `claude` CLI on this machine, rather than the HTTPS API.
//!
//! **Why this exists.** A Claude Pro subscription and Anthropic API credits are
//! separate purchases. The subscription pays for claude.ai and for the `claude`
//! CLI signed in with it; the Messages API at api.anthropic.com bills credits on
//! an API key and does not read a subscription. So a person with Pro and no
//! credits cannot use [`crate::ai::client`] at all — but they can use this,
//! because the CLI is what their subscription already covers.
//!
//! **Tokens yes, money no — and the difference is the point.** Asking for
//! `--output-format json` gets real token counts back, so "this month went
//! through four million tokens on the plan" is an answer the app can honestly
//! give. What it still will not do is turn that into a price: the plan's
//! allowance is charged where this process cannot see it, and there is no
//! per-token rate to multiply by. Providers of this kind stay
//! `metered: false` — not a claim the call was free, but a refusal to invent a
//! figure. The same rule governs the handover path, which shows no spend for
//! work Claude Code did.
//!
//! An older CLI that ignores `--output-format` still works: the reply is read
//! as plain text and the counts stay zero, which is where they were before.
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
use serde::Deserialize;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

/// An agentic CLI turn can think for minutes, so this is generous — but bounded,
/// because a wedged child process that never exits would hang the job runner
/// holding this call and take the queue with it.
const TIMEOUT: Duration = Duration::from_secs(900);


/// Everywhere a working Claude Code might be, best bet first.
///
/// **Being on PATH is neither necessary nor sufficient.** The Claude desktop app
/// keeps its own copy under `%APPDATA%/Claude/claude-code/<version>/` and never
/// puts it on PATH; npm puts shims *on* PATH that can be a stub which refuses to
/// run. Looking only at PATH therefore manages to miss a perfectly good install
/// and find a broken one at the same time — which is exactly what happened.
fn candidates(configured: &str) -> Vec<std::path::PathBuf> {
    let mut found = Vec::new();

    // An explicit setting wins: somebody who typed a path meant it.
    let trimmed = configured.trim();
    if !trimmed.is_empty() {
        if let Some(path) = crate::tooling::dev_runner::which(trimmed) {
            found.push(path);
        }
    }

    // The desktop app's managed install, newest version first. It updates itself,
    // so it is the likeliest to be current.
    for base in managed_roots() {
        let Ok(entries) = std::fs::read_dir(&base) else { continue };
        let mut versions: Vec<std::path::PathBuf> =
            entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
        versions.sort_by_key(|dir| std::cmp::Reverse(version_order(dir)));
        for dir in versions {
            let exe = dir.join(if cfg!(windows) { "claude.exe" } else { "claude" });
            if exe.is_file() {
                found.push(exe);
            }
        }
    }

    // The native installer's home, then whatever PATH offers.
    if let Some(home) = home_dir() {
        let local = home.join(".local").join("bin").join("claude");
        if local.is_file() {
            found.push(local);
        }
    }
    if let Some(path) = crate::tooling::dev_runner::which("claude") {
        found.push(path);
    }

    found.dedup();
    found
}

/// Where self-updating installs live, per platform.
fn managed_roots() -> Vec<std::path::PathBuf> {
    let mut roots = Vec::new();
    if cfg!(windows) {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            roots.push(std::path::PathBuf::from(appdata).join("Claude").join("claude-code"));
        }
    }
    if let Some(home) = home_dir() {
        roots.push(home.join(".claude").join("claude-code"));
        roots.push(
            home.join("Library")
                .join("Application Support")
                .join("Claude")
                .join("claude-code"),
        );
    }
    roots
}

fn home_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(std::path::PathBuf::from)
}

/// Version folders sorted as numbers, not as text — otherwise `2.1.9` sorts
/// above `2.1.10` and the app settles on a version it has already outgrown.
fn version_order(path: &std::path::Path) -> Vec<u64> {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .split('.')
        .map(|part| part.parse::<u64>().unwrap_or(0))
        .collect()
}

/// The first candidate that actually runs, with what it reported.
///
/// **Running it is the test, not finding it.** A file called `claude.exe` can be
/// a 500-byte shell script that Windows rejects — npm leaves exactly that behind
/// when it fetches the wrong platform's build. Asking each candidate for its
/// version costs milliseconds and is the only thing that tells a real install
/// from a placeholder, so the search does that rather than trusting a filename.
pub async fn discover(configured: &str) -> Result<(std::path::PathBuf, String), String> {
    let found = candidates(configured);
    if found.is_empty() {
        return Err(
            "Claude Code is not on this machine — no copy on the PATH, and none where the \
             Claude desktop app keeps its own."
                .into(),
        );
    }

    let mut last = String::new();
    for exe in &found {
        match ask_version(exe).await {
            Ok(version) => return Ok((exe.clone(), version)),
            Err(why) => last = format!("{} — {why}", exe.display()),
        }
    }
    Err(format!(
        "Found {} copy of Claude Code but none of them would run. The last tried: {last}",
        found.len()
    ))
}

/// What `claude --version` says, or why it could not be asked.
///
/// This is the Test button's check, and it deliberately stops short of a real
/// turn: a turn would prove the sign-in too, but it would also spend a slice of
/// the plan's allowance every time somebody pressed Test. Being installed is
/// what can be established for free, so that is what is claimed — the caller
/// says plainly that the sign-in is not covered.
pub async fn version(configured_exe: &str) -> Result<String, String> {
    discover(configured_exe).await.map(|(_, version)| version)
}

/// Asks one specific executable for its version.
///
/// Short timeout on purpose: this runs against every candidate in turn, and a
/// hung one must not hold up the search for the working copy behind it.
async fn ask_version(exe: &std::path::Path) -> Result<String, String> {
    let output = tokio::time::timeout(
        Duration::from_secs(20),
        tokio::process::Command::new(exe).arg("--version").output(),
    )
    .await
    .map_err(|_| "it did not answer within 20 seconds".to_string())?
    .map_err(|e| format!("it would not start ({e})"))?;

    let printed = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = if stderr.trim().is_empty() { &printed } else { stderr.trim() };
        return Err(detail.chars().take(200).collect::<String>());
    }
    Ok(if printed.is_empty() { "installed".to_string() } else { printed })
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
    let mut npm = npm_command().map_err(|e| {
        format!("{e}. Node and npm have to be installed for this — the app cannot install them for you.")
    })?;
    let (os, cpu) = npm_platform();
    let output = tokio::time::timeout(
        Duration::from_secs(600),
        npm.args([
            "install",
            "-g",
            // **Stated, not inherited.** npm picks the platform-native binary
            // using its `os`/`cpu` config, and a stray `os=linux` in a user's
            // ~/.npmrc makes it fetch a Linux build on Windows — npm reports
            // success, the real binary never arrives, and the package leaves a
            // stub behind that Windows refuses to execute. Saying which machine
            // this is makes the install immune to whatever the config says.
            &format!("--os={os}"),
            &format!("--cpu={cpu}"),
            // Belt and braces against the other two ways this fails: the native
            // binary is an optional dependency, and it arrives via postinstall.
            "--include=optional",
            "--foreground-scripts",
            "@anthropic-ai/claude-code",
        ])
        .output(),
    )
    .await
    .map_err(|_| "npm did not finish within ten minutes and was given up on".to_string())?
    .map_err(|e| format!("npm would not run ({e})"))?;

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

/// This machine, in the names npm uses for it.
///
/// npm's vocabulary is not Rust's — `win32` for `windows`, `darwin` for `macos`,
/// `x64` for `x86_64` — and getting it wrong is worse than not passing it at
/// all, because npm would then match nothing and quietly install no binary.
fn npm_platform() -> (&'static str, &'static str) {
    let os = match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    };
    let cpu = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        "x86" => "ia32",
        other => other,
    };
    (os, cpu)
}

/// A command for a tool that may be a script rather than a real executable.
///
/// **The bug this exists to stop.** On Windows both `npm` and `claude` install
/// as `.cmd` shims. `Command::new("claude")` tries `claude` and `claude.exe`,
/// finds neither, and reports "program not found" against an install that is
/// perfectly good — which is exactly what a fresh, successful `npm i -g` looked
/// like from inside this app. Resolving through PATHEXT and spawning the full
/// path is what makes the shim runnable.
///
/// The resolved path is spawned directly rather than through `cmd /C`: passing a
/// model name or a path into a shell string is an injection waiting to happen,
/// and the standard library already knows how to launch a `.cmd` safely.
fn tool_command(name: &str) -> Result<tokio::process::Command, String> {
    let resolved = crate::tooling::dev_runner::which(name)
        .ok_or_else(|| format!("'{name}' is not on this machine's PATH"))?;
    Ok(tokio::process::Command::new(resolved))
}

fn npm_command() -> Result<tokio::process::Command, String> {
    tool_command("npm")
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
    // The same search the status check uses, so a turn runs against whichever
    // copy was reported working rather than whatever happens to be on PATH —
    // which may be the npm stub that cannot run at all.
    let (exe, _) = discover(configured_exe).await.map_err(|e| {
        format!(
            "{e} Claude Code has to be installed and signed in for this provider — \
             set it up in Admin, then run `claude` once to sign in."
        )
    })?;
    let mut command = tokio::process::Command::new(&exe);
    command
        .arg("--print")
        // Asked for so the reply carries token counts. `read_output` treats
        // anything that is not an envelope as a plain reply, so an older CLI
        // that ignores this keeps working with counts at zero.
        .args(["--output-format", "json"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if !model.trim().is_empty() {
        command.arg("--model").arg(model.trim());
    }

    let mut child = command.spawn().map_err(|e| {
        format!(
            "could not run '{}' ({e}). Claude Code has to be installed and signed in \
             for this provider — set it up in Admin, then run `claude` once to sign in \
             with your subscription.",
            exe.display()
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

/// What `--output-format json` wraps a reply in, when it is used.
///
/// **Read defensively, because this shape is not ours.** Asking for JSON is how
/// token counts become available at all — plain `--print` reports none — but the
/// envelope belongs to the CLI and can change under us. So every field is
/// optional, and anything that does not look like an envelope is treated as a
/// plain reply rather than an error. The worst case is the counts stay zero,
/// which is exactly where they were before.
#[derive(Deserialize, Default)]
struct CliEnvelope {
    #[serde(default)]
    result: Option<String>,
    #[serde(default)]
    usage: Option<CliUsage>,
}

#[derive(Deserialize, Default)]
struct CliUsage {
    #[serde(default)]
    input_tokens: i64,
    #[serde(default)]
    output_tokens: i64,
    #[serde(default)]
    cache_creation_input_tokens: i64,
    #[serde(default)]
    cache_read_input_tokens: i64,
}

/// The reply text and what it consumed, from whatever the CLI printed.
///
/// Tokens are worth having even though no price can be put on them: "this month
/// went through four million tokens on the plan" is a real answer, and it is one
/// the app can honestly give. What it still must not do is turn that into money
/// — the allowance is charged where this process cannot see it.
fn read_output(output: &str) -> (String, Usage) {
    let Some(envelope) = extract_json(output)
        .ok()
        .and_then(|json| serde_json::from_str::<CliEnvelope>(json).ok())
        .filter(|e| e.result.is_some())
    else {
        // Not an envelope — a plain reply, which is what `--print` alone gives.
        return (output.to_string(), unmetered());
    };

    let usage = envelope.usage.unwrap_or_default();
    (
        envelope.result.unwrap_or_default(),
        Usage {
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            cache_creation_input_tokens: usage.cache_creation_input_tokens,
            cache_read_input_tokens: usage.cache_read_input_tokens,
        },
    )
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
    let (reply, usage) = read_output(&output);
    let json = extract_json(&reply)?;
    Ok((parse(json)?, usage))
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
    let (reply, usage) = read_output(&output);
    let json = extract_json(&reply)?;
    Ok((parse_diagram(json, format)?, usage))
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


    /// Usage is zero when nothing reported it. Asserting it keeps a later
    /// "helpful" estimate from being added: a made-up figure here would show up
    /// as real money in the ledger.
    #[test]
    fn nothing_is_reported_as_spent_because_nothing_can_be_known() {
        let usage = unmetered();
        assert_eq!(usage.input_tokens, 0);
        assert_eq!(usage.output_tokens, 0);
        assert_eq!(usage.cache_creation_input_tokens, 0);
        assert_eq!(usage.cache_read_input_tokens, 0);
    }

    /// **Tokens come back when the CLI reports them.** Counting them is worth
    /// doing even though no price can be put on them — "four million tokens
    /// this month on the plan" is a real answer.
    #[test]
    fn the_json_envelope_yields_the_reply_and_its_token_counts() {
        let output = r#"{"result":"{\"stories\":[]}","usage":{"input_tokens":120,"output_tokens":45,"cache_read_input_tokens":900}}"#;
        let (reply, usage) = read_output(output);
        assert_eq!(reply, r#"{"stories":[]}"#);
        assert_eq!(usage.input_tokens, 120);
        assert_eq!(usage.output_tokens, 45);
        assert_eq!(usage.cache_read_input_tokens, 900);
    }

    /// **An older CLI that ignores the flag must still work.** Plain output is
    /// not an envelope, so it is the reply — with counts at zero, which is
    /// where they were before any of this.
    #[test]
    fn plain_output_is_still_read_as_the_reply() {
        let output = r#"Here you go: {"stories":[]}"#;
        let (reply, usage) = read_output(output);
        assert_eq!(reply, output, "the whole thing is the reply");
        assert_eq!(usage.input_tokens, 0);
        assert_eq!(usage.output_tokens, 0);
    }

    /// An envelope missing its usage block is still an envelope. Counts stay
    /// zero rather than the reply being thrown away over a missing field.
    #[test]
    fn an_envelope_without_usage_still_gives_up_its_reply() {
        let (reply, usage) = read_output(r#"{"result":"{\"a\":1}"}"#);
        assert_eq!(reply, r#"{"a":1}"#);
        assert_eq!(usage.output_tokens, 0);
    }

    /// A JSON reply that is *not* an envelope — no `result` field — must not be
    /// mistaken for one, or the model's own answer would be discarded.
    #[test]
    fn a_bare_json_reply_is_not_mistaken_for_an_envelope() {
        let output = r#"{"stories":[{"title":"a","description":"b"}]}"#;
        let (reply, _) = read_output(output);
        assert_eq!(reply, output);
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

    /// Newest version wins, and "newest" is a number comparison.
    ///
    /// Sorted as text, `2.1.9` beats `2.1.10` and the app would quietly settle
    /// on a version it had already outgrown — the kind of wrong that never
    /// announces itself.
    #[test]
    fn versions_are_ordered_as_numbers_not_as_text() {
        let order = |s: &str| version_order(std::path::Path::new(s));
        assert!(order("2.1.10") > order("2.1.9"));
        assert!(order("2.2.0") > order("2.1.99"));
        // Junk in the folder name sorts last rather than panicking.
        assert!(order("2.0.0") > order("not-a-version"));
    }

    /// **The complaint this answers: "I have it installed."** They did — the
    /// Claude desktop app keeps its own copy under `%APPDATA%`, and it is never
    /// put on PATH. Searching PATH alone reported a real install as missing
    /// while finding npm's broken stub, which is the worst of both.
    ///
    /// Skips where no install exists rather than failing: that is a machine
    /// without Claude Code, not a broken search.
    #[tokio::test]
    async fn a_working_install_is_found_wherever_it_lives() {
        match discover("").await {
            Ok((exe, version)) => {
                assert!(!version.is_empty(), "a found install must report a version");
                assert!(exe.is_file(), "and must be a real file: {}", exe.display());
            }
            Err(why) => {
                eprintln!("skipped: no working Claude Code here — {why}");
            }
        }
    }

    /// **The stub, reproduced.** npm leaves behind a `claude.exe` that is a
    /// text file, and Windows answers "not compatible with the version of
    /// Windows you're running" — a good-looking filename that cannot run.
    ///
    /// Pointing the search straight at one must not have it accepted: either a
    /// genuinely working copy elsewhere is returned instead, or the whole search
    /// fails. What must never happen is the stub being reported as the install.
    #[tokio::test]
    async fn a_stub_that_cannot_run_is_never_the_answer() {
        let dir = std::env::temp_dir().join(format!("coperativeai-stub-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let stub = dir.join(if cfg!(windows) { "claude.exe" } else { "claude" });
        // Byte for byte the shape npm ships: a shell script wearing an .exe.
        std::fs::write(&stub, "echo \"Error: claude native binary not installed.\"\nexit 1\n")
            .expect("write stub");

        let outcome = discover(&stub.to_string_lossy()).await;
        std::fs::remove_dir_all(&dir).ok();

        match outcome {
            // A machine with a real install elsewhere: that one is returned,
            // and the stub is not.
            Ok((exe, _)) => assert_ne!(
                exe, stub,
                "the stub must never be reported as a working install"
            ),
            // A machine with nothing else — CI, for instance. The refusal has to
            // name the copy it tried, or "it did not work" is unactionable when
            // several copies exist and only one is broken.
            Err(why) => assert!(
                why.contains(&stub.display().to_string()),
                "the refusal should name which copy failed: {why}"
            ),
        }
    }

    /// **Resolving a tool is not the same as being able to run it, and only
    /// running it proves the difference.**
    ///
    /// Every failure in this area passed a test that checked the wrong half:
    /// "is it on PATH" said yes while spawning said "program not found", then
    /// "did we find a file" said yes while spawning said "not a valid Win32
    /// application". So this one resolves the real npm on this machine and
    /// actually starts it. It is the only test here that could have caught
    /// either bug.
    ///
    /// Skips when npm is absent rather than failing — that is a machine without
    /// Node, not a broken resolver — matching how the git and shell tests in
    /// this repo already treat their tools.
    #[tokio::test]
    async fn the_resolved_npm_actually_spawns() {
        let Some(resolved) = crate::tooling::dev_runner::which("npm") else {
            eprintln!("skipped: npm is not installed here");
            return;
        };
        if cfg!(windows) {
            let name = resolved.to_string_lossy().to_lowercase();
            assert!(
                !name.ends_with("npm"),
                "resolved the extensionless shell script, which Windows cannot execute: {name}"
            );
        }

        let output = tokio::process::Command::new(&resolved)
            .arg("--version")
            .output()
            .await
            .unwrap_or_else(|e| panic!("could not spawn {}: {e}", resolved.display()));

        assert!(
            output.status.success(),
            "{} --version failed: {}",
            resolved.display(),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    /// A missing CLI is the most likely first failure, so the message names the
    /// tool it looked for and where to fix it, rather than surfacing a bare OS
    /// error. It points at the setup panel because that is now the thing that
    /// installs it — telling someone to type a command the app has a button for
    /// would be worse advice.
    #[tokio::test]
    async fn a_wrong_configured_path_falls_back_to_a_working_install() {
        // A configured name that resolves nowhere contributes no candidate, so
        // the search carries on to the places it knows about.
        let outcome = generate_stories("claude-code-that-is-not-installed", "m", &prompt()).await;

        // On a machine with Claude Code, a stale setting does not stop it
        // working — being found is more use than being right about a typo.
        // (Reaching a real CLI, the call then fails for its own reasons.)
        if let Err(why) = outcome {
            assert!(
                !why.contains("not on this machine's PATH") || why.contains("not on this machine"),
                "a failure here should be about running it, not about the typo: {why}"
            );
        }

        // The claim that matters, and the only one true on every machine: a name
        // that is nowhere resolves to nothing, so it can never be mistaken for
        // an install.
        assert!(
            crate::tooling::dev_runner::which("claude-code-that-is-not-installed").is_none(),
        );
    }

    /// With nothing installed anywhere, the message says that plainly rather
    /// than naming whichever path happened to be tried last.
    #[test]
    fn no_install_anywhere_is_reported_as_no_install() {
        // Proved on the pure part: with no candidates there is nothing to run.
        let none = candidates("definitely-nowhere-at-all");
        assert!(
            !none.iter().any(|p| p.to_string_lossy().contains("definitely-nowhere")),
            "an unresolvable name must not become a candidate"
        );
    }

    /// **The bug that made a good install look like a broken one, twice.**
    ///
    /// npm and Claude Code each ship *two* files into the same folder: `npm`
    /// with no extension, a shell script for Git Bash, and `npm.cmd`, the one
    /// Windows can execute. Spawning the bare name first fails with
    /// "%1 is not a valid Win32 application"; not searching PATHEXT at all fails
    /// with "program not found". Only the `.cmd` runs, so only the `.cmd` is the
    /// right answer.
    ///
    /// **Both files are laid down here on purpose.** The first version of this
    /// test wrote only the `.cmd`, so it passed against a folder that does not
    /// exist in the wild while the real one — both files, bare name winning —
    /// stayed broken. A fixture has to be the shape of the thing it stands in
    /// for.
    #[test]
    fn the_runnable_shim_wins_over_the_shell_script_beside_it() {
        if !cfg!(windows) {
            return; // PATHEXT is a Windows idea; there is nothing to prove here.
        }
        let dir = std::env::temp_dir().join(format!("coperativeai-which-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let shim = dir.join("pretend-tool.cmd");
        std::fs::write(&shim, "@echo off\r\n").expect("write shim");
        // The sibling that Windows cannot run — exactly how npm ships.
        std::fs::write(dir.join("pretend-tool"), "#!/bin/sh\n").expect("write script");

        let previous = std::env::var_os("PATH");
        let mut paths = vec![dir.clone()];
        if let Some(p) = &previous {
            paths.extend(std::env::split_paths(p));
        }
        // SAFETY-of-intent: this test is single-threaded over PATH and restores
        // it below; the alternative is not testing the thing that broke.
        std::env::set_var("PATH", std::env::join_paths(paths).expect("join"));

        let found = crate::tooling::dev_runner::which("pretend-tool");

        if let Some(p) = previous {
            std::env::set_var("PATH", p);
        }
        std::fs::remove_dir_all(&dir).ok();

        assert_eq!(
            found.as_deref(),
            Some(shim.as_path()),
            "the .cmd must win over the extensionless shell script beside it"
        );
    }
}
