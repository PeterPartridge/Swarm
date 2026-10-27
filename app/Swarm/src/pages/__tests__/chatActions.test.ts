import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return { ...original, createWorkItem: vi.fn() };
});

import * as backend from "../../lib/backend";
import { CHAT_ACTIONS, interpret, offersFor, type Workstation } from "../../lib/chatActions";

const mocked = vi.mocked(backend);

function workstation(hives: string[]): Workstation {
  return {
    productId: 7,
    canAccessHive: (id) => hives.includes(id),
    openHive: vi.fn(),
    openView: vi.fn(),
    setHiveColour: vi.fn(),
    setTheme: vi.fn(),
  };
}

describe("what the chat may offer the AI", () => {
  /// The model is only told about doors this person can use: offering one the
  /// role hides would invite a request the screen then has to refuse.
  it("offers only what the role allows", () => {
    const names = (hives: string[]) => offersFor(workstation(hives)).map((o) => o.name);
    expect(names(["product"])).toContain("createWorkItem");
    expect(names(["test"])).not.toContain("createWorkItem");
    expect(names([])).toEqual(expect.arrayContaining(["openHive", "setTheme"]));
  });

  it("describes every action and its arguments", () => {
    for (const action of CHAT_ACTIONS) {
      expect(action.description, action.name).not.toBe("");
      expect(action.args, action.name).toMatch(/^\{.*\}$/);
    }
  });
});

describe("what the AI asked for", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses an action the app never offered", () => {
    const step = interpret({ name: "deleteEverything", args: "{}" }, workstation(["product"]));
    expect(step.kind).toBe("refused");
  });

  it("refuses arguments that are not JSON", () => {
    const step = interpret({ name: "openHive", args: "develop" }, workstation(["develop"]));
    expect(step.kind).toBe("refused");
  });

  /// The role is checked again here, whatever was offered: the reply is the
  /// model's, and the model can name any Hive it likes.
  it("refuses a Hive the person cannot open", () => {
    const step = interpret({ name: "openHive", args: '{"hive":"develop"}' }, workstation(["test"]));
    expect(step).toMatchObject({ kind: "refused" });
  });

  it("opens a Hive straight away — it changes nothing", async () => {
    const ws = workstation(["develop"]);
    const step = interpret({ name: "openHive", args: '{"hive":"develop"}' }, ws);
    expect(step.kind).toBe("run");
    if (step.kind === "refused") return;
    await step.run();
    expect(ws.openHive).toHaveBeenCalledWith("develop");
  });

  it("opens a view only if that Hive has it", () => {
    const ws = workstation(["develop"]);
    expect(interpret({ name: "openView", args: '{"hive":"develop","view":"work"}' }, ws).kind).toBe("run");
    expect(interpret({ name: "openView", args: '{"hive":"develop","view":"nowhere"}' }, ws).kind).toBe("refused");
  });

  it("checks a colour is a colour", () => {
    const ws = workstation(["test"]);
    expect(interpret({ name: "setHiveColour", args: '{"hive":"test","colour":"#112233"}' }, ws).kind).toBe("run");
    expect(interpret({ name: "setHiveColour", args: '{"hive":"test","colour":"red"}' }, ws).kind).toBe("refused");
  });

  /// Writing the project's own data waits for the person, and nothing is
  /// written until they say yes.
  it("asks before creating a work item, and creates it only when run", async () => {
    mocked.createWorkItem.mockResolvedValue(42);
    const step = interpret(
      { name: "createWorkItem", args: '{"title":"Checkout","itemType":"feature"}' },
      workstation(["product"]),
    );
    expect(step.kind).toBe("confirm");
    expect(mocked.createWorkItem).not.toHaveBeenCalled();
    if (step.kind === "refused") return;
    expect(step.describe).toMatch(/Checkout/);
    expect(await step.run()).toMatch(/42/);
    expect(mocked.createWorkItem).toHaveBeenCalledWith({
      title: "Checkout",
      itemType: "feature",
      productId: 7,
    });
  });

  it("refuses to create a work item for a role without Product or Develop", () => {
    const step = interpret(
      { name: "createWorkItem", args: '{"title":"Checkout","itemType":"feature"}' },
      workstation(["test"]),
    );
    expect(step.kind).toBe("refused");
  });
});
