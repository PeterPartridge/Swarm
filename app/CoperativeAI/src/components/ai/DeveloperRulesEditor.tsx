import { useCallback, useEffect, useState } from "react";
import {
  ruleTemplates,
  type RuleTemplate,
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
  /// The ready-made rule sets on offer, and which is picked.
  ///
  /// **Insert, never replace.** A template appends to whatever is already in a
  /// field: somebody who has written their own paragraph and then looks at a
  /// template should not lose it for looking. Choosing the same one twice adds
  /// it twice, which is visible and undoable — unlike a silent overwrite.
  const [templates, setTemplates] = useState<RuleTemplate[]>([]);
  const [chosen, setChosen] = useState("");

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

  // Fetched once. Not having them is not a failure of the form — the fields
  // still work — so a problem here is left quiet rather than raised over an
  // editor somebody is using.
  useEffect(() => {
    if (readOnly) return;
    void ruleTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [readOnly]);

  /// Adds a template's wording to whatever is already written.
  ///
  /// **Appended, never substituted.** Somebody who has written their own
  /// paragraph and then looks at a template must not lose it for looking, so
  /// each block goes on the end of its field with a blank line between. Picking
  /// the same one twice adds it twice — visible, and undone by editing, which
  /// a silent overwrite would not be.
  async function insertTemplate(id: string) {
    const template = templates.find((t) => t.id === id);
    if (!template) return;
    const join = (was: string, add: string) =>
      add.trim() === "" ? was : was.trim() === "" ? add : `${was.trimEnd()}\n\n${add}`;

    const next = {
      ...rules,
      codingStandards: join(rules.codingStandards, template.codingStandards),
      architecturePrinciples: join(rules.architecturePrinciples, template.architecturePrinciples),
      maintainability: join(rules.maintainability, template.maintainability),
      aiConstraints: join(rules.aiConstraints, template.aiConstraints),
    };
    setRules(next);
    setChosen("");
    try {
      await setDeveloperRules({ ...next, productId });
      setNotice(`Added "${template.name}". Edit it to suit — it is a starting point.`);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

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

      </p>

      {/* **A starting point, not a decision.** An empty rules form is the
          hardest kind to fill in, and a field that stays blank is a rule the AI
          is never given. Each option names its source, because "our rules" and
          "the Twelve-Factor App" carry very different weight and somebody
          deciding whether to keep a line should be able to go and read the
          original. */}
      {!readOnly && templates.length > 0 && (
        <div className="rule-templates">
          <label htmlFor="rule-template">Start from</label>
          <select
            id="rule-template"
            value={chosen}
            onChange={(e) => {
              setChosen(e.target.value);
              if (e.target.value !== "") void insertTemplate(e.target.value);
            }}
          >
            <option value="">Choose a template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {t.summary}
              </option>
            ))}
          </select>
          <p className="hint">
            Adds to what is already written rather than replacing it. Sources:{" "}
            {templates.map((t, i) => (
              <span key={t.id}>
                {i > 0 ? "; " : ""}
                {t.url ? (
                  <a href={t.url} target="_blank" rel="noreferrer">
                    {t.source}
                  </a>
                ) : (
                  t.source
                )}
                {t.licence ? ` (${t.licence})` : ""}
              </span>
            ))}
            .
          </p>
        </div>
      )}
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
