import { useCallback, useEffect, useState } from "react";
import {
  fetchAgentPolicy,
  getAgentPolicySource,
  getInstalledPolicy,
  movingGithubRef,
  runAgentPolicy,
  setAgentPolicySource,
  type AgentPolicySource,
  type FetchedPolicy,
  type InstalledPolicy,
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

  /** Brings it here so it can be read. Nothing is run by this. */
  async function bring() {
    setBusy("fetch");
    setRan("");
    try {
      setFetched(await fetchAgentPolicy());
      setNote("Fetched. Read it before running it.");
      setError(null);
    } catch (e) {
      setError(String(e));
      setFetched(null);
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
        <button
          type="button"
          onClick={() => void apply()}
          disabled={!fetched || busy !== ""}
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
