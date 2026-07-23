import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DiagramBuilder, {
  buildDrawio,
  buildMermaid,
} from "../../components/DiagramBuilder";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    draftArchitecture: vi.fn(),
    saveArchitectureDoc: vi.fn(),
    saveDiagram: vi.fn(),
    openDiagram: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const nodes = [
  { id: "solution-3", label: "Shop API", kind: "service" },
  { id: "solution-7", label: "Orders", kind: "database" },
];
const edges = [
  { from: "solution-3", to: "solution-7", label: "shares a schema with" },
];

describe("the two renderings", () => {
  /// **Mirrored from `drawio::to_mermaid`.** The Rust test
  /// `the_same_draft_renders_as_mermaid` asserts the identical output — the
  /// draft is rendered there and later edits are rendered here, so if the two
  /// drifted a diagram would change notation halfway through being built.
  it("produces the Mermaid the backend would", () => {
    const mermaid = buildMermaid(nodes, edges);
    expect(mermaid.startsWith("flowchart TD")).toBe(true);
    expect(mermaid).toContain('solution_3["Shop API"]');
    expect(mermaid).toContain('solution_7[("Orders")]');
    expect(mermaid).toContain("solution_3 -->|shares a schema with| solution_7");
  });

  /// A dash ends a Mermaid id, and our own ids are `solution-3`.
  it("makes ids safe the same way", () => {
    expect(buildMermaid([{ id: "3rd", label: "X", kind: "service" }], [])).toContain(
      'n3rd["X"]',
    );
  });

  /// A pipe closes an arrow label early and takes the rest of the line.
  it("swaps the punctuation that would break a flowchart", () => {
    const out = buildMermaid(
      [
        { id: "a", label: 'A "quoted" box', kind: "service" },
        { id: "b", label: "B", kind: "service" },
      ],
      [{ from: "a", to: "b", label: "reads|writes" }],
    );
    expect(out).not.toContain('"quoted"');
    expect(out).toContain("reads/writes");
  });

  /// Mirrored from `drawio::build` — an mxfile the real draw.io will open.
  it("produces mxGraph draw.io will open", () => {
    const xml = buildDrawio("Architecture", nodes, edges);
    expect(xml.startsWith("<mxfile")).toBe(true);
    expect(xml).toContain('<mxCell id="0" />');
    expect(xml).toContain('value="Shop API"');
    expect(xml).toContain('source="solution-3" target="solution-7"');
    // the same grid the Rust side writes
    expect(xml).toContain('x="40" y="40"');
    expect(xml).toContain('x="240" y="40"');
  });

  it("escapes the characters that would corrupt the file", () => {
    const xml = buildDrawio("A & B", [{ id: "x", label: "Orders & <Billing>", kind: "service" }], []);
    expect(xml).toContain("Orders &amp; &lt;Billing&gt;");
    expect(xml).not.toContain("<Billing>");
  });
});

describe("DiagramBuilder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.draftArchitecture.mockResolvedValue({
      format: "mermaid",
      content: "flowchart TD\n",
      nodes,
      edges,
    });
    mocked.saveArchitectureDoc.mockResolvedValue(1);
    mocked.saveDiagram.mockResolvedValue("C:/p/.CoperativeAI/diagrams/architecture.drawio");
  });

  /// The merge, in one assertion: the same builder serves both notations,
  /// because which notation a diagram is written in is a rendering choice
  /// rather than a different feature.
  it("drafts from the Solutions in whichever notation is chosen", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DiagramBuilder
        productId={1}
        kind="infrastructure"
        format="mermaid"
        solutionId=""
        onSaved={() => {}}
        onError={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Draft from this Product/ }));
    await waitFor(() => expect(mocked.draftArchitecture).toHaveBeenCalledWith(1, "mermaid"));

    rerender(
      <DiagramBuilder
        productId={1}
        kind="infrastructure"
        format="drawio"
        solutionId=""
        onSaved={() => {}}
        onError={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Draft from this Product/ }));
    await waitFor(() => expect(mocked.draftArchitecture).toHaveBeenCalledWith(1, "drawio"));
  });

  /// Mermaid is text and lives in the document. draw.io is a file as well, so
  /// the real editor can open it — that is the only difference on save.
  it("saves Mermaid as a document and draw.io as a document and a file", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DiagramBuilder
        productId={1}
        kind="infrastructure"
        format="mermaid"
        solutionId=""
        onSaved={() => {}}
        onError={() => {}}
      />,
    );

    await user.type(screen.getByLabelText("Box label"), "Shop API");
    await user.click(screen.getByRole("button", { name: "Add box" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocked.saveArchitectureDoc).toHaveBeenCalledWith(
        expect.objectContaining({ format: "mermaid", kind: "infrastructure" }),
      ),
    );
    expect(mocked.saveDiagram).not.toHaveBeenCalled();

    rerender(
      <DiagramBuilder
        productId={1}
        kind="infrastructure"
        format="drawio"
        solutionId=""
        onSaved={() => {}}
        onError={() => {}}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /Save and write the .drawio file/ }),
    );
    await waitFor(() => expect(mocked.saveDiagram).toHaveBeenCalled());
    expect(await screen.findByText(/architecture\.drawio/)).toBeInTheDocument();
  });

  /// The preview is the boxes, so it is the same picture either way.
  it("previews the boxes whichever notation is chosen", async () => {
    const user = userEvent.setup();
    render(
      <DiagramBuilder
        productId={1}
        kind="infrastructure"
        format="drawio"
        solutionId=""
        onSaved={() => {}}
        onError={() => {}}
      />,
    );

    await user.type(screen.getByLabelText("Box label"), "Shop API");
    await user.click(screen.getByRole("button", { name: "Add box" }));

    const preview = await screen.findByRole("region", { name: "Preview" });
    expect(within(preview).getByRole("img", { name: "Diagram preview" })).toBeInTheDocument();
    expect(within(preview).getByText("Shop API")).toBeInTheDocument();
  });

  /// PlantUML and JSON graphs are written, not drawn — the builder says so
  /// rather than offering boxes that cannot be rendered.
  it("stands aside for the notations it cannot draw", () => {
    render(
      <DiagramBuilder
        productId={1}
        kind="infrastructure"
        format="plantuml"
        solutionId=""
        onSaved={() => {}}
        onError={() => {}}
      />,
    );
    expect(screen.getByText(/write the document below/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Box label")).not.toBeInTheDocument();
  });
});
