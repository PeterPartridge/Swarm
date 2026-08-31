import DeveloperRulesEditor from "../ai/DeveloperRulesEditor";
import LifecycleSteps from "./LifecycleSteps";
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
 *  **One place owns the rules, and this is it.** They used to be edited in
 *  Admin and shown read-only here, on the reasoning that Admin owned them. That
 *  put the rules a screen away from the strategy they qualify and from the
 *  enforcement panel that reports on them, so the people writing them were the
 *  ones who had to go somewhere else. The Admin copy is gone rather than
 *  duplicated: two editors for one set of rules drift, and the drift is
 *  invisible until the AI obeys the wrong copy. */
export default function RulesView({ productId }: { productId: number }) {
  return (
    <div className="rules-view">
      <header className="rules-head">
        <div>
          <h2>Strategy and rules</h2>
          <p className="hint">
            Every agent reads this before it plans — both the technical strategy
            and the Developer Rules are edited here.
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

          {/* Editable here, and only here. */}
          <DeveloperRulesEditor productId={productId} />

          {/* **The same kind of thing as the rules above.** What every team
              agrees to before the work starts, read on every work item
              afterwards — so it is written where the rest of the standing
              direction is, rather than growing a settings screen of its own. */}
          <LifecycleSteps productId={productId} />
        </div>

        <RuleEnforcement productId={productId} />
      </div>
    </div>
  );
}
