import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ExtensionsPanel from "../../components/admin/ExtensionsPanel";
import type { ExtensionOffer, InstalledExtension } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listInstalledExtensions: vi.fn(),
    readExtensionSource: vi.fn(),
    installExtension: vi.fn(),
    removeExtension: vi.fn(),
  };
});

import * as backend from "../../lib/backend";

const mocked = vi.mocked(backend);

const installed = (kind: "hive" | "cell", id: string, source = "built-in"): InstalledExtension => ({
  kind,
  id,
  version: "0.1.0",
  source,
  installedAt: 0,
});

const offer = (kind: string, id: string, name: string, problem: string | null = null): ExtensionOffer => ({
  kind,
  id,
  name,
  version: "0.1.0",
  publisher: "PeterPartridge/Swarm",
  description: `${name} things`,
  problem,
});

function renderPanel(onChange = vi.fn()) {
  render(<ExtensionsPanel onChange={onChange} />);
  return onChange;
}

describe("ExtensionsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listInstalledExtensions.mockResolvedValue([]);
    mocked.removeExtension.mockResolvedValue();
    mocked.installExtension.mockResolvedValue();
  });

  /// A new Swarm: nothing yet, and the page says so rather than showing an
  /// empty table.
  it("says when nothing is installed", async () => {
    renderPanel();
    expect(await screen.findByText(/Nothing is installed yet/)).toBeInTheDocument();
  });

  it("lists what is installed, named, with where it came from", async () => {
    mocked.listInstalledExtensions.mockResolvedValue([
      installed("hive", "product"),
      installed("cell", "docker", "https://example.com/swarm-extensions.json"),
    ]);
    renderPanel();
    const product = await screen.findByRole("row", { name: "Installed hive Product" });
    expect(within(product).getByText("built-in")).toBeInTheDocument();
    const docker = screen.getByRole("row", { name: "Installed cell docker" });
    expect(within(docker).getByText("https://example.com/swarm-extensions.json")).toBeInTheDocument();
  });

  /// A Hive's role grants go with it, and that is worth a second press: it
  /// cannot be undone by installing it again.
  it("asks before removing a Hive, and says what goes and what stays", async () => {
    const user = userEvent.setup();
    mocked.listInstalledExtensions.mockResolvedValue([installed("hive", "product")]);
    const onChange = renderPanel();

    await user.click(await screen.findByRole("button", { name: "Remove Product" }));
    expect(screen.getByText(/role grants/)).toBeInTheDocument();
    expect(screen.getByText(/data stays/)).toBeInTheDocument();
    expect(mocked.removeExtension).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocked.removeExtension).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Remove Product" }));
    await user.click(screen.getByRole("button", { name: "Confirm remove" }));
    await waitFor(() => expect(mocked.removeExtension).toHaveBeenCalledWith("hive", "product"));
    expect(onChange).toHaveBeenCalled();
  });

  it("removes a cell at once, and shows the refusal when it is in use", async () => {
    const user = userEvent.setup();
    mocked.listInstalledExtensions.mockResolvedValue([installed("cell", "docker")]);
    mocked.removeExtension.mockRejectedValue("The docker cell is where commands run now.");
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "Remove docker" }));
    await waitFor(() => expect(mocked.removeExtension).toHaveBeenCalledWith("cell", "docker"));
    expect(await screen.findByRole("alert")).toHaveTextContent("where commands run now");
  });

  /// This repository is the default source; any other URL can replace it.
  it("reads this repository's list by default", async () => {
    const user = userEvent.setup();
    mocked.readExtensionSource.mockResolvedValue([]);
    renderPanel();
    const field = await screen.findByLabelText("Source URL");
    expect(field).toHaveValue(backend.SWARM_EXTENSIONS_URL);

    await user.clear(field);
    await user.type(field, "https://example.com/swarm-extensions.json");
    await user.click(screen.getByRole("button", { name: "Read" }));
    await waitFor(() =>
      expect(mocked.readExtensionSource).toHaveBeenCalledWith(
        "https://example.com/swarm-extensions.json",
      ),
    );
  });

  it("offers Install, says why not, or says it is installed", async () => {
    const user = userEvent.setup();
    mocked.listInstalledExtensions.mockResolvedValue([installed("hive", "product")]);
    mocked.readExtensionSource.mockResolvedValue([
      offer("hive", "product", "Product"),
      offer("hive", "test", "Test"),
      offer("hive", "studio", "Studio", "This Swarm does not contain it."),
    ]);
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Read" }));

    const product = await screen.findByRole("row", { name: "Offered hive Product" });
    expect(within(product).getByText("Installed")).toBeInTheDocument();
    expect(within(product).queryByRole("button")).toBeNull();

    const test = screen.getByRole("row", { name: "Offered hive Test" });
    expect(within(test).getByRole("button", { name: "Install Test" })).toBeEnabled();

    const studio = screen.getByRole("row", { name: "Offered hive Studio" });
    expect(within(studio).getByText("This Swarm does not contain it.")).toBeInTheDocument();
    expect(within(studio).queryByRole("button")).toBeNull();
  });

  it("installs from the source it read, then refreshes", async () => {
    const user = userEvent.setup();
    mocked.readExtensionSource.mockResolvedValue([offer("cell", "wsl", "WSL")]);
    const onChange = renderPanel();
    await user.click(await screen.findByRole("button", { name: "Read" }));

    mocked.listInstalledExtensions.mockResolvedValue([installed("cell", "wsl")]);
    await user.click(await screen.findByRole("button", { name: "Install WSL" }));

    await waitFor(() =>
      expect(mocked.installExtension).toHaveBeenCalledWith(backend.SWARM_EXTENSIONS_URL, "cell", "wsl"),
    );
    expect(onChange).toHaveBeenCalled();
    expect(await screen.findByRole("row", { name: "Installed cell wsl" })).toBeInTheDocument();
  });

  it("shows why a source could not be read", async () => {
    const user = userEvent.setup();
    mocked.readExtensionSource.mockRejectedValue("The address must start with https://.");
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Read" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("https://");
  });
});
