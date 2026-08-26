import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readinessOf,
  startFromFor,
  useDebuggers,
  recheckDebuggers,
} from "../../lib/debuggers";
import type { AdapterStatus } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return { ...original, debugAdapters: vi.fn() };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const adapter = (over: Partial<AdapterStatus> = {}): AdapterStatus =>
  ({
    language: "go",
    label: "Go (Delve)",
    adapter: "dlv",
    transport: "stdio",
    available: true,
    program: "dlv",
    argv: ["dlv"],
    version: "1.22.0",
    problem: "",
    install: "go install github.com/go-delve/delve/cmd/dlv@latest",
    ...over,
  }) as AdapterStatus;

/** A component that just reports what the hook says. */
function Watcher({ name }: { name: string }) {
  const { adapters, settled, recheck } = useDebuggers();
  return (
    <div>
      <span data-testid={`state-${name}`}>
        {!settled
          ? "looking"
          : adapters === null
            ? "unknown"
            : (adapters.find((a) => a.language === "go")?.available ?? false)
              ? "installed"
              : "missing"}
      </span>
      <button type="button" onClick={recheck}>
        look again {name}
      </button>
    </div>
  );
}

describe("useDebuggers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.debugAdapters.mockResolvedValue([adapter({ available: false })]);
  });

  /// **One probe, not one per panel.** Answering each component separately
  /// would execute every candidate adapter three times over — the picker, the
  /// board and each session panel all ask.
  it("shares one read between everything that asks", async () => {
    render(
      <>
        <Watcher name="a" />
        <Watcher name="b" />
        <Watcher name="c" />
      </>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("state-a")).toHaveTextContent("missing"),
    );
    expect(screen.getByTestId("state-c")).toHaveTextContent("missing");
    expect(mocked.debugAdapters).toHaveBeenCalledTimes(1);
  });

  /// **The refusal has to be able to stop being true.** The app shows the
  /// install command; somebody runs it in a terminal and comes back, and until
  /// this existed the only way to be believed was to reopen the pane.
  it("re-reads on demand and tells every panel at once", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Watcher name="a" />
        <Watcher name="b" />
      </>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("state-a")).toHaveTextContent("missing"),
    );

    // …installed in a terminal somewhere else…
    mocked.debugAdapters.mockResolvedValue([adapter({ available: true })]);
    await user.click(screen.getByRole("button", { name: "look again a" }));

    await waitFor(() =>
      expect(screen.getByTestId("state-a")).toHaveTextContent("installed"),
    );
    // the panel that did not ask hears it too, or the two would disagree about
    // the same machine
    expect(screen.getByTestId("state-b")).toHaveTextContent("installed");
  });

  /// Coming back to the window is the moment somebody expects the answer to
  /// have changed — they went away to install it.
  it("looks again when the window is focused after something was missing", async () => {
    render(<Watcher name="a" />);
    await waitFor(() =>
      expect(screen.getByTestId("state-a")).toHaveTextContent("missing"),
    );
    mocked.debugAdapters.mockClear();
    mocked.debugAdapters.mockResolvedValue([adapter({ available: true })]);

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("state-a")).toHaveTextContent("installed"),
    );
  });

  /// Executing every candidate on each alt-tab would be a lot of work for
  /// nothing when the last answer had no gap in it.
  it("does not look again on focus when nothing was missing", async () => {
    mocked.debugAdapters.mockResolvedValue([adapter({ available: true })]);
    render(<Watcher name="a" />);
    await waitFor(() =>
      expect(screen.getByTestId("state-a")).toHaveTextContent("installed"),
    );
    mocked.debugAdapters.mockClear();

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(mocked.debugAdapters).not.toHaveBeenCalled();
  });

  /// A failed re-read must not throw away an answer that was working — that
  /// would turn a hiccup into a refusal.
  it("keeps the last answer when a re-read fails", async () => {
    mocked.debugAdapters.mockResolvedValue([adapter({ available: true })]);
    render(<Watcher name="a" />);
    await waitFor(() =>
      expect(screen.getByTestId("state-a")).toHaveTextContent("installed"),
    );

    mocked.debugAdapters.mockRejectedValue("could not look");
    act(() => {
      recheckDebuggers();
    });

    await waitFor(() =>
      expect(screen.getByTestId("state-a")).toHaveTextContent("installed"),
    );
  });
});

describe("readinessOf", () => {
  /// Three answers, not two: "no launch shape yet" is a thing to wait for and
  /// "not installed" is one command away.
  it("tells the two reasons for not debugging apart", () => {
    const list = [
      adapter({ available: false }),
      adapter({
        language: "python",
        label: "Python (debugpy)",
        available: true,
        install: "pip install debugpy",
      }),
    ];
    expect(readinessOf("Go (go mod)", list)).toMatchObject({
      state: "missing",
      label: "Go (Delve)",
      install: "go install github.com/go-delve/delve/cmd/dlv@latest",
    });
    // Python launches now, through debugpy — the fourth and last shape.
    expect(readinessOf("Python (venv)", list)).toMatchObject({ state: "ready" });
    // Ruby has no adapter here at all, which is a different thing from one
    // that is not installed: nothing to install would help.
    expect(readinessOf("Ruby", list)).toMatchObject({ state: "unsupported" });
    expect(readinessOf(null, list)).toMatchObject({ state: "unsupported" });
  });

  it("says ready only when the adapter actually ran", () => {
    expect(readinessOf("Go (go mod)", [adapter()])).toMatchObject({ state: "ready" });
    expect(readinessOf("Go (go mod)", [adapter({ available: false })])).toMatchObject({
      state: "missing",
    });
  });

  /// **A list nobody could read is not proof of absence.** Collapsing that into
  /// "missing" would refuse to start a debugger sitting right there, on the
  /// strength of a question that never got asked.
  it("says unknown when there is no list, and missing when the list has a gap", () => {
    expect(readinessOf("Go (go mod)", null)).toMatchObject({ state: "unknown" });
    // an empty list is an answer — nothing is installed
    expect(readinessOf("Go (go mod)", [])).toMatchObject({ state: "missing" });
  });
});

/// **One function for the picker and the box.** They were two: the picker
/// resolved what it was given and set a flag, and a path typed by hand went
/// through neither — so an absolute path typed in was stored whole, with no
/// warning, and meant a different file on the next machine.
describe("startFromFor", () => {
  const root = "C:/repos/orders";

  it("leaves a relative path alone, tidying its slashes", () => {
    expect(startFromFor(root, "api/serve.py")).toEqual({
      stored: "api/serve.py",
      outside: null,
    });
    // Typed the Windows way, stored the way the picker produces.
    expect(startFromFor(root, "api\\serve.py")).toEqual({
      stored: "api/serve.py",
      outside: null,
    });
  });

  /// Lexical, and on purpose: `api/../serve.py` should be stored as `serve.py`
  /// on any machine, not only on one where that folder happens to exist.
  it("resolves the dots rather than storing them", () => {
    expect(startFromFor(root, "api/../serve.py")).toEqual({
      stored: "serve.py",
      outside: null,
    });
    expect(startFromFor(root, "./api/./serve.py")).toEqual({
      stored: "api/serve.py",
      outside: null,
    });
  });

  /// **The shape that got neither treatment.** It is relative, so nothing
  /// warned; and it was already relative, so nothing resolved it — and it still
  /// is not in the repository.
  it("names a relative path that climbs out of the working copy", () => {
    expect(startFromFor(root, "../../shared/serve.py")).toEqual({
      stored: "../../shared/serve.py",
      outside: "escapes",
    });
    // **Which of these is which cannot be told from the leading dots.**
    // Climbing out and straight back in lands inside the repository, and is
    // stored as the short form it means.
    expect(startFromFor(root, "../orders/api/serve.py")).toEqual({
      stored: "api/serve.py",
      outside: null,
    });
  });

  /// The same answer written portably. There is no reason to keep the
  /// machine-specific form when a relative one says the same thing.
  it("makes an absolute path inside the working copy relative", () => {
    expect(startFromFor(root, "C:/repos/orders/api/serve.py")).toEqual({
      stored: "api/serve.py",
      outside: null,
    });
    // Windows paths are case-insensitive, and the drive letter is the usual
    // place that bites.
    expect(startFromFor(root, "c:\\Repos\\Orders\\api\\serve.py")).toEqual({
      stored: "api/serve.py",
      outside: null,
    });
  });

  /// A `.dll` built elsewhere is a legitimate answer; pretending it is portable
  /// is not.
  it("keeps a path outside the working copy whole, and says so", () => {
    expect(startFromFor(root, "D:\\elsewhere\\serve.py")).toEqual({
      stored: "D:\\elsewhere\\serve.py",
      outside: "absolute",
    });
    // A sibling folder whose name merely starts the same is still outside.
    expect(startFromFor(root, "C:/repos/orders-old/main.py").outside).toBe("absolute");
  });

  it("treats blank as nothing set rather than as a path", () => {
    expect(startFromFor(root, "   ")).toEqual({ stored: "", outside: null });
  });
});
