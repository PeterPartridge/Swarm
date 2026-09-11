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
    // Building jsdom once per worker rather than once per file. Vitest reports
    // the environment as roughly half of the run, across 74 files, and this
    // keeps per-file isolation while paying for it once.
    pool: "vmThreads",
  },
});
