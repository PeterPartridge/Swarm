import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "../../lib/backend";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return {
    ...original,
    listProducts: vi.fn(),
    chatTurn: vi.fn(),
    createWorkItem: vi.fn(),
  };
});

import * as backend from "../../lib/backend";
import ChatHome from "../../components/chat/ChatHome";
import type { Workstation } from "../../lib/chatActions";

const mocked = vi.mocked(backend);

const shop: Product = {
  id: 7,
  name: "Shop App",
  answers: "{}",
  origin: "product",
  handedOverAt: null,
  inProductArea: true,
};

function workstation(): Omit<Workstation, "productId"> {
  return {
    canAccessHive: (id) => id === "product" || id === "develop",
    openHive: vi.fn(),
    openView: vi.fn(),
    setHiveColour: vi.fn(),
    setTheme: vi.fn(),
  };
}

function reply(text: string, actions: { name: string; args: string }[] = []) {
  return { reply: text, actions, provider: "Claude", model: "sonnet", reason: "" };
}

async function say(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(await screen.findByLabelText("Message"), text);
  await user.click(screen.getByRole("button", { name: "Send" }));
}

describe("ChatHome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listProducts.mockResolvedValue([shop]);
  });

  /// The whole conversation goes each turn, with the actions this person may
  /// use and the Hives they may open — the backend keeps no state of its own.
  it("sends the conversation, the offers and the Hives, and shows the reply", async () => {
    const user = userEvent.setup();
    mocked.chatTurn.mockResolvedValue(reply("Hello — what shall we set up?"));
    render(<ChatHome workstation={workstation()} />);

    await say(user, "hi");

    expect(await screen.findByText("Hello — what shall we set up?")).toBeInTheDocument();
    const [productId, history, offers, hives] = mocked.chatTurn.mock.calls[0];
    expect(productId).toBe(7);
    expect(history).toEqual([{ from: "person", text: "hi" }]);
    expect(offers.map((o) => o.name)).toContain("openHive");
    expect(hives).toEqual(["product", "develop"]);
  });

  it("runs a layout action straight away and says so", async () => {
    const user = userEvent.setup();
    const ws = workstation();
    mocked.chatTurn.mockResolvedValue(
      reply("Opening Develop.", [{ name: "openHive", args: '{"hive":"develop"}' }]),
    );
    render(<ChatHome workstation={ws} />);

    await say(user, "take me to develop");

    await waitFor(() => expect(ws.openHive).toHaveBeenCalledWith("develop"));
    expect(await screen.findByText(/Opened Develop/)).toBeInTheDocument();
  });

  /// Nothing is written until the person says yes, and "No" writes nothing.
  it("asks before creating a work item", async () => {
    const user = userEvent.setup();
    mocked.createWorkItem.mockResolvedValue(42);
    mocked.chatTurn.mockResolvedValue(
      reply("I can add that.", [
        { name: "createWorkItem", args: '{"title":"Checkout","itemType":"feature"}' },
      ]),
    );
    render(<ChatHome workstation={workstation()} />);

    await say(user, "add a checkout feature");

    const confirm = await screen.findByRole("button", { name: /Confirm/ });
    expect(mocked.createWorkItem).not.toHaveBeenCalled();
    await user.click(confirm);
    await waitFor(() => expect(mocked.createWorkItem).toHaveBeenCalled());
    expect(await screen.findByText(/42/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirm/ })).not.toBeInTheDocument();
  });

  it("can decline what it asks", async () => {
    const user = userEvent.setup();
    mocked.chatTurn.mockResolvedValue(
      reply("I can add that.", [
        { name: "createWorkItem", args: '{"title":"Checkout","itemType":"feature"}' },
      ]),
    );
    render(<ChatHome workstation={workstation()} />);

    await say(user, "add a checkout feature");
    await user.click(await screen.findByRole("button", { name: /Cancel/ }));

    expect(await screen.findByText(/Not done/)).toBeInTheDocument();
    expect(mocked.createWorkItem).not.toHaveBeenCalled();
  });

  it("shows a refused action with its reason", async () => {
    const user = userEvent.setup();
    mocked.chatTurn.mockResolvedValue(
      reply("Opening Test.", [{ name: "openHive", args: '{"hive":"test"}' }]),
    );
    render(<ChatHome workstation={workstation()} />);

    await say(user, "open test");

    expect(await screen.findByText(/Refused/)).toBeInTheDocument();
  });

  /// Deny-by-default is the backend's refusal, shown as it was said: the
  /// sentence names what to set, which is the whole point of it.
  it("shows the policy's refusal", async () => {
    const user = userEvent.setup();
    mocked.chatTurn.mockRejectedValue(
      "'Shop App' has no Product AI policy, so AI can't chat about it (deny-by-default).",
    );
    render(<ChatHome workstation={workstation()} />);

    await say(user, "hi");

    expect(await screen.findByText(/no Product AI policy/)).toBeInTheDocument();
  });

  it("says a Product is needed when there is none", async () => {
    mocked.listProducts.mockResolvedValue([]);
    render(<ChatHome workstation={workstation()} />);
    expect(await screen.findByText(/needs a Product/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
