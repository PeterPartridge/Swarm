import { useCallback, useEffect, useState } from "react";
import {
  getDeveloperRules,
  setDeveloperRules,
  DEVELOPER_RULE_FIELDS,
  type DeveloperRuleField,
  type DeveloperRules,
} from "../../lib/backend";

const EMPTY: Omit<DeveloperRules, "productId"> = {
  codingStandards: "",
  architecturePrinciples: "",
  maintainability: "",
  preferredFrameworks: "",
  allowedTech: "",
  disallowedTech: "",
  aiConstraints: "",
};

/** How hard each rule actually bites.
 *
 *  **Two levels, because there are two.** The design this came from had three
 *  (Blocking / Warn / Advisory) with per-rule counts like "212 checks · 4 blocks
 *  this week", and the app has neither: nothing counts how often a rule fired,
 *  and only one of these seven is checked at all. `disallowedTech` is stated as
 *  a prohibition *and* the answer is read back against it; the rest are put in
 *  the prompt and believed. Labelling all seven "Blocking" would be the more
 *  flattering lie. */
const ENFORCED: DeveloperRuleField = "disallowedTech";

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

      <div className="rule-cards">
        {DEVELOPER_RULE_FIELDS.map((field) => {
          const enforced = field.id === ENFORCED;
          const written = (rules[field.id] ?? "").trim() !== "";
          return (
            <label key={field.id} className={`rule-card ${written ? "" : "rule-empty"}`}>
              <span className="rule-card-head">
                <span className="rule-name">{field.label}</span>
                <span className={enforced ? "rule-level enforced" : "rule-level stated"}>
                  {enforced ? "Enforced" : "In the prompt"}
                </span>
              </span>
              <textarea
                aria-label={field.label}
                defaultValue={rules[field.id] ?? ""}
                readOnly={readOnly}
                placeholder={readOnly ? "Not set — write it in Admin." : ""}
                onBlur={readOnly ? undefined : (e) => saveField(field.id, e.target.value)}
              />
            </label>
          );
        })}
      </div>

      <p className="hint">
        Only <strong>disallowed technologies</strong> is checked: it goes into
        the prompt as a prohibition and the answer is read back against it. The
        other six are stated and believed — the app does not count how often any
        rule fired.
      </p>
    </section>
  );
}
