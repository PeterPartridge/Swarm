import { HIVES } from "@hives/registry";
import { createWorkItem, type ActionOffer, type ProposedAction } from "./backend";
import type { ThemeMode } from "./theme";

/** What the chat's actions can reach: the shell's controls, the active
 *  person's Hive grants, and the Product the conversation is about. */
export interface Workstation {
  productId: number;
  canAccessHive: (id: string) => boolean;
  openHive: (id: string) => void;
  openView: (hive: string, view: string) => void;
  setHiveColour: (hive: string, colour: string) => void;
  setTheme: (mode: ThemeMode) => void;
}

/** An action bound to its arguments, ready to run. `run` says what happened. */
interface Prepared {
  describe: string;
  run: () => Promise<string>;
}

/** One thing the AI may ask the app to do.
 *
 *  `prepare` checks the arguments and the role, and either binds them or says
 *  why not — in a sentence the person reads, because a refusal they cannot
 *  understand is one they cannot fix. */
export interface ChatAction extends ActionOffer {
  /** Writes the project's own data, or is hard to undo: the person confirms
   *  it first. Layout and appearance do not, since undoing them is a click. */
  confirm: boolean;
  /** Whether this person may use it at all — what decides if it is offered. */
  allowed: (ws: Workstation) => boolean;
  prepare: (args: Record<string, unknown>, ws: Workstation) => Prepared | string;
}

/** The Hive this person may open by that id, or why not. */
function hiveFor(id: unknown, ws: Workstation) {
  const hive = HIVES.find((h) => h.id === id);
  if (!hive) return `there is no Hive called ${JSON.stringify(id)}`;
  if (!ws.canAccessHive(hive.id)) return `your role does not include the ${hive.label} Hive`;
  return hive;
}

const HIVE_IDS = HIVES.map((h) => JSON.stringify(h.id)).join(", ");

/** Every action the chat can take, in the order they are offered.
 *
 *  **Short on purpose.** "Anything the app can do" is the aim, and each action
 *  added here is one more thing an AI can change, so they arrive one at a
 *  time, each with its own check and test, rather than as a passthrough to
 *  every command the app has. */
export const CHAT_ACTIONS: ChatAction[] = [
  {
    name: "openHive",
    description: "Opens a work area (Hive) in the main window.",
    args: `{"hive": one of ${HIVE_IDS}}`,
    confirm: false,
    allowed: () => true,
    prepare: ({ hive }, ws) => {
      const found = hiveFor(hive, ws);
      if (typeof found === "string") return found;
      return {
        describe: `Open ${found.label}`,
        run: async () => {
          ws.openHive(found.id);
          return `Opened ${found.label}.`;
        },
      };
    },
  },
  {
    name: "openView",
    description: "Opens one view inside a Hive, such as Develop's Work board.",
    args: `{"hive": a Hive id, "view": ${HIVES.flatMap((h) =>
      (h.views ?? []).map((v) => `"${v.id}" (${h.label} ${v.label})`),
    ).join(", ")}}`,
    confirm: false,
    allowed: () => true,
    prepare: ({ hive, view }, ws) => {
      const found = hiveFor(hive, ws);
      if (typeof found === "string") return found;
      const target = found.views?.find((v) => v.id === view);
      if (!target) return `${found.label} has no view called ${JSON.stringify(view)}`;
      return {
        describe: `Open ${found.label} ${target.label}`,
        run: async () => {
          ws.openView(found.id, target.id);
          return `Opened ${found.label} ${target.label}.`;
        },
      };
    },
  },
  {
    name: "setTheme",
    description: "Switches the whole app between dark and light.",
    args: `{"mode": "dark" or "light"}`,
    confirm: false,
    allowed: () => true,
    prepare: ({ mode }, ws) => {
      if (mode !== "dark" && mode !== "light") return `${JSON.stringify(mode)} is not dark or light`;
      return {
        describe: `Switch to the ${mode} theme`,
        run: async () => {
          ws.setTheme(mode);
          return `Switched to the ${mode} theme.`;
        },
      };
    },
  },
  {
    name: "setHiveColour",
    description: "Sets the colour of a Hive's tab and accents.",
    args: `{"hive": a Hive id, "colour": "#rrggbb"}`,
    confirm: false,
    allowed: () => true,
    prepare: ({ hive, colour }, ws) => {
      const found = hiveFor(hive, ws);
      if (typeof found === "string") return found;
      if (typeof colour !== "string" || !/^#[0-9a-f]{6}$/i.test(colour)) {
        return `${JSON.stringify(colour)} is not a colour written as #rrggbb`;
      }
      return {
        describe: `Colour ${found.label} ${colour}`,
        run: async () => {
          ws.setHiveColour(found.id, colour);
          return `Coloured ${found.label} ${colour}.`;
        },
      };
    },
  },
  {
    name: "createWorkItem",
    description: "Adds a work item to the Product this conversation is about.",
    args: `{"title": text, "itemType": "epic", "feature", "userStory", "task", "bug" or "test"}`,
    confirm: true,
    // Work items are planned in Product and built in Develop; a role with
    // neither has no screen on which the item would appear.
    allowed: (ws) => ws.canAccessHive("product") || ws.canAccessHive("develop"),
    prepare: ({ title, itemType }, ws) => {
      if (typeof title !== "string" || !title.trim()) return "a work item needs a title";
      if (typeof itemType !== "string" || !itemType.trim()) return "a work item needs a type";
      return {
        describe: `Create the ${itemType} "${title.trim()}"`,
        run: async () => {
          const id = await createWorkItem({ title: title.trim(), itemType, productId: ws.productId });
          return `Created work item #${id}.`;
        },
      };
    },
  },
];

/** The actions this person may use, as the backend sends them to the AI. */
export function offersFor(ws: Workstation): ActionOffer[] {
  return CHAT_ACTIONS.filter((a) => a.allowed(ws)).map(({ name, description, args }) => ({
    name,
    description,
    args,
  }));
}

/** What to do with one action the AI named. */
export type Step =
  | { kind: "refused"; reason: string }
  | ({ kind: "run" | "confirm" } & Prepared);

/** Checks an action the AI asked for, against the list and the role, again —
 *  whatever was offered, the reply is the model's, and it can name anything. */
export function interpret(proposed: ProposedAction, ws: Workstation): Step {
  const action = CHAT_ACTIONS.find((a) => a.name === proposed.name);
  if (!action) return { kind: "refused", reason: `"${proposed.name}" is not something this app lets the AI do` };
  if (!action.allowed(ws)) return { kind: "refused", reason: `your role cannot ${proposed.name}` };
  let args: unknown;
  try {
    args = JSON.parse(proposed.args || "{}");
  } catch {
    return { kind: "refused", reason: `its arguments were not readable: ${proposed.args}` };
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return { kind: "refused", reason: `its arguments were not an object: ${proposed.args}` };
  }
  const prepared = action.prepare(args as Record<string, unknown>, ws);
  if (typeof prepared === "string") return { kind: "refused", reason: prepared };
  return { kind: action.confirm ? "confirm" : "run", ...prepared };
}
