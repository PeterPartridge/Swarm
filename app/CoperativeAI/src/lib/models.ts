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
  // Above high the model has nowhere further to go — these differ by how hard
  // it thinks, which is why each row sets an effort as well as a model.
  {
    id: "extra",
    label: "Extra",
    forWhat: "Work that needs the best model to take its time.",
    suggested: "claude-fable-5",
  },
  {
    id: "max",
    label: "Max",
    forWhat: "Unfamiliar systems, or a design that has to be got right first time.",
    suggested: "claude-fable-5",
  },
  {
    id: "ultra",
    label: "Ultra",
    forWhat: "The hardest thing you have: build the shape of a system from scratch.",
    suggested: "claude-fable-5",
  },
] as const;
