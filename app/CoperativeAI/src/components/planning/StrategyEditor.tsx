import { useCallback, useEffect, useState } from "react";
import { getStrategy, saveStrategy } from "../../lib/backend";

interface StrategyEditorProps {
  productId: number;
  area: string; // "develop" | "test" (product uses ProductStrategy)
  title: string;
  fields: { id: string; label: string }[];
  /** One field's id, drawn first and large as the standing direction everything
   *  else is written under. Omitted, every field is the same size — which is
   *  right for Test, where none of them leads. */
  lead?: string;
}

/** A generic structured-strategy editor: labelled textareas saved as one JSON
 *  document per (product, area). Used by the Develop and Test areas. */
export default function StrategyEditor({
  productId,
  area,
  title,
  fields,
  lead,
}: StrategyEditorProps) {
  const [content, setContent] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const json = await getStrategy(productId, area);
      try {
        setContent(JSON.parse(json) as Record<string, string>);
      } catch {
        setContent({});
      }
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId, area]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function saveField(id: string, value: string) {
    const next = { ...content, [id]: value };
    setContent(next);
    try {
      await saveStrategy(productId, area, JSON.stringify(next));
      setSavedNote("Saved.");
    } catch (e) {
      setError(String(e));
    }
  }

  const leadField = lead ? (fields.find((f) => f.id === lead) ?? null) : null;
  const rest = leadField ? fields.filter((f) => f.id !== leadField.id) : fields;

  return (
    <section className="strategy-editor" aria-label={title}>
      <h2>{title}</h2>
      {error && <p role="alert">{error}</p>}
      {savedNote && <p role="status">{savedNote}</p>}
      {/* The lead field, drawn as the standing direction rather than the first
          of six equal boxes. Same textarea and the same save — only its size
          says it is read before the rest. */}
      {leadField && (
        <label className="strategy-lead">
          <span className="lead-kicker">{leadField.label}</span>
          <textarea
            aria-label={leadField.label}
            rows={3}
            placeholder="The direction everything below is written under."
            defaultValue={content[leadField.id] ?? ""}
            onBlur={(e) => saveField(leadField.id, e.target.value)}
          />
        </label>
      )}

      <div className="strategy-fields">
        {rest.map((f) => (
          <label key={f.id}>
            {f.label}
            <textarea
              aria-label={f.label}
              defaultValue={content[f.id] ?? ""}
              onBlur={(e) => saveField(f.id, e.target.value)}
            />
          </label>
        ))}
      </div>
    </section>
  );
}
