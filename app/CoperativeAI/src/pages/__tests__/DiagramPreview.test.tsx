import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DiagramPreview } from "../../components/DiagramPreview";
import { diagramPosition, DIAGRAM_GRID } from "../../lib/backend";




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
