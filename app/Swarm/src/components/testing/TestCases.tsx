import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  setTestCaseRegression,
  createTestCase,
  deleteTestCase,
  implementTestCase,
  runTestCase,
  type TestRunResult,
  listDeliverables,
  listTestCases,
  listWorkItems,
  updateTestCase,
  TYPE_LABELS,
  type Blocked,
  type Deliverable,
  type TestCase,
  type WorkItem,
} from "../../lib/backend";
import BlockedNote from "../ai/BlockedNote";
import RunOutcome from "./RunOutcome";

/** The Test area's test cases: plain-English scenarios QA designs, each
 *  optionally associated with a Deliverable or a Work Item, and markable as
 *  implemented with the path of the real test. */
export default function TestCases({
  productId,
  workItemId,
}: {
  productId: number;
  /** Show only the scenarios linked to this work item, and link new ones to it.
   *
   *  **The same component, scoped.** QA looks at one work item at a time, and
   *  the whole Product's scenarios on that screen would be everybody else's
   *  tests as well — but a second component for "the same list, filtered" is
   *  two places to fix a bug in how a scenario is run. */
  workItemId?: number;
}) {
  const [cases, setCases] = useState<TestCase[]>([]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [scenario, setScenario] = useState("");
  // "" | "d:<id>" | "w:<id>" — one association picker over both kinds
  const [link, setLink] = useState("");
  /** Which case is being implemented, so only its button shows the wait. */
  const [implementing, setImplementing] = useState<number | null>(null);
  /** Per-case outcome of the last implement press: where the test landed, or
   *  the question the AI asked instead. Keyed by case id so two scenarios do
   *  not overwrite each other's answer. */
  const [outcomes, setOutcomes] = useState<
    Record<number, { path?: string; blocked?: Blocked }>
  >({});
  /** Which case is being run, and the fresh result per case. A fresh result
   *  replaces the stored one on screen because it carries the runner output
   *  and the command, which are returned but never stored. */
  const [runningTest, setRunningTest] = useState<number | null>(null);
  const [runs, setRuns] = useState<Record<number, TestRunResult>>({});

  const refresh = useCallback(async () => {
    try {
      const [loadedCases, loadedDeliverables, loadedItems] = await Promise.all([
        listTestCases(productId),
        listDeliverables(productId),
        listWorkItems(productId),
      ]);
      setCases(loadedCases);
      setDeliverables(loadedDeliverables);
      setItems(loadedItems);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function parseLink(value: string): {
    deliverableId: number | null;
    workItemId: number | null;
  } {
    if (value.startsWith("d:")) {
      return { deliverableId: Number(value.slice(2)), workItemId: null };
    }
    if (value.startsWith("w:")) {
      return { deliverableId: null, workItemId: Number(value.slice(2)) };
    }
    return { deliverableId: null, workItemId: null };
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    // On a work item's own screen the association is not a question: a scenario
    // added there is about that item, so the picker's answer is not consulted.
    const parsed = parseLink(link);
    const deliverableId = workItemId === undefined ? parsed.deliverableId : null;
    const linkedItem = workItemId ?? parsed.workItemId;
    // Optimistic: the new case shows immediately, then reconciles with the DB.
    const temp: TestCase = {
      id: -Date.now(),
      productId,
      title: title.trim(),
      scenario,
      state: "designed",
      testPath: null,
      deliverableId,
      workItemId: linkedItem,
      testNames: [],
      lastRunAt: null,
      lastRunOutcome: null,
      lastRunSummary: null,
      regression: false,
    };
    setCases((cur) => [...cur, temp]);
    setTitle("");
    setScenario("");
    setLink("");
    try {
      await createTestCase({
        productId,
        title: temp.title,
        scenario: temp.scenario,
        deliverableId,
        workItemId: linkedItem,
      });
      await refresh();
    } catch (err) {
      setCases((cur) => cur.filter((c) => c.id !== temp.id)); // roll back
      setError(String(err));
    }
  }

  /// Its own call rather than part of `commit`: putting a scenario in the suite
  /// is a decision about what the test is *for*, and routing it through the
  /// general update would restate a title and scenario nobody changed.
  async function toggleRegression(testCase: TestCase, regression: boolean) {
    setCases((cur) =>
      cur.map((c) => (c.id === testCase.id ? { ...c, regression } : c)),
    );
    try {
      await setTestCaseRegression(testCase.id, regression);
      setError(null);
    } catch (err) {
      setError(String(err));
      await refresh();
    }
  }

  async function commit(testCase: TestCase, changes: Partial<TestCase>) {
    const next = { ...testCase, ...changes };
    setCases((cur) => cur.map((c) => (c.id === next.id ? next : c)));
    try {
      await updateTestCase({
        id: next.id,
        title: next.title,
        scenario: next.scenario,
        state: next.state,
        testPath: next.testPath,
        deliverableId: next.deliverableId,
        workItemId: next.workItemId,
      });
      setError(null);
    } catch (err) {
      setError(String(err));
      await refresh();
    }
  }

  /** Asks the AI to write the test. The backend owns every gate — this only
   *  decides whether pressing is worth offering at all. */
  async function onImplement(testCase: TestCase) {
    setImplementing(testCase.id);
    try {
      const result = await implementTestCase(testCase.id);
      setOutcomes((cur) => ({
        ...cur,
        [testCase.id]: result.blocked
          ? { blocked: result.blocked }
          : { path: result.testPath },
      }));
      setError(null);
      // The state and path come back from the reload, not from assuming the
      // write happened the way we hoped it did.
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setImplementing(null);
    }
  }

  /** Runs the test written for this scenario. A failure is a result, not an
   *  error — so it lands in `runs`, never in `error`. */
  async function onRun(testCase: TestCase) {
    setRunningTest(testCase.id);
    try {
      const result = await runTestCase(testCase.id);
      setRuns((cur) => ({ ...cur, [testCase.id]: result }));
      setError(null);
      // The stored outcome comes back with the reload; the fresh one above is
      // what stays on screen, because it also has the output and the command.
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setRunningTest(null);
    }
  }

  async function onDelete(testCase: TestCase) {
    try {
      await deleteTestCase(testCase.id);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  const linkLabel = (testCase: TestCase) => {
    if (testCase.deliverableId !== null) {
      const d = deliverables.find((x) => x.id === testCase.deliverableId);
      return `Deliverable: ${d?.name ?? "(unknown)"}`;
    }
    if (testCase.workItemId !== null) {
      const w = items.find((x) => x.id === testCase.workItemId);
      return w
        ? `${TYPE_LABELS[w.itemType] ?? w.itemType}: ${w.title}`
        : "Work item: (unknown)";
    }
    return "Not associated";
  };

  const linkValue = (testCase: TestCase) =>
    testCase.deliverableId !== null
      ? `d:${testCase.deliverableId}`
      : testCase.workItemId !== null
        ? `w:${testCase.workItemId}`
        : "";

  /** The shared association options: deliverables first, then work items. */
  const linkOptions = (
    <>
      <option value="">Not associated</option>
      {deliverables.map((d) => (
        <option key={`d${d.id}`} value={`d:${d.id}`}>
          Deliverable: {d.name}
        </option>
      ))}
      {items.map((w) => (
        <option key={`w${w.id}`} value={`w:${w.id}`}>
          {TYPE_LABELS[w.itemType] ?? w.itemType}: {w.title}
        </option>
      ))}
    </>
  );

  return (
    <section className="test-cases" aria-label="Test cases">
      <h2>Test Cases</h2>
      {error && <p role="alert">{error}</p>}

      <form onSubmit={onAdd} aria-label="New test case">
        <input
          aria-label="Test title"
          placeholder="What is being tested?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          aria-label="Test scenario"
          placeholder="Given… when… then… (plain English is fine)"
          value={scenario}
          onChange={(e) => setScenario(e.target.value)}
        />
        <label>
          Associated with
          <select
            aria-label="Associated with"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          >
            {linkOptions}
          </select>
        </label>
        <button type="submit">Add test case</button>
      </form>

      {cases.length === 0 ? (
        <p>No test cases yet — add the first scenario above.</p>
      ) : (
        <ul className="test-case-list">
          {cases
            .filter((c) => workItemId === undefined || c.workItemId === workItemId)
            .map((c) => (
            <li key={c.id} className={`test-case state-${c.state}`} aria-label={c.title}>
              <div className="test-case-head">
                <strong>{c.title}</strong>
                <span className="test-state">{c.state}</span>
              </div>
              {c.scenario && <p className="test-scenario">{c.scenario}</p>}
              <span className="test-link">{linkLabel(c)}</span>

              {/* **The regression suite is a decision, so it is a press.** The
                  same spec can be a one-off check this week and the thing
                  guarding checkout for two years; nothing about the test can
                  tell those apart, so somebody says which. */}
              <label className="test-regression">
                <input
                  type="checkbox"
                  aria-label={`Regression suite: ${c.title}`}
                  checked={c.regression}
                  onChange={(e) => void toggleRegression(c, e.target.checked)}
                />
                In the regression suite
              </label>

              {/* Captions are spans, not <label>s: each control's accessible
                  name is its aria-label, which carries the case title so the
                  same control on different cases stays distinguishable. */}
              <div className="test-case-controls">
                <div className="field">
                  <span>Associated with</span>
                  <select
                    aria-label={`Associated with for ${c.title}`}
                    value={linkValue(c)}
                    onChange={(e) => commit(c, parseLink(e.target.value))}
                  >
                    {linkOptions}
                  </select>
                </div>
                <div className="field">
                  <span>State</span>
                  <select
                    aria-label={`State for ${c.title}`}
                    value={c.state}
                    onChange={(e) => commit(c, { state: e.target.value })}
                  >
                    <option value="designed">designed</option>
                    <option value="implemented">implemented</option>
                  </select>
                </div>
                {c.state === "implemented" && (
                  <div className="field">
                    <span>Test file</span>
                    <input
                      aria-label={`Test file for ${c.title}`}
                      placeholder="src/__tests__/login.test.ts"
                      defaultValue={c.testPath ?? ""}
                      onBlur={(e) =>
                        commit(c, { testPath: e.target.value.trim() || null })
                      }
                    />
                  </div>
                )}
                {c.state === "designed" && (
                  <>
                    {/* Disabled with a reason rather than hidden: a control
                        that vanishes teaches nobody why. The AI policy belongs
                        to a work item, so a case linked to a Deliverable — or
                        to nothing — has none to ask. */}
                    <button
                      aria-label={`Implement ${c.title} with AI`}
                      aria-describedby={
                        c.workItemId === null ? `why-not-${c.id}` : undefined
                      }
                      disabled={c.workItemId === null || implementing !== null}
                      onClick={() => onImplement(c)}
                    >
                      {implementing === c.id ? "Writing the test…" : "Implement with AI"}
                    </button>
                    {c.workItemId === null && (
                      <span id={`why-not-${c.id}`} className="hint">
                        Associate this with a work item first — the AI policy
                        that allows generating tests belongs to the work item.
                      </span>
                    )}
                  </>
                )}
                {c.state === "implemented" && (
                  <button
                    aria-label={`Run the test for ${c.title}`}
                    disabled={runningTest !== null}
                    onClick={() => onRun(c)}
                  >
                    {runningTest === c.id ? "Running…" : "Run"}
                  </button>
                )}
                <button aria-label={`Delete test case ${c.title}`} onClick={() => onDelete(c)}>
                  Delete
                </button>
              </div>

              {/* The run just finished, or — until one is — the last recorded
                  one. A fresh result wins because it carries the output. */}
              {runs[c.id] ? (
                <RunOutcome
                  outcome={runs[c.id].outcome}
                  summary={runs[c.id].summary}
                  aboutThisTest={runs[c.id].aboutThisTest}
                  commandLine={runs[c.id].commandLine}
                  output={runs[c.id].output}
                />
              ) : (
                c.lastRunOutcome && (
                  <RunOutcome
                    outcome={c.lastRunOutcome}
                    summary={c.lastRunSummary ?? ""}
                    when={c.lastRunAt}
                  />
                )
              )}

              {outcomes[c.id]?.path && (
                <p className="test-written">
                  Written to <code>{outcomes[c.id].path}</code>
                </p>
              )}
              {outcomes[c.id]?.blocked && (
                <BlockedNote
                  blocked={outcomes[c.id].blocked!}
                  what="writing a test that asserts nothing"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
