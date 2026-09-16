import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Tauri's event API reaches for internals that only exist inside a Tauri
// window; in jsdom it throws before any component can render. Stubbed here
// rather than per test file **on purpose**: a partial `vi.mock` with
// `...original` lets anything unlisted fall through to the real module, and
// this project has been bitten by that silence more than once. A global stub
// cannot be forgotten by the next test that renders a terminal.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

// jsdom does not implement `getContext`, and `@xterm/xterm` measures character
// cells with it on every render. Unstubbed it prints six "Not implemented"
// dumps per run — noise that is indistinguishable from a real failure at a
// glance, which is the cost: a suite whose normal output contains errors trains
// everyone to skim past the one that matters.
//
// Returns null rather than a fake 2D context **deliberately**. Null is a value
// the canvas API genuinely returns when a context cannot be had, so callers are
// obliged to handle it; a hand-rolled fake would let a test pass against
// measurements no browser would ever produce.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
