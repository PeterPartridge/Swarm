//! Starting points for a Product's Developer Rules, from named sources.
//!
//! **Why templates at all.** An empty rules form is the hardest kind to fill
//! in: everybody knows roughly what good practice is and nobody wants to write
//! it out. A blank field therefore stays blank, and rules that stay blank are
//! rules the AI is never given.
//!
//! **Why these sources, and why they are named.** Each template says where it
//! came from and under what licence, because "our architecture rules" carries
//! very different weight from "the Twelve-Factor App, which somebody outside
//! this company wrote down and a lot of people agree with". A person deciding
//! whether to keep a line should be able to go and read the original.
//!
//! The wording here is **this app's own**, written against those sources rather
//! than copied from them: the fields are prompts to a model and need to read as
//! instructions, which the originals are not. Where a source is licensed the
//! licence is stated so anybody reusing the output knows what they have.
//!
//! **These are text, and text is guidance.** Only `disallowedTech` has teeth —
//! it is re-checked against what the model says it will use, and
//! `ai::validation` fails a model that ignores it. Everything else is put in
//! front of the model and can be ignored by it, which is why the constraints
//! template says so in as many words rather than implying a control that is not
//! there.

use serde::Serialize;

/// One ready-made set of rules, and where it came from.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleTemplate {
    /// Stable across renames, because a Product may record which was used.
    pub id: String,
    pub name: String,
    /// What it is for, in one line, so the dropdown is choosable without
    /// reading the whole thing.
    pub summary: String,
    /// Who wrote the source and where to read it.
    pub source: String,
    pub url: String,
    /// The licence of the **source**, empty where it states none. Not the
    /// licence of the wording below, which is this app's.
    pub licence: String,
    /// Which field each block belongs in. Empty strings are left alone rather
    /// than overwriting whatever is already there.
    pub coding_standards: String,
    pub architecture_principles: String,
    pub maintainability: String,
    pub ai_constraints: String,
}

/// Every template this app ships.
pub fn all() -> Vec<RuleTemplate> {
    vec![twelve_factor(), asvs(), ai_access()]
}

/// One by id, for applying a chosen template.
pub fn find(id: &str) -> Option<RuleTemplate> {
    all().into_iter().find(|t| t.id == id)
}

/// The Twelve-Factor App — how a service should be built to be run.
///
/// Attributed and linked rather than reproduced: the factors are one-line
/// headings and the value here is the instruction each implies, which is
/// written for a model to follow.
fn twelve_factor() -> RuleTemplate {
    RuleTemplate {
        id: "twelve-factor".into(),
        name: "The Twelve-Factor App".into(),
        summary: "How a service should be built so it can be deployed and run anywhere.".into(),
        source: "Adam Wiggins, 2017".into(),
        url: "https://12factor.net/".into(),
        // The site states no licence, so none is claimed here.
        licence: String::new(),
        coding_standards: String::new(),
        architecture_principles: "\
Follow the Twelve-Factor App (12factor.net):
- One codebase in version control, many deploys. Do not fork per environment.
- Declare every dependency explicitly and pin it. Never rely on something \
happening to be installed on the machine.
- Keep configuration in the environment, not in code. Anything that differs \
between deploys is configuration.
- Treat backing services — databases, queues, caches, third-party APIs — as \
attached resources reached by a URL in configuration, so one can be swapped \
without a code change.
- Keep build, release and run separate. A release is a build plus a config and \
is immutable once made.
- Run the app as stateless processes. Anything that must persist belongs in a \
backing service, not in local memory or on local disk.
- Export the service by binding to a port rather than depending on a web server \
being injected at runtime.
- Scale out by running more processes rather than by making one process bigger.
- Start fast and shut down gracefully, so a process can be moved or replaced at \
any moment.
- Keep development, staging and production as alike as possible, in tooling and \
in backing services as well as in code.
- Write logs to standard output as a stream of events. Do not manage log files \
or rotation inside the app.
- Run one-off admin tasks as processes in the same environment and against the \
same release as the long-running ones."
            .into(),
        maintainability: String::new(),
        ai_constraints: String::new(),
    }
}

/// OWASP ASVS 5.0 — what a security review would look for.
///
/// **CC BY-SA 4.0**, which is stated on the template so anybody who publishes
/// rules derived from it knows the share-alike term applies to the original.
/// The lines below are written for this app rather than copied, and name the
/// chapters so a reader can go to the section that matters.
fn asvs() -> RuleTemplate {
    RuleTemplate {
        id: "owasp-asvs-5".into(),
        name: "OWASP ASVS 5.0".into(),
        summary: "Security requirements a review would check, by area.".into(),
        source: "OWASP Application Security Verification Standard 5.0.0".into(),
        url: "https://owasp.org/www-project-application-security-verification-standard/".into(),
        licence: "CC BY-SA 4.0".into(),
        coding_standards: "\
Build to OWASP ASVS 5.0. The chapters worth naming in review:
- Encoding and sanitization (V1): encode on output for the context it lands in, \
and never build a shell command, SQL statement or path by joining strings.
- Validation and business logic (V2): validate against what is allowed rather \
than what is forbidden, and enforce business rules server-side.
- Web frontend security (V3) and API and web service (V4): set the security \
headers, and treat every request as untrusted whichever door it came through.
- File handling (V5): never trust an uploaded name, type or size.
- Authentication (V6), session management (V7) and authorization (V8): check \
authorisation on every request against the acting user, not once at login.
- Self-contained tokens (V9) and OAuth/OIDC (V10): verify signature, issuer, \
audience and expiry — all four.
- Cryptography (V11): use a vetted library with current algorithms. Do not \
invent a scheme, and do not roll your own random.
- Secure communication (V12): TLS everywhere, including between internal \
services.
- Configuration (V13): ship with secure defaults, and keep secrets out of the \
repository and out of logs.
- Data protection (V14): collect the minimum, and be deliberate about what is \
kept and for how long.
- Secure coding and architecture (V15) and logging and error handling (V16): \
fail closed, and log enough to investigate without logging the secret itself."
            .into(),
        architecture_principles: String::new(),
        maintainability: String::new(),
        ai_constraints: String::new(),
    }
}

/// Limits on what the AI may reach — **asked for, not enforced**.
///
/// This one is deliberately blunt about its own status. The app can put these
/// in front of a model and it cannot stop a model, or a CLI that model drives,
/// from doing otherwise. Writing "the AI must not touch production" in a field
/// that is only a prompt, and leaving somebody believing it is a gate, is
/// exactly the kind of claim this project refuses to make.
fn ai_access() -> RuleTemplate {
    RuleTemplate {
        id: "ai-access-limits".into(),
        name: "Limits on what the AI may reach".into(),
        summary: "Going online, and touching production data — asked for, not enforced.".into(),
        source: "This app's own wording".into(),
        url: String::new(),
        licence: String::new(),
        coding_standards: String::new(),
        architecture_principles: String::new(),
        maintainability: String::new(),
        ai_constraints: "\
Going online:
- Do not fetch from the internet as part of ordinary work. Use what is in the \
repository and what you were given.
- Where something genuinely needs looking up, say what and why and wait to be \
asked, rather than fetching and carrying on.
- Never send the contents of this repository, credentials, customer data or \
anything from a database to a third-party service.
- Adding a dependency is going online on somebody else's behalf: propose it, do \
not install it.

Databases:
- Work against a local or development database. Never connect to production.
- Never run a migration, a schema change or a destructive statement against any \
shared environment.
- Treat a connection string that names a production host as a mistake to report \
rather than a credential to use.
- Where real data is needed to reproduce something, ask for an anonymised \
extract instead of reaching for the source.

These are instructions to the model, not controls this app enforces. A model \
can ignore them, and a tool it drives can do things this app never sees. Where \
something must not happen, it has to be prevented where the capability lives — \
by not giving the process the credential, the network route or the permission."
            .into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every template has to be findable by the id the UI will send back.
    #[test]
    fn every_template_can_be_found_by_its_id() {
        for template in all() {
            assert_eq!(find(&template.id).map(|t| t.name), Some(template.name.clone()));
        }
    }

    /// **Attribution is not optional.** A template that says nothing about
    /// where it came from is one somebody would take as this company's own
    /// opinion, and the whole point of shipping these is that they are not.
    #[test]
    fn every_template_says_where_it_came_from() {
        for template in all() {
            assert!(!template.source.trim().is_empty(), "{} has no source", template.id);
            assert!(!template.summary.trim().is_empty(), "{} has no summary", template.id);
        }
    }

    /// A licensed source must carry its licence, because anybody publishing
    /// rules derived from it needs to know the terms.
    #[test]
    fn the_licensed_source_states_its_licence() {
        let asvs = find("owasp-asvs-5").expect("asvs");
        assert_eq!(asvs.licence, "CC BY-SA 4.0");
        assert!(asvs.url.contains("owasp.org"), "and where to read it: {}", asvs.url);

        // Twelve-Factor states no licence, so none is claimed on its behalf.
        let twelve = find("twelve-factor").expect("twelve-factor");
        assert!(twelve.licence.is_empty(), "no licence may be invented: {:?}", twelve.licence);
        assert!(twelve.url.contains("12factor.net"));
    }

    /// A template must put something somewhere, or picking it does nothing.
    #[test]
    fn every_template_fills_at_least_one_field() {
        for t in all() {
            let filled = [
                &t.coding_standards,
                &t.architecture_principles,
                &t.maintainability,
                &t.ai_constraints,
            ]
            .iter()
            .any(|f| !f.trim().is_empty());
            assert!(filled, "{} would insert nothing", t.id);
        }
    }

    /// **The one that matters most.** The access template is guidance, and it
    /// has to say so — leaving somebody believing "must not touch production"
    /// is a gate this app enforces would be worse than not shipping it.
    #[test]
    fn the_access_template_admits_it_is_not_enforced() {
        let limits = find("ai-access-limits").expect("limits");
        let said = limits.ai_constraints.to_lowercase();
        assert!(said.contains("not controls this app enforces"), "{said}");
        assert!(said.contains("can ignore them"), "{said}");
        // And says what would actually work instead, rather than only what will
        // not: a caveat with no way forward is just a disclaimer.
        assert!(said.contains("where the capability lives"), "{said}");
    }

    /// It covers both things it claims to cover.
    #[test]
    fn the_access_template_covers_going_online_and_production_data() {
        let limits = find("ai-access-limits").expect("limits");
        let said = limits.ai_constraints.to_lowercase();
        assert!(said.contains("internet"), "going online: {said}");
        assert!(said.contains("production"), "production data: {said}");
    }
}
