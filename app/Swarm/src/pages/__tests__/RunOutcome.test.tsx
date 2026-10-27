import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RunOutcome, { readingOf } from "../../components/testing/RunOutcome";

describe("RunOutcome", () => {
  /// The rule the whole feature turns on: red before the work exists is the
  /// test you were supposed to write, not a failure of the scenario.
  it("reads a failure as the expected first result", () => {
    expect(readingOf("failed", true)).toMatch(/expected/i);
    expect(readingOf("failed", true)).not.toMatch(/error/i);
  });

  /// And green is ambiguous in a way nothing can resolve automatically, so it
  /// must say both things rather than pick the flattering one.
  it("gives a pass both of its meanings", () => {
    const reading = readingOf("passed", true);
    expect(reading).toMatch(/already done/i);
    expect(reading).toMatch(/does not exercise/i);
  });

  it("says a whole-suite verdict may not be about this scenario at all", () => {
    const reading = readingOf("failed", false);
    expect(reading).toMatch(/whole suite/i);
    expect(reading).toMatch(/somebody else/i);
    // The unattributed reading wins over the outcome's own — otherwise a red
    // suite would be read as "expected" for a scenario it never ran.
    expect(reading).not.toMatch(/expected/i);
  });

  it("shows the verdict, the summary and when it was, without an alert", () => {
    render(
      <RunOutcome
        outcome="failed"
        summary="0 passed, 1 failed, 0 skipped"
        when={1755000000000}
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("failed");
    expect(status).toHaveTextContent("0 passed, 1 failed");
    // A run that failed is a result, not an error condition.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the runner output behind a disclosure rather than in the way", () => {
    render(
      <RunOutcome
        outcome="errored"
        summary="by exit code only — no parser recognised this runner's output"
        commandLine="cargo test a_wrong_password_is_rejected"
        output="error: could not compile"
      />,
    );
    expect(screen.getByText("Runner output")).toBeInTheDocument();
    expect(screen.getByText(/could not compile/)).toBeInTheDocument();
    expect(
      screen.getByText("cargo test a_wrong_password_is_rejected"),
    ).toBeInTheDocument();
  });
});
