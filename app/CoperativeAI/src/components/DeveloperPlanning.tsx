import { useCallback, useEffect, useState } from "react";
import DiagramView from "./DiagramView";
import {
  ARCHITECTURE_KIND_LABELS,
  DIAGRAM_FORMATS,
  REPO_LINK_LABELS,
  deleteArchitectureDoc,
  generateArchitectureDoc,
  linkSolutions,
  listArchitectureDocs,
  listRepoLinks,
  listSolutions,
  solutionsReachedBy,
  unlinkSolutions,
  type ArchitectureDoc,
  type ArchitectureDocKind,
  type DiagramFormat,
  type RepoLink,
  type RepoLinkKind,
  type Solution,
} from "../lib/backend";

const KINDS = Object.keys(ARCHITECTURE_KIND_LABELS) as ArchitectureDocKind[];
const LINK_KINDS = Object.keys(REPO_LINK_LABELS) as RepoLinkKind[];

/** Developer Planning: how the systems are put together, and how they depend
 *  on one another.
 *
 *  Architecture documents are validated as the notation they claim to be before
 *  they are stored — a diagram that does not render is worse than none, because
 *  it looks like documentation and so nobody writes the documentation. */
export default function DeveloperPlanning({ productId }: { productId: number }) {
  const [docs, setDocs] = useState<ArchitectureDoc[]>([]);
  const [links, setLinks] = useState<RepoLink[]>([]);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [kind, setKind] = useState<ArchitectureDocKind>("systemInteraction");
  const [format, setFormat] = useState<DiagramFormat>("mermaid");
  const [solutionId, setSolutionId] = useState("");
  const [brief, setBrief] = useState("");
  const [linkFrom, setLinkFrom] = useState("");
  const [linkTo, setLinkTo] = useState("");
  const [linkKind, setLinkKind] = useState<RepoLinkKind>("callsApi");
  const [linkNotes, setLinkNotes] = useState("");
  const [impact, setImpact] = useState<{ id: number; reached: number[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [loadedDocs, loadedLinks, loadedSolutions] = await Promise.all([
        listArchitectureDocs(productId),
        listRepoLinks(productId),
        listSolutions(),
      ]);
      setDocs(loadedDocs);
      setLinks(loadedLinks);
      setSolutions(loadedSolutions.filter((s) => s.productId === productId));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const nameOf = (id: number) =>
    solutions.find((s) => s.id === id)?.name ?? `#${id}`;

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
        setNotice(
          `The AI stopped rather than inventing an architecture: ${result.blocked.reason} ` +
            `${result.blocked.whatIsNeeded}`,
        );
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

  async function onLink() {
    try {
      await linkSolutions(Number(linkFrom), Number(linkTo), linkKind, linkNotes);
      setLinkFrom("");
      setLinkTo("");
      setLinkNotes("");
      setError(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function onImpact(id: number) {
    try {
      setImpact({ id, reached: await solutionsReachedBy(id) });
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <section className="developer-planning" aria-label="Developer Planning">
      <h2>Developer Planning</h2>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      <section className="repo-map" aria-label="How the Solutions depend on each other">
        <h3>Cross-repo map</h3>
        {solutions.length < 2 ? (
          <p className="hint">
            A dependency needs two Solutions — this Product has{" "}
            {solutions.length === 0 ? "none" : "one"}.
          </p>
        ) : (
          <>
            {links.length > 0 && (
              <ul className="repo-links">
                {links.map((l) => (
                  <li key={l.id} className={l.kind === "buildsOn" ? "ordering" : ""}>
                    <span>
                      {nameOf(l.fromSolutionId)} {REPO_LINK_LABELS[l.kind]}{" "}
                      {nameOf(l.toSolutionId)}
                      {l.notes && <em> — {l.notes}</em>}
                    </span>
                    <button
                      aria-label={`Remove link from ${nameOf(l.fromSolutionId)} to ${nameOf(l.toSolutionId)}`}
                      onClick={() =>
                        void unlinkSolutions(l.id).then(refresh).catch((e) => setError(String(e)))
                      }
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="repo-link-form">
              <select
                aria-label="Dependency from"
                value={linkFrom}
                onChange={(e) => setLinkFrom(e.target.value)}
              >
                <option value="">From…</option>
                {solutions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Dependency kind"
                value={linkKind}
                onChange={(e) => setLinkKind(e.target.value as RepoLinkKind)}
              >
                {LINK_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {REPO_LINK_LABELS[k]}
                  </option>
                ))}
              </select>
              <select
                aria-label="Dependency to"
                value={linkTo}
                onChange={(e) => setLinkTo(e.target.value)}
              >
                <option value="">To…</option>
                {solutions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <input
                aria-label="Dependency notes"
                placeholder="why (optional)"
                value={linkNotes}
                onChange={(e) => setLinkNotes(e.target.value)}
              />
              <button
                aria-label="Add Solution dependency"
                disabled={linkFrom === "" || linkTo === ""}
                onClick={onLink}
              >
                Link
              </button>
            </div>

            {/* The question the map exists to answer. */}
            <div className="impact">
              <span className="hint">If we change…</span>
              {solutions.map((s) => (
                <button
                  key={s.id}
                  aria-label={`What does changing ${s.name} reach`}
                  onClick={() => onImpact(s.id)}
                >
                  {s.name}
                </button>
              ))}
              {impact && (
                <p role="status">
                  {impact.reached.length === 0
                    ? `Changing ${nameOf(impact.id)} reaches nothing else recorded here.`
                    : `Changing ${nameOf(impact.id)} reaches: ${impact.reached
                        .map(nameOf)
                        .join(", ")}.`}
                </p>
              )}
            </div>
          </>
        )}
      </section>

      <section className="architecture-docs" aria-label="Architecture documents">
        <h3>Architecture</h3>
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
                {f}
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
        <div className="field">
          <span>What should it show?</span>
          <textarea
            rows={2}
            aria-label="Architecture brief"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
          />
        </div>
        <button aria-label="Generate architecture document" onClick={onGenerate} disabled={busy}>
          {busy ? "Drawing…" : "AI: draw it"}
        </button>

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
