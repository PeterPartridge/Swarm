import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createTestCase,
  deleteTestCase,
  listDeliverables,
  listTestCases,
  listWorkItems,
  updateTestCase,
  TYPE_LABELS,
  type Deliverable,
  type TestCase,
  type WorkItem,
} from "../lib/backend";

/** The Test area's test cases: plain-English scenarios QA designs, each
 *  optionally associated with a Deliverable or a Work Item, and markable as
 *  implemented with the path of the real test. */
export default function TestCases({ productId }: { productId: number }) {
  const [cases, setCases] = useState<TestCase[]>([]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [scenario, setScenario] = useState("");
  // "" | "d:<id>" | "w:<id>" — one association picker over both kinds
  const [link, setLink] = useState("");

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
    const { deliverableId, workItemId } = parseLink(link);
    // Optimistic: the new case shows immediately, then reconciles with the DB.
    const temp: TestCase = {
      id: -Date.now(),
      productId,
      title: title.trim(),
      scenario,
      state: "designed",
      testPath: null,
      deliverableId,
      workItemId,
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
        workItemId,
      });
      await refresh();
    } catch (err) {
      setCases((cur) => cur.filter((c) => c.id !== temp.id)); // roll back
      setError(String(err));
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
          {cases.map((c) => (
            <li key={c.id} className={`test-case state-${c.state}`} aria-label={c.title}>
              <div className="test-case-head">
                <strong>{c.title}</strong>
                <span className="test-state">{c.state}</span>
              </div>
              {c.scenario && <p className="test-scenario">{c.scenario}</p>}
              <span className="test-link">{linkLabel(c)}</span>

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
                <button aria-label={`Delete test case ${c.title}`} onClick={() => onDelete(c)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
