import { useCallback, useEffect, useState } from "react";
import {
  addClaudeCodeProvider,
  claudeCodeStatus,
  getProductBudget,
  installClaudeCode,
  listAiProviders,
  setProductBudget,
  getPaidApiAllowed,
  setPaidApiAllowed,
  type AiProvider,
} from "../../lib/backend";
import AiSettings from "./AiSettings";

/** How Claude gets paid for. The two are separate purchases, which is the whole
 *  reason this is a choice rather than one "Claude" setting. */
type Route = "plan" | "api";

/** The stages of setting up, in order. `signIn` is deliberately last of the
 *  ones the app touches and is never marked done by it — see the component. */
type Stage = "install" | "provider" | "order";

const STAGE_WORDS: Record<Stage, string> = {
  install: "Installing Claude Code…",
  provider: "Adding it as a provider…",
  order: "Making it this Product's first choice…",
};

/** Setting Claude up, as one button rather than a list to follow.
 *
 *  **Why a choice of two.** A Claude subscription and Anthropic API credits are
 *  separate purchases. The plan pays for the `claude` command line tool; the API
 *  bills credits against a key and cannot read a subscription. "I have Claude"
 *  is therefore not enough to know what to set up, and guessing wrong ends in a
 *  call that fails for a reason the error cannot explain.
 *
 *  **Why a button and not instructions.** Three of the four steps are things
 *  this app can simply do — install the tool, add the provider, put it first —
 *  so it does them, and says which one it is on while it works. Printed steps
 *  would be asking someone to be the machine.
 *
 *  **The fourth stays yours.** Signing in means handling your credentials, and
 *  this app will not do that: it opens nothing and stores nothing. It tells you
 *  the one command to run and is honest that it cannot check whether you ran it
 *  — proving that needs a real call, which would spend a slice of your plan's
 *  allowance every time this page loaded.
 *
 *  Anything that is a decision rather than a step is folded away, so what is
 *  showing by default is a choice, a button, and four lines of state. */
export default function ClaudeSetup({ productId }: { productId: number }) {
  const [route, setRoute] = useState<Route>("plan");
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [chain, setChain] = useState<number[]>([]);
  const [cli, setCli] = useState<{
    installed: boolean;
    version: string;
    path: string;
  } | null>(null);
  /// Which stage is running, or null when nothing is. Drives the button's own
  /// label, so "what is it doing?" is answered where the press happened.
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /// npm's own words, kept out of the way but never thrown away — when an
  /// install fails, they name the cause far better than an exit code.
  const [log, setLog] = useState<string>("");

  /// Whether calls that cost money may run. Off until somebody says otherwise,
  /// and enforced in the router — this control reflects that setting rather
  /// than being the whole of it.
  const [paidAllowed, setPaidAllowed] = useState(false);
  const [executable, setExecutable] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [loaded, budget] = await Promise.all([
        listAiProviders(),
        getProductBudget(productId),
      ]);
      setProviders(loaded);
      setChain(budget?.providerChain ?? []);
    } catch (e) {
      setError(String(e));
    }
    // Separately: not having the CLI is an answer, not a failure, and a machine
    // that cannot be asked must not blank the rest of the panel.
    try {
      setPaidAllowed(await getPaidApiAllowed());
    } catch {
      // Unreadable means treat it as off, which is the safe direction: it
      // cannot start spending because a setting failed to load.
      setPaidAllowed(false);
    }
    try {
      const status = await claudeCodeStatus(executable);
      setCli({ installed: status.installed, version: status.version, path: status.path });
    } catch {
      setCli(null);
    }
  }, [productId, executable]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const cliProvider = providers.find((p) => p.kind === "claudeCode") ?? null;
  const apiProvider = providers.find((p) => p.kind === "anthropic") ?? null;
  const chosen = route === "plan" ? cliProvider : apiProvider;
  const isFirst = chosen !== null && chain[0] === chosen.id;

  /** Puts a provider at the head of this Product's chain.
   *
   *  Head, not merely present: the chain is tried in order, and everything after
   *  the first is a handover target for when a budget runs down. A provider
   *  sitting second is never reached until then — which, for somebody whose
   *  first provider cannot work at all, means nothing runs. */
  async function putFirst(providerId: number) {
    const budget = await getProductBudget(productId);
    const rest = (budget?.providerChain ?? []).filter((id) => id !== providerId);
    await setProductBudget({
      productId,
      totalBudgetMicropence: budget?.totalBudgetMicropence ?? 0,
      aiBudgetMicropence: budget?.aiBudgetMicropence ?? 0,
      tokenLimit: budget?.tokenLimit ?? 0,
      warnPct: budget?.warnPct ?? 75,
      handoverPct: budget?.handoverPct ?? 90,
      hardStopPct: budget?.hardStopPct ?? 100,
      periodDays: budget?.periodDays ?? 30,
      providerChain: [providerId, ...rest],
    });
  }

  /** Does the whole plan setup, stopping at the first thing that fails.
   *
   *  Each stage is skipped when it is already done, so pressing again after a
   *  failure resumes rather than starting over — and installing over a working
   *  install is avoided rather than merely harmless. */
  async function setUpPlan() {
    setError(null);
    setNotice(null);
    try {
      if (!cli?.installed) {
        setStage("install");
        setLog(await installClaudeCode());
        const after = await claudeCodeStatus(executable);
        setCli({ installed: after.installed, version: after.version, path: after.path });
        if (!after.installed) {
          // npm reported success and the tool still will not run. Saying so is
          // better than adding a provider that cannot work.
          throw new Error(
            `npm finished, but ${after.problem || "the tool still will not run"}`,
          );
        }
      }

      let providerId = cliProvider?.id ?? null;
      if (providerId === null) {
        setStage("provider");
        providerId = await addClaudeCodeProvider("Claude Code (my plan)", executable);
      }

      setStage("order");
      await putFirst(providerId);

      setNotice(
        "Set up. The one thing left is signing in — run `claude` once in a terminal and choose the subscription login. This app cannot do that step or check it.",
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setStage(null);
      await refresh();
    }
  }

  /** The API route: the app can only do the last step. Buying credits and
   *  handing over a key are not things it should do for you. */
  async function setUpApi() {
    if (!apiProvider) return;
    setError(null);
    setNotice(null);
    setStage("order");
    try {
      await putFirst(apiProvider.id);
      setNotice("This Product now asks the API first.");
    } catch (e) {
      setError(String(e));
    } finally {
      setStage(null);
      await refresh();
    }
  }

  const planDone = Boolean(cli?.installed) && cliProvider !== null && isFirst;
  const apiDone = Boolean(apiProvider?.keyStored) && isFirst;

  /** What the button says. While working it names the stage, because "Setting
   *  up…" for two minutes of a cold npm install tells you nothing about whether
   *  it is stuck. */
  const buttonLabel = () => {
    if (stage) return STAGE_WORDS[stage];
    if (route === "plan") return planDone ? "Set up again" : "Set up Claude with my plan";
    return apiDone ? "Set up again" : "Use the API for this Product";
  };

  return (
    <section className="claude-setup" aria-label="Claude setup">
      <h3>Using Claude</h3>

      <label className="setup-route">
        How do you pay for Claude?
        <select
          aria-label="How you pay for Claude"
          value={route}
          onChange={(e) => setRoute(e.target.value as Route)}
          disabled={stage !== null}
        >
          <option value="plan">My Claude plan (Pro or Max)</option>
          {/* Only offered when paid calls are switched on. Offering a route
              that the router would refuse is how you end up debugging a chain
              that was never the problem. */}
          {paidAllowed && <option value="api">API credits</option>}
        </select>
      </label>

      {/* The switch. Off by default, because a plan and API credits are
          separate purchases and somebody with the plan alone has no use for a
          metered provider — every call it makes fails, and every prompt to set
          one up is noise. */}
      <label className="setup-paid switch">
        <input
          type="checkbox"
          aria-label="Allow calls that cost money"
          checked={paidAllowed}
          disabled={stage !== null}
          onChange={async (e) => {
            const next = e.target.checked;
            setPaidAllowed(next);
            // Back to the plan route immediately: leaving the API route
            // selected while the router refuses it would show a setup flow
            // that cannot complete.
            if (!next) setRoute("plan");
            try {
              await setPaidApiAllowed(next);
              setError(null);
            } catch (err) {
              setPaidAllowed(!next); // put it back rather than lie about it
              setError(String(err));
            }
          }}
        />
        Allow calls that cost money
      </label>
      <p className="hint">
        {paidAllowed
          ? "Metered providers may run — the Claude API and Ollama's hosted service both bill. Product budgets still apply."
          : "Off: nothing that charges will be called, and you will not be asked to set one up. Claude Code on your plan and a local Ollama both still work, because neither is billed."}
      </p>

      {/* The distinction the whole panel exists for, said once, up front. */}
      <p className="hint">
        {route === "plan"
          ? "Your plan pays for Claude Code on this machine. No spend is shown for it — the allowance is charged where this app cannot see it, and it will not invent a figure."
          : "API credits are billed against a key and are metered here: every call goes through this Product's budget and into the ledger. A Claude plan does not pay for these."}
      </p>

      <div className="setup-actions">
        <button
          className="setup-go"
          aria-label={
            route === "plan" ? "Set up Claude with my plan" : "Use the API for this Product"
          }
          aria-busy={stage !== null}
          disabled={stage !== null || (route === "api" && !apiProvider)}
          onClick={() => void (route === "plan" ? setUpPlan() : setUpApi())}
        >
          {buttonLabel()}
        </button>
      </div>

      {route === "api" && !apiProvider && (
        <p className="hint">
          Add the provider and its key first, under <strong>Advanced</strong>{" "}
          below. The key goes straight to this machine's credential store — this
          app never writes it to the database and cannot show it back.
        </p>
      )}

      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {/* State, not instructions: what is true now, so a half-finished setup is
          readable at a glance. Each line says what it means rather than relying
          on a tick to carry it. */}
      <ul className="setup-state">
        {route === "plan" ? (
          <>
            <li className={cli?.installed ? "is-done" : "is-todo"}>
              {cli?.installed ? (
                <>
                  Claude Code is installed — {cli.version}.{" "}
                  {/* Which copy, because there is very often more than one: the
                      desktop app keeps its own, npm puts others on the PATH, and
                      they do not all work. Naming it turns "is it installed?"
                      into a question with a checkable answer. */}
                  <code className="setup-path">{cli.path}</code>
                </>
              ) : (
                "Claude Code was not found on this machine."
              )}
            </li>
            <li className={cliProvider ? "is-done" : "is-todo"}>
              {cliProvider
                ? `Added as a provider — "${cliProvider.name}", no key needed.`
                : "Not added as a provider yet."}
            </li>
            <li className={isFirst ? "is-done" : "is-todo"}>
              {isFirst
                ? "This Product asks it before anything else."
                : "Not this Product's first choice yet."}
            </li>
            <li className="is-yours">
              Signing in is yours to do: run <code>claude</code> once and choose
              the subscription login, not an API key. This app cannot check it —
              proving it would mean spending your allowance every time this page
              opened.
            </li>
          </>
        ) : (
          <>
            <li className={apiProvider?.keyStored ? "is-done" : "is-todo"}>
              {apiProvider?.keyStored
                ? `Provider "${apiProvider.name}" is added, key in this machine's credential store.`
                : "No API provider with a key yet."}
            </li>
            <li className={isFirst ? "is-done" : "is-todo"}>
              {isFirst
                ? "This Product asks it before anything else."
                : "Not this Product's first choice yet."}
            </li>
            <li className="is-yours">
              Credits are yours to buy — a Claude plan does not pay for them.
            </li>
          </>
        )}
      </ul>

      {/* Folded away because none of it is a step — it is a decision, and the
          defaults are right for almost everyone. */}
      <details className="setup-advanced">
        <summary>Advanced</summary>

        <label>
          Claude Code executable
          <input
            aria-label="Claude Code executable"
            placeholder="claude — or a full path if it is not on PATH"
            value={executable}
            onChange={(e) => setExecutable(e.target.value)}
          />
        </label>
        <p className="hint">
          Empty means whichever <code>claude</code> is on your PATH. Set a full
          path only when the install is somewhere a terminal cannot find.
        </p>


        <h4>What the button does, and what it will not</h4>
        <ul className="hint">
          <li>
            <strong>It runs</strong> <code>npm i -g @anthropic-ai/claude-code</code>,
            adds the provider, and puts it first for this Product. Installing over
            a broken half-install repairs it, which is the usual reason{" "}
            <code>claude</code> is on the PATH and still will not run.
          </li>
          <li>
            <strong>It will not</strong> sign you in. That means handling your
            credentials, and this app does not do that — it stores no password
            and opens no login for you.
          </li>
          <li>
            <strong>It cannot tell</strong> whether you are signed in, or how much
            plan allowance is left. Neither can be read without making a real
            call.
          </li>
          <li>
            <strong>Worth knowing:</strong> Claude Code cannot be shown mockups —
            it reads files from disk, not pictures in a prompt. A work item with
            mockups attached is refused rather than planned without them.
          </li>
        </ul>

        {chain.length > 0 && (
          <p className="hint">
            Current order for this Product:{" "}
            {chain
              .map((id) => providers.find((p) => p.id === id)?.name ?? `#${id}`)
              .join(" → ")}
          </p>
        )}

        {log && (
          <>
            <h4>What npm said</h4>
            <pre className="setup-log" aria-label="Install output">
              {log}
            </pre>
          </>
        )}

        {/* Every provider, by hand. This used to be a second panel of its own,
            which meant two places doing the same job — the button above covers
            what almost everyone needs, and this is here for the rest: a second
            Claude account, a hosted Ollama, a base URL that is not the default.
            Folded, because needing it is the exception. */}
        <h4>Providers, in full</h4>
        <AiSettings />
      </details>
    </section>
  );
}
