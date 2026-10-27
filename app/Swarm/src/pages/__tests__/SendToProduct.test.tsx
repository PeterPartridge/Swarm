import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SendToProduct from "../../components/product/SendToProduct";
import NewProjectForm from "../../components/product/NewProjectForm";
import type { Product } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return { ...original, handOverProduct: vi.fn(), createProduct: vi.fn() };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const project = (over: Partial<Product> = {}): Product => ({
  id: 7,
  name: "Dev Project",
  answers: "{}",
  origin: "develop",
  handedOverAt: null,
  inProductArea: false,
  ...over,
});

describe("Send to Product", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.handOverProduct.mockResolvedValue();
  });

  it("is offered for this area's Project until it is sent", () => {
    render(<SendToProduct product={project()} area="develop" onSent={() => {}} />);
    expect(screen.getByRole("button", { name: "Send to Product" })).toBeInTheDocument();
  });

  it("is not offered once the Product is in the Product area", () => {
    render(
      <SendToProduct
        product={project({ handedOverAt: 1, inProductArea: true })}
        area="develop"
        onSent={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Send to Product" })).toBeNull();
  });

  it("is not offered for another area's Project", () => {
    render(<SendToProduct product={project({ origin: "test" })} area="develop" onSent={() => {}} />);
    expect(screen.queryByRole("button", { name: "Send to Product" })).toBeNull();
  });

  it("hands the Project over, then tells the area", async () => {
    const onSent = vi.fn();
    render(<SendToProduct product={project()} area="develop" onSent={onSent} />);
    await userEvent.click(screen.getByRole("button", { name: "Send to Product" }));
    expect(mocked.handOverProduct).toHaveBeenCalledWith(7);
    await waitFor(() => expect(onSent).toHaveBeenCalled());
  });

  it("says why when the hand-over is refused", async () => {
    mocked.handOverProduct.mockRejectedValue("'Dev Project' is already in the Product area");
    render(<SendToProduct product={project()} area="develop" onSent={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Send to Product" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already in the Product area");
  });
});

describe("New project", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.createProduct.mockResolvedValue(3);
  });

  it("is made in the area it was created from", async () => {
    render(<NewProjectForm origin="test" onCreated={() => {}} />);
    await userEvent.type(screen.getByLabelText("Project name"), "QA Project");
    await userEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(mocked.createProduct).toHaveBeenCalledWith("QA Project", "{}", undefined, "test");
  });

  it("says it stays here until it is sent", () => {
    render(<NewProjectForm origin="develop" onCreated={() => {}} />);
    expect(screen.getByText(/stays in Develop until/)).toBeInTheDocument();
  });
});
