import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import JobsPanel from "../../components/ai/JobsPanel";
import RunsPanel from "../../components/ai/RunsPanel";
import { notifyWorkChanged, useWorkChanged } from "../../lib/workSignal";
import type { AiJob, Run } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listAiJobs: vi.fn(),
    cancelAiJob: vi.fn(),
    getAiConcurrency: vi.fn(),
    listRuns: vi.fn(),
    startRun: vi.fn(),
    listAbandonedWorktrees: vi.fn(),
    removeWorktreeAt: vi.fn(),
    discardRunWorktree: vi.fn(),
    previewRunMerge: vi.fn(),
    mergeRunBranch: vi.fn(),
    abortRunMerge: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("../../components/code/RunTerminal", () => ({
  default: () => <div />,
}));

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const job = (over: Partial<AiJob> = {}): AiJob => ({
  id: 1,
  workItemId: 9,
  workItemTitle: "Add checkout",
  purpose: "changePlan",
  state: "running",
  message: "",
  submittedAt: 1,
  startedAt: null,
  finishedAt: null,
  ...over,
});

const run = (over: Partial<Run> = {}): Run =>
  ({
    id: 0,
    workItemId: 9,
    workItemTitle: "Add checkout",
    solutionId: 3,
    solutionName: "Shop API",
    state: "notStarted",
    branch: "feature/9-add-checkout",
    worktreePath: "",
    terminalId: "",
    briefPath: "",
    filesChanged: 0,
    planApproved: false,
    ...over,
  }) as Run;

/** A minimal subscriber, so the fan-out can be observed without a whole panel. */
function Counter({ name }: { name: string }) {
  const [count, setCount] = useState(0);
  const bump = useCallback(() => setCount((c) => c + 1), []);
  useWorkChanged(bump);
  return <div data-testid={name}>{count}</div>;
}

describe("workSignal", () => {
  /// Every subscriber hears it, not just the first or the last — the whole
  /// reason the panels stopped keeping private subscriptions.
  it("reaches every subscriber", async () => {
    render(
      <>
        <Counter name="a" />
        <Counter name="b" />
      </>,
    );

    act(() => notifyWorkChanged());
    await waitFor(() => expect(screen.getByTestId("a")).toHaveTextContent("1"));
    expect(screen.getByTestId("b")).toHaveTextContent("1");

    act(() => notifyWorkChanged());
    await waitFor(() => expect(screen.getByTestId("b")).toHaveTextContent("2"));
  });

  /// An unmounted component must stop hearing about it. A listener left in the
  /// set would call setState on a dead component forever — the leak this kind
  /// of module is most likely to have.
  it("stops calling a subscriber that has gone away", async () => {
    const { unmount } = render(<Counter name="gone" />);
    const survivor = render(<Counter name="stays" />);

    act(() => notifyWorkChanged());
    await waitFor(() =>
      expect(survivor.getByTestId("stays")).toHaveTextContent("1"),
    );

    unmount();
    act(() => notifyWorkChanged());
    await waitFor(() =>
      expect(survivor.getByTestId("stays")).toHaveTextContent("2"),
    );
    // No warning about updating an unmounted component, and nothing thrown.
    expect(screen.queryByTestId("gone")).not.toBeInTheDocument();
  });
});

describe("panels following one another", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getAiConcurrency.mockResolvedValue({ limit: 1, available: 0 });
    mocked.listAbandonedWorktrees.mockResolvedValue([]);
  });

  /// **The bug this closes.** The runs list refreshed on mount and never again,
  /// so a job finishing beside it — or a plan approved on another tab — left it
  /// showing a Start button that was wrong, until somebody pressed Refresh.
  it("refreshes the runs list when work changes elsewhere", async () => {
    mocked.listAiJobs.mockResolvedValue([]);
    mocked.listRuns.mockResolvedValue([run({ planApproved: false })]);
    render(<RunsPanel productId={1} />);

    expect(
      await screen.findByLabelText("Start Add checkout on Shop API"),
    ).toBeDisabled();

    // Something elsewhere approved the plan.
    mocked.listRuns.mockResolvedValue([run({ planApproved: true })]);
    act(() => notifyWorkChanged());

    await waitFor(() =>
      expect(screen.getByLabelText("Start Add checkout on Shop API")).toBeEnabled(),
    );
  });

  /// Stopping a job frees a slot and can unblock a run, so the panels beside the
  /// queue have to hear about it — that is what the notify on cancel is for.
  it("tells the other panels when a job is stopped", async () => {
    const user = userEvent.setup();
    mocked.listAiJobs.mockResolvedValue([job({ id: 4, state: "running" })]);
    mocked.cancelAiJob.mockResolvedValue("Stopped before it reached a provider.");
    mocked.listRuns.mockResolvedValue([run()]);

    render(
      <>
        <JobsPanel productId={1} />
        <Counter name="listening" />
      </>,
    );

    await user.click(await screen.findByLabelText("Stop Add checkout"));

    await waitFor(() => expect(mocked.cancelAiJob).toHaveBeenCalledWith(4));
    // The neighbour was told, rather than having to be refreshed by hand.
    await waitFor(() =>
      expect(screen.getByTestId("listening")).not.toHaveTextContent("0"),
    );
  });
});
