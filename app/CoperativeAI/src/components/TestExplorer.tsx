import { useCallback, useEffect, useState } from "react";
import {
  listTestSuites,
  runSolutionTests,
  setSolutionTestCommand,
  TEST_KIND_LABELS,
  type SolutionSuites,
  type SuiteRun,
} from "../lib/backend";

/** Every Solution's unit tests, in one place, whatever they are written in.
 *
 *  **Counts appear only when they were read.** A run whose output no parser
 *  recognised reports pass or fail from the exit code and shows the raw output
 *  instead of numbers — an invented test count would be worse than none, the
 *  same rule that keeps unknown AI spend off the screen.
 *
 *  Solutions are run one at a time rather than all at once, so results appear
 *  as each finishes instead of after the slowest one in the Product. */
export default function TestExplorer({ productId }: { productId: number }) {
  const [groups, setGroups] = useState<SolutionSuites[]>([]);
  const [runs, setRuns] = useState<Record<number, SuiteRun[]>>({});
  const [running, setRunning] = useState<number | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [commandDraft, setCommandDraft] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setGroups(await listTestSuites(productId));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runOne(solutionId: number) {
    setRunning(solutionId);
    setError(null);
    try {
      const results = await runSolutionTests(solutionId);
      setRuns((prev) => ({ ...prev, [solutionId]: results }));
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(null);
    }
  }

  /** Sequential on purpose: several test runners at once compete for the same
   *  cores and disk, and the wall-clock total is no better for it. */
  async function runAll() {
    setRunning("all");
    setError(null);
    for (const group of groups) {
      if (group.unavailable) continue;
      try {
        const results = await runSolutionTests(group.solutionId);
        setRuns((prev) => ({ ...prev, [group.solutionId]: results }));
      } catch (e) {
        setError(String(e));
      }
    }
    setRunning(null);
  }

  async function saveCommand(solutionId: number) {
    try {
      await setSolutionTestCommand(solutionId, commandDraft.trim() || null);
      setEditing(null);
      setCommandDraft("");
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  const totals = Object.values(runs)
    .flat()
    .reduce(
      (acc, r) => ({
        passed: acc.passed + (r.counted ? r.passed : 0),
        failed: acc.failed + (r.counted ? r.failed : 0),
        counted: acc.counted + (r.counted ? 1 : 0),
        uncounted: acc.uncounted + (r.counted ? 0 : 1),
        suites: acc.suites + 1,
        red: acc.red + (r.exitOk ? 0 : 1),
      }),
      { passed: 0, failed: 0, counted: 0, uncounted: 0, suites: 0, red: 0 },
    );

  return (
    <section className="develop-card" aria-label="Unit tests">
      <h2>Unit tests</h2>
      <p className="hint">
        Every Solution's tests, in whatever language they are written. A
        Solution with more than one suite — a web front end and a Rust core, say
        — shows both, because running only the first would report half a
        Solution as green.
      </p>

      {error && <p role="alert">{error}</p>}

      <div className="test-actions">
        <button onClick={runAll} disabled={running !== null || groups.length === 0}>
          {running === "all" ? "Running…" : "Run all Solutions"}
        </button>
        {totals.suites > 0 && (
          /* Worded differently from a suite's own line on purpose — two
             identical-looking counts, one a total and one not, is how someone
             misreads a run. The counted part is omitted entirely when nothing
             was counted, rather than claiming a truthful-looking "0 passed". */
          <span className={totals.red > 0 ? "test-total fail" : "test-total pass"}>
            {totals.counted > 0 &&
              `${totals.passed} passing and ${totals.failed} failing`}
            {totals.counted > 0 && totals.uncounted > 0 && ", "}
            {totals.uncounted > 0 &&
              `${totals.uncounted} known only by exit code`}
            {` — across ${totals.suites} suite${totals.suites === 1 ? "" : "s"}`}
          </span>
        )}
      </div>

      {groups.length === 0 && <p>No Solutions in this Product yet.</p>}

      <ul className="test-solutions">
        {groups.map((group) => {
          const results = runs[group.solutionId] ?? [];
          return (
            <li key={group.solutionId} className="test-solution">
              <div className="test-solution-head">
                <strong>{group.name}</strong>
                {group.customCommand && (
                  <span className="test-custom">own command</span>
                )}
                <button
                  aria-label={`Run tests for ${group.name}`}
                  disabled={running !== null || !!group.unavailable}
                  onClick={() => runOne(group.solutionId)}
                >
                  {running === group.solutionId ? "Running…" : "Run"}
                </button>
                <button
                  aria-label={`Set test command for ${group.name}`}
                  onClick={() => {
                    setEditing(group.solutionId);
                    setCommandDraft(group.customCommand ?? "");
                  }}
                >
                  Test command
                </button>
              </div>

              {group.unavailable && <p className="hint">{group.unavailable}</p>}

              {editing === group.solutionId && (
                <div className="test-command-editor">
                  <label>
                    Command to run this Solution's tests
                    <input
                      aria-label={`Test command for ${group.name}`}
                      value={commandDraft}
                      placeholder="e.g. mix test, gradle test, make check"
                      onChange={(e) => setCommandDraft(e.target.value)}
                    />
                  </label>
                  <p className="hint">
                    This replaces detection entirely. Leave it empty to go back
                    to working it out.
                  </p>
                  <button onClick={() => saveCommand(group.solutionId)}>Save</button>
                  <button onClick={() => setEditing(null)}>Cancel</button>
                </div>
              )}

              {group.suites.length > 0 && results.length === 0 && (
                <ul className="test-suites">
                  {group.suites.map((s) => (
                    <li key={`${s.directory}-${s.kind}`}>
                      <span className="test-kind">
                        {TEST_KIND_LABELS[s.kind] ?? s.kind}
                      </span>{" "}
                      <code>{s.commandLine}</code>{" "}
                      <span className="hint">
                        in {s.directory === "." ? "the Solution root" : s.directory} —
                        found by {s.foundBy}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {results.map((run) => {
                const key = `${group.solutionId}-${run.suite.directory}-${run.suite.kind}`;
                return (
                  <div
                    key={key}
                    className={`test-run ${run.exitOk ? "pass" : "fail"}`}
                  >
                    <div className="test-run-head">
                      <span className="test-kind">
                        {TEST_KIND_LABELS[run.suite.kind] ?? run.suite.kind}
                      </span>
                      {run.suite.directory !== "." && (
                        <span className="hint"> {run.suite.directory}</span>
                      )}
                      {run.counted ? (
                        <span className="test-counts">
                          {run.passed} passed, {run.failed} failed
                          {run.skipped > 0 && `, ${run.skipped} skipped`}
                        </span>
                      ) : (
                        /* The honesty rule made visible: nothing was read from
                           the output, so no numbers are shown. */
                        <span className="test-counts uncounted">
                          {run.exitOk ? "passed" : "failed"} — no test count could
                          be read from the output
                        </span>
                      )}
                      <span className="hint">{(run.durationMs / 1000).toFixed(1)}s</span>
                      <button
                        aria-label={`Show output for ${group.name} ${run.suite.kind}`}
                        onClick={() => setExpanded(expanded === key ? null : key)}
                      >
                        {expanded === key ? "Hide output" : "Output"}
                      </button>
                    </div>

                    {run.tests.filter((t) => t.state === "failed").length > 0 && (
                      <ul className="test-failures">
                        {run.tests
                          .filter((t) => t.state === "failed")
                          .map((t) => (
                            <li key={t.name}>{t.name}</li>
                          ))}
                      </ul>
                    )}

                    {expanded === key && <pre className="test-output">{run.output}</pre>}
                  </div>
                );
              })}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
