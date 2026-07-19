import { useCallback, useEffect, useState } from "react";
import {
  DESIGN_ASSET_LABELS,
  deleteDesignAsset,
  emitDesignFiles,
  generateDesignStrategy,
  listDesignAssets,
  postFigmaComment,
  pushDesignTokens,
  readFigmaFile,
  type DesignAsset,
  type FigmaFile,
} from "../lib/backend";
import FigmaLink from "./FigmaLink";

/** Marketing and Design: a strategy the AI can draft, and — for design — the
 *  artefacts that follow from it.
 *
 *  Design is the only area with assets. Marketing produces prose; a token set
 *  or a flow diagram is a thing you can hand to someone, so those are stored,
 *  shown and pushable. */
export default function MarketingDesign({
  productId,
  area,
}: {
  productId: number;
  area: "marketing" | "design";
}) {
  const [assets, setAssets] = useState<DesignAsset[]>([]);
  const [brief, setBrief] = useState("");
  const [figmaRef, setFigmaRef] = useState("");
  const [figmaFile, setFigmaFile] = useState<FigmaFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const title = area === "marketing" ? "Marketing" : "Design";

  const refresh = useCallback(async () => {
    if (area !== "design") return;
    try {
      setAssets(await listDesignAssets(productId));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId, area]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onGenerate() {
    setBusy(true);
    setNotice(`Asking the AI to work out the ${area} direction…`);
    try {
      const result = await generateDesignStrategy({
        productId,
        area,
        brief,
        figmaFileRef: figmaRef.trim() === "" ? null : figmaRef,
      });
      if (result.blocked) {
        // Not a failure. A model that refuses to invent a direction for a
        // Product nobody has described is doing the right thing.
        setNotice(
          `The AI stopped rather than inventing a direction: ${result.blocked.reason} ` +
            `${result.blocked.whatIsNeeded}`,
        );
      } else {
        setNotice(
          `Created ${result.created.join(", ")} (${result.provider} · ${result.reason}).`,
        );
      }
      await refresh();
    } catch (e) {
      setNotice(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onReadFigma() {
    setBusy(true);
    try {
      setFigmaFile(await readFigmaFile(figmaRef));
      setError(null);
    } catch (e) {
      setFigmaFile(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onPushTokens(asset: DesignAsset) {
    try {
      await pushDesignTokens(asset.id, figmaRef, asset.name);
      setNotice(`Pushed ${asset.name} to Figma as variables.`);
      setError(null);
      await refresh();
    } catch (e) {
      // Almost always the Enterprise plan limit. The message from the backend
      // names that and points at the exported file, so it is shown whole.
      setError(String(e));
    }
  }

  async function onEmit() {
    try {
      const written = await emitDesignFiles(productId);
      setNotice(`Wrote ${written.join(", ")}.`);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function onComment(asset: DesignAsset) {
    try {
      await postFigmaComment(
        figmaRef,
        `From CoperativeAI — ${DESIGN_ASSET_LABELS[asset.kind]} "${asset.name}":\n\n${asset.content}`,
      );
      setNotice(`Posted "${asset.name}" as a comment on the Figma file.`);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <section className="marketing-design" aria-label={`${title} for this Product`}>
      <h2>{title}</h2>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      <div className="field">
        <span>
          What do you want from this round?{" "}
          {area === "marketing"
            ? "Audience, positioning, pricing, launch."
            : "Branding, tokens, flows, components."}
        </span>
        <textarea
          rows={3}
          aria-label={`${title} brief`}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
        />
      </div>

      <FigmaLink
        fileRef={figmaRef}
        onFileRefChange={setFigmaRef}
        file={figmaFile}
        onRead={onReadFigma}
        busy={busy}
      />

      <button
        aria-label={`Generate ${title.toLowerCase()} strategy`}
        onClick={onGenerate}
        disabled={busy}
      >
        {busy ? "Working…" : `AI: draft the ${title.toLowerCase()} strategy`}
      </button>

      {area === "design" && assets.length > 0 && (
        <section className="design-assets" aria-label="Design assets">
          <h3>Assets</h3>
          <div className="asset-actions">
            <button aria-label="Write design files" onClick={onEmit}>
              Write to design/ files
            </button>
            <span className="hint">
              Below Enterprise, exporting <code>design/tokens.json</code> and
              importing it in Figma is the only route tokens have in.
            </span>
          </div>
          <ul>
            {assets.map((asset) => (
              <li key={asset.id}>
                <div className="asset-head">
                  <strong>{asset.name}</strong>
                  <span className="asset-kind">{DESIGN_ASSET_LABELS[asset.kind]}</span>
                  {asset.figmaFileKey && (
                    <span className="asset-pushed">in Figma</span>
                  )}
                </div>
                <pre className="asset-content">{asset.content}</pre>
                <div className="asset-actions">
                  {/* Only a token set can become Figma variables; anything else
                      has no representation there. */}
                  {asset.kind === "tokens" && (
                    <button
                      aria-label={`Push ${asset.name} to Figma`}
                      disabled={figmaRef.trim() === ""}
                      onClick={() => onPushTokens(asset)}
                    >
                      Push to Figma
                    </button>
                  )}
                  <button
                    aria-label={`Comment ${asset.name} on Figma`}
                    disabled={figmaRef.trim() === ""}
                    onClick={() => onComment(asset)}
                  >
                    Post as comment
                  </button>
                  <button
                    aria-label={`Delete ${asset.name}`}
                    onClick={() =>
                      void deleteDesignAsset(asset.id).then(refresh).catch((e) => setError(String(e)))
                    }
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
