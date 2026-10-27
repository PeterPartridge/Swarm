/** How a test run reads, in plain English.
 *
 *  **The app must not grade this, and that is the whole point.** The project's
 *  own rule is "write a failing test, then just enough code to pass it" — so a
 *  test written for work that is not built yet *should* be red, and showing a
 *  red cross would call the framework working a failure.
 *
 *  Green is the ambiguous one. It means either the work is already done, or the
 *  test does not exercise it — the vacuous test the generation's escape hatch
 *  exists to avoid. Nothing can tell those apart automatically, so both are
 *  said and the person decides. */
export function readingOf(outcome: string, aboutThisTest: boolean): string {
  if (!aboutThisTest) {
    return "This is the whole suite's result — this scenario's own tests could not be picked out of it, so the verdict may be about somebody else's test.";
  }
  switch (outcome) {
    case "failed":
      return "Expected, if the work this tests has not been built yet — that is the failing test you write first.";
    case "passed":
      return "Either the work is already done, or the test does not exercise it. Read it before trusting it.";
    case "skipped":
      return "The test was skipped, so it proved nothing either way.";
    default:
      return "The runner could not be started, so nothing was proved. The output below says why.";
  }
}

/** One test run's verdict — the last recorded one, or the one just finished. */
export default function RunOutcome({
  outcome,
  summary,
  aboutThisTest = true,
  when,
  commandLine,
  output,
}: {
  outcome: string;
  summary: string;
  aboutThisTest?: boolean;
  /** Unix millis, when this is a stored result rather than a fresh one. */
  when?: number | null;
  commandLine?: string;
  output?: string;
}) {
  return (
    <div className={`run-outcome run-${outcome}`} role="status">
      <p className="run-verdict">
        <strong>{outcome}</strong>
        {when ? ` — ${new Date(when).toLocaleString()}` : ""}
        {summary ? ` · ${summary}` : ""}
      </p>
      <p className="run-reading">{readingOf(outcome, aboutThisTest)}</p>
      {commandLine && (
        <p className="run-command">
          Ran <code>{commandLine}</code>
        </p>
      )}
      {output && (
        <details>
          <summary>Runner output</summary>
          <pre>{output}</pre>
        </details>
      )}
    </div>
  );
}
