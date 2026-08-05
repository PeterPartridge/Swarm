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

/** The three efforts, and what the Project brief says each is for.
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

/** The stored `models` array for a set of tier choices.
 *
 *  The order is the contract: `ai::tiering` takes the first for low, the middle
 *  for medium and the last for high, so three entries in tier order is exactly
 *  what it expects — and is why this is three labelled choices in the UI rather
 *  than a comma-separated list somebody has to order correctly in their head. */
export function modelsForTiers(low: string, medium: string, high: string): string[] {
  return [low, medium, high];
}

/** The tier choices a stored `models` array represents.
 *
 *  The inverse of `modelsForTiers`, using the same rule as the Rust side so a
 *  provider saved by an older version still reads back sensibly — a list of one
 *  means that model does every tier. */
export function tiersFromModels(models: string[]): {
  low: string;
  medium: string;
  high: string;
} {
  if (models.length === 0) {
    return { low: "", medium: "", high: "" };
  }
  return {
    low: models[0],
    medium: models[Math.floor(models.length / 2)],
    high: models[models.length - 1],
  };
}
