import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TestArea from "../TestArea";
import type { Deliverable, Product, TestCase, WorkItem } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listProducts: vi.fn(),
    getStrategy: vi.fn(),
    saveStrategy: vi.fn(),
    listTestCases: vi.fn(),
    createTestCase: vi.fn(),
    updateTestCase: vi.fn(),
    deleteTestCase: vi.fn(),
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
};

describe("TestArea (Testing Strategy + test cases)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("asks for a Product first when none exist", async () => {
    mocked.listProducts.mockResolvedValue([]);
    render(<TestArea />);
    expect(await screen.findByText(/create one in the Product tab/i)).toBeInTheDocument();
  });
});
