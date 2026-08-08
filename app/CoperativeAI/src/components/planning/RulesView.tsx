import DeveloperRulesEditor from "../ai/DeveloperRulesEditor";
import RuleEnforcement from "../ai/RuleEnforcement";
import StrategyEditor from "./StrategyEditor";
import { DEVELOP_STRATEGY_FIELDS } from "../../lib/backend";

/** Strategy and rules: what every agent reads before it plans.
 *
 *  Two columns, as the design has it — the standing direction and the rules
 *  under it down the left, what actually stopped an agent down the right.
 *
 *  **The design's scoreboard is not here.** It opened with three figures —
 *  "68% of agent PRs merged first try", "11m median ticket to review", "4/4
 *  rules enforced by agents" — and per-rule counts beside every line. This app
 *  records none of them: it does not watch pull requests, does not time a ticket
 *  to review, and counts no rule firings. The header states what *is* true —
 *  how many rules are written, and that exactly one of them is checked — which
 *  is the same reassurance minus the invented part.
 *
 *  **Two places do not own the rules.** The technical strategy is edited here
 *  because it is the developers'; the Developer Rules are read-only because
 *  Admin owns them, and a second editor would drift. */
export default function RulesView({ productId }: { productId: number }) {
  return (
    <div className="rules-view">
      <header className="rules-head">
        <div>
          <h2>Strategy and rules</h2>
          <p className="hint">
            Every agent reads this before it plans. The technical strategy is
            yours to edit; the Developer Rules are set in Admin.
          </p>
        </div>
      </header>

      <div className="rules-body">
        <div className="rules-main">
          {/* Which field leads is marked on the field list itself, so this call
              site does not carry a second copy of that decision. */}
          <StrategyEditor
            productId={productId}
            area="develop"
            title="Technical Strategy"
            fields={DEVELOP_STRATEGY_FIELDS}
          />

          {/* Read-only here — these are set in Admin. Two editors for one set
              of rules would drift, and the drift would be invisible until the
              AI obeyed the wrong copy. */}
          <DeveloperRulesEditor productId={productId} readOnly />
        </div>

        <RuleEnforcement productId={productId} />
      </div>
    </div>
  );
}
