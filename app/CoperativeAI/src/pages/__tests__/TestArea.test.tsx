import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TestArea from "../TestArea";
import type { Deliverable, Product, TestCase, WorkItem } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    // The lifecycle checklist is written on this screen now; unmocked these

    // fall through to the real invoke and render an error alert.

    lifecycleGates: vi.fn(),

    listLifecycleSteps: vi.fn(),

    setLifecycleSteps: vi.fn(),

    listWorkItemSteps: vi.fn(),

    setWorkItemStep: vi.fn(),
    listProducts: vi.fn(),
    getStrategy: vi.fn(),
    saveStrategy: vi.fn(),
    listTestCases: vi.fn(),
    createTestCase: vi.fn(),
    updateTestCase: vi.fn(),
    deleteTestCase: vi.fn(),
    implementTestCase: vi.fn(),
    runTestCase: vi.fn(),
    listDeliverables: vi.fn(),
    listWorkItems: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const product: Product = { id: 1, name: "Shop App", answers: "{}" };
const deliverable: Deliverable = {
  id: 7,
  productId: 1,
  name: "MVP",
  description: "",
  dependsOnDeliverableId: null,
};
const workItem: WorkItem = {
  id: 20,
  title: "Login",
  itemType: "feature",
  status: "planned",
  description: null,
  productId: 1,
  parentItemId: null,
  assigneeId: null,
  sprintId: null,
  startDate: null,
  endDate: null,
  deliverableId: null,
  expectedCost: null,
  estimatedProfit: null,
  chargeable: false,
  customerCoverPct: null,
  risk: "",
  solutionId: null,
};
const testCase: TestCase = {
  id: 5,
  productId: 1,
  title: "Login works",
  scenario: "Given a user, when they sign in, then they see the workspace",
  state: "designed",
  testPath: null,
  deliverableId: null,
  workItemId: 20,
  testNames: [],
  lastRunAt: null,
  lastRunOutcome: null,
  lastRunSummary: null,
};

describe("TestArea (Testing Strategy + test cases)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.lifecycleGates.mockResolvedValue([]);
    mocked.listLifecycleSteps.mockResolvedValue([]);
    mocked.listWorkItemSteps.mockResolvedValue([]);
    mocked.listProducts.mockResolvedValue([product]);
    mocked.getStrategy.mockResolvedValue("{}");
    mocked.listTestCases.mockResolvedValue([testCase]);
    mocked.listDeliverables.mockResolvedValue([deliverable]);
    mocked.listWorkItems.mockResolvedValue([workItem]);
  });

  it("shows the Testing Strategy fields for the selected product", async () => {
    render(<TestArea />);
    expect(
      await screen.findByRole("region", { name: "Testing Strategy" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Test plans")).toBeInTheDocument();
    expect(screen.getByLabelText("Test environments")).toBeInTheDocument();
    expect(screen.getByLabelText("Required tooling")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Links to test cases / automated suites"),
    ).toBeInTheDocument();
  });

  it("lists existing test cases with what they are associated with", async () => {
    render(<TestArea />);
    expect(await screen.findByText("Login works")).toBeInTheDocument();
    // the caption, not the identically-worded <option> in the association picker
    expect(
      screen.getByText("Feature: Login", { selector: "span.test-link" }),
    ).toBeInTheDocument();
  });

  it("adds a test case associated with a deliverable and shows it", async () => {
    const user = userEvent.setup();
    // the reload after the write reflects it, as the real backend would
    mocked.createTestCase.mockImplementation(async () => {
      mocked.listTestCases.mockResolvedValue([
        testCase,
        { ...testCase, id: 9, title: "Checkout works", deliverableId: 7, workItemId: null },
      ]);
      return 9;
    });
    render(<TestArea />);

    await user.type(await screen.findByLabelText("Test title"), "Checkout works");
    await user.selectOptions(screen.getByLabelText("Associated with"), "d:7");
    await user.click(screen.getByRole("button", { name: "Add test case" }));

    expect(await screen.findByText("Checkout works")).toBeInTheDocument();
    await waitFor(() =>
      expect(mocked.createTestCase).toHaveBeenCalledWith({
        productId: 1,
        title: "Checkout works",
        scenario: "",
        deliverableId: 7,
        workItemId: null,
      }),
    );
  });

  it("associates an existing case with a deliverable instead of a work item", async () => {
    const user = userEvent.setup();
    mocked.updateTestCase.mockResolvedValue(undefined);
    render(<TestArea />);

    await user.selectOptions(
      await screen.findByLabelText("Associated with for Login works"),
      "d:7",
    );

    await waitFor(() =>
      expect(mocked.updateTestCase).toHaveBeenCalledWith({
        id: 5,
        title: "Login works",
        scenario: testCase.scenario,
        state: "designed",
        testPath: null,
        deliverableId: 7,
        workItemId: null,
      }),
    );
  });

  it("marking a case implemented reveals the test-file field", async () => {
    const user = userEvent.setup();
    mocked.updateTestCase.mockResolvedValue(undefined);
    render(<TestArea />);

    expect(
      screen.queryByLabelText("Test file for Login works"),
    ).not.toBeInTheDocument();

    await user.selectOptions(
      await screen.findByLabelText("State for Login works"),
      "implemented",
    );

    expect(
      await screen.findByLabelText("Test file for Login works"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(mocked.updateTestCase).toHaveBeenCalledWith(
        expect.objectContaining({ id: 5, state: "implemented" }),
      ),
    );
  });

  it("will not offer to implement a scenario that has no work item to ask", async () => {
    // The strict rule, in the UI: the AI policy belongs to a work item, so a
    // case linked to a Deliverable has nobody to ask. The button says why
    // rather than disappearing — a control that vanishes teaches nothing.
    mocked.listTestCases.mockResolvedValue([
      { ...testCase, deliverableId: 7, workItemId: null },
    ]);
    render(<TestArea />);

    const button = await screen.findByRole("button", {
      name: "Implement Login works with AI",
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/work item/i);
  });

  it("writes the test, shows where it landed, and marks the case implemented", async () => {
    const user = userEvent.setup();
    mocked.implementTestCase.mockImplementation(async () => {
      mocked.listTestCases.mockResolvedValue([
        { ...testCase, state: "implemented", testPath: "src/__tests__/login.test.ts" },
      ]);
      return {
        testPath: "src/__tests__/login.test.ts",
        provider: "Claude",
        model: "claude-sonnet-5",
        reason: "within budget",
        blocked: null,
      };
    });
    render(<TestArea />);

    await user.click(
      await screen.findByRole("button", { name: "Implement Login works with AI" }),
    );

    expect(await screen.findByText(/src\/__tests__\/login\.test\.ts/)).toBeInTheDocument();
    await waitFor(() => expect(mocked.implementTestCase).toHaveBeenCalledWith(5));
    // The row now reads as implemented, from the reload rather than a guess.
    await waitFor(() =>
      expect(screen.getByLabelText("State for Login works")).toHaveValue("implemented"),
    );
  });

  it("shows the AI's question when it declines, and leaves the case designed", async () => {
    const user = userEvent.setup();
    mocked.implementTestCase.mockResolvedValue({
      testPath: "",
      provider: "Claude",
      model: "claude-sonnet-5",
      reason: "within budget",
      blocked: {
        reason: "the scenario does not say what a pass looks like",
        whatIsNeeded: "what should the page show when the login fails?",
        feedbackId: 3,
      },
    });
    render(<TestArea />);

    await user.click(
      await screen.findByRole("button", { name: "Implement Login works with AI" }),
    );

    expect(
      await screen.findByText(/what should the page show when the login fails\?/),
    ).toBeInTheDocument();
    expect(screen.getByText(/does not say what a pass looks like/)).toBeInTheDocument();
    // Declining is not implementing.
    expect(screen.getByLabelText("State for Login works")).toHaveValue("designed");
  });

  it("says what refused when the backend blocks the call", async () => {
    const user = userEvent.setup();
    mocked.implementTestCase.mockRejectedValue(
      "'Login''s AI policy does not allow generating tests.",
    );
    render(<TestArea />);

    await user.click(
      await screen.findByRole("button", { name: "Implement Login works with AI" }),
    );

    expect(
      await screen.findByText(/does not allow generating tests/),
    ).toBeInTheDocument();
  });

  const implemented: TestCase = {
    ...testCase,
    state: "implemented",
    testPath: "src/__tests__/login.test.ts",
    testNames: ["rejects a wrong password"],
    lastRunAt: null,
    lastRunOutcome: null,
    lastRunSummary: null,
  };

  it("offers Run only once there is a test to run", async () => {
    render(<TestArea />);
    // Designed: nothing has been written, so there is nothing to run.
    expect(
      await screen.findByRole("button", { name: "Implement Login works with AI" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Run the test for Login works" }),
    ).not.toBeInTheDocument();
  });

  /// The heart of it: red is the expected result before the work is built, so
  /// the app must not present it as a failure of the scenario.
  it("reads a failing test as the expected result, not as an error", async () => {
    const user = userEvent.setup();
    mocked.listTestCases.mockResolvedValue([implemented]);
    mocked.runTestCase.mockResolvedValue({
      outcome: "failed",
      summary: "0 passed, 1 failed, 0 skipped",
      aboutThisTest: true,
      narrowed: true,
      commandLine: "npx vitest run --reporter=json src/__tests__/login.test.ts",
      output: "FAIL src/__tests__/login.test.ts",
      durationMs: 1200,
    });
    render(<TestArea />);

    await user.click(
      await screen.findByRole("button", { name: "Run the test for Login works" }),
    );

    const result = await screen.findByRole("status");
    expect(result).toHaveTextContent("failed");
    expect(result).toHaveTextContent(/expected.*work/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() => expect(mocked.runTestCase).toHaveBeenCalledWith(5));
  });

  /// And green is the ambiguous one — either the work is done, or the test
  /// does not exercise it. The app cannot tell, so it must not pretend to.
  it("gives a passing test both of its readings", async () => {
    const user = userEvent.setup();
    mocked.listTestCases.mockResolvedValue([implemented]);
    mocked.runTestCase.mockResolvedValue({
      outcome: "passed",
      summary: "1 passed, 0 failed, 0 skipped",
      aboutThisTest: true,
      narrowed: true,
      commandLine: "npx vitest run",
      output: "PASS",
      durationMs: 900,
    });
    render(<TestArea />);

    await user.click(
      await screen.findByRole("button", { name: "Run the test for Login works" }),
    );

    const result = await screen.findByRole("status");
    expect(result).toHaveTextContent("passed");
    expect(result).toHaveTextContent(/either the work is|does not/i);
  });

  /// A whole-suite result is not this scenario's result, and saying otherwise
  /// would blame it for somebody else's failing test.
  it("says when the verdict is the whole suite's rather than this test's", async () => {
    const user = userEvent.setup();
    mocked.listTestCases.mockResolvedValue([implemented]);
    mocked.runTestCase.mockResolvedValue({
      outcome: "failed",
      summary: "40 passed, 2 failed, 0 skipped",
      aboutThisTest: false,
      narrowed: false,
      commandLine: "cargo test",
      output: "…",
      durationMs: 30000,
    });
    render(<TestArea />);

    await user.click(
      await screen.findByRole("button", { name: "Run the test for Login works" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(/whole suite/i);
  });

  it("shows the last run on arrival, without running anything", async () => {
    mocked.listTestCases.mockResolvedValue([
      {
        ...implemented,
        lastRunAt: 1755000000000,
        lastRunOutcome: "failed",
        lastRunSummary: "0 passed, 1 failed, 0 skipped",
      },
    ]);
    render(<TestArea />);

    expect(await screen.findByText(/0 passed, 1 failed/)).toBeInTheDocument();
    expect(mocked.runTestCase).not.toHaveBeenCalled();
  });

  it("asks for a Product first when none exist", async () => {
    mocked.listProducts.mockResolvedValue([]);
    render(<TestArea />);
    expect(await screen.findByText(/create one in the Product tab/i)).toBeInTheDocument();
  });
});

