import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AiPlanReview from "../../components/planning/AiPlanReview";
import { formatFiles, parseFiles } from "../../lib/plan";
import type { WorkItemPlan } from "../../lib/backend";

const RESULT = {
  created: ["Greeter"],
  provider: "Anthropic",
  model: "claude",
  reason: "",
  blocked: null,
};

vi.mock("../../lib/backend", async () => {
  const actual = await vi.importActual<typeof import("../../lib/backend")>(
    "../../lib/backend",
  );
  return {
    ...actual,
    savePlanSchemas: vi.fn().mockResolvedValue(undefined),
    generateChangePlan: vi.fn(),
  };
});

const mocked = vi.mocked(await import("../../lib/backend"));

const plan = (over: Partial<WorkItemPlan> = {}): WorkItemPlan => ({
  id: 1,
  workItemId: 9,
  solutionId: 4,
  solutionName: "Greeter",
  changesRequired: "Greet by name",
  unitTests: "",
  branchName: "",
  cloneFrom: "",
  mockups: "[]",
  apiSchema: "",
  pageSchema: "",
  filesToChange: "",
  approvedAt: 0,
  ...over,
});

/** The string the model actually returned, from the report that prompted this
 *  screen: one line, semicolons between files, and the reason for each file in
 *  brackets after it. */
const REAL =
  'src/main.rs (console entry point: print prompt "Please enter your name", read stdin, call greeting validation); ' +
  "src/greeting.rs (pure function fn build_greeting(input: &str) -> Result<String, GreetingError>); " +
  "tests/greeting_tests.rs (behavioural tests: empty input asserts NoNameEntered)";

describe("reading the file list", () => {
  it("splits it into one entry per file", () => {
    const files = parseFiles(REAL);
    expect(files.map((f) => f.path)).toEqual([
      "src/main.rs",
      "src/greeting.rs",
      "tests/greeting_tests.rs",
    ]);
    expect(files[2].note).toContain("empty input asserts NoNameEntered");
  });

  /** A note is prose and prose has semicolons in it. Splitting on every one of
   *  them turned a three-file plan into eight nonsense rows. */
  it("keeps a semicolon that is inside a note", () => {
    const files = parseFiles("a.rs (does x; then y); b.rs (does z)");
    expect(files.map((f) => f.path)).toEqual(["a.rs", "b.rs"]);
    expect(files[0].note).toBe("does x; then y");
  });

  it("reads a list written one per line", () => {
    const files = parseFiles("src/main.rs\nsrc/lib.rs (the rest)");
    expect(files.map((f) => f.path)).toEqual(["src/main.rs", "src/lib.rs"]);
    expect(files[0].note).toBe("");
  });

  it("survives the round trip, so editing one row does not rewrite the others", () => {
    expect(parseFiles(formatFiles(parseFiles(REAL)))).toEqual(parseFiles(REAL));
  });

  it("has nothing to show for an empty plan", () => {
    expect(parseFiles("   ")).toEqual([]);
  });
});

describe("the AI planning tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.savePlanSchemas.mockResolvedValue(undefined);
    mocked.generateChangePlan.mockResolvedValue(RESULT);
  });

  it("lays the plan out per Solution, one row per file", () => {
    render(
      <AiPlanReview
        workItemId={9}
        plans={[plan({ filesToChange: REAL })]}
        onChanged={vi.fn()}
      />,
    );

    const section = screen.getByRole("region", { name: /Greeter/ });
    const files = within(section).getAllByRole("listitem");
    expect(files).toHaveLength(3);
    expect(files[0]).toHaveTextContent("src/main.rs");
    // The reason is beside the path, not concatenated into it.
    expect(within(section).getByText(/console entry point/)).toBeInTheDocument();
  });

  it("says there is no plan yet rather than showing an empty box", () => {
    render(<AiPlanReview workItemId={9} plans={[plan()]} onChanged={vi.fn()} />);
    expect(screen.getByText(/nothing planned for it yet/i)).toBeInTheDocument();
  });

  it("saves an edited file path without asking the AI again", async () => {
    const onChanged = vi.fn();
    render(
      <AiPlanReview
        workItemId={9}
        plans={[plan({ filesToChange: "src/main.rs (entry point)" })]}
        onChanged={onChanged}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Edit the plan/ }));
    const path = screen.getByLabelText("File 1 path");
    await userEvent.clear(path);
    await userEvent.type(path, "src/bin/main.rs");
    await userEvent.click(screen.getByRole("button", { name: "Save the plan" }));

    await waitFor(() =>
      expect(mocked.savePlanSchemas).toHaveBeenCalledWith({
        id: 1,
        apiSchema: "",
        pageSchema: "",
        filesToChange: "src/bin/main.rs (entry point)",
      }),
    );
    expect(mocked.generateChangePlan).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
  });

  it("drops a file the reviewer removed", async () => {
    render(
      <AiPlanReview
        workItemId={9}
        plans={[plan({ filesToChange: "a.rs (one); b.rs (two)" })]}
        onChanged={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Edit the plan/ }));
    await userEvent.click(screen.getByRole("button", { name: "Remove file 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Save the plan" }));

    await waitFor(() =>
      expect(mocked.savePlanSchemas).toHaveBeenCalledWith(
        expect.objectContaining({ filesToChange: "b.rs (two)" }),
      ),
    );
  });

  /** The other half of "change the plan": say what is wrong and let the model
   *  redo it, rather than typing the correction yourself. */
  it("sends the reviewer's instruction to the AI", async () => {
    render(
      <AiPlanReview
        workItemId={9}
        plans={[plan({ filesToChange: "a.rs (one)" })]}
        onChanged={vi.fn()}
      />,
    );

    await userEvent.type(
      screen.getByLabelText(/what to change about this plan/i),
      "use anyhow, not a custom error",
    );
    await userEvent.click(screen.getByRole("button", { name: /Ask the AI/ }));

    await waitFor(() =>
      expect(mocked.generateChangePlan).toHaveBeenCalledWith(
        9,
        "use anyhow, not a custom error",
      ),
    );
  });

  it("will not send an empty instruction", async () => {
    render(
      <AiPlanReview
        workItemId={9}
        plans={[plan({ filesToChange: "a.rs (one)" })]}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Ask the AI/ })).toBeDisabled();
  });

  /** A blocked reply is the model saying it cannot plan this, and it comes back
   *  as a result rather than an error — silently discarding it looked exactly
   *  like nothing happening. */
  it("shows what the AI said when it declines to revise", async () => {
    mocked.generateChangePlan.mockResolvedValue({
      ...RESULT,
      created: [],
      blocked: {
        reason: "Two Solutions claim the same endpoint",
        whatIsNeeded: "which one owns it",
        feedbackId: 3,
      },
    });
    render(
      <AiPlanReview
        workItemId={9}
        plans={[plan({ filesToChange: "a.rs (one)" })]}
        onChanged={vi.fn()}
      />,
    );

    await userEvent.type(
      screen.getByLabelText(/what to change about this plan/i),
      "split it",
    );
    await userEvent.click(screen.getByRole("button", { name: /Ask the AI/ }));

    expect(
      await screen.findByText(/Two Solutions claim the same endpoint/),
    ).toBeInTheDocument();
  });

  it("says when the plan has been approved as it stands", () => {
    render(
      <AiPlanReview
        workItemId={9}
        plans={[plan({ filesToChange: "a.rs (one)", approvedAt: 1_700_000_000_000 })]}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText(/approved/i)).toBeInTheDocument();
  });
});
