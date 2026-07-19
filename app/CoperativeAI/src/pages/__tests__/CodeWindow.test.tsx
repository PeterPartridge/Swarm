import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CodeWindow from "../../components/CodeWindow";

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
  return {
    default: (props: {
      value: string;
      onChange: (v: string | undefined) => void;
      onMount?: (editor: unknown, monaco: unknown) => void;
      "aria-label"?: string;
    }) => {
      props.onMount?.(
        { addCommand: () => {} },
        { KeyMod: { CtrlCmd: 2048 }, KeyCode: { KeyS: 49 } },
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

describe("CodeWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.writeSolutionFile.mockResolvedValue();
  });

  it("shows the file and keeps Save off while nothing has changed", async () => {
    render(
      <CodeWindow solutionId={3} path="src/main.rs" initialContent="fn main() {}" onSaved={vi.fn()} />,
    );

    expect(await screen.findByLabelText("Editor for src/main.rs")).toHaveValue("fn main() {}");
    expect(screen.getByLabelText("Save src/main.rs")).toBeDisabled();
    expect(screen.queryByLabelText(/has unsaved changes/)).not.toBeInTheDocument();
  });

  it("marks an edit unsaved, saves it, and reads clean again", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(
      <CodeWindow solutionId={3} path="src/main.rs" initialContent="fn main() {}" onSaved={onSaved} />,
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
    render(<CodeWindow solutionId={3} path="a.txt" initialContent="one" onSaved={vi.fn()} />);

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
      <CodeWindow solutionId={3} path="src/main.rs" initialContent="fn main() {}" onSaved={vi.fn()} />,
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
    render(<CodeWindow solutionId={3} path="a.js" initialContent="x" onSaved={vi.fn()} />);

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
    render(<CodeWindow solutionId={3} path="a.js" initialContent="x" onSaved={vi.fn()} />);

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
    render(<CodeWindow solutionId={3} path=".git/config" initialContent="[core]" onSaved={vi.fn()} />);

    const editor = await screen.findByLabelText("Editor for .git/config");
    await user.type(editor, "{End}x");
    await user.click(screen.getByLabelText("Save .git/config"));

    expect(await screen.findByRole("alert")).toHaveTextContent("nothing is written under .git");
    expect(screen.getByLabelText(".git/config has unsaved changes")).toBeInTheDocument();
  });
});
