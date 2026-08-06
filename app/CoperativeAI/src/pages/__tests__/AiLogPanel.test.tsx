import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiLogPanel from "../../components/ai/AiLogPanel";
import type { AiCall } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return { ...original, listAiCalls: vi.fn() };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const call = (over: Partial<AiCall> = {}): AiCall => ({
  id: 1,
  workItemId: 9,
  provider: "Claude Code (my plan)",
  model: "claude-opus-5",
  purpose: "changePlan",
  outcome: "ok",
  inputTokens: 1200,
  outputTokens: 340,
  cacheReadTokens: 8000,
  cacheWriteTokens: 0,
  latencyMs: 4200,
  prompt: "Product: Shop App\n\nPlan the checkout work",
  reply: '{"filesToChange":"src/pay.rs"}',
  createdAt: 1,
  ...over,
});

const log = (calls: AiCall[]) => ({
  totals: {
    calls: calls.length,
    inputTokens: calls.reduce((n, c) => n + c.inputTokens, 0),
    outputTokens: calls.reduce((n, c) => n + c.outputTokens, 0),
    cacheReadTokens: calls.reduce((n, c) => n + c.cacheReadTokens, 0),
    blocked: calls.filter((c) => c.outcome === "blocked").length,
  },
  calls,
});

describe("AiLogPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listAiCalls.mockResolvedValue(log([]));
  });

  /// **Tokens, not money.** A Claude plan has no per-token rate, so counting
  /// what was used is the answer that exists — and the panel says why rather
  /// than leaving the absence of a cost to be noticed.
  it("totals tokens and says why there is no price", async () => {
    mocked.listAiCalls.mockResolvedValue(log([call(), call({ id: 2 })]));
    render(<AiLogPanel productId={1} />);

    expect(await screen.findByText("2,400")).toBeInTheDocument(); // tokens in
    expect(screen.getByText("680")).toBeInTheDocument(); // tokens out
    expect(screen.getByText(/no per-token price to quote/)).toBeInTheDocument();
  });

  /// A call that never reached a provider consumed nothing. Folding it into the
  /// total would overstate how busy the AI has been, so it is counted apart and
  /// said separately.
  it("counts calls that were never sent apart from the rest", async () => {
    mocked.listAiCalls.mockResolvedValue(
      log([call(), call({ id: 2, outcome: "blocked", inputTokens: 0, outputTokens: 0 })]),
    );
    render(<AiLogPanel productId={1} />);

    // Two rows, but only one actually went out.
    expect(await screen.findByText("1")).toBeInTheDocument();
    expect(screen.getByText(/1 more call was never sent/)).toBeInTheDocument();
  });

  /// **The thing a tally could never answer.** What was asked and what came
  /// back is what you want when a plan reads oddly.
  it("shows the exchange when a call is opened", async () => {
    const user = userEvent.setup();
    mocked.listAiCalls.mockResolvedValue(log([call()]));
    render(<AiLogPanel productId={1} />);

    // Collapsed to begin with: a page of prompts is a wall.
    expect(screen.queryByText(/Plan the checkout work/)).not.toBeInTheDocument();

    await user.click(
      await screen.findByLabelText(
        "Show the changePlan call to Claude Code (my plan)",
      ),
    );
    expect(screen.getByText(/Plan the checkout work/)).toBeInTheDocument();
    expect(screen.getByText(/filesToChange/)).toBeInTheDocument();
  });

  /// Rows written before the exchange was kept genuinely have nothing to show.
  /// A control that opened onto an empty box would be worse than none.
  it("says when there is nothing to read rather than offering an empty box", async () => {
    mocked.listAiCalls.mockResolvedValue(log([call({ prompt: "", reply: "" })]));
    render(<AiLogPanel productId={1} />);

    expect(
      await screen.findByText(/Recorded before the exchange was kept/),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Show the changePlan call to Claude Code (my plan)"),
    ).toBeDisabled();
  });

  /// A blocked call has a different reason for being empty, and saying the
  /// wrong one sends somebody looking for a lost transcript.
  it("distinguishes never-sent from not-recorded", async () => {
    mocked.listAiCalls.mockResolvedValue(
      log([call({ outcome: "blocked", prompt: "", reply: "", provider: "—", model: "" })]),
    );
    render(<AiLogPanel productId={1} />);

    expect(await screen.findByText(/Never sent, so there is nothing to read/)).toBeInTheDocument();
  });

  /// Zero tokens is a fact about a provider that reports none, not a call that
  /// used nothing — so it is worded as "not reported".
  it("says when no tokens were reported rather than showing zero", async () => {
    mocked.listAiCalls.mockResolvedValue(
      log([call({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 })]),
    );
    render(<AiLogPanel productId={1} />);

    expect(await screen.findByText("no tokens reported")).toBeInTheDocument();
  });

  it("says nothing has happened yet when the log is empty", async () => {
    render(<AiLogPanel productId={1} />);
    expect(await screen.findByText(/Every AI call lands here/)).toBeInTheDocument();
  });
});
