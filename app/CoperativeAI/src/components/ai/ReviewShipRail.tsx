import { useState } from "react";
import type { ChangeReview, FileChange, Run, Solution } from "../../lib/backend";

/** One line of the ship checklist. */
interface Check {
  label: string;
  /** True when it has been met, false when it has not, null when nothing has
   *  been run yet — the three are different answers and the rail says which. */
  met: boolean | null;
  meta: string;
}

/** Whether the tests were run here, and what they said. Null means nobody has
 *  pressed Run in this session, which is not the same as failing. */
export type TestVerdict = { passed: number; failed: number; counted: boolean } | null;

/** Review and ship, down the right of the Build view.
 *
 *  **The checks are derived, never ticked.** The design this came from had four
 *  checkboxes a person clicked themselves, which would make the ring a record of
 *  what somebody claimed rather than what happened. Every line here is read back
 *  from the change review, the test run and the run's own settled state — so an
 *  amber ring means work outstanding, not an unticked box.
 *
 *  **There is no commit button.** The app hands over a command and records the
 *  decision; it does not run git on your behalf. Keep and Discard write that
 *  decision against the run, which is the thing this app can actually do. */
export default function ReviewShipRail({
  agentLabel,
  run,
  solution,
  review,
  reviewing,
  onReview,
  onSettle,
  settled,
  tests,
  selectedPath,
  selectedChange,
}: {
  /** Names whose work is being shipped, for the region label. */
  agentLabel: string;
  run: Run | null;
  solution: Solution | null;
  review: ChangeReview | null;
  reviewing: boolean;
  onReview: () => void;
  onSettle: (state: "kept" | "discarded") => void;
  /** What has already been recorded against this run, if anything. */
  settled: "kept" | "discarded" | null;
  tests: TestVerdict;
  /** The file open in the tree, for the Inspect tab. */
  selectedPath: string | null;
  selectedChange: FileChange | null;
}) {
  const [tab, setTab] = useState<"ship" | "inspect">("ship");

  const report = review?.report ?? null;
  const violations = report?.violations ?? [];
  const alreadySettled =
    settled ?? (run?.state === "kept" || run?.state === "discarded" ? run.state : null);

  const checks: Check[] = [
    {
      label: "Changes read",
      met: review === null ? null : true,
      meta: report ? `${report.filesChanged} files` : "not run",
    },
    {
      label: "Rules pass",
      // No rules is not a pass. Silence for want of rules reads exactly like
      // silence for want of problems, so it stays unmet and says why.
      met: review === null ? null : review.noRules ? null : violations.length === 0,
      meta: review === null ? "not run" : review.noRules ? "no rules set" : `${violations.length} broken`,
    },
    {
      label: "Tests pass",
      met: tests === null ? null : tests.failed === 0,
      meta:
        tests === null
          ? "not run"
          : tests.counted
            ? `${tests.passed} passed · ${tests.failed} failed`
            : "read from exit code",
    },
    {
      label: "Decision recorded",
      met: alreadySettled === null ? null : true,
      meta: alreadySettled ?? "not yet",
    },
  ];

  const done = checks.filter((c) => c.met === true).length;
  const ready = done === checks.length;
  const total = Math.max(1, (report?.addedLines ?? 0) + (report?.removedLines ?? 0));

  return (
    <aside className="ship-rail" aria-label={`Review and ship ${agentLabel}`}>
      <div className="ship-tabs" role="tablist" aria-label="Rail panels">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "ship"}
          className={tab === "ship" ? "ship-tab on" : "ship-tab"}
          onClick={() => setTab("ship")}
        >
          Review &amp; ship
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "inspect"}
          className={tab === "inspect" ? "ship-tab on" : "ship-tab"}
          onClick={() => setTab("inspect")}
        >
          Inspect
        </button>
      </div>

      {tab === "ship" && (
        <div className="ship-body">
          <div className="ship-progress">
            <div
              className={`ship-ring ${ready ? "ring-ready" : ""}`}
              style={
                {
                  "--ring-pct": `${(done / checks.length) * 100}%`,
                } as React.CSSProperties
              }
            >
              <span className="ring-inner">
                <strong>{done}</strong>
                <span>of {checks.length}</span>
              </span>
            </div>
            <div className="ship-progress-text">
              <strong className={ready ? "ok" : undefined}>
                {ready ? "Clear to ship" : review === null ? "Nothing read yet" : "Review in progress"}
              </strong>
              <p className="hint">
                {ready
                  ? "Rules pass, tests are green, and the decision is on the record."
                  : "Every line below is read back from the run — none of it is ticked by hand."}
              </p>
            </div>
          </div>

          <ul className="ship-checks">
            {checks.map((c) => (
              <li
                key={c.label}
                className={c.met === true ? "check met" : c.met === false ? "check unmet" : "check unknown"}
              >
                <span className="check-box" aria-hidden="true">
                  {c.met === true ? "✓" : c.met === false ? "✕" : "·"}
                </span>
                <span className="check-label">{c.label}</span>
                <span className="check-meta">{c.meta}</span>
              </li>
            ))}
          </ul>

          <div className="ship-card">
            <div className="ship-card-head">
              <span>Diff summary</span>
              <span className="card-mono">
                {report ? `${report.filesChanged} files` : "—"}
              </span>
            </div>
            <div className="diff-bar" aria-hidden="true">
              <span
                className="diff-add"
                style={{ width: `${((report?.addedLines ?? 0) / total) * 100}%` }}
              />
              <span
                className="diff-del"
                style={{ width: `${((report?.removedLines ?? 0) / total) * 100}%` }}
              />
            </div>
            <div className="diff-counts">
              <span className="ok">+{report?.addedLines ?? 0} added</span>
              <span className="bad">−{report?.removedLines ?? 0} removed</span>
            </div>
            <button type="button" onClick={onReview} disabled={reviewing || solution === null}>
              {reviewing ? "Reading…" : review === null ? "Review what changed" : "Read it again"}
            </button>
          </div>

          {violations.length > 0 && (
            <div className="ship-blocker" role="status">
              <strong>
                {violations.length} rule{violations.length === 1 ? "" : "s"} broken
              </strong>
              <ul>
                {violations.map((v, i) => (
                  <li key={`${v.path}-${i}`}>
                    {v.path !== "" && <code>{v.path}</code>} {v.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {review?.noRules && report && report.filesChanged > 0 && (
            <p className="hint" role="status">
              This Product has no Developer Rules, so nothing was checked against
              them. Set them in Admin.
            </p>
          )}

          <div className="ship-card">
            <div className="ship-card-head">
              <span>Where it lands</span>
            </div>
            <p className="ship-branch">
              <span className="card-mono hue">{run?.branch || "no branch"}</span>
              <span aria-hidden="true">→</span>
              <span className="card-mono">{solution?.name ?? "no Solution"}</span>
            </p>
            <p className="hint">
              The app records your decision against the handover. Files stay as
              they are — use Git to actually merge or revert.
            </p>
          </div>

          {/* Never gated on the checks: keeping a change over a broken rule is
              a decision somebody is allowed to make, and it is recorded as
              exactly that rather than laundered into a clean pass. */}
          {review?.runId != null && report && report.filesChanged > 0 && (
            <div className="ship-actions">
              {alreadySettled === null ? (
                <>
                  <button
                    type="button"
                    className="ship-keep"
                    aria-label={`Keep the changes in ${solution?.name ?? "this Solution"}`}
                    onClick={() => onSettle("kept")}
                  >
                    Keep these changes
                  </button>
                  <button
                    type="button"
                    aria-label={`Discard the changes in ${solution?.name ?? "this Solution"}`}
                    onClick={() => onSettle("discarded")}
                  >
                    Discard
                  </button>
                </>
              ) : (
                <p role="status">
                  Recorded as {alreadySettled}
                  {alreadySettled === "kept" && violations.length > 0
                    ? " — with the broken rules above on the record"
                    : ""}
                  .
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "inspect" && (
        <div className="ship-body">
          {selectedPath === null ? (
            <p className="hint">Pick a file in the tree to see what is known about it.</p>
          ) : (
            <>
              <div className="ship-card">
                <strong className="inspect-name">{selectedPath.split("/").pop()}</strong>
                <p className="card-mono inspect-path">{selectedPath}</p>
                <div className="inspect-chips">
                  <span className="chip">{solution?.name ?? "—"}</span>
                  <span className={`chip ${selectedChange ? selectedChange.status : "unchanged"}`}>
                    {selectedChange ? selectedChange.status : "unchanged"}
                  </span>
                </div>
              </div>

              <div className="ship-card">
                <div className="ship-card-head">
                  <span>Working copy</span>
                </div>
                <dl className="inspect-rows">
                  <div>
                    <dt>Status</dt>
                    <dd>{selectedChange ? selectedChange.status : "unchanged"}</dd>
                  </div>
                  <div>
                    <dt>Lines added</dt>
                    <dd className="ok">{selectedChange ? `+${selectedChange.addedLines}` : "—"}</dd>
                  </div>
                  <div>
                    <dt>Lines removed</dt>
                    <dd className="bad">
                      {selectedChange ? `−${selectedChange.removedLines}` : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Solution</dt>
                    <dd>{solution?.name ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Folder</dt>
                    <dd className="card-mono">{solution?.localPath ?? "not set"}</dd>
                  </div>
                </dl>
              </div>

              {/* Deliberately no size, coverage or owner: the app does not read
                  any of the three, and inventing them here would put four
                  confident numbers on screen that nothing stands behind. */}
              <p className="hint">
                Only what the working copy and git can answer. Size, coverage and
                ownership are not things this app reads.
              </p>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
