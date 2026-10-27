/** Wires Monaco to the bundled build and local workers.
 *
 *  This module is only ever imported dynamically, by the code window: Monaco
 *  is the heaviest dependency in the app, and a workspace that only sometimes
 *  edits code should not pay for an editor on every start — the same rule
 *  Mermaid follows.
 *
 *  `loader.config({ monaco })` matters in a desktop app: the wrapper's default
 *  is to fetch Monaco from a CDN, and an offline desktop app must never load
 *  its editor from someone else's server. */
import { loader } from "@monaco-editor/react";

let configured = false;

export async function ensureMonaco(): Promise<void> {
  if (configured) return;
  const [monaco, editorWorker, jsonWorker, cssWorker, htmlWorker, tsWorker] =
    await Promise.all([
      import("monaco-editor"),
      import("monaco-editor/esm/vs/editor/editor.worker?worker"),
      import("monaco-editor/esm/vs/language/json/json.worker?worker"),
      import("monaco-editor/esm/vs/language/css/css.worker?worker"),
      import("monaco-editor/esm/vs/language/html/html.worker?worker"),
      import("monaco-editor/esm/vs/language/typescript/ts.worker?worker"),
    ]);

  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      switch (label) {
        case "json":
          return new jsonWorker.default();
        case "css":
        case "scss":
        case "less":
          return new cssWorker.default();
        case "html":
        case "handlebars":
        case "razor":
          return new htmlWorker.default();
        case "typescript":
        case "javascript":
          return new tsWorker.default();
        default:
          return new editorWorker.default();
      }
    },
  };
  loader.config({ monaco });
  configured = true;
}
