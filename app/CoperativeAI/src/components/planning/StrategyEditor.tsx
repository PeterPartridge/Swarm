import { useCallback, useEffect, useState } from "react";
import { getStrategy, saveStrategy, type StrategyField } from "../../lib/backend";

interface StrategyEditorProps {
  productId: number;
  area: string; // "develop" | "test" (product uses ProductStrategy)
  title: string;
  /** Which field leads, if any, comes from the list itself — see `lead` on
   *  `StrategyField`. Naming it at the call site instead meant the fact lived
   *  in two places and only one of them was the list. */
  fields: StrategyField[];
}

/** A generic structured-strategy editor: labelled textareas saved as one JSON
 *  document per (product, area). Used by the Develop and Test areas. */
export default function StrategyEditor({
  productId,
  area,
  title,
  fields,
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

  const leadField = fields.find((f) => f.lead) ?? null;
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
