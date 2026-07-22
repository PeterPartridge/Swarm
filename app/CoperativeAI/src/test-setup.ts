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
