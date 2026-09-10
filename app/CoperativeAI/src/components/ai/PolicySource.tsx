import { useCallback, useEffect, useState } from "react";
import {
  getAgentPolicySource,
  setAgentPolicySource,
  type AgentPolicySource,
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
  const [source, setSource] = useState<AgentPolicySource>({ from: "", command: "", folder: "" });
  const [saved, setSaved] = useState<AgentPolicySource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const got = await getAgentPolicySource();
      setSource(got);
      setSaved(got);
      setError(null);
    } catch (e) {
      setError(String(e));
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

  const changed = saved !== null && JSON.stringify(saved) !== JSON.stringify(source);
  const isUrl = /^https?:\/\//i.test(source.from.trim());

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
        {note && <span className="hint">{note}</span>}
      </div>

      {/* **Said plainly rather than discovered.** Saving a source is not the
          same as a policy being in force, and the gap between the two is
          exactly where somebody would otherwise assume protection. */}
      <p className="hint">
        Saving this records where the policy comes from. Fetching it, reading it
        and running it before an agent starts is still to come — nothing is
        restricted yet.
      </p>
    </section>
  );
}
