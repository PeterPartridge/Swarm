import { useCallback, useEffect, useState } from "react";
import { getStrategy, saveStrategy } from "../lib/backend";

interface StrategyEditorProps {
  productId: number;
  area: string; // "develop" | "test" (product uses ProductStrategy)
  title: string;
  fields: { id: string; label: string }[];
}

/** A generic structured-strategy editor: labelled textareas saved as one JSON
 *  document per (product, area). Used by the Develop and Test areas. */
export default function StrategyEditor({ productId, area, title, fields }: StrategyEditorProps) {
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

  return (
    <section className="strategy-editor" aria-label={title}>
      <h2>{title}</h2>
      {error && <p role="alert">{error}</p>}
      {savedNote && <p role="status">{savedNote}</p>}
      <div className="strategy-fields">
        {fields.map((f) => (
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
