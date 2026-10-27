import { useEffect, useState } from "react";
import {
  changeKinds,
  changeKindsForSolution,
  kindLocations,
  reviewSolutionChanges,
  setSolutionKindLocations,
  setSolutionPath,
  settleChangeRun,
  type ChangeKindInfo,
  type ChangeReview,
  type Solution,
} from "../../lib/backend";
import FolderField from "../common/FolderField";

/** Managing a Solution's working copy: where it is, and what has changed in it.
 *
 *  Editing lives on the Code tab, not here — one editor in one place. This
 *  panel points the Solution at a folder, opens it in the editor, and runs the
 *  change review, which is the part that earns its keep: a diff checked against
 *  the Developer Rules, so an agent's output is reviewed rather than merely
 *  accepted. */
/** Which side of a diff a line is on. The `+++`/`---` headers name the file
 *  rather than changing it, so they are neither. */
function diffLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "diff-header";
  if (line.startsWith("@@")) return "diff-hunk";
  if (line.startsWith("+")) return "diff-added";
  if (line.startsWith("-")) return "diff-removed";
  return "";
}

export default function SolutionBox({
  solution,
  onPathChanged,
  onOpenInEditor,
}: {
  solution: Solution;
  onPathChanged: () => void;
  /** Hands this Solution to the Code tab. */
  onOpenInEditor?: (solution: Solution) => void;
}) {
  const [review, setReview] = useState<ChangeReview | null>(null);
  const [settled, setSettled] = useState<"kept" | "discarded" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /// The kinds **this** Solution can hold — an API is not asked where its
  /// screens live. The rules editor used the global list and asked everybody
  /// about everything.
  const [kinds, setKinds] = useState<ChangeKindInfo[]>([]);

  const linked = solution.localPath !== null && solution.localPath !== "";

  useEffect(() => {
    // Two calls because they answer different halves: which kinds *this*
    // Solution can hold, and what each is called. The rest of the panel works
    // without them, so a failure here stays quiet.
    void Promise.all([changeKindsForSolution(solution.id), changeKinds()])
      .then(([mine, all]) => setKinds(all.filter((k) => mine.includes(k.id))))
      .catch(() => setKinds([]));
  }, [solution.id]);

  /// Records where one kind of thing lives in this working copy, or clears it.
  ///
  /// Blank is a real answer and stored as one: the difference between "they go
  /// in `src/pages`" and "nobody has said" is what decides whether the build
  /// plan scans for what is already there or admits it does not know.
  async function onSetLocation(kind: string, folder: string) {
    const map = kindLocations(solution.kindLocations);
    if (folder.trim() === "") delete map[kind];
    else map[kind] = folder.trim();
    try {
      await setSolutionKindLocations(solution.id, JSON.stringify(map));
      setError(null);
      onPathChanged();
    } catch (e) {
      setError(String(e));
    }
  }

  async function onReview() {
    setBusy(true);
    try {
      setReview(await reviewSolutionChanges(solution.id));
      setSettled(null);
      setError(null);
    } catch (e) {
      setReview(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onSettle(state: "kept" | "discarded") {
    if (!review?.runId) return;
    try {
      await settleChangeRun(review.runId, state);
      setSettled(state);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function onSetPath(path: string) {
    try {
      await setSolutionPath(solution.id, path === "" ? null : path);
      setError(null);
      onPathChanged();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    // No heading: whatever renders this already names the Solution, and
    // repeating it puts the same words on screen twice.
    <section className="solution-box" aria-label={`${solution.name} working copy`}>
      {error && <p role="alert">{error}</p>}

      <FolderField
        label="Working copy"
        value={solution.localPath ?? ""}
        onChange={onSetPath}
      />
      {!linked && (
        <p className="hint">
          A linked GitHub repository is not a checkout — point this at the
          folder on your machine to open it.
        </p>
      )}

      {/* **Where things live, on the Solution.** It sat in the Product's
          Developer Rules until 2026-08-21, which was wrong twice: a layout is a
          fact about one repository and a Product grows more of them, and it is
          Develop's decision rather than something the Product side sets. It is
          beside the working copy because every path here is relative to it —
          and it stays editable, because architecture moves as a product grows
          rather than being settled the day a Solution is made. */}
      {kinds.length > 0 && (
        <section className="rule-locations" aria-label="Where things live">
          <h4>Where things live</h4>
          <p className="hint">
            A folder inside this working copy, per kind of thing. Agents are
            told it, and the build plan reads the folder to suggest what is
            already there. Blank means nobody has said, and nothing is scanned.
          </p>
          <div className="rule-location-rows">
            {kinds.map((k) => (
              <label key={k.id} className="rule-location">
                <span>{k.heading}</span>
                <input
                  type="text"
                  aria-label={`Where ${k.heading} live in ${solution.name}`}
                  placeholder="not said"
                  defaultValue={kindLocations(solution.kindLocations)[k.id] ?? ""}
                  onBlur={(e) => void onSetLocation(k.id, e.target.value)}
                />
              </label>
            ))}
          </div>
        </section>
      )}

      {linked && onOpenInEditor && (
        <button
          aria-label={`Open ${solution.name} in the code editor`}
          onClick={() => onOpenInEditor(solution)}
        >
          Open
        </button>
      )}

      {linked && (
        <section className="change-review" aria-label={`Changes in ${solution.name}`}>
          <div className="review-head">
            <h4>Change review</h4>
            <button aria-label={`Review changes in ${solution.name}`} onClick={onReview} disabled={busy}>
              {busy ? "Reading…" : "Review what changed"}
            </button>
          </div>

          {review && (
            <>
              <p className="review-totals">
                {review.report.filesChanged === 0
                  ? "Nothing has changed in this working copy."
                  : `${review.report.filesChanged} file${
                      review.report.filesChanged === 1 ? "" : "s"
                    } changed · +${review.report.addedLines} −${review.report.removedLines}`}
              </p>

              {/* Silence for want of rules reads exactly like silence for want
                  of problems, so the difference is stated. */}
              {review.noRules && review.report.filesChanged > 0 && (
                <p className="hint" role="status">
                  This Product has no Developer Rules, so nothing was checked
                  against them. Set them in Admin.
                </p>
              )}

              {review.report.violations.length > 0 && (
                <ul className="review-violations" aria-label="Rules broken">
                  {review.report.violations.map((f, i) => (
                    <li key={`${f.path}-${i}`}>
                      <strong>{f.path}</strong> — {f.detail}
                    </li>
                  ))}
                </ul>
              )}
              {review.report.notices.length > 0 && (
                <ul className="review-notices" aria-label="Worth a look">
                  {review.report.notices.map((f, i) => (
                    <li key={`notice-${i}`}>{f.detail}</li>
                  ))}
                </ul>
              )}

              {/* Accept is never gated — the user chose that — but the
                  findings were recorded on the run before this button existed,
                  so keeping a change over a violation is on the record as
                  exactly that, not laundered into a clean pass. */}
              {review.runId !== null && review.report.filesChanged > 0 && (
                <div className="settle-run">
                  {settled === null ? (
                    <>
                      <button
                        aria-label={`Keep the changes in ${solution.name}`}
                        onClick={() => onSettle("kept")}
                      >
                        Keep
                      </button>
                      <button
                        aria-label={`Discard the changes in ${solution.name}`}
                        onClick={() => onSettle("discarded")}
                      >
                        Discard
                      </button>
                      <span className="hint">
                        Records your decision against the handover. Files stay
                        as they are — use git to actually revert.
                      </span>
                    </>
                  ) : (
                    <p role="status">
                      Recorded as {settled}
                      {settled === "kept" && review.report.violations.length > 0
                        ? " — with the broken rules above on the record"
                        : ""}
                      .
                    </p>
                  )}
                </div>
              )}

              {review.changes.length > 0 && (
                <ul className="change-list">
                  {review.changes.map((c) => (
                    <li key={c.path}>
                      <div className="change-head">
                        <span className={`change-status ${c.status}`}>{c.status}</span>
                        <strong>{c.path}</strong>
                        <span className="change-counts">
                          +{c.addedLines} −{c.removedLines}
                        </span>
                      </div>
                      {/* Coloured by line, not syntax-highlighted: what a
                          reviewer needs first is which lines arrived and which
                          left, and that is a per-line fact. */}
                      <pre className="change-diff">
                        {c.diff.split("\n").map((line, n) => (
                          <span key={n} className={diffLineClass(line)}>
                            {line}
                            {"\n"}
                          </span>
                        ))}
                      </pre>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}
    </section>
  );
}
