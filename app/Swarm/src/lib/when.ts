import type { AiJob } from "./backend";

/** When a job stopped, in the shortest form that is still unambiguous.
 *
 *  Today's are a time, because "did that just happen?" is the question on the
 *  day; anything older is a date, because by then the question is "how long has
 *  that been sitting there?".
 *
 *  **Shared, because an undated failure reads as a failure now.** The rule
 *  enforcement panel and the AI feedback panel both list attempts that stopped,
 *  and a list of refusals with no times had somebody reading nine records from
 *  before a fix as nine problems with the app in front of them. */
export function whenStopped(job: AiJob): string {
  const at = job.finishedAt ?? job.startedAt ?? job.submittedAt;
  if (!at) return "—";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "—";
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** One failure, however many times it happened.
 *
 *  **A refusal repeated on every attempt is one fact, not nine.** Pressing Plan
 *  eight times against a policy that says no writes eight identical rows, and
 *  read as a list that looks like eight separate things going wrong. Grouped by
 *  what was said, newest first, carrying the count and the most recent time. */
export interface Failed {
  /** The newest job with this message — its id keys the row. */
  id: number;
  purpose: string;
  message: string;
  times: number;
  when: string;
}

export function groupFailures(jobs: AiJob[]): Failed[] {
  const byMessage = new Map<string, AiJob[]>();
  for (const job of jobs) {
    const held = byMessage.get(job.message);
    if (held) held.push(job);
    else byMessage.set(job.message, [job]);
  }
  return [...byMessage.values()]
    .map((group) => {
      const newest = group.reduce((a, b) => (b.submittedAt > a.submittedAt ? b : a));
      return {
        id: newest.id,
        purpose: newest.purpose,
        message: newest.message,
        times: group.length,
        when: whenStopped(newest),
      };
    })
    .sort((a, b) => b.id - a.id);
}
