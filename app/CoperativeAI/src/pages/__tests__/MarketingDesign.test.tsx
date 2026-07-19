import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MarketingDesign from "../../components/MarketingDesign";
import type { DesignAsset, FigmaFile } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listDesignAssets: vi.fn(),
    deleteDesignAsset: vi.fn(),
    emitDesignFiles: vi.fn(),
    generateDesignStrategy: vi.fn(),
    figmaStatus: vi.fn(),
    setFigmaToken: vi.fn(),
    clearFigmaToken: vi.fn(),
    readFigmaFile: vi.fn(),
    pushDesignTokens: vi.fn(),
    postFigmaComment: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

function asset(overrides: Partial<DesignAsset>): DesignAsset {
  return {
    id: 1,
    productId: 7,
    kind: "tokens",
    name: "Core",
    content: '{"colour":{"primary":"#1f6feb"}}',
    format: "json",
    figmaFileKey: null,
    figmaNodeId: null,
    ...overrides,
  };
}

const figmaFile: FigmaFile = {
  fileKey: "abc123",
  name: "Checkout",
  pages: [{ name: "Flows", frames: ["Basket"], textCount: 12, textTruncated: false }],
  components: ["Button"],
  styles: [],
  promptPreview: "x".repeat(400),
};

describe("Marketing & Design", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listDesignAssets.mockResolvedValue([]);
    mocked.figmaStatus.mockResolvedValue({ connected: true });
  });

  it("marketing asks for a strategy and has no assets — prose is not an artefact", async () => {
    render(<MarketingDesign productId={7} area="marketing" />);

    expect(
      await screen.findByRole("region", { name: "Marketing for this Product" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Marketing brief")).toBeInTheDocument();
    expect(mocked.listDesignAssets).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Design assets" })).not.toBeInTheDocument();
  });

  it("sends the brief and the linked file, and reports what was created", async () => {
    const user = userEvent.setup();
    mocked.generateDesignStrategy.mockResolvedValue({
      created: ["design strategy", "Core tokens"],
      provider: "Ollama",
      model: "ornith:9b",
      reason: "past the handover threshold",
      blocked: null,
    });
    render(<MarketingDesign productId={7} area="design" />);

    await user.type(await screen.findByLabelText("Design brief"), "Refresh the look");
    await user.type(screen.getByLabelText("Figma file URL or key"), "abc123");
    await user.click(screen.getByLabelText("Generate design strategy"));

    await waitFor(() =>
      expect(mocked.generateDesignStrategy).toHaveBeenCalledWith({
        productId: 7,
        area: "design",
        brief: "Refresh the look",
        figmaFileRef: "abc123",
      }),
    );
    // The routing reason travels to the user: a local model changes the
    // quality of what comes back, and nobody should discover that by wondering.
    expect(
      await screen.findByText(/Core tokens.*Ollama.*past the handover threshold/),
    ).toBeInTheDocument();
  });

  /// No file linked must mean null, not an empty string the backend has to guess at.
  it("sends no file reference when none was given", async () => {
    const user = userEvent.setup();
    mocked.generateDesignStrategy.mockResolvedValue({
      created: ["marketing strategy"],
      provider: "Claude",
      model: "m",
      reason: "within budget",
      blocked: null,
    });
    render(<MarketingDesign productId={7} area="marketing" />);

    await user.click(await screen.findByLabelText("Generate marketing strategy"));
    await waitFor(() =>
      expect(mocked.generateDesignStrategy).toHaveBeenCalledWith(
        expect.objectContaining({ figmaFileRef: null }),
      ),
    );
  });

  /// A model refusing to invent a direction for an undescribed Product is the
  /// framework working, not an error.
  it("treats a refusal as a question, not a failure", async () => {
    const user = userEvent.setup();
    mocked.generateDesignStrategy.mockResolvedValue({
      created: [],
      provider: "Claude",
      model: "m",
      reason: "within budget",
      blocked: {
        reason: "No idea who this is for.",
        whatIsNeeded: "Who are the users?",
        feedbackId: 0,
      },
    });
    render(<MarketingDesign productId={7} area="design" />);

    await user.click(await screen.findByLabelText("Generate design strategy"));

    // By text rather than by role: the Figma panel also renders a status line,
    // so role="status" is not unique on this screen.
    expect(await screen.findByText(/No idea who this is for/)).toBeInTheDocument();
    expect(screen.getByText(/Who are the users\?/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  /// Only a token set has a representation as Figma variables.
  it("offers a Figma push for tokens only", async () => {
    mocked.listDesignAssets.mockResolvedValue([
      asset({ id: 1, kind: "tokens", name: "Core" }),
      asset({ id: 2, kind: "uiFlow", name: "Sign-up", format: "mermaid", content: "flowchart TD" }),
    ]);
    render(<MarketingDesign productId={7} area="design" />);

    await screen.findByRole("region", { name: "Design assets" });
    expect(screen.getByLabelText("Push Core to Figma")).toBeInTheDocument();
    expect(screen.queryByLabelText("Push Sign-up to Figma")).not.toBeInTheDocument();
    // commenting works for anything
    expect(screen.getByLabelText("Comment Sign-up on Figma")).toBeInTheDocument();
  });

  /// Below Enterprise this is the only route tokens have into Figma, so it
  /// must be a button someone can find — not a fallback behind a failure.
  it("writes the design files, and says where they went", async () => {
    const user = userEvent.setup();
    mocked.listDesignAssets.mockResolvedValue([asset({})]);
    mocked.emitDesignFiles.mockResolvedValue(["design/tokens.json"]);
    render(<MarketingDesign productId={7} area="design" />);

    await user.click(await screen.findByLabelText("Write design files"));

    await waitFor(() => expect(mocked.emitDesignFiles).toHaveBeenCalledWith(7));
    expect(await screen.findByText(/Wrote design\/tokens\.json/)).toBeInTheDocument();
  });

  /// The 403 from a non-Enterprise plan is the expected case, and its
  /// explanation must reach the user whole rather than becoming "failed".
  it("shows the plan explanation when a token push is refused", async () => {
    const user = userEvent.setup();
    mocked.listDesignAssets.mockResolvedValue([asset({})]);
    mocked.pushDesignTokens.mockRejectedValue(
      "Figma refused to let this token write variables (403). the Variables REST API is **Enterprise-only** … the app writes design/tokens.json for exactly this case.",
    );
    render(<MarketingDesign productId={7} area="design" />);

    await user.type(await screen.findByLabelText("Figma file URL or key"), "abc123");
    await user.click(screen.getByLabelText("Push Core to Figma"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Enterprise-only");
    expect(alert).toHaveTextContent("design/tokens.json");
  });

  /// The digest exists so a megabyte file never reaches a prompt. Saying the
  /// size out loud is what makes that a visible saving rather than a claim.
  it("shows what the file costs as a prompt before it is paid for", async () => {
    const user = userEvent.setup();
    mocked.readFigmaFile.mockResolvedValue(figmaFile);
    render(<MarketingDesign productId={7} area="design" />);

    await user.type(await screen.findByLabelText("Figma file URL or key"), "abc123");
    await user.click(screen.getByLabelText("Read Figma file"));

    expect(await screen.findByText(/Checkout/)).toBeInTheDocument();
    expect(screen.getByText(/about 100 tokens, not the whole/)).toBeInTheDocument();
  });

  /// Stating the limits up front is cheaper than a 403 nobody can act on.
  it("states what Figma's API cannot do, without waiting for a failure", async () => {
    render(<MarketingDesign productId={7} area="design" />);

    const figma = await screen.findByRole("region", { name: "Figma" });
    expect(within(figma).getByText(/cannot create frames or layouts/)).toBeInTheDocument();
    expect(within(figma).getByText(/Enterprise/)).toBeInTheDocument();
  });

  /// The token goes to the OS credential store; the app only ever learns
  /// whether one is stored.
  it("asks for a token when Figma is not connected", async () => {
    const user = userEvent.setup();
    // Not connected until the token is stored, then connected — the component
    // re-reads status after connecting rather than assuming it worked.
    mocked.figmaStatus
      .mockResolvedValueOnce({ connected: false })
      .mockResolvedValue({ connected: true });
    mocked.setFigmaToken.mockResolvedValue("me@example.com");
    render(<MarketingDesign productId={7} area="design" />);

    const input = await screen.findByLabelText("Figma personal access token");
    expect(input).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Read Figma file")).toBeDisabled();

    await user.type(input, "figd_secret");
    await user.click(screen.getByLabelText("Connect Figma"));

    await waitFor(() => expect(mocked.setFigmaToken).toHaveBeenCalledWith("figd_secret"));
    expect(await screen.findByText(/Connected as me@example.com/)).toBeInTheDocument();
  });
});
