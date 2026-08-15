import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SaveBar from "../../components/SaveBar";
import { MIN_SPIN, SAVED_FOR, reset, track } from "../../lib/saving";

describe("SaveBar", () => {
  beforeEach(() => {
    reset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    reset();
  });

  /// A permanent bar reading "Ready" is furniture, and furniture at the bottom
  /// of every screen is attention somebody paid for nothing.
  it("draws nothing when there is nothing to say", () => {
    const { container } = render(<SaveBar />);
    expect(container).toBeEmptyDOMElement();
  });

  /// **"Saved" appears when the write actually returned.** The spinner has a
  /// floor so a fast save does not flash, but delaying the news itself would be
  /// the very lie the floor exists to avoid.
  it("says it is saving, then that it saved", async () => {
    render(<SaveBar />);

    let finish: (() => void) | null = null;
    const saving = track("Developer rules", () => new Promise<void>((r) => (finish = r)));

    expect(await screen.findByText(/Saving developer rules/)).toBeInTheDocument();

    await act(async () => {
      finish?.();
      await saving;
      // Past the spinner's floor, which delays hiding the spinner and nothing
      // else.
      vi.advanceTimersByTime(MIN_SPIN + 10);
    });

    expect(await screen.findByText("Developer rules saved")).toBeInTheDocument();
  });

  /// Reassurance goes stale, so it goes away on its own.
  it("goes quiet again after a success", async () => {
    render(<SaveBar />);

    await act(async () => {
      await track("Developer rules", async () => {});
      vi.advanceTimersByTime(MIN_SPIN + 10);
    });
    expect(await screen.findByText("Developer rules saved")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(SAVED_FOR + 50);
    });
    await waitFor(() =>
      expect(screen.queryByText("Developer rules saved")).not.toBeInTheDocument(),
    );
  });

  /// **A save that did not happen is the one thing nobody may miss**, so it does
  /// not fade — and it carries the reason, because a bar saying only "could not
  /// save" sends somebody looking for what was already in hand.
  it("keeps a failure on screen, with its reason, until it is dismissed", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SaveBar />);

    await act(async () => {
      // Rethrown, because the bar reports on the work rather than swallowing
      // it — a caller that needs to know still finds out.
      await expect(
        track("Developer rules", async () => {
          throw new Error("the database is read-only");
        }),
      ).rejects.toThrow("read-only");
      vi.advanceTimersByTime(SAVED_FOR * 2);
    });

    const said = await screen.findByRole("alert");
    expect(said).toHaveTextContent("Developer rules not saved");
    expect(said).toHaveTextContent("the database is read-only");

    await user.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  /// **Two panels saving at once.** The first to return must not declare
  /// everything finished while the other is still going.
  it("keeps saying it is saving until the last one is done", async () => {
    render(<SaveBar />);

    let finishSlow: (() => void) | null = null;
    const fast = track("Rules", async () => {});
    const slow = track("Strategy", () => new Promise<void>((r) => (finishSlow = r)));

    await act(async () => {
      await fast;
      vi.advanceTimersByTime(MIN_SPIN + 10);
    });
    // Still going, because one of them is.
    expect(screen.queryByText(/saved$/)).not.toBeInTheDocument();
    expect(screen.getByText(/Saving/)).toBeInTheDocument();

    await act(async () => {
      finishSlow?.();
      await slow;
      vi.advanceTimersByTime(MIN_SPIN + 10);
    });
    expect(await screen.findByText("Strategy saved")).toBeInTheDocument();
  });

  /// A success is not worth interrupting anybody about; a failure is.
  it("only interrupts for a failure", async () => {
    render(<SaveBar />);

    await act(async () => {
      await track("Rules", async () => {});
      vi.advanceTimersByTime(MIN_SPIN + 10);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
