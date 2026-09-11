/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port; clearScreen off keeps Rust errors visible.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    // **`vmThreads` was tried here and reverted. Do not re-apply it.** It does
    // build jsdom once per worker and it is genuinely much faster — measured on
    // this suite, 10.4s against 25.6s. It was reverted anyway, because of what
    // paid for that:
    //
    // Inside a VM context the timers jsdom runs on can stall for seconds.
    // Measured, on an otherwise idle machine, one `findByLabelText` taking
    // 3040ms, 2841ms, 3150ms, 9ms — bimodal, not loaded. The damning part is
    // that it *succeeded* at 3040ms when Testing Library's own findBy timeout
    // is 1000ms: the clock that should have rejected it had stalled too. A pool
    // where the timeout mechanism is subject to the same stall it is meant to
    // catch is one where no test timeout means what it says, and that is not
    // something a larger number buys off. It surfaced as one test failing about
    // one run in twenty-five here — and far more often on a loaded two-core CI
    // runner, which is where a red suite costs the most trust.
    //
    // Measured alternatives, so nobody has to re-derive them: `forks` 25.7s and
    // stable; `threads` with `isolate: false` is faster but fails 236-400 tests,
    // so this suite genuinely needs per-file isolation; moving the 8 of 74 files
    // that need no DOM to the node environment saves a second or two, not
    // fifteen. Squeezing `testTimeout` to 2000ms passes under `threads` and
    // `forks` and fails only under `vmThreads`, which is how the headroom above
    // was established.
    pool: "threads",
  },
});
