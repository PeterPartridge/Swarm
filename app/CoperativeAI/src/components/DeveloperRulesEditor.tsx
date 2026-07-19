import { useCallback, useEffect, useState } from "react";
import {
  getDeveloperRules,
  setDeveloperRules,
  DEVELOPER_RULE_FIELDS,
  type DeveloperRuleField,
  type DeveloperRules,
} from "../lib/backend";

const EMPTY: Omit<DeveloperRules, "productId"> = {
  codingStandards: "",
  architecturePrinciples: "",
  maintainability: "",
  preferredFrameworks: "",
  allowedTech: "",
  disallowedTech: "",
  aiConstraints: "",
};

/** The constraints the AI must work within when proposing how to build
 *  something. These are not notes: disallowed technologies are stated as a
 *  prohibition in the prompt and the AI's answer is checked against them.
 *
 *  Editable in Admin, where policy lives. Rendered `readOnly` in the Develop
 *  area so developers can see the rules they are working under without two
 *  places claiming to own them — a copy that drifts is worse than a pointer. */
export default function DeveloperRulesEditor({
  productId,
  readOnly = false,
}: {
  productId: number;
  readOnly?: boolean;
}) {
  const [rules, setRules] = useState({ ...EMPTY });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const loaded = await getDeveloperRules(productId);
      setRules(loaded ? { ...loaded } : { ...EMPTY });
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function saveField(id: DeveloperRuleField, value: string) {
    const next = { ...rules, [id]: value };
    setRules(next);
    try {
      await setDeveloperRules({ ...next, productId });
      setNotice("Developer rules saved.");
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <section className="strategy-editor" aria-label="Developer Rules">
      <h2>Developer Rules</h2>
      <p className="hint">
        What the AI must follow when it proposes code, architecture or plans.
        Anything listed as <strong>disallowed</strong> is stated as a hard
        prohibition and the AI's answer is checked against it.
        {readOnly && " These are set in the Admin area."}
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      <div className="strategy-fields">
        {DEVELOPER_RULE_FIELDS.map((field) => (
          <label key={field.id}>
            {field.label}
            <textarea
              aria-label={field.label}
              defaultValue={rules[field.id] ?? ""}
              readOnly={readOnly}
              onBlur={readOnly ? undefined : (e) => saveField(field.id, e.target.value)}
            />
          </label>
        ))}
      </div>
    </section>
  );
}
