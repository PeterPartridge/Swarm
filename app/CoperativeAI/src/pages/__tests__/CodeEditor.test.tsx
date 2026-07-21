import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CodeEditor from "../../components/CodeEditor";
import type { FileTree, Solution } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    readSolutionTree: vi.fn(),
    readSolutionFile: vi.fn(),
    writeSolutionFile: vi.fn(),
    askCodingPal: vi.fn(),
  };
});

// Monaco cannot render in jsdom; a textarea stands in. The editor's own
// behaviour is tested in CodeWindow.test.tsx.
vi.mock("../../lib/monacoSetup", () => ({
  ensureMonaco: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@monaco-editor/react", async () => {
  const { createElement } = await import("react");
  return {
    default: (props: { value: string; "aria-label"?: string }) =>
      createElement("textarea", {
        "aria-label": props["aria-label"],
        value: props.value,
        readOnly: true,
      }),
    loader: { config: () => {} },
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

function solution(overrides: Partial<Solution> = {}): Solution {
  return {
    id: 3,
    name: "Shop API",
    productId: 7,
    solutionType: "api",
    answers: "{}",
    origin: "created",
    githubUrl: null,
    githubVisibility: null,
    localPath: "C:/repos/shop-api",
    ...overrides,
  };
}

const tree: FileTree = {
  entries: [
    { path: "src", name: "src", isDir: true, depth: 0 },
    { path: "src/main.rs", name: "main.rs", isDir: false, depth: 1 },
    { path: "README.md", name: "README.md", isDir: false, depth: 0 },
  ],
  truncated: false,
};

describe("CodeEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.readSolutionTree.mockResolvedValue(tree);
  });

  it("shows the file explorer beside the editor", async () => {
    render(<CodeEditor solution={solution()} />);

    const files = await screen.findByRole("list", { name: "Files in Shop API" });
    expect(files).toBeInTheDocument();
    // nothing open yet — the editor pane invites a choice
    expect(screen.getByText(/Pick a file from the explorer/)).toBeInTheDocument();
  });

  it("opens a file from the explorer into the editor", async () => {
    const user = userEvent.setup();
    mocked.readSolutionFile.mockResolvedValue("fn main() {}");
    render(<CodeEditor solution={solution()} />);

    await user.click(await screen.findByLabelText("Open src/main.rs"));

    await waitFor(() => expect(mocked.readSolutionFile).toHaveBeenCalledWith(3, "src/main.rs"));
    expect(await screen.findByLabelText("Editor for src/main.rs")).toHaveValue("fn main() {}");
  });

  /// A partial tree that does not say so reads as a complete one.
  it("says when the tree was cut short", async () => {
    mocked.readSolutionTree.mockResolvedValue({ ...tree, truncated: true });
    render(<CodeEditor solution={solution()} />);

    expect(await screen.findByText(/more files not shown/)).toBeInTheDocument();
  });

  /// A linked GitHub repo is not a checkout — say where to fix it rather than
  /// showing an empty explorer.
  it("asks for a working copy when the Solution has none", async () => {
    render(<CodeEditor solution={solution({ localPath: null })} />);

    expect(await screen.findByText(/no working copy on this machine yet/)).toBeInTheDocument();
    expect(mocked.readSolutionTree).not.toHaveBeenCalled();
  });

  it("surfaces a tree that cannot be read", async () => {
    mocked.readSolutionTree.mockRejectedValue("the folder for this Solution is not there any more");
    render(<CodeEditor solution={solution()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("not there any more");
  });
});
