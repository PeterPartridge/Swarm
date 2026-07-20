import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SprintManager from "../../components/SprintManager";
import type { Sprint } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listSprints: vi.fn(),
    createSprint: vi.fn(),
    removeSprint: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const sprint: Sprint = {
  id: 9,
  productId: 7,
  name: "Sprint 1",
  startDate: Date.parse("2026-08-01"),
  endDate: Date.parse("2026-08-14"),
};

describe("SprintManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listSprints.mockResolvedValue([sprint]);
  });

  it("lists sprints with their dates", async () => {
    render(<SprintManager productId={7} />);
    const list = await screen.findByRole("region", { name: "Sprints" });
    expect(within(list).getByText("Sprint 1")).toBeInTheDocument();
    expect(within(list).getByText("2026-08-01 → 2026-08-14")).toBeInTheDocument();
  });

  /// Dates are optional: teams that run sprints by number, not calendar,
  /// must not be forced to invent them.
  it("creates a sprint with no dates", async () => {
    const user = userEvent.setup();
    mocked.createSprint.mockResolvedValue(10);
    render(<SprintManager productId={7} />);

    await user.type(await screen.findByLabelText("Sprint name"), "Sprint 2");
    await user.click(screen.getByRole("button", { name: "Add sprint" }));

    await waitFor(() =>
      expect(mocked.createSprint).toHaveBeenCalledWith({
        productId: 7,
        name: "Sprint 2",
        startDate: null,
        endDate: null,
      }),
    );
  });

  it("removes a sprint", async () => {
    const user = userEvent.setup();
    mocked.removeSprint.mockResolvedValue();
    render(<SprintManager productId={7} />);

    await user.click(await screen.findByLabelText("Remove sprint Sprint 1"));
    await waitFor(() => expect(mocked.removeSprint).toHaveBeenCalledWith(9));
  });

  it("says so when there are no sprints yet", async () => {
    mocked.listSprints.mockResolvedValue([]);
    render(<SprintManager productId={7} />);
    expect(await screen.findByText(/No sprints yet/)).toBeInTheDocument();
  });
});
