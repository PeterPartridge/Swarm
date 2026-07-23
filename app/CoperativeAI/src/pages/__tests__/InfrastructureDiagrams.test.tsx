import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InfrastructureDiagrams, {
  DiagramPreview,
} from "../../components/InfrastructureDiagrams";
import { diagramPosition, DIAGRAM_GRID } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listDiagrams: vi.fn(),
    saveDiagram: vi.fn(),
    openDiagram: vi.fn(),
    diagramFromSolutions: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

describe("the shared grid", () => {
  /// **Mirrored from `drawio.rs`.** The identical assertions live in
  /// `the_grid_positions_are_the_ones_the_preview_mirrors` — a preview laid
  /// out differently from the file would be a picture of a diagram nobody is
  /// about to get, which is worse than showing none.
  it("puts boxes exactly where the .drawio file will", () => {
    expect(diagramPosition(0)).toEqual({ x: 40, y: 40 });
    expect(diagramPosition(3)).toEqual({ x: 640, y: 40 });
    expect(diagramPosition(4)).toEqual({ x: 40, y: 180 });
    expect(diagramPosition(5)).toEqual({ x: 240, y: 180 });
    expect([DIAGRAM_GRID.w, DIAGRAM_GRID.h]).toEqual([160, 60]);
  });
});

describe("DiagramPreview", () => {
  it("draws a box per node and a line per edge", () => {
    render(
      <DiagramPreview
        nodes={[
          { id: "api", label: "Shop API", kind: "service" },
          { id: "db", label: "Orders", kind: "database" },
        ]}
        edges={[{ from: "api", to: "db", label: "reads" }]}
      />,
    );

    const svg = screen.getByRole("img", { name: "Diagram preview" });
    expect(within(svg).getByText("Shop API")).toBeInTheDocument();
    expect(within(svg).getByText("Orders")).toBeInTheDocument();
    expect(within(svg).getByText("reads")).toBeInTheDocument();
    expect(svg.querySelectorAll("rect")).toHaveLength(2);
    expect(svg.querySelectorAll("line")).toHaveLength(1);
  });

  /// An arrow to a box that is not on the diagram would draw a line to
  /// nowhere, which reads as a rendering fault rather than a missing box.
  it("skips an arrow whose other end is not there", () => {
    render(
      <DiagramPreview
        nodes={[{ id: "api", label: "Shop API", kind: "service" }]}
        edges={[{ from: "api", to: "ghost", label: "calls" }]}
      />,
    );
    const svg = screen.getByRole("img", { name: "Diagram preview" });
    expect(svg.querySelectorAll("line")).toHaveLength(0);
  });

  it("says what to do when there is nothing yet", () => {
    render(<DiagramPreview nodes={[]} edges={[]} />);
    expect(screen.getByText(/Add a box/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("InfrastructureDiagrams", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listDiagrams.mockResolvedValue([]);
  });

  /// The point of having recorded the Solutions: the first draft is not typed
  /// in again by hand.
  it("drafts the diagram from the Product's Solutions", async () => {
    const user = userEvent.setup();
    mocked.diagramFromSolutions.mockResolvedValue({
      nodes: [
        { id: "solution-3", label: "Shop API", kind: "service" },
        { id: "solution-7", label: "Orders", kind: "database" },
      ],
      edges: [{ from: "solution-3", to: "solution-7", label: "shares a schema with" }],
    });
    render(<InfrastructureDiagrams productId={1} />);

    await user.click(
      await screen.findByRole("button", { name: /Draft from this Product/ }),
    );

    await waitFor(() => expect(mocked.diagramFromSolutions).toHaveBeenCalledWith(1));
    // and it lands in the preview immediately, before any file exists
    const svg = await screen.findByRole("img", { name: "Diagram preview" });
    expect(within(svg).getByText("Shop API")).toBeInTheDocument();
    expect(within(svg).getByText("shares a schema with")).toBeInTheDocument();
  });

  /// Drafting from nothing must say so rather than blanking a diagram
  /// somebody was part-way through.
  it("says when there are no Solutions to draw from", async () => {
    const user = userEvent.setup();
    mocked.diagramFromSolutions.mockResolvedValue({ nodes: [], edges: [] });
    render(<InfrastructureDiagrams productId={1} />);

    await user.click(
      await screen.findByRole("button", { name: /Draft from this Product/ }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/no Solutions yet/);
  });

  /// The preview updates as boxes are added, which is the whole point of it
  /// being rendered from the nodes rather than from a saved file.
  it("updates the preview as a box is added", async () => {
    const user = userEvent.setup();
    render(<InfrastructureDiagrams productId={1} />);

    // Nothing drawn yet, so the preview says what to do rather than showing
    // an empty frame. Scoped: "Add a box" is also the form's own label.
    const preview = await screen.findByRole("region", { name: "Preview" });
    expect(within(preview).getByText(/Add a box and it will appear here/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Box label"), "Shop API");
    await user.click(screen.getByRole("button", { name: "Add box" }));

    const svg = await screen.findByRole("img", { name: "Diagram preview" });
    expect(within(svg).getByText("Shop API")).toBeInTheDocument();
  });

  it("writes the file and says where it went", async () => {
    const user = userEvent.setup();
    mocked.saveDiagram.mockResolvedValue("C:/products/shop/.CoperativeAI/diagrams/infrastructure.drawio");
    render(<InfrastructureDiagrams productId={1} />);

    await user.type(await screen.findByLabelText("Box label"), "Shop API");
    await user.click(screen.getByRole("button", { name: "Add box" }));
    await user.click(screen.getByRole("button", { name: /Write the .drawio file/ }));

    await waitFor(() =>
      expect(mocked.saveDiagram).toHaveBeenCalledWith(
        1,
        "Infrastructure",
        [{ id: "shop-api", label: "Shop API", kind: "service" }],
        [],
      ),
    );
    expect(await screen.findByText(/infrastructure\.drawio/)).toBeInTheDocument();
  });

  /// Removing a box must take its arrows with it, or the file opens in draw.io
  /// with a dangling edge that looks like corruption.
  it("removes a box's arrows along with the box", async () => {
    const user = userEvent.setup();
    mocked.saveDiagram.mockResolvedValue("x.drawio");
    render(<InfrastructureDiagrams productId={1} />);

    await user.type(await screen.findByLabelText("Box label"), "Shop API");
    await user.click(screen.getByRole("button", { name: "Add box" }));
    await user.type(screen.getByLabelText("Box label"), "Orders");
    await user.click(screen.getByRole("button", { name: "Add box" }));

    await user.selectOptions(screen.getByLabelText("Arrow from"), "shop-api");
    await user.selectOptions(screen.getByLabelText("Arrow to"), "orders");
    await user.click(screen.getByRole("button", { name: "Add arrow" }));

    await user.click(screen.getByLabelText("Remove Shop API"));
    await user.click(screen.getByRole("button", { name: /Write the .drawio file/ }));

    await waitFor(() =>
      expect(mocked.saveDiagram).toHaveBeenCalledWith(1, "Infrastructure", [
        { id: "orders", label: "Orders", kind: "service" },
      ], []),
    );
  });
});
