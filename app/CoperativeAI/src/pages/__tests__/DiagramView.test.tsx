import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DiagramView, {
  clearDiagramCache,
  jsonGraphToMermaid,
} from "../../components/DiagramView";

const renderMock = vi.fn();
const initializeMock = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: (...args: unknown[]) => initializeMock(...args),
    render: (...args: unknown[]) => renderMock(...args),
  },
}));

describe("DiagramView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The cache is global and outlives a component on purpose; clear it so one
    // case's drawing is not another's silent pass.
    clearDiagramCache();
    renderMock.mockResolvedValue({ svg: "<svg><g>drawn</g></svg>" });
  });

  it("draws a Mermaid diagram", async () => {
    render(<DiagramView content="flowchart TD\n A-->B" format="mermaid" label="How it fits" />);

    expect(await screen.findByRole("img", { name: "How it fits" })).toBeInTheDocument();
    // source is available but not in the way
    expect(screen.queryByLabelText("How it fits source")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Show source of How it fits")).toBeInTheDocument();
  });

  /// A stored diagram is data. Mermaid directives can change how it renders,
  /// and a diagram should not be able to reconfigure the app around it.
  it("renders with Mermaid's strict security level", async () => {
    render(<DiagramView content="flowchart TD\n A-->B" format="mermaid" label="X" />);

    await waitFor(() => expect(initializeMock).toHaveBeenCalled());
    expect(initializeMock).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: "strict", startOnLoad: false }),
    );
  });

  /// The structural check that let this be stored is not a parser, so a diagram
  /// can pass it and still fail to render. A blank space would explain nothing.
  it("says why a diagram did not render, and falls back to the source", async () => {
    renderMock.mockRejectedValue(new Error("Parse error on line 2"));
    render(<DiagramView content="flowchart TD\n ???" format="mermaid" label="Broken" />);

    expect(await screen.findByText(/did not render: Parse error on line 2/)).toBeInTheDocument();
    expect(screen.getByLabelText("Broken source")).toHaveTextContent("flowchart TD");
  });

  /// A page of architecture diagrams re-drawing on every tab switch is time
  /// paid for a picture that cannot have changed.
  it("draws a given source once and reuses it", async () => {
    const { unmount } = render(
      <DiagramView content="flowchart TD\n A-->B" format="mermaid" label="Once" />,
    );
    expect(await screen.findByRole("img", { name: "Once" })).toBeInTheDocument();
    expect(renderMock).toHaveBeenCalledTimes(1);
    unmount();

    render(<DiagramView content="flowchart TD\n A-->B" format="mermaid" label="Again" />);
    expect(await screen.findByRole("img", { name: "Again" })).toBeInTheDocument();
    expect(renderMock).toHaveBeenCalledTimes(1);

    // …but a different diagram is still drawn.
    render(<DiagramView content="flowchart TD\n C-->D" format="mermaid" label="Other" />);
    await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(2));
  });

  it("shows and hides the source on request", async () => {
    const user = userEvent.setup();
    render(<DiagramView content="flowchart TD\n A-->B" format="mermaid" label="X" />);

    await user.click(await screen.findByLabelText("Show source of X"));
    expect(screen.getByLabelText("X source")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Hide source of X"));
    expect(screen.queryByLabelText("X source")).not.toBeInTheDocument();
  });

  /// Rendering PlantUML in a browser means posting it to a third-party server.
  /// A private architecture diagram is not worth sending elsewhere for a
  /// picture, so it is not drawn and the reason is given.
  it("refuses to draw PlantUML rather than sending it away", async () => {
    render(<DiagramView content="@startuml\nA -> B\n@enduml" format="plantuml" label="Infra" />);

    expect(await screen.findByLabelText("Infra source")).toHaveTextContent("@startuml");
    expect(screen.getByText(/sending the diagram to a third-party server/)).toBeInTheDocument();
    expect(renderMock).not.toHaveBeenCalled();
  });

  it("converts a JSON graph and draws that", async () => {
    render(
      <DiagramView
        content='{"nodes":[{"id":"web","label":"Web"},{"id":"api"}],"edges":[{"from":"web","to":"api"}]}'
        format="jsonGraph"
        label="Map"
      />,
    );

    await waitFor(() => expect(renderMock).toHaveBeenCalled());
    const source = renderMock.mock.calls[0][1] as string;
    expect(source).toContain("flowchart TD");
    expect(source).toContain('n_web["Web"]');
    expect(source).toContain("n_web --> n_api");
  });
});

describe("jsonGraphToMermaid", () => {
  /// Mermaid node ids cannot hold the punctuation a JSON id happily can.
  it("sanitises ids and keeps the original as the label", () => {
    const out = jsonGraphToMermaid(
      '{"nodes":[{"id":"shop-api/v2","label":"Shop API"}],"edges":[]}',
    );
    expect(out).toContain('n_shop_api_v2["Shop API"]');
  });

  it("falls back to the id when there is no label", () => {
    expect(jsonGraphToMermaid('{"nodes":[{"id":"api"}],"edges":[]}')).toContain('n_api["api"]');
  });

  /// A bracket or quote in a label would otherwise close the node early.
  it("keeps punctuation in a label from breaking the diagram", () => {
    const out = jsonGraphToMermaid(
      '{"nodes":[{"id":"a","label":"The \\"main\\" API"}],"edges":[]}',
    );
    expect(out).toContain(`n_a["The 'main' API"]`);
  });

  it("labels an edge when it has one", () => {
    const out = jsonGraphToMermaid(
      '{"nodes":[{"id":"a"},{"id":"b"}],"edges":[{"from":"a","to":"b","label":"calls"}]}',
    );
    expect(out).toContain('n_a -- "calls" --> n_b');
  });

  it("returns null rather than a broken diagram for unusable input", () => {
    expect(jsonGraphToMermaid("{not json")).toBeNull();
    expect(jsonGraphToMermaid('{"edges":[]}')).toBeNull();
  });

  it("skips entries too incomplete to draw", () => {
    const out = jsonGraphToMermaid(
      '{"nodes":[{"id":"a"},{"label":"nameless"}],"edges":[{"from":"a"},{"from":"a","to":"a"}]}',
    );
    expect(out).toContain("n_a");
    expect(out).not.toContain("nameless");
    // the edge missing a "to" is dropped; the complete one survives
    expect(out?.match(/-->/g)).toHaveLength(1);
  });
});
