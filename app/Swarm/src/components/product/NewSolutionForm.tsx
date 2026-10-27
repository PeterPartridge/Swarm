import { useEffect, useState, type FormEvent } from "react";
import {
  createSolutionWithStarter,
  listStarters,
  pickFolder,
  startExistingSolution,
  SOLUTION_QUESTIONS,
  SOLUTION_TYPES,
  type Product,
  type Starter,
  type StarterRun,
} from "../../lib/backend";

/** Making a Solution: what it is called, what sort of thing it is, what
 *  language it is written in — and, when a language is chosen, running that
 *  toolchain's own generator to create the project.
 *
 *  **One form, two places.** Develop's Map tab has always had this, and the
 *  build plan needed it too: a developer who reaches "which Solution does this
 *  land in?" and finds the answer is "one nobody has made yet" should not have
 *  to leave the work item to make it. Two copies of the form would have been
 *  two answers to "which types are there" — and they already were, because the
 *  build plan's cut-down version offered `service`, `library` and `other`,
 *  none of which the backend recognises, while missing `database`.
 *
 *  **The command is shown before it runs.** A starter writes a folder full of
 *  files, so nothing is run that could not be read first — the button press is
 *  the confirmation. */
export default function NewSolutionForm({
  productId,
  products,
  onProductChange,
  askBrief = false,
  onCreated,
  onCancel,
}: {
  productId: number;
  /** When given, the form asks which Product. Develop's card creates for any
   *  of them; a form opened inside a work item already knows. */
  products?: Product[];
  onProductChange?: (id: number) => void;
  /** The four solution-spec questions. Off where a Solution is being made in
   *  the middle of another task — the brief is answered on the Solution's own
   *  card, and four prose boxes between somebody and their work item is how a
   *  shortcut becomes a detour. */
  askBrief?: boolean;
  /** The new Solution's id. Fired once, after the row exists — whether or not
   *  the starter then worked. */
  onCreated: (solutionId: number) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState("");
  const [solutionType, setSolutionType] = useState<string>("application");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [starters, setStarters] = useState<Starter[]>([]);
  const [starterId, setStarterId] = useState("");
  /// Editable before it runs, so the button press is the confirmation.
  const [command, setCommand] = useState("");
  /// The name for "something else" — recorded as the Solution's language, so a
  /// year later it says "Elixir" rather than "custom".
  const [customLanguage, setCustomLanguage] = useState("");
  const [parentDir, setParentDir] = useState("");
  const [run, setRun] = useState<StarterRun | null>(null);
  /// Kept so a failed starter can be retried against the Solution that was
  /// created anyway — the decision is worth more than the folder.
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setStarters(await listStarters());
      } catch {
        // Starters are an offer, not a requirement: a Solution can still be
        // created without one, so a failure here must not block the form.
      }
    })();
  }, []);

  function chooseStarter(id: string) {
    setStarterId(id);
    setCommand(starters.find((s) => s.id === id)?.command ?? "");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim() === "") return;
    setBusy(true);
    setRun(null);
    // The picked language is the answer to the language question, so it is
    // stored with the other answers rather than only as a starter id — the
    // brief that reaches the AI reads "Rust (cargo)", not "rust".
    const language =
      starterId === "custom"
        ? customLanguage.trim()
        : (starters.find((s) => s.id === starterId)?.label ?? "");
    try {
      const created = await createSolutionWithStarter({
        name: name.trim(),
        productId,
        solutionType,
        answers: JSON.stringify({ ...answers, language }),
        starterId: starterId || null,
        command: command || null,
        parentDir: parentDir || null,
        languageName: starterId === "custom" ? customLanguage.trim() : null,
      });
      // Kept whether it worked or not: when a generator fails, its own words
      // are the only thing that says which toolchain is missing.
      setRun(created.started);
      setCreatedId(created.solutionId);
      setError(null);
      setName("");
      setAnswers({});
      onCreated(created.solutionId);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const chosen = starters.find((s) => s.id === starterId);

  return (
    <div className="new-solution">
      {error && <p role="alert">{error}</p>}

      <form onSubmit={submit} aria-label="New Solution">
        <label>
          Name
          <input
            aria-label="Solution name"
            placeholder="Solution name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        {products !== undefined && (
          <label>
            Product
            <select
              aria-label="Product"
              value={productId}
              onChange={(e) => onProductChange?.(Number(e.target.value))}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* Every type the backend knows, and only those. What a Solution's
            type is decides what work can be recorded against it, so a type
            offered here that the backend has never heard of produces a
            Solution nothing can plan for. */}
        <label>
          Type
          <select
            aria-label="Solution type"
            value={solutionType}
            onChange={(e) => setSolutionType(e.target.value)}
          >
            {SOLUTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        {/* The language question *is* the starter picker. Asking it twice —
            once as prose and once as a dropdown — invites two different
            answers, and the one the generator uses would not be the one
            anybody read. */}
        <label>
          {SOLUTION_QUESTIONS.find((q) => q.id === "language")?.label ?? "Language"}
          <select
            aria-label="Starter language"
            value={starterId}
            onChange={(e) => chooseStarter(e.target.value)}
          >
            <option value="">Not sure yet / already have the code</option>
            {starters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        {askBrief &&
          SOLUTION_QUESTIONS.filter((q) => q.id !== "language").map((q) => (
            <label key={q.id}>
              {q.label}
              <textarea
                value={answers[q.id] ?? ""}
                onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
              />
            </label>
          ))}

        {starterId !== "" && (
          <div className="starter-detail">
            <p className="hint">Needs {chosen?.needs}.</p>
            {/* "Something else" has no name and no command of its own, so both
                are asked for. Without the name the Solution would be recorded
                as having been started in "custom", which tells nobody anything
                a year later. */}
            {starterId === "custom" && (
              <label>
                Language name
                <input
                  aria-label="Language name"
                  value={customLanguage}
                  placeholder="Elixir, Kotlin, Zig…"
                  onChange={(e) => setCustomLanguage(e.target.value)}
                />
              </label>
            )}
            <label>
              Command to run
              <input
                aria-label="Starter command"
                value={command}
                placeholder="the command that creates the project"
                onChange={(e) => setCommand(e.target.value)}
              />
            </label>
            <p className="hint">
              This runs in a new folder named after the Solution. It is shown
              here so you can read it before pressing Create — and it is only
              ever run in an empty folder.
            </p>
            <label>
              Create it in
              <input
                aria-label="Folder to create the project in"
                value={parentDir}
                placeholder="where the new project folder goes"
                onChange={(e) => setParentDir(e.target.value)}
              />
            </label>
            <button
              type="button"
              onClick={async () => {
                const picked = await pickFolder();
                if (picked) setParentDir(picked);
              }}
            >
              Choose folder…
            </button>
          </div>
        )}

        <div className="new-solution-actions">
          <button type="submit" disabled={busy || name.trim() === ""}>
            {busy
              ? "Working…"
              : starterId === ""
                ? "Create Solution"
                : "Create Solution and start it"}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {/* The generator's own words, kept whether it worked or not. */}
      {run && (
        <div className={run.succeeded ? "starter-run pass" : "starter-run fail"} role="status">
          <p>
            {run.succeeded
              ? `Started in ${run.directory}.`
              : "The starter did not finish. The Solution was still created — the folder can be pointed at or retried."}
          </p>
          <code>{run.command}</code>
          <pre>{run.output}</pre>
          {/* A failed starter used to be a dead end: the only ways out were
              pointing the Solution at a folder by hand or deleting and
              recreating it, which meant retyping the answers just to find out
              whether a toolchain had been installed since. */}
          {!run.succeeded && createdId !== null && (
            <button
              type="button"
              onClick={async () => {
                try {
                  setRun(
                    await startExistingSolution({
                      solutionId: createdId,
                      starterId,
                      command: command || null,
                      parentDir,
                    }),
                  );
                  setError(null);
                  onCreated(createdId);
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              Try the starter again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
