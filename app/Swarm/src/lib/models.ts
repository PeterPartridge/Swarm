/** The models this app offers, and what each is for.
 *
 *  **Hardcoded on purpose, with a way out.** Anthropic publishes no endpoint
 *  that lists the models an account may use, so a dropdown here can only be a
 *  list somebody maintains. That is worth it — typing `claude-opus-5` from
 *  memory is how you end up with a provider that fails on its first real call,
 *  for a reason the error cannot explain. `OTHER` is the escape hatch: a model
 *  released after this list was written must not be unreachable.
 *
 *  Ollama is deliberately absent. Its models are whatever that server has
 *  pulled, which the app reads from the server itself — a fixed list would be a
 *  guess about somebody else's machine.
 */
export interface ModelChoice {
  id: string;
  label: string;
  /** What it is for, in the words the Project brief uses. */
  note: string;
}

/** Sentinel for "not on this list". Never sent to a provider. */
export const OTHER_MODEL = "__other__";

/** Cheapest first — the order the effort tiers index into. */
export const CLAUDE_MODELS: ModelChoice[] = [
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    note: "Cheapest and fastest. Good for mechanical edits where the answer is already decided.",
  },
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    note: "Small, well-defined tasks and everyday feature work — minor code edits, small UI tweaks, new files and tests.",
  },
  {
    id: "claude-opus-5",
    label: "Opus 5",
    note: "Harder work that still has a clear shape: cross-file changes, awkward refactors.",
  },
  {
    id: "claude-fable-5",
    label: "Fable 5",
    note: "Complex UI or coding work, unfamiliar systems, architecture decisions, interpreting design files.",
  },
];

/** How hard Claude works, cheapest first — mirrors `ai::effort::ALL`.
 *
 *  **Five, not three.** `xhigh` and `max` sit above `high`, which is the
 *  default and behaves exactly as if nothing were sent. This app offered only
 *  the first three for a while, so "high" was the most it could ever ask for
 *  while every model it lists goes two levels further.
 *
 *  Not every model takes every level, which `effortsFor` answers. */
export const EFFORT_LEVELS = [
  { id: "low", label: "Low — quick and cheap" },
  { id: "medium", label: "Medium — balanced" },
  { id: "high", label: "High — the default" },
  { id: "xhigh", label: "Extra high — for long coding jobs" },
  { id: "max", label: "Max — no limit on thinking" },
] as const;

/** The levels a given model will accept.
 *
 *  Haiku takes no effort parameter at all, and `xhigh` is newer than `max` —
 *  so a model can support the higher-sounding one and reject the other. A model
 *  typed in by hand is assumed to support everything, matching the backend:
 *  a rejected level fails loudly, where a dropped one spends silently. */
export function effortsFor(model: string): typeof EFFORT_LEVELS[number][] {
  const name = model.trim().toLowerCase();
  if (name.includes("haiku")) return [];
  if (["sonnet-4-6", "opus-4-6", "opus-4-5"].some((old) => name.includes(old))) {
    return EFFORT_LEVELS.filter((e) => e.id !== "xhigh");
  }
  return [...EFFORT_LEVELS];
}

/** The three complexities, and what the Project brief says each is for.
 *
 *  Shown beside the choice rather than left to be inferred: "high" is a word
 *  everyone reads differently, and the brief already answered what it means
 *  here. */
export const EFFORT_TIERS = [
  {
    id: "low",
    label: "Low effort",
    forWhat: "Small, well-defined edits and straightforward fixes.",
    /** From the Project brief, Part 4. */
    suggested: "claude-sonnet-5",
  },
  {
    id: "medium",
    label: "Medium effort",
    forWhat: "Everyday feature work and moderate refactors.",
    suggested: "claude-sonnet-5",
  },
  {
    id: "high",
    label: "High effort",
    forWhat: "Architecture changes, cross-file refactors, and complex implementation.",
    suggested: "claude-fable-5",
  },
] as const;
