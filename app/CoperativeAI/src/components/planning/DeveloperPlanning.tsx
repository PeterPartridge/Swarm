import { useCallback, useEffect, useState } from "react";
import Notice, { type NoticeValue } from "../ai/Notice";
import DiagramBuilder from "../diagram/DiagramBuilder";
import DiagramView from "../diagram/DiagramView";
import SolutionMap from "../diagram/SolutionMap";
import {
  ARCHITECTURE_KIND_LABELS,
  DIAGRAM_FORMATS,
  DIAGRAM_FORMAT_LABELS,
  deleteArchitectureDoc,
  generateArchitectureDoc,
  listArchitectureDocs,
  listSolutions,
  type ArchitectureDoc,
  type ArchitectureDocKind,
  type DiagramFormat,
  type Solution,
} from "../../lib/backend";

const KINDS = Object.keys(ARCHITECTURE_KIND_LABELS) as ArchitectureDocKind[];

/** Developer Planning: one picture of how the Solutions fit together.
 *
 *  The cross-repo map and the architecture diagram were the same drawing made
 *  twice — a box per Solution and the dependencies between them — so they are
 *  one section now: a drag-drop map at the top (each Solution a box shaped by
 *  its type), and below it the AI's help drawing the notations a hand-arranged
 *  map cannot, plus every diagram already saved.
 *
 *  Architecture documents are validated as the notation they claim to be before
 *  they are stored — a diagram that does not render is worse than none, because
 *  it looks like documentation and so nobody writes the documentation. */
export default function DeveloperPlanning({
  productId,
  onOpenAgent,
}: {
  productId: number;
  /** Opens the work item an agent on the map is working on, over in Build. */
  onOpenAgent?: (workItemId: number) => void;
}) {
  const [docs, setDocs] = useState<ArchitectureDoc[]>([]);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [kind, setKind] = useState<ArchitectureDocKind>("systemInteraction");
  const [format, setFormat] = useState<DiagramFormat>("mermaid");
  const [solutionId, setSolutionId] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [loadedDocs, loadedSolutions] = await Promise.all([
        listArchitectureDocs(productId),
        listSolutions(),
      ]);
      setDocs(loadedDocs);
      setSolutions(loadedSolutions.filter((s) => s.productId === productId));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const nameOf = (id: number) => solutions.find((s) => s.id === id)?.name ?? `#${id}`;

  async function onGenerate() {
    setBusy(true);
    setNotice("Asking the AI to draw it…");
    try {
      const result = await generateArchitectureDoc({
        productId,
        solutionId: solutionId === "" ? null : Number(solutionId),
        kind,
        format,
        brief,
      });
      if (result.blocked) {
        setNotice({
          blocked: result.blocked,
          what: "inventing an architecture",
        });
      } else {
        setNotice(`${result.created.join(" — ")} (${result.provider} · ${result.reason}).`);
      }
      await refresh();
    } catch (e) {
      setNotice(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="developer-planning" aria-label="Developer Planning">
      <h2>Developer Planning</h2>
      {error && <p role="alert">{error}</p>}
      <Notice value={notice} />

      {/* The combined map: existing Solutions as type-shaped boxes, dragged into
          place and joined by their dependencies, with a new Solution added from
          here and the arrangement saved. */}
      <section aria-label="Architecture map of the Solutions">
        <h3>Architecture map</h3>
        {/* The documents are read once, here, and handed to the map's inspector
            rather than fetched again — two reads of the same list are two
            chances for the index and the previews below to disagree. */}
        <SolutionMap productId={productId} docs={docs} onOpenAgent={onOpenAgent} />
      </section>

      <section className="architecture-docs" aria-label="Architecture documents">
        <h3>Generated diagrams</h3>
        <p className="hint">
          For the notations a hand-arranged map cannot draw — a sequence, a
          contract — let the AI draft one from the Solutions and links already
          recorded.
        </p>
        <div className="architecture-form">
          <select
            aria-label="Document kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as ArchitectureDocKind)}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {ARCHITECTURE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <select
            aria-label="Diagram format"
            value={format}
            onChange={(e) => setFormat(e.target.value as DiagramFormat)}
          >
            {DIAGRAM_FORMATS.map((f) => (
              <option key={f} value={f}>
                {DIAGRAM_FORMAT_LABELS[f] ?? f}
              </option>
            ))}
          </select>
          <select
            aria-label="About which Solution"
            value={solutionId}
            onChange={(e) => setSolutionId(e.target.value)}
          >
            {/* Null means the whole Product — a system-interaction map spans
                several Solutions, an API contract belongs to one. */}
            <option value="">The whole Product</option>
            {solutions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        {/* Drafting comes first whichever notation is chosen: the app already
            knows the Solutions and the links between them, and the AI should
            not be paid to rediscover what is in the database. */}
        <DiagramBuilder
          productId={productId}
          kind={kind}
          format={format}
          solutionId={solutionId}
          onSaved={refresh}
          onError={setError}
        />

        {/* The AI half stays for the notations it can write. draw.io is drafted
            from the Solutions and then arranged by hand in draw.io, which is
            better at it than any prompt. */}
        {format !== "drawio" && (
          <>
            <div className="field">
              <span>What should it show?</span>
              <textarea
                rows={2}
                aria-label="Architecture brief"
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
              />
            </div>
            <button
              aria-label="Generate architecture document"
              onClick={onGenerate}
              disabled={busy}
            >
              {busy ? "Drawing…" : "AI: draw it"}
            </button>
          </>
        )}

        {docs.length > 0 && (
          <ul className="doc-list">
            {docs.map((doc) => (
              <li key={doc.id}>
                <div className="doc-head">
                  <strong>{doc.name}</strong>
                  <span className="doc-kind">{ARCHITECTURE_KIND_LABELS[doc.kind]}</span>
                  <span className="doc-kind">{doc.format}</span>
                  <span className="doc-scope">
                    {doc.solutionId === null ? "whole Product" : nameOf(doc.solutionId)}
                  </span>
                </div>
                <DiagramView
                  content={doc.content}
                  format={doc.format}
                  label={doc.name}
                />
                <button
                  aria-label={`Delete ${doc.name}`}
                  onClick={() =>
                    void deleteArchitectureDoc(doc.id)
                      .then(refresh)
                      .catch((e) => setError(String(e)))
                  }
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
