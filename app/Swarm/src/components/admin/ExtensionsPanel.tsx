import { useCallback, useEffect, useState, type FormEvent } from "react";
import { HIVES } from "@hives/registry";
import {
  installExtension,
  listInstalledExtensions,
  readExtensionSource,
  removeExtension,
  SWARM_EXTENSIONS_URL,
  type ExtensionOffer,
  type InstalledExtension,
} from "../../lib/backend";

/** A Hive by its label, a cell by its id: the installed table only has ids,
 *  and the registry is what names a Hive everywhere else. */
const nameOf = (e: InstalledExtension) =>
  e.kind === "hive" ? (HIVES.find((h) => h.id === e.id)?.label ?? e.id) : e.id;

/** Admin → Extensions: what is installed, and where more comes from.
 *
 *  **Two cards, in the order a person needs them.** What is here first, with
 *  Remove; then a source to read, which this repository fills in by default.
 *  Nothing from a source runs: Round 1 installs only what this Swarm already
 *  contains, and the backend checks that again on every install.
 *
 *  `onChange` is called after anything is installed or removed, because what
 *  the rail and the role editor show depends on it. */
export default function ExtensionsPanel({ onChange }: { onChange: () => void | Promise<void> }) {
  const [installed, setInstalled] = useState<InstalledExtension[]>([]);
  const [url, setUrl] = useState(SWARM_EXTENSIONS_URL);
  /** The URL the offers below were read from — installing uses this one, not
   *  whatever has been typed into the field since. */
  const [readFrom, setReadFrom] = useState<string | null>(null);
  const [offers, setOffers] = useState<ExtensionOffer[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setInstalled(await listInstalledExtensions());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
      await onChange();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRead(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setOffers(await readExtensionSource(url));
      setReadFrom(url);
    } catch (err) {
      setOffers(null);
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  function onRemove(e: InstalledExtension) {
    // A Hive's grants go with it, so it asks; a cell has none to lose.
    if (e.kind === "hive") setConfirming(e.id);
    else void act(() => removeExtension(e.kind, e.id));
  }

  const isInstalled = (o: ExtensionOffer) =>
    installed.some((e) => e.kind === o.kind && e.id === o.id);

  return (
    <>
      {error && <p role="alert">{error}</p>}

      <section className="admin-card" aria-label="Installed extensions">
        <h2>Installed</h2>
        {installed.length === 0 ? (
          <p className="hint">
            Nothing is installed yet. Read a source below and install the Hives
            and Cells you want.
          </p>
        ) : (
          <table className="roles-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Name</th>
                <th>Version</th>
                <th>From</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {installed.map((e) => (
                <tr key={`${e.kind}/${e.id}`} aria-label={`Installed ${e.kind} ${nameOf(e)}`}>
                  <td>{e.kind}</td>
                  <td>{nameOf(e)}</td>
                  <td>{e.version}</td>
                  <td>{e.source}</td>
                  <td>
                    {confirming === e.id && e.kind === "hive" ? (
                      <span>
                        {`${nameOf(e)}'s role grants go, and installing it again grants it to nobody. Its data stays. `}
                        <button
                          aria-label="Confirm remove"
                          disabled={busy}
                          onClick={() => {
                            setConfirming(null);
                            void act(() => removeExtension(e.kind, e.id));
                          }}
                        >
                          Remove
                        </button>{" "}
                        <button onClick={() => setConfirming(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button
                        aria-label={`Remove ${nameOf(e)}`}
                        disabled={busy}
                        onClick={() => onRemove(e)}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="admin-card" aria-label="Add extensions">
        <h2>Add</h2>
        <p className="hint">
          Any address serving a <code>swarm-extensions.json</code>. This Swarm
          can install only the Hives and Cells it already contains; the list
          says which, and why not for the rest.
        </p>
        <form onSubmit={onRead} aria-label="Read a source">
          <input
            aria-label="Source URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            size={60}
          />
          <button type="submit" disabled={busy}>
            Read
          </button>
        </form>
        {offers !== null &&
          (offers.length === 0 ? (
            <p className="hint">That source lists nothing.</p>
          ) : (
            <table className="roles-table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Name</th>
                  <th>Version</th>
                  <th>Publisher</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {offers.map((o, i) => (
                  <tr key={`${o.kind}/${o.id}/${i}`} aria-label={`Offered ${o.kind} ${o.name}`}>
                    <td>{o.kind}</td>
                    <td>
                      {o.name}
                      {o.description && <div className="hint">{o.description}</div>}
                    </td>
                    <td>{o.version}</td>
                    <td>{o.publisher}</td>
                    <td>
                      {o.problem !== null ? (
                        <span className="hint">{o.problem}</span>
                      ) : isInstalled(o) ? (
                        <span>Installed</span>
                      ) : (
                        <button
                          aria-label={`Install ${o.name}`}
                          disabled={busy}
                          onClick={() => void act(() => installExtension(readFrom ?? url, o.kind, o.id))}
                        >
                          Install
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </section>
    </>
  );
}
