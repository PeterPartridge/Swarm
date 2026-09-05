import { render, screen, waitFor, within } from "@testing-library/react";
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

  /// **The agent's changes, where the files are.** An agent works in its own
  /// checkout, and the Product-wide change list reads each Solution's main
  /// folder — so the pane that shows files showed the default branch and no
  /// sign that an agent had touched anything. Clicking into an agent now shows
  /// what that agent changed.
  it("shows the selected agent's changed files instead of the branch tree", async () => {
    render(
      <BuildExplorer
        productId={1}
        solutions={[solution]}
        solutionId={5}
        selectedPath={null}
        onSelectFile={() => {}}
        runChanges={[change("Greeting.cs"), change("tests/GreetingTests.cs")]}
      />,
    );

    const list = await screen.findByRole("region", { name: "Files" });
    expect(within(list).getByText("Greeting.cs")).toBeInTheDocument();
    expect(within(list).getByText("GreetingTests.cs")).toBeInTheDocument();
    // Not the default branch's tree: those files are not what the agent did,
    // and a file it *added* is not in that tree at all.
    expect(within(list).queryByText("main.ts")).not.toBeInTheDocument();
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

    expect(await screen.findByText("main.ts")).toBeInTheDocument();
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
        runChanges={[change("Greeting.cs"), change("Program.cs")]}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/2 changed by this agent/i)).toBeInTheDocument(),
    );
  });
});
