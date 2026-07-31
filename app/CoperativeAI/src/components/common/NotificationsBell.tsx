import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkChanged } from "../../lib/workSignal";
import { listRecentAiJobs, type AiJob } from "../../lib/backend";

/** What the AI has been doing, from anywhere in the app.
 *
 *  The redesign puts a bell in the topbar; this is what it reports. **Only
 *  things that actually happened** — every row is an AI job the app really ran,
 *  read across all Products, because a queue left running under a Product you
 *  are not looking at is exactly what a bell is for.
 *
 *  A job that asked a question or failed is what deserves attention, so those
 *  are what the unread dot counts.
 *
 *  **"Read" survives a restart.** Marking everything read and finding the same
 *  dot back after reopening the app is the behaviour that teaches people to
 *  ignore a bell. It is kept as the highest job id read through, on this
 *  machine — job ids only climb, so one number answers "is this newer than what
 *  I have seen" for every row, and it cannot grow without bound the way a list
 *  of ids would. Per machine rather than in the database, for the same reason
 *  the theme is: what one person has looked at is not a shared fact. */
export default function NotificationsBell() {
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [open, setOpen] = useState(false);
  const [readThrough, setReadThrough] = useState<number>(() => loadReadThrough());
  const holder = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setJobs(await listRecentAiJobs());
    } catch {
      // Outside Tauri (the browser preview) there is nothing to report; a bell
      // that shouted an error would be worse than a quiet one.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useWorkChanged(refresh);

  // A click anywhere else closes it, the way every dropdown like this does.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (holder.current && !holder.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  /// Worth interrupting for: a question to answer, or a failure to look at.
  const notable = jobs.filter((j) => j.state === "blocked" || j.state === "failed");
  const unread = notable.filter((j) => j.id > readThrough).length;

  function markAllRead() {
    // The highest id in hand, not just the notable ones: everything currently
    // listed has been seen, so a later job is the only thing that should ring.
    const highest = jobs.reduce((max, j) => Math.max(max, j.id), readThrough);
    setReadThrough(highest);
    saveReadThrough(highest);
  }

  return (
    <div className="notif" ref={holder}>
      <button
        className="notif-button"
        aria-label={
          unread === 0 ? "Notifications" : `Notifications, ${unread} needing attention`
        }
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5.5 8a4.5 4.5 0 0 1 9 0c0 3.2 1.2 4.4 1.2 4.4H4.3S5.5 11.2 5.5 8Z" />
          <path d="M8.4 15a1.8 1.8 0 0 0 3.2 0" />
        </svg>
        {unread > 0 && <span className="notif-dot" aria-hidden="true" />}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <strong>Notifications</strong>
            {notable.length > 0 && (
              <button className="notif-mark" onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>

          {jobs.length === 0 ? (
            <p className="hint notif-empty">
              Nothing yet. Submitting a work item for planning shows up here.
            </p>
          ) : (
            <ul className="notif-list">
              {jobs.slice(0, 8).map((job) => (
                <li key={job.id} className={`notif-item notif-${job.state}`}>
                  <span className={`notif-state ${job.state}`}>{STATE_WORDS[job.state]}</span>
                  <span className="notif-title">{job.workItemTitle}</span>
                  {job.message && <span className="notif-message">{job.message}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const READ_KEY = "coperativeai.notificationsReadThrough";

/** The highest job id already looked at. Zero means "nothing read yet", which
 *  is the right answer for a fresh machine and for one whose storage is
 *  unreadable — showing a dot that is not needed is a smaller failure than
 *  hiding one that is. */
function loadReadThrough(): number {
  try {
    const raw = localStorage.getItem(READ_KEY);
    const parsed = raw === null ? 0 : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function saveReadThrough(id: number): void {
  try {
    localStorage.setItem(READ_KEY, String(id));
  } catch {
    // A machine that refuses localStorage still clears the dot for this
    // session; it just rings again next launch.
  }
}

/** A job's state said as an outcome rather than a database value — "asked a
 *  question" is what a blocked job actually did. */
const STATE_WORDS: Record<AiJob["state"], string> = {
  queued: "waiting",
  running: "running",
  done: "planned",
  blocked: "asked a question",
  failed: "failed",
  // "you stopped it" rather than "cancelled": the bell reports what happened,
  // and this is the one outcome the reader caused themselves.
  cancelled: "you stopped it",
};
