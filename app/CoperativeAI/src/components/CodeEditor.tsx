import { useCallback, useEffect, useState } from "react";
import {
  readSolutionFile,
  readSolutionTree,
  type FileTree,
  type Solution,
} from "../lib/backend";
import CodeWindow from "./CodeWindow";

/** The Code tab's two-pane editor: a file explorer on the left, the editor in
 *  the middle. Reached by opening a Solution from the Workspace tab.
 *
 *  It reads the working copy's tree and opens one file at a time into the
 *  editor (which owns saving and the coding pal). Path containment is enforced
 *  in the backend, so a click here can only ever open a file inside the
 *  Solution's own folder. */
export default function CodeEditor({ solution }: { solution: Solution }) {
  const [tree, setTree] = useState<FileTree | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [contents, setContents] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const linked = solution.localPath !== null && solution.localPath !== "";

  const refresh = useCallback(async () => {
    if (!linked) {
      setTree(null);
      return;
    }
    try {
      setTree(await readSolutionTree(solution.id));
      setError(null);
    } catch (e) {
      setTree(null);
      setError(String(e));
    }
  }, [solution.id, linked]);

  useEffect(() => {
    void refresh();
    // A different Solution opened means a different tree and no file yet.
    setOpenPath(null);
    setContents("");
  }, [refresh]);

  async function onOpen(path: string) {
    try {
      setContents(await readSolutionFile(solution.id, path));
      setOpenPath(path);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  if (!linked) {
    return (
      <p className="hint">
        {solution.name} has no working copy on this machine yet. Point it at a
        folder on the Workspace tab, then open it here.
      </p>
    );
  }

  return (
    <section className="code-editor" aria-label={`Code: ${solution.name}`}>
      {error && <p role="alert">{error}</p>}
      <div className="code-editor-panes">
        <ul className="file-tree" aria-label={`Files in ${solution.name}`}>
          {tree?.entries.map((entry) => (
            <li key={entry.path} style={{ paddingLeft: `${entry.depth * 0.75}rem` }}>
              {entry.isDir ? (
                <span className="tree-dir">{entry.name}/</span>
              ) : (
                <button
                  className={`tree-file${openPath === entry.path ? " tree-file-open" : ""}`}
                  aria-label={`Open ${entry.path}`}
                  onClick={() => onOpen(entry.path)}
                >
                  {entry.name}
                </button>
              )}
            </li>
          ))}
          {tree?.truncated && (
            /* A partial tree that does not say so reads as a complete one. */
            <li className="hint">…more files not shown</li>
          )}
        </ul>

        <div className="file-view">
          {openPath ? (
            <CodeWindow
              key={openPath}
              solutionId={solution.id}
              path={openPath}
              initialContent={contents}
              onSaved={() => void refresh()}
            />
          ) : (
            <p className="hint">Pick a file from the explorer to edit it.</p>
          )}
        </div>
      </div>
    </section>
  );
}
