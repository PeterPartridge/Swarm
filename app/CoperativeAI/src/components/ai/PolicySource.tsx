import { useCallback, useEffect, useState } from "react";
import {
  fetchAgentPolicy,
  getAgentPolicySource,
  getInstalledPolicy,
  installPolicyIntoSolution,
  listSolutions,
  movingGithubRef,
  previewPolicyInstall,
  runAgentPolicy,
  setAgentPolicySource,
  type AgentPolicySource,
  type FetchedPolicy,
  type InstalledPolicy,
  type PolicyChange,
  type Solution,
} from "../../lib/backend";

/** Where an agent policy comes from, what installs it, and where it lands.
 *
 *  **Inside "Where agents run", not beside it.** A policy means nothing without
 *  a sandbox: with no boundary there is no separate user and no container, so
 *  nothing can be kept from an agent at all. Put in its own panel it would read
 *  as protection in its own right, which is the failure this whole area exists
 *  to avoid.
 *
 *  **Three fields rather than one, because fetching and running are different
 *  acts.** Where to get it, what to do with it, and where "here" is. Keeping
 *  them apart is what lets the thing be read before it is run — the only
 *  safeguard there is against a policy somebody else wrote, given that it runs
 *  as root inside the boundary and can weaken it as easily as strengthen it. */
export default function PolicySource() {
  const [source, setSource] = useState<AgentPolicySource>({
    from: "",
    command: "",
    folder: "",
    expectDigest: "",
  });
  const [saved, setSaved] = useState<AgentPolicySource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [fetched, setFetched] = useState<FetchedPolicy | null>(null);
  const [ran, setRan] = useState("");
  /** Which act is under way, so only its own button says so. */
  const [busy, setBusy] = useState("");

  /** What was last run into the boundary — past tense, and not a claim that
   *  it is still in force. */
  const [installed, setInstalled] = useState<InstalledPolicy | null>(null);

  /** Where a fetched *policy* could go. Only loaded when one arrives, because
   *  a script has no Solution to be installed into. */
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [into, setInto] = useState<number | null>(null);
  const [change, setChange] = useState<PolicyChange | null>(null);
  const [applied, setApplied] = useState("");

  const load = useCallback(async () => {
    try {
      const got = await getAgentPolicySource();
      setSource(got);
      setSaved(got);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
    // Separate from the source, and its failure is not the source's failure:
    // not knowing what was installed must not make the panel look broken.
    try {
      setInstalled(await getInstalledPolicy());
    } catch {
      setInstalled(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    try {
      await setAgentPolicySource(source);
      setSaved(source);
      setNote("Saved.");
      setError(null);
    } catch (e) {
      // The refusal is the useful part: it says which field cannot be honoured.
      setError(String(e));
      setNote("");
    }
  }

  /** Brings it here so it can be read. Nothing is run or written by this. */
  async function bring() {
    setBusy("fetch");
    setRan("");
    setChange(null);
    setApplied("");
    try {
      const got = await fetchAgentPolicy();
      setFetched(got);
      setError(null);
      // **What arrived decides what is offered.** A deny list goes into a
      // Solution and is honoured by both backends; a script is run into the
      // distribution and does nothing under Docker. Asking somebody to know
      // which they have would be asking them to do this reading themselves.
      if (got.shape === "policy") {
        setNote("Fetched a policy. Read it, then choose where it goes.");
        try {
          const found = await listSolutions();
          setSolutions(found);
          setInto(found.length > 0 ? found[0].id : null);
        } catch {
          /* Not knowing the Solutions is not the fetch failing. */
        }
      } else {
        setNote("Fetched a script. Read it before running it.");
        setSolutions([]);
        setInto(null);
      }
    } catch (e) {
      setError(String(e));
      setFetched(null);
    } finally {
      setBusy("");
    }
  }

  /** What installing it into the chosen Solution would change. Writes nothing. */
  async function preview() {
    if (!fetched || into === null) return;
    setBusy("preview");
    setApplied("");
    try {
      setChange(await previewPolicyInstall(into, fetched));
      setError(null);
    } catch (e) {
      setError(String(e));
      setChange(null);
    } finally {
      setBusy("");
    }
  }

  /** Writes it into the Solution's repository — only after it was previewed. */
  async function applyToSolution() {
    if (!fetched || into === null) return;
    setBusy("install");
    try {
      const done = await installPolicyIntoSolution(into, fetched);
      setChange(done);
      const name = solutions.find((s) => s.id === into)?.name ?? "that Solution";
      setApplied(`Written into ${name}. Runs there will honour it from now on.`);
      setError(null);
    } catch (e) {
      setError(String(e));
      setApplied("");
    } finally {
      setBusy("");
    }
  }

  /** Runs it where the agent will run — as root, inside the boundary. */
  async function apply() {
    if (!fetched) return;
    setBusy("run");
    try {
      setRan(await runAgentPolicy(fetched));
      setNote("Policy run.");
      setError(null);
      // Re-read rather than assumed: what is shown as installed should be what
      // the backend actually wrote down, not what this component expected it to.
      try {
        setInstalled(await getInstalledPolicy());
      } catch {
        /* The run still happened; not knowing is not worth an alert here. */
      }
    } catch (e) {
      setError(String(e));
      setRan("");
    } finally {
      setBusy("");
    }
  }

  /** Pins what was just fetched, so every fetch after this one is checked.
   *
   *  **Saved in the same press, not left as a field somebody meant to save.**
   *  A digest typed into a box and not stored is the most misleading state this
   *  panel could be in: it looks pinned and checks nothing. */
  async function pin() {
    if (!fetched) return;
    const next = { ...source, expectDigest: fetched.digest };
    setBusy("pin");
    try {
      await setAgentPolicySource(next);
      setSource(next);
      setSaved(next);
      setNote("Pinned. Fetches after this one are checked against it.");
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }

  const changed = saved !== null && JSON.stringify(saved) !== JSON.stringify(source);
  const isUrl = /^https?:\/\//i.test(source.from.trim());
  const pinned = source.expectDigest.trim() !== "";
  /** Recognised where it is typed, because "put the commit in instead" is only
   *  useful advice if it says which part of the address to replace. */
  const branch = movingGithubRef(source.from);

  return (
    <section className="policy-source" aria-label="Agent policy">
      <h4>What agents may not reach</h4>
      <p className="hint">
        A policy is fetched, read, and then run where the agent will run — so it
        restricts by permissions rather than by asking the agent nicely. It only
        means anything with a sandbox on: with none, there is no separate user to
        keep anything from.
      </p>

      {error && <p role="alert">{error}</p>}

      <label>
        Download from
        <input
          type="text"
          value={source.from}
          placeholder="https://… or a file on this machine"
          onChange={(e) => setSource({ ...source, from: e.target.value })}
        />
      </label>
      {/* Said where it is typed, not discovered on save: a policy is fetched
          and then run as root, so plain http is a script anybody on the path
          can rewrite. */}
      <span className="hint">
        {isUrl
          ? "An address must be https — this is fetched and then run."
          : "A file on this machine is the safer choice: you can read it first."}
      </span>
      {/* **Said as it is typed rather than found on Save.** A branch means
          "whatever that points at when the button is next pressed", which is a
          different file from the one somebody read, on a day its author picks. */}
      {branch !== null && !pinned && (
        <span className="hint" role="status">
          “{branch}” is a branch, so this would fetch whatever it points at next
          — not what you read. Put the commit id in the address instead, or
          fetch it once and pin its digest below.
        </span>
      )}

      <label>
        Expected digest
        <input
          type="text"
          value={source.expectDigest}
          placeholder="optional — the SHA-256 it must have"
          onChange={(e) => setSource({ ...source, expectDigest: e.target.value })}
        />
      </label>
      {/* **The gap named rather than left to be assumed.** A digest on screen
          looks like integrity whether or not anything was checked against it,
          and that assumption is the whole failure this field exists to end. */}
      <span className="hint">
        {pinned
          ? "Every fetch is checked against this, and a policy that does not match is not saved or run."
          : "Nothing is pinned, so a fetch is checked against nothing. Fetch it once, read it, then pin what you read."}
      </span>

      <label>
        Download to
        <input
          type="text"
          value={source.folder}
          placeholder="the folder it lands in"
          onChange={(e) => setSource({ ...source, folder: e.target.value })}
        />
      </label>

      <label>
        Run this to install it
        <input
          type="text"
          value={source.command}
          placeholder="the command that applies the policy"
          onChange={(e) => setSource({ ...source, command: e.target.value })}
        />
      </label>

      <div className="policy-actions">
        <button type="button" onClick={() => void save()} disabled={!changed}>
          Save
        </button>
        {/* **Three presses, not one.** Fetch, read, then run. A single button
            would make the reading optional, and the reading is the only
            safeguard there is against a policy somebody else wrote — it runs
            as root inside the boundary and can weaken it as easily as
            strengthen it. */}
        <button
          type="button"
          onClick={() => void bring()}
          disabled={changed || !saved?.from.trim() || busy !== ""}
        >
          {busy === "fetch" ? "Fetching…" : "Fetch it"}
        </button>
        {/* **Offered only for what it can actually act on.** Running a deny
            list as a shell script would do nothing useful and might do
            something harmful, and installing a script as a policy is refused
            by the backend anyway — so the button that does not apply is gone
            rather than present and failing. */}
        <button
          type="button"
          onClick={() => void apply()}
          disabled={!fetched || fetched.shape === "policy" || busy !== ""}
        >
          {busy === "run" ? "Running…" : "Run it"}
        </button>
        {note && <span className="hint">{note}</span>}
      </div>

      {fetched && (
        <div className="policy-read">
          <p className="hint">
            {fetched.bytes} bytes, at {fetched.path}. Read it before running it.
            {fetched.truncated && " Shown as far as it is worth reading."}
          </p>
          {/* **Two plainly different words, never one icon** — the rule this
              area was built on. "Checked" means a digest set beforehand matched;
              "not checked" means this is the first sight of it and nothing
              verified anything. Both show the digest; only one is a claim. */}
          <p className="hint">
            <code>{fetched.digest}</code>{" "}
            {fetched.verified
              ? "— checked against the pinned digest."
              : "— not checked against anything. Compare it with what the policy’s author published."}
          </p>
          {!fetched.verified && (
            <button type="button" onClick={() => void pin()} disabled={busy !== ""}>
              {busy === "pin" ? "Pinning…" : "Pin this digest"}
            </button>
          )}
          <pre>{fetched.text}</pre>
        </div>
      )}

      {/* **A policy goes into a repository, which is what makes it shareable
          and reviewable and what both backends already honour.** This is the
          route a script never had: a deny list restricts under Docker as
          mounts and under WSL as permissions, where a script only ever worked
          under one of them. */}
      {fetched?.shape === "policy" && (
        <div className="policy-read">
          <p className="hint">
            This is a policy — a list of what an agent may not reach. It goes
            into a Solution&rsquo;s repository as <code>.coperativeai/policy.json</code>,
            where it is read on every run and enforced by whichever boundary is
            in force. Unlike a script, it works under Docker too.
          </p>
          {solutions.length === 0 ? (
            <p className="hint">No Solutions to install it into yet.</p>
          ) : (
            <div className="policy-actions">
              <label>
                Install into
                <select
                  value={into ?? ""}
                  onChange={(e) => {
                    setInto(Number(e.target.value));
                    // The plan belonged to the previous Solution; keeping it on
                    // screen would describe a change to somewhere else.
                    setChange(null);
                    setApplied("");
                  }}
                >
                  {solutions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => void preview()}
                disabled={into === null || busy !== ""}
              >
                {busy === "preview" ? "Checking…" : "What would change?"}
              </button>
              {/* **Applies nothing until it has been shown.** The removals are
                  rules somebody believed were being enforced, and one going
                  without a decision is the failure worth a second press. */}
              <button
                type="button"
                onClick={() => void applyToSolution()}
                disabled={change === null || applied !== "" || busy !== ""}
              >
                {busy === "install" ? "Writing…" : "Install it"}
              </button>
            </div>
          )}

          {change && (
            <div className="policy-read">
              {!change.hadOne && (
                <p className="hint">That Solution has no policy today.</p>
              )}
              {/* Removals first and named, because they are the half that
                  takes protection away rather than adding it. */}
              {change.removed.length > 0 && (
                <p role="status">
                  Would stop enforcing: {change.removed.join(", ")}.
                </p>
              )}
              <p className="hint">
                {change.added.length > 0
                  ? `Would start enforcing: ${change.added.join(", ")}.`
                  : "Nothing new would be enforced."}
                {change.kept.length > 0 && ` Unchanged: ${change.kept.join(", ")}.`}
              </p>
              {applied && <p className="hint">{applied}</p>}
            </div>
          )}
        </div>
      )}

      {ran && (
        <div className="policy-read">
          <p className="hint">What running it said:</p>
          <pre>{ran || "(it said nothing)"}</pre>
        </div>
      )}

      {/* **What was run, in the past tense, with the date.** A person looking
          at this panel wants to know whether the boundary has had a policy put
          into it — and the only honest answer available is "this script ran, on
          this day". Nothing here watches the distribution afterwards, and root
          inside it can undo every permission a script set, so present tense
          would be a claim this app cannot support. */}
      <div className="policy-read">
        {installed !== null && installed.from !== "" ? (
          <p className="hint">
            Last run into the {installed.mode === "docker" ? "container" : "distribution"}:{" "}
            {installed.from} (<code title={installed.digest}>{installed.digest.slice(0, 12)}</code>)
            on {new Date(installed.at).toLocaleString()}. That says a script ran, not that what it
            did is still in place — anything with root inside the boundary can undo it, and setting
            the sandbox up again clears this record because it rebuilds what the script worked on.
          </p>
        ) : (
          <p className="hint">
            No policy script has been run into the boundary. A Solution&rsquo;s own{" "}
            <code>.coperativeai/policy.json</code> is enforced on every run regardless — that is a
            different mechanism from this one.
          </p>
        )}
      </div>

      {/* **Said plainly rather than discovered.** A source that has been saved
          is not a policy in force, and the gap between the two is exactly where
          somebody would otherwise assume protection they do not have. */}
      <p className="hint">
        A policy only restricts anything once it has been run, and only where
        there is a boundary to run it in. Under Docker it is applied when a run
        starts, because a container does not exist between runs.
      </p>
      {/* **The limit that would otherwise be found the hard way.** Both
          mechanisms work on the working copy — one hides the path, the other
          makes it unreadable — and neither touches git's own storage. A file
          committed at any point is still in the history the run was cloned
          from, and `git show` does not go through the filesystem. So this is
          worth having for untracked and ignored files, and is not the thing
          that keeps a committed secret from an agent. */}
      <p className="hint">
        A path that was ever committed stays in the repository's history, and an
        agent with the clone can still reach it through git. This keeps
        untracked and ignored files out of its way; it is not a way to take back
        something already committed.
      </p>
    </section>
  );
}
