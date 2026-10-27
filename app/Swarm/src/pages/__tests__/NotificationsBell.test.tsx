import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NotificationsBell from "../../components/common/NotificationsBell";
import type { AiJob } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return { ...original, listRecentAiJobs: vi.fn() };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const job = (over: Partial<AiJob> = {}): AiJob => ({
  id: 1,
  workItemId: 9,
  workItemTitle: "Add checkout",
  purpose: "changePlan",
  state: "done",
  message: "",
  submittedAt: 1,
  startedAt: null,
  finishedAt: null,
  ...over,
});

describe("NotificationsBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocked.listRecentAiJobs.mockResolvedValue([]);
  });

  it("says nothing has happened when there are no jobs", async () => {
    const user = userEvent.setup();
    render(<NotificationsBell />);
    await user.click(await screen.findByLabelText("Notifications"));
    expect(screen.getByText(/Nothing yet/)).toBeInTheDocument();
  });

  /// A job that asked a question or failed is what deserves attention, so it is
  /// what the unread dot counts — a finished plan is not an interruption.
  it("counts only the jobs needing attention", async () => {
    mocked.listRecentAiJobs.mockResolvedValue([
      job({ id: 1, state: "done" }),
      job({ id: 2, state: "blocked", message: "which payment provider?" }),
      job({ id: 3, state: "failed" }),
    ]);
    render(<NotificationsBell />);
    expect(
      await screen.findByLabelText("Notifications, 2 needing attention"),
    ).toBeInTheDocument();
  });

  /// Every row is a real job, said as an outcome rather than a state name.
  it("lists what the AI did, in plain words", async () => {
    const user = userEvent.setup();
    mocked.listRecentAiJobs.mockResolvedValue([
      job({ id: 2, state: "blocked", message: "which payment provider?" }),
    ]);
    render(<NotificationsBell />);

    await user.click(await screen.findByLabelText(/Notifications/));
    expect(screen.getByText("asked a question")).toBeInTheDocument();
    expect(screen.getByText("Add checkout")).toBeInTheDocument();
    expect(screen.getByText("which payment provider?")).toBeInTheDocument();
  });

  it("clears the dot when everything is marked read", async () => {
    const user = userEvent.setup();
    mocked.listRecentAiJobs.mockResolvedValue([job({ id: 2, state: "failed" })]);
    render(<NotificationsBell />);

    await user.click(await screen.findByLabelText("Notifications, 1 needing attention"));
    await user.click(screen.getByRole("button", { name: "Mark all read" }));

    // The bell itself no longer announces anything needing attention. (Scoped
    // to the button: the open panel is also labelled "Notifications".)
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
  });

  /// The debt this closes: marking everything read and finding the same dot
  /// back after a restart is what teaches people to ignore a bell.
  it("remembers what was read across a restart", async () => {
    const user = userEvent.setup();
    mocked.listRecentAiJobs.mockResolvedValue([job({ id: 7, state: "failed" })]);
    const first = render(<NotificationsBell />);

    await user.click(await screen.findByLabelText("Notifications, 1 needing attention"));
    await user.click(screen.getByRole("button", { name: "Mark all read" }));
    first.unmount();

    // …a fresh mount, as after reopening the app: the same job is not new.
    render(<NotificationsBell />);
    expect(await screen.findByRole("button", { name: "Notifications" })).toBeInTheDocument();
  });

  /// …but a job that arrived after the last read still rings.
  it("rings again for a job newer than the last one read", async () => {
    const user = userEvent.setup();
    mocked.listRecentAiJobs.mockResolvedValue([job({ id: 7, state: "failed" })]);
    const first = render(<NotificationsBell />);
    await user.click(await screen.findByLabelText("Notifications, 1 needing attention"));
    await user.click(screen.getByRole("button", { name: "Mark all read" }));
    first.unmount();

    mocked.listRecentAiJobs.mockResolvedValue([
      job({ id: 8, state: "blocked", message: "which provider?" }),
      job({ id: 7, state: "failed" }),
    ]);
    render(<NotificationsBell />);
    expect(
      await screen.findByLabelText("Notifications, 1 needing attention"),
    ).toBeInTheDocument();
  });
});
