import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CodeWindow from "../../components/code/CodeWindow";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return { ...original, writeSolutionFile: vi.fn(), askCodingPal: vi.fn() };
});

// jsdom cannot host Monaco; the stub honours value/onChange like the real one.
vi.mock("../../lib/monacoSetup", () => ({
  ensureMonaco: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@monaco-editor/react", async () => {
  const { createElement } = await import("react");
  // Lets a test act as the developer dragging a selection: the fake editor
  // hands the range's own text back through getValueInRange, like Monaco does.
  let selectionListener: ((ev: { selection: unknown }) => void) | null = null;
  // The hover provider the editor registers, so a test can act as the pointer.
  let hoverProvider:
    | {
        provideHover: (
          model: unknown,
          position: unknown,
        ) => Promise<{ contents: { value: string }[] } | null>;
      }
    | null = null;
  let disposed = false;
  return {
    __fireSelection: (text: string) =>
      selectionListener?.({ selection: { __text: text } }),
    /// Acts as a pointer resting on a word. Null when nothing registered one.
    __hover: async (word: string) =>
      hoverProvider
        ? await hoverProvider.provideHover(
            { getWordAtPosition: () => ({ word, startColumn: 1, endColumn: 1 }) },
            { lineNumber: 1, column: 1 },
          )
        : null,
    __registered: () => hoverProvider !== null,
    __disposed: () => disposed,
    default: (props: {
      value: string;
      onChange: (v: string | undefined) => void;
      onMount?: (editor: unknown, monaco: unknown) => void;
      "aria-label"?: string;
    }) => {
      props.onMount?.(
        {
          addCommand: () => {},
          onDidChangeCursorSelection: (cb: (ev: { selection: unknown }) => void) => {
            selectionListener = cb;
          },
          getModel: () => ({
            getValueInRange: (range: unknown) => (range as { __text: string }).__text,
            getLanguageId: () => "go",
          }),
        },
        {
          KeyMod: { CtrlCmd: 2048 },
          KeyCode: { KeyS: 49 },
          languages: {
            registerHoverProvider: (
              _language: string,
              provider: {
                provideHover: (
                  model: unknown,
                  position: unknown,
                ) => Promise<{ contents: { value: string }[] } | null>;
              },
            ) => {
              hoverProvider = provider;
              disposed = false;
              return {
                dispose: () => {
                  hoverProvider = null;
                  disposed = true;
                },
              };
            },
          },
        },
      );
      return createElement("textarea", {
        "aria-label": props["aria-label"],
        value: props.value,
        onChange: (e: { target: { value: string } }) => props.onChange(e.target.value),
      });
    },
    loader: { config: () => {} },
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

/** The editor is controlled — its buffer belongs to whatever opens it, so that
 *  switching between open files keeps each one's unsaved edits. This stands in
 *  for that owner, which is the only realistic way to drive it. */
function Harness({
  path = "src/main.rs",
  initial = "fn main() {}",
  onSaved,
}: {
  path?: string;
  initial?: string;
  onSaved?: (saved: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  return (
    <CodeWindow
      solutionId={3}
      path={path}
      value={value}
      saved={saved}
      onChange={setValue}
      onSaved={(content) => {
        setSaved(content);
        onSaved?.(content);
      }}
    />
  );
}

describe("CodeWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.writeSolutionFile.mockResolvedValue();
  });

  it("shows the file and keeps Save off while nothing has changed", async () => {
    render(
      <Harness path="src/main.rs" initial="fn main() {}" />,
    );

    expect(await screen.findByLabelText("Editor for src/main.rs")).toHaveValue("fn main() {}");
    expect(screen.getByLabelText("Save src/main.rs")).toBeDisabled();
    expect(screen.queryByLabelText(/has unsaved changes/)).not.toBeInTheDocument();
  });

  it("marks an edit unsaved, saves it, and reads clean again", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(
      <Harness path="src/main.rs" initial="fn main() {}" onSaved={onSaved} />,
    );

    const editor = await screen.findByLabelText("Editor for src/main.rs");
    await user.type(editor, "{End} // done");

    expect(screen.getByLabelText("src/main.rs has unsaved changes")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Save src/main.rs"));

    await waitFor(() =>
      expect(mocked.writeSolutionFile).toHaveBeenCalledWith(3, "src/main.rs", "fn main() {} // done"),
    );
    expect(onSaved).toHaveBeenCalled();
    expect(screen.queryByLabelText(/has unsaved changes/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Save src/main.rs")).toBeDisabled();
  });

  /// Dirty is measured against the saved content, not the keystroke count —
  /// an edit undone by hand reads as clean.
  it("reads clean when an edit is typed back to the saved text", async () => {
    const user = userEvent.setup();
    render(<Harness path="a.txt" initial="one" />);

    const editor = await screen.findByLabelText("Editor for a.txt");
    await user.clear(editor);
    expect(screen.getByLabelText("a.txt has unsaved changes")).toBeInTheDocument();

    await user.type(editor, "one");
    expect(screen.queryByLabelText(/has unsaved changes/)).not.toBeInTheDocument();
  });

  /// The pal's revision goes into the editor buffer, never onto disk — the
  /// developer's own save is the gate, and applying must read as unsaved.
  it("applies a pal revision to the buffer and leaves the save to the developer", async () => {
    const user = userEvent.setup();
    mocked.askCodingPal.mockResolvedValue({
      explanation: "Split the function in two.",
      replacement: "fn main() { helper(); }",
      violations: [],
      provider: "Ollama",
      model: "ornith:9b",
      reason: "past the handover threshold",
      blocked: null,
    });
    render(
      <Harness path="src/main.rs" initial="fn main() {}" />,
    );

    await screen.findByLabelText("Editor for src/main.rs");
    await user.selectOptions(screen.getByLabelText("Pal action"), "refactor");
    await user.type(screen.getByLabelText("Pal instruction"), "split this up");
    await user.click(screen.getByLabelText("Ask the pal about src/main.rs"));

    await waitFor(() =>
      expect(mocked.askCodingPal).toHaveBeenCalledWith({
        solutionId: 3,
        path: "src/main.rs",
        action: "refactor",
        instruction: "split this up",
        selection: null,
      }),
    );
    expect(await screen.findByText("Split the function in two.")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Apply the pal's revision to src/main.rs"));

    expect(screen.getByLabelText("Editor for src/main.rs")).toHaveValue("fn main() { helper(); }");
    expect(screen.getByLabelText("src/main.rs has unsaved changes")).toBeInTheDocument();
    expect(mocked.writeSolutionFile).not.toHaveBeenCalled();
  });

  /// "Explain this bit" — a selection travels with the ask, and clearing it
  /// goes back to asking about the whole file.
  it("sends the selected code with the ask, and null once cleared", async () => {
    const user = userEvent.setup();
    const { act } = await import("@testing-library/react");
    const mod = (await import("@monaco-editor/react")) as unknown as {
      __fireSelection: (text: string) => void;
    };
    mocked.askCodingPal.mockResolvedValue({
      explanation: "It is the entry point.",
      replacement: "",
      violations: [],
      provider: "Claude",
      model: "m",
      reason: "within budget",
      blocked: null,
    });
    render(
      <Harness path="src/main.rs" initial="fn main() {}" />,
    );
    await screen.findByLabelText("Editor for src/main.rs");

    act(() => mod.__fireSelection("fn main"));
    expect(await screen.findByText(/Asking about the selected code/)).toBeInTheDocument();

    await user.click(screen.getByLabelText("Ask the pal about src/main.rs"));
    await waitFor(() =>
      expect(mocked.askCodingPal).toHaveBeenCalledWith(
        expect.objectContaining({ selection: "fn main" }),
      ),
    );

    act(() => mod.__fireSelection(""));
    expect(screen.queryByText(/Asking about the selected code/)).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Ask the pal about src/main.rs"));
    await waitFor(() =>
      expect(mocked.askCodingPal).toHaveBeenLastCalledWith(
        expect.objectContaining({ selection: null }),
      ),
    );
  });

  /// Violations are shown before apply, not discovered after save.
  it("names forbidden technology in a proposal before it can be applied", async () => {
    const user = userEvent.setup();
    mocked.askCodingPal.mockResolvedValue({
      explanation: "Swapped to jQuery for brevity.",
      replacement: "import $ from 'jquery';",
      violations: ["jquery"],
      provider: "Claude",
      model: "m",
      reason: "within budget",
      blocked: null,
    });
    render(<Harness path="a.js" initial="x" />);

    await screen.findByLabelText("Editor for a.js");
    await user.click(screen.getByLabelText("Ask the pal about a.js"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("developer rules forbid");
    expect(alert).toHaveTextContent("jquery");
    // apply stays available — accepting is ungated everywhere in this app
    expect(screen.getByLabelText("Apply the pal's revision to a.js")).toBeEnabled();
  });

  it("shows a pal refusal as a question, not a failure", async () => {
    const user = userEvent.setup();
    mocked.askCodingPal.mockResolvedValue({
      explanation: "",
      replacement: "",
      violations: [],
      provider: "Claude",
      model: "m",
      reason: "within budget",
      blocked: { reason: "The instruction contradicts the rules.", whatIsNeeded: "Which wins?", feedbackId: 0 },
    });
    render(<Harness path="a.js" initial="x" />);

    await screen.findByLabelText("Editor for a.js");
    await user.click(screen.getByLabelText("Ask the pal about a.js"));

    expect(await screen.findByText(/stopped rather than guessing/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  /// A refused save must say why and keep the work dirty — silently losing the
  /// refusal would read as saved.
  it("surfaces a refused save and stays unsaved", async () => {
    const user = userEvent.setup();
    mocked.writeSolutionFile.mockRejectedValue(
      "nothing is written under .git — that would change the repository itself, not the code",
    );
    render(<Harness path=".git/config" initial="[core]" />);

    const editor = await screen.findByLabelText("Editor for .git/config");
    await user.type(editor, "{End}x");
    await user.click(screen.getByLabelText("Save .git/config"));

    expect(await screen.findByRole("alert")).toHaveTextContent("nothing is written under .git");
    expect(screen.getByLabelText(".git/config has unsaved changes")).toBeInTheDocument();
  });

  /// **The same `evaluate` the watch pane uses, asked because a pointer
  /// moved.** Hovering a name is where somebody instinctively looks first, and
  /// it is one request away from what the pane beside it already does.
  it("answers a hover with what the name comes to", async () => {
    const monaco = (await import("@monaco-editor/react")) as unknown as {
      __hover: (word: string) => Promise<{ contents: { value: string }[] } | null>;
    };
    render(
      <CodeWindow
        solutionId={1}
        path="main.go"
        value="total := subtotal + tax"
        saved="total := subtotal + tax"
        onChange={() => {}}
        onSaved={() => {}}
        onHover={async (expression) =>
          expression === "subtotal" ? { value: "11810", kind: "int" } : null
        }
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("Editor for main.go")).toBeInTheDocument());

    const answer = await monaco.__hover("subtotal");
    expect(answer?.contents.map((c) => c.value).join(" ")).toContain("11810");
    // The type is worth saying and is said separately, so a long one does not
    // crowd the value out of the first line.
    expect(answer?.contents.map((c) => c.value).join(" ")).toContain("int");
  });

  /// Hovering an ordinary word — a keyword, a comment — must say nothing at
  /// all rather than an empty tooltip.
  it("says nothing when there is no value for the word", async () => {
    const monaco = (await import("@monaco-editor/react")) as unknown as {
      __hover: (word: string) => Promise<{ contents: { value: string }[] } | null>;
    };
    render(
      <CodeWindow
        solutionId={1}
        path="main.go"
        value="func main() {}"
        saved="func main() {}"
        onChange={() => {}}
        onSaved={() => {}}
        onHover={async () => null}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("Editor for main.go")).toBeInTheDocument());

    expect(await monaco.__hover("func")).toBeNull();
  });

  /// **No debugger, no provider.** An editor answering every hover with "no
  /// debugger" would be worse than one that stays quiet, and a provider that
  /// always returns nothing still costs a round trip per pointer movement.
  it("registers no hover provider when there is nothing to ask", async () => {
    const monaco = (await import("@monaco-editor/react")) as unknown as {
      __registered: () => boolean;
    };
    render(
      <CodeWindow
        solutionId={1}
        path="main.go"
        value="func main() {}"
        saved="func main() {}"
        onChange={() => {}}
        onSaved={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("Editor for main.go")).toBeInTheDocument());

    expect(monaco.__registered()).toBe(false);
  });

  /// Monaco's providers belong to a language rather than to an editor, so one
  /// left behind would have a closed file still answering hovers — through a
  /// callback pointing at a debug session that has since ended.
  it("takes its hover provider away when the editor goes", async () => {
    const monaco = (await import("@monaco-editor/react")) as unknown as {
      __disposed: () => boolean;
    };
    const { unmount } = render(
      <CodeWindow
        solutionId={1}
        path="main.go"
        value="x := 1"
        saved="x := 1"
        onChange={() => {}}
        onSaved={() => {}}
        onHover={async () => ({ value: "1", kind: "int" })}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("Editor for main.go")).toBeInTheDocument());

    unmount();
    expect(monaco.__disposed()).toBe(true);
  });
});
