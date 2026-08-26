import { useCallback, useEffect, useState } from "react";
import { track } from "../../lib/saving";
import {
  changeKinds,
  kindLocations,
  ruleTemplates,
  type ChangeKindInfo,
  type RuleTemplate,
  getDeveloperRules,
  setDeveloperRules,
  DEVELOPER_RULE_FIELDS,
  type DeveloperRuleField,
  type DeveloperRules,
} from "../../lib/backend";

/** The part of a template that belongs in one box, or empty.
 *
 *  Templates carry a block per field so a source can speak to architecture
 *  without also speaking to security. Fields a template says nothing about
 *  come back empty and are left alone. */
function blockFor(template: RuleTemplate, field: DeveloperRuleField): string {
  switch (field) {
    case "codingStandards":
      return template.codingStandards;
    case "architecturePrinciples":
      return template.architecturePrinciples;
    case "maintainability":
      return template.maintainability;
    case "aiConstraints":
      return template.aiConstraints;
    // The three list fields are somebody's own choices about their own stack,
    // and no outside source can supply them.
    default:
      return "";
  }
}

const EMPTY: Omit<DeveloperRules, "productId"> = {
  codingStandards: "",
  architecturePrinciples: "",
  maintainability: "",
  preferredFrameworks: "",
  allowedTech: "",
  disallowedTech: "",
  aiConstraints: "",
  kindLocations: "{}",
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
  /// The vocabulary of things a Solution can hold, so the "where does it live"
  /// rows are the same list the build plan ticks from rather than a second one
  /// written here.
  const [vocabulary, setVocabulary] = useState<ChangeKindInfo[]>([]);

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
  /// Adds one template's wording to **one** field.
  ///
  /// **Per box rather than per form.** The first version inserted every block a
  /// template had, so taking ASVS for coding standards also took whatever it
  /// said about anything else. Somebody filling in a form wants the security
  /// paragraph in the security box and nothing else moved.
  ///
  /// Still appended, never substituted: somebody who has written their own
  /// paragraph and then looks at a template must not lose it for looking.
  async function insertTemplate(id: string, field: DeveloperRuleField) {
    const template = templates.find((t) => t.id === id);
    if (!template) return;
    const add = blockFor(template, field);
    if (add.trim() === "") return;

    const was = rules[field] ?? "";
    const next = {
      ...rules,
      [field]: was.trim() === "" ? add : `${was.trimEnd()}\n\n${add}`,
    };
    setRules(next);
    try {
      await track("Developer rules", () => setDeveloperRules({ ...next, productId }));
      setNotice(`Added "${template.name}". Edit it to suit — it is a starting point.`);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    void changeKinds()
      .then(setVocabulary)
      // The prose rules still work without the vocabulary, so a failure here
      // is not raised over an editor somebody is using.
      .catch(() => setVocabulary([]));
  }, []);

  async function saveField(id: DeveloperRuleField, value: string) {
    const next = { ...rules, [id]: value };
    setRules(next);
    try {
      await track("Developer rules", () => setDeveloperRules({ ...next, productId }));
      // The bar says it saved, so the panel does not say it twice.
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  /// Records where one kind of thing lives, or clears it.
  ///
  /// A blank is a real answer and stored as one — the difference between "they
  /// go in `src/pages`" and "nobody has said" is exactly what decides whether
  /// the build plan scans for existing screens or admits it does not know.
  async function saveLocation(kind: string, folder: string) {
    const map = kindLocations(rules.kindLocations);
    if (folder.trim() === "") delete map[kind];
    else map[kind] = folder.trim();
    const next = { ...rules, kindLocations: JSON.stringify(map) };
    setRules(next);
    try {
      await track("Developer rules", () => setDeveloperRules({ ...next, productId }));
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
      {/* **Where the wording comes from, once.** Naming the sources beside
          every dropdown would repeat them seven times; naming them nowhere
          would leave somebody unable to check what they had just inserted. */}
      {!readOnly && templates.length > 0 && (
        <p className="hint">
          Each box can start from a template. Sources:{" "}
          {templates
            .filter((t) => t.url !== "")
            .map((t, i) => (
              <span key={t.id}>
                {i > 0 ? "; " : ""}
                <a href={t.url} target="_blank" rel="noreferrer">
                  {t.source}
                </a>
                {t.licence ? ` (${t.licence})` : ""}
              </span>
            ))}
            . Inserting adds to what is already written rather than replacing it.
        </p>
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
              {/* Only where this template has something for this box. A
                  dropdown offering a choice that inserts nothing is a control
                  that does not work. */}
              {!readOnly && templates.some((t) => blockFor(t, field.id) !== "") && (
                <select
                  aria-label={`Start ${field.label} from a template`}
                  value=""
                  onChange={(e) => {
                    if (e.target.value !== "") void insertTemplate(e.target.value, field.id);
                  }}
                >
                  <option value="">Start from…</option>
                  {templates
                    .filter((t) => blockFor(t, field.id) !== "")
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              )}
              <textarea
                aria-label={field.label}
                // Re-keyed so an insert shows: the box is uncontrolled so that
                // typing is not fought, and without this it would keep the text
                // it mounted with.
                key={`${field.id}:${(rules[field.id] ?? "").length}`}
                defaultValue={rules[field.id] ?? ""}
                readOnly={readOnly}
                placeholder={readOnly ? "Not set — write it in Admin." : ""}
                onBlur={readOnly ? undefined : (e) => saveField(field.id, e.target.value)}
              />
            </label>
          );
        })}
      </div>

      {/* **The rule with a second job.** "Screens go in `src/pages`" is a
          convention an agent cannot reliably read out of the code — and it is
          also what lets the build plan offer the screens that already exist
          instead of asking somebody to remember their names. Nothing is scanned
          for a kind nobody has placed: a guess that screens are "probably in
          src/pages" would produce confident suggestions for a repository laid
          out some other way. */}
      {vocabulary.length > 0 && (
        <section className="rule-locations" aria-label="Where things live">
          <h3>Where things live</h3>
          <p className="hint">
            A folder inside a working copy, per kind of thing. Agents are told
            it, and the build plan reads the folder to suggest what is already
            there. Left blank means nobody has said, and nothing is scanned.
          </p>
          <div className="rule-location-rows">
            {vocabulary.map((k) => (
              <label key={k.id} className="rule-location">
                <span>{k.heading}</span>
                <input
                  type="text"
                  aria-label={`Where ${k.heading} live`}
                  placeholder="not said"
                  defaultValue={kindLocations(rules.kindLocations)[k.id] ?? ""}
                  readOnly={readOnly}
                  onBlur={
                    readOnly ? undefined : (e) => void saveLocation(k.id, e.target.value)
                  }
                />
              </label>
            ))}
          </div>
        </section>
      )}

      <p className="hint">
        Only <strong>disallowed technologies</strong> is checked: it goes into
        the prompt as a prohibition and the answer is read back against it. The
        other six are stated and believed — the app does not count how often any
        rule fired.
      </p>
    </section>
  );
}
