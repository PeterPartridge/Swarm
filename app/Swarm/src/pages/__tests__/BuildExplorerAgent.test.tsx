import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BuildExplorer from "../../components/code/BuildExplorer";
import type { FileChange, Solution } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    readSolutionTree: vi.fn(),
    productChangedFiles: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const solution = {
  id: 5,
  name: "Shop API",
  productId: 1,
  localPath: "C:/repos/shop-api",
} as Solution;

const change = (path: string): FileChange =>
  ({ path, status: "modified", addedLines: 3, removedLines: 1, diff: "" }) as FileChange;

describe("the Files pane while an agent is selected", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.readSolutionTree.mockResolvedValue({
      entries: [
        { path: "src", name: "src", isDir: true, depth: 0 },
        { path: "src/main.ts", name: "main.ts", isDir: false, depth: 1 },
      ],
      truncated: false,
    } as never);
    mocked.productChangedFiles.mockResolvedValue([]);
  });

  /// **The agent's own checkout is the tree.** An agent works in a worktree,
  /// and the Product-wide change list reads each Solution's main folder — so
  /// the pane that shows files showed the default branch and no sign that an
  /// agent had touched anything. Clicking into an agent walks *its* checkout,
  /// which is also the only place the files it added exist.
  it("walks the selected agent's checkout, not the Solution's folder", async () => {
    render(
      <BuildExplorer
        productId={1}
        solutions={[solution]}
        solutionId={5}
        selectedPath={null}
        onSelectFile={() => {}}
        runId={7}
        runChanges={[change("Greeting.cs")]}
      />,
    );

    await waitFor(() => expect(mocked.readSolutionTree).toHaveBeenCalledWith(5, 7));
    const list = await screen.findByRole("region", { name: "Files" });
    // The walk's own entries are there — folded, as everything starts — and so
    // is the file the agent added, which exists in no other checkout.
    expect(within(list).getByLabelText("Folder src")).toBeInTheDocument();
    expect(within(list).getByText("Greeting.cs")).toBeInTheDocument();
  });

  /// **Closed until somebody opens them.** A tree that arrives fully expanded
  /// is a wall of paths — a .NET project opens on `bin/Debug/net8.0/…` before
  /// anything a person wrote. The shape of the repository first, the contents
  /// on a click.
  it("starts with every folder closed, and opens one when it is clicked", async () => {
    const user = userEvent.setup();
    mocked.readSolutionTree.mockResolvedValue({
      entries: [
        { path: "src", name: "src", isDir: true, depth: 0 },
        { path: "src/main.ts", name: "main.ts", isDir: false, depth: 1 },
        { path: "README.md", name: "README.md", isDir: false, depth: 0 },
      ],
      truncated: false,
    } as never);
    render(
      <BuildExplorer
        productId={1}
        solutions={[solution]}
        solutionId={5}
        selectedPath={null}
        onSelectFile={() => {}}
      />,
    );

    // The top level, and nothing under it.
    expect(await screen.findByLabelText("Folder src")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.queryByText("main.ts")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Folder src"));
    expect(await screen.findByText("main.ts")).toBeInTheDocument();
  });

  /// **Except where the point is the changes.** "Changed only" exists to show
  /// what changed; hiding those behind folders to open one at a time would make
  /// that view answer nothing.
  it("shows changed files without opening anything, in the changed-only view", async () => {
    const user = userEvent.setup();
    render(
      <BuildExplorer
        productId={1}
        solutions={[solution]}
        solutionId={5}
        selectedPath={null}
        onSelectFile={() => {}}
        runId={7}
        runChanges={[change("bin/Debug/net8.0/hello.dll")]}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Whole tree" }));
    expect(
      await screen.findByLabelText("bin/Debug/net8.0/hello.dll"),
    ).toBeInTheDocument();
  });

  /// **The folders the walk skips, when something in them changed.** `bin` and
  /// `obj` are skipped for good reasons — generated, enormous — and in a .NET
  /// project they are exactly where the changed files are. A change is worth
  /// seeing wherever it lives, in the folders it really sits in.
  it("shows a change under folders the walk skipped, nested where it belongs", async () => {
    render(
      <BuildExplorer
        productId={1}
        solutions={[solution]}
        solutionId={5}
        selectedPath={null}
        onSelectFile={() => {}}
        runId={7}
        runChanges={[change("bin/Debug/net8.0/hello.dll")]}
      />,
    );

    const user = userEvent.setup();
    const list = await screen.findByRole("region", { name: "Files" });
    // Closed to begin with: the folder is there, its contents are not.
    expect(within(list).getByLabelText("Folder bin")).toBeInTheDocument();
    expect(within(list).queryByLabelText("Folder Debug")).not.toBeInTheDocument();

    // Opening down the path finds the changed file where it really lives.
    await user.click(within(list).getByLabelText("Folder bin"));
    await user.click(await within(list).findByLabelText("Folder Debug"));
    await user.click(await within(list).findByLabelText("Folder net8.0"));
    expect(
      await within(list).findByLabelText("bin/Debug/net8.0/hello.dll"),
    ).toBeInTheDocument();
  });

  /// **Closing out puts the branch back.** The agent's checkout is a detour;
  /// the Solution's own files are where the pane lives the rest of the time.
  it("goes back to the default branch when no agent is selected", async () => {
    const { rerender } = render(
      <BuildExplorer
        productId={1}
        solutions={[solution]}
        solutionId={5}
        selectedPath={null}
        onSelectFile={() => {}}
        runId={7}
        runChanges={[change("Greeting.cs")]}
      />,
    );
    await screen.findByText("Greeting.cs");

    rerender(
      <BuildExplorer
        productId={1}
        solutions={[solution]}
        solutionId={5}
        selectedPath={null}
        onSelectFile={() => {}}
        runChanges={null}
      />,
    );

    expect(await screen.findByLabelText("Folder src")).toBeInTheDocument();
    expect(screen.queryByText("Greeting.cs")).not.toBeInTheDocument();
  });

  /// An agent that has changed nothing yet is said plainly. An empty list where
  /// a tree used to be reads as a broken pane.
  it("says so when the agent has not changed anything yet", async () => {
    render(
      <BuildExplorer
        productId={1}
        solutions={[solution]}
        solutionId={5}
        selectedPath={null}
        onSelectFile={() => {}}
        runId={7}
        runChanges={[]}
      />,
    );
    expect(
      await screen.findByText(/has not changed anything yet/i),
    ).toBeInTheDocument();
  });

  /// The count says what it is counting. "3 changed of 400" is about a
  /// repository; an agent's pane is about one agent.
  it("counts the agent's files rather than the repository's", async () => {
    render(
      <BuildExplorer
        productId={1}
        solutions={[solution]}
        solutionId={5}
        selectedPath={null}
        onSelectFile={() => {}}
        runId={7}
        runChanges={[change("Greeting.cs"), change("Program.cs")]}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/2 changed by this agent/i)).toBeInTheDocument(),
    );
  });
});
