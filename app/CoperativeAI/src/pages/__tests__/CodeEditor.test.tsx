import { render, screen, waitFor, within } from "@testing-library/react";
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
    createSolutionFile: vi.fn(),
    askCodingPal: vi.fn(),
    productChangedFiles: vi.fn(),
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
    // Editable, so a test can prove an unsaved edit survives a tab switch.
    default: (props: {
      value: string;
      onChange: (v: string | undefined) => void;
      "aria-label"?: string;
    }) =>
      createElement("textarea", {
        "aria-label": props["aria-label"],
        value: props.value,
        onChange: (e: { target: { value: string } }) => props.onChange(e.target.value),
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
    testCommand: null,
    language: null,
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
    render(<CodeEditor solutions={[solution()]} opened={solution()} />);

    const files = await screen.findByRole("list", { name: "Files in Shop API" });
    expect(files).toBeInTheDocument();
    // nothing open yet — the editor pane invites a choice
    expect(screen.getByText(/Pick a file from the explorer/)).toBeInTheDocument();
  });

  it("opens a file from the explorer into the editor", async () => {
    const user = userEvent.setup();
    mocked.readSolutionFile.mockResolvedValue("fn main() {}");
    render(<CodeEditor solutions={[solution()]} opened={solution()} />);

    await user.click(await screen.findByLabelText("Open src/main.rs"));

    await waitFor(() => expect(mocked.readSolutionFile).toHaveBeenCalledWith(3, "src/main.rs"));
    expect(await screen.findByLabelText("Editor for src/main.rs")).toHaveValue("fn main() {}");
  });

  /// The point of solution tabs: a change spanning an API and the app in front
  /// of it is one job, so both are open at once rather than one at a time.
  it("adds a second solution and keeps each one's own files and folds", async () => {
    const user = userEvent.setup();
    const api = solution();
    const web = solution({ id: 4, name: "Shop Web", localPath: "C:/repos/shop-web" });
    mocked.readSolutionTree.mockImplementation(async (id: number) =>
      id === 3
        ? tree
        : {
            entries: [{ path: "index.html", name: "index.html", isDir: false, depth: 0 }],
            truncated: false,
          },
    );
    mocked.readSolutionFile.mockResolvedValue("contents");
    render(<CodeEditor solutions={[api, web]} opened={api} />);

    await user.click(await screen.findByLabelText("Open src/main.rs"));
    expect(await screen.findByLabelText("Editor for src/main.rs")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Add a solution"), "4");

    // the second Solution's own tree, and none of the first's files open
    expect(await screen.findByRole("list", { name: "Files in Shop Web" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Open src/main.rs")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Show src/main.rs")).not.toBeInTheDocument();

    // …and going back finds the first exactly as it was left
    await user.click(screen.getByLabelText("Show Shop API"));
    expect(await screen.findByLabelText("Editor for src/main.rs")).toBeInTheDocument();
  });

  it("closes a solution and falls back to another open one", async () => {
    const user = userEvent.setup();
    const api = solution();
    const web = solution({ id: 4, name: "Shop Web", localPath: "C:/repos/shop-web" });
    render(<CodeEditor solutions={[api, web]} opened={api} />);

    await user.selectOptions(await screen.findByLabelText("Add a solution"), "4");
    await screen.findByLabelText("Show Shop Web");

    await user.click(screen.getByLabelText("Close Shop Web"));
    expect(await screen.findByRole("list", { name: "Files in Shop API" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Show Shop Web")).not.toBeInTheDocument();
  });

  /// A Solution already open is brought forward, not opened twice.
  it("does not offer a solution that is already open", async () => {
    const api = solution();
    const web = solution({ id: 4, name: "Shop Web", localPath: "C:/repos/shop-web" });
    render(<CodeEditor solutions={[api, web]} opened={api} />);

    const picker = await screen.findByLabelText("Add a solution");
    expect(within(picker).getByRole("option", { name: "Shop Web" })).toBeInTheDocument();
    expect(within(picker).queryByRole("option", { name: "Shop API" })).not.toBeInTheDocument();
  });

  it("says where to start when nothing is open", async () => {
    render(<CodeEditor solutions={[solution()]} opened={null} />);
    expect(await screen.findByText(/No Solution open/)).toBeInTheDocument();
  });

  /// The reason the buffer lives in this component rather than the editor:
  /// switching tabs must not throw away work.
  it("keeps each open file's unsaved edits when switching between tabs", async () => {
    const user = userEvent.setup();
    mocked.readSolutionFile.mockImplementation(async (_id: number, path: string) =>
      path === "src/main.rs" ? "fn main() {}" : "# readme",
    );
    render(<CodeEditor solutions={[solution()]} opened={solution()} />);

    await user.click(await screen.findByLabelText("Open src/main.rs"));
    await user.type(await screen.findByLabelText("Editor for src/main.rs"), "{End} // wip");

    // open a second file, then come back
    await user.click(screen.getByLabelText("Open README.md"));
    expect(await screen.findByLabelText("Editor for README.md")).toHaveValue("# readme");

    await user.click(screen.getByLabelText("Show src/main.rs"));
    expect(await screen.findByLabelText("Editor for src/main.rs")).toHaveValue(
      "fn main() {} // wip",
    );
    expect(screen.getByLabelText("src/main.rs has unsaved changes")).toBeInTheDocument();
  });

  it("closes a tab and falls back to another open file", async () => {
    const user = userEvent.setup();
    mocked.readSolutionFile.mockResolvedValue("x");
    render(<CodeEditor solutions={[solution()]} opened={solution()} />);

    await user.click(await screen.findByLabelText("Open src/main.rs"));
    await user.click(screen.getByLabelText("Open README.md"));
    await user.click(screen.getByLabelText("Close README.md"));

    expect(await screen.findByLabelText("Editor for src/main.rs")).toBeInTheDocument();
    expect(screen.queryByLabelText("Show README.md")).not.toBeInTheDocument();
  });

  /// A flat list of every file at every depth is a wall; folders fold.
  it("collapses a folder and hides what is inside it", async () => {
    const user = userEvent.setup();
    render(<CodeEditor solutions={[solution()]} opened={solution()} />);

    expect(await screen.findByLabelText("Open src/main.rs")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Collapse src"));

    expect(screen.queryByLabelText("Open src/main.rs")).not.toBeInTheDocument();
    // the folder itself stays, and the file outside it is untouched
    expect(screen.getByLabelText("Expand src")).toBeInTheDocument();
    expect(screen.getByLabelText("Open README.md")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Expand src"));
    expect(screen.getByLabelText("Open src/main.rs")).toBeInTheDocument();
  });

  /// The pal drafts tests into a file that has to exist first.
  it("creates a file and opens it", async () => {
    const user = userEvent.setup();
    mocked.createSolutionFile.mockResolvedValue();
    mocked.readSolutionFile.mockResolvedValue("");
    render(<CodeEditor solutions={[solution()]} opened={solution()} />);

    await user.type(await screen.findByLabelText("New file path"), "src/new.rs");
    await user.click(screen.getByLabelText("Create file"));

    await waitFor(() =>
      expect(mocked.createSolutionFile).toHaveBeenCalledWith(3, "src/new.rs"),
    );
    expect(await screen.findByLabelText("Editor for src/new.rs")).toBeInTheDocument();
  });

  it("surfaces a refused file creation", async () => {
    const user = userEvent.setup();
    mocked.createSolutionFile.mockRejectedValue("src/main.rs already exists");
    render(<CodeEditor solutions={[solution()]} opened={solution()} />);

    await user.type(await screen.findByLabelText("New file path"), "src/main.rs");
    await user.click(screen.getByLabelText("Create file"));

    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
  });

  /// A partial tree that does not say so reads as a complete one.
  it("says when the tree was cut short", async () => {
    mocked.readSolutionTree.mockResolvedValue({ ...tree, truncated: true });
    render(<CodeEditor solutions={[solution()]} opened={solution()} />);

    expect(await screen.findByText(/more files not shown/)).toBeInTheDocument();
  });

  /// A linked GitHub repo is not a checkout — say where to fix it rather than
  /// showing an empty explorer.
  it("asks for a working copy when the Solution has none", async () => {
    render(<CodeEditor solutions={[solution({ localPath: null })]} opened={solution({ localPath: null })} />);

    expect(await screen.findByText(/no working copy on this machine yet/)).toBeInTheDocument();
    expect(mocked.readSolutionTree).not.toHaveBeenCalled();
  });

  it("surfaces a tree that cannot be read", async () => {
    mocked.readSolutionTree.mockRejectedValue("the folder for this Solution is not there any more");
    render(<CodeEditor solutions={[solution()]} opened={solution()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("not there any more");
  });

  /// The git toggle: the explorer stops being the repository and becomes the
  /// work in progress — which is the question actually being asked once a
  /// change is under way.
  it("swaps the tree for the changed files when git is toggled on", async () => {
    const user = userEvent.setup();
    mocked.productChangedFiles.mockResolvedValue([
      {
        solutionId: 3,
        name: "Shop API",
        changes: [
          {
            path: "src/basket.rs",
            status: "modified",
            addedLines: 12,
            removedLines: 3,
            diff: "@@ -1,2 +1,3 @@\n context\n+added line\n-removed line\n",
          },
        ],
        unavailable: null,
      },
    ]);
    render(<CodeEditor solutions={[solution()]} opened={solution()} />);

    // the whole repository to begin with
    expect(await screen.findByRole("list", { name: "Files in Shop API" })).toBeInTheDocument();

    await user.click(screen.getByLabelText("Changed files only"));

    const changed = await screen.findByRole("list", { name: "Changed files in Shop API" });
    expect(within(changed).getByText(/src\/basket\.rs/)).toBeInTheDocument();
    expect(within(changed).getByText(/\+12/)).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Files in Shop API" }),
    ).not.toBeInTheDocument();
  });

  /// "What has changed" is the other half of the ask — the file list alone
  /// says which files, not what happened in them.
  it("shows the diff for a changed file that is open", async () => {
    const user = userEvent.setup();
    mocked.readSolutionFile.mockResolvedValue("fn main() {}");
    mocked.productChangedFiles.mockResolvedValue([
      {
        solutionId: 3,
        name: "Shop API",
        changes: [
          {
            path: "src/main.rs",
            status: "modified",
            addedLines: 1,
            removedLines: 1,
            diff: "@@ -1 +1 @@\n-old line\n+new line\n",
          },
        ],
        unavailable: null,
      },
    ]);
    render(<CodeEditor solutions={[solution()]} opened={solution()} />);
    await user.click(await screen.findByLabelText("Changed files only"));
    await user.click(await screen.findByLabelText("Open src/main.rs"));

    const diff = await screen.findByRole("region", { name: "Changes to src/main.rs" });
    expect(within(diff).getByText(/\+new line/)).toBeInTheDocument();
    expect(within(diff).getByText(/-old line/)).toBeInTheDocument();
  });
});
