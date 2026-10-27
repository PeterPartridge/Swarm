import type { Blocked } from "../../lib/backend";

/** The AI declining, shown the same way everywhere.
 *
 *  **Not a failure, and it should not read like one.** A model that asks
 *  instead of inventing the missing half is the framework working, so this is
 *  never an `alert`, and it always leads with what the AI declined to do
 *  rather than with the word "error".
 *
 *  `status` rather than `note`: it appears after an async action, and `status`
 *  is a live region, so a screen reader announces the question when it arrives
 *  instead of leaving it sitting unread on the page.
 *
 *  Before this existed the same sentence was assembled at seven call sites in
 *  three different wordings, and three of them forgot to guard an empty
 *  `whatIsNeeded` — so a decline with no question showed a dangling sentence.
 *  One component means one wording and one guard.
 *
 *  `what` completes "The AI stopped rather than …" — pass a verb phrase such
 *  as `"guessing"` or `"inventing an architecture"`.
 *
 *  `answerOn` is for the callers whose question is *stored* rather than shown:
 *  the planning board writes the question onto the card, so repeating it here
 *  would say the same thing twice. Give it the place to look ("the card") and
 *  it points there instead of restating the question. */
export default function BlockedNote({
  blocked,
  what,
  answerOn,
}: {
  blocked: Blocked;
  what: string;
  answerOn?: string;
}) {
  return (
    <div className="ai-blocked" role="status">
      <p>
        The AI stopped rather than {what}: {blocked.reason}
      </p>
      {answerOn ? (
        <p>Answer its question on {answerOn} to try again.</p>
      ) : (
        blocked.whatIsNeeded && (
          <p>
            <strong>{blocked.whatIsNeeded}</strong>
          </p>
        )
      )}
    </div>
  );
}
