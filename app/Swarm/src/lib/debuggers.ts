import { useEffect, useState } from "react";
import { isAbsolutePath, relativeTo } from "./breakpoints";
import { debugAdapters, type AdapterStatus } from "./backend";

/** Which language a Solution would be debugged as.
 *
 *  Guessed from what it was created as, which is the only signal recorded —
 *  and `Solution.language` is explicitly "a record of what it was begun as, not
 *  a claim about what it is now". So a wrong guess is possible, and every
 *  caller names the language it is offering rather than silently picking one. */
export function debugLanguageOf(language: string | null): string | null {
  const said = (language ?? "").toLowerCase();
  if (said.includes("go")) return "go";
  if (said.includes("python")) return "python";
  if (said.includes("c#") || said.includes("dotnet") || said.includes(".net")) return "csharp";
  if (said.includes("typescript") || said.includes("javascript") || said.includes("node")) {
    return "typescript";
  }
  return null;
}

/** The languages whose launch shape is built — now all four.
 *
 *  Go through Delve, TypeScript and JavaScript through js-debug, C# through
 *  netcoredbg, Python through debugpy. The shapes differ more than "different
 *  arguments" suggests: Delve is handed a folder and builds it, netcoredbg a
 *  built assembly, and debugpy exactly one `.py` — which is why a Python
 *  Solution can be refused for having nothing in it that looks like a program.
 *  That refusal is a real answer and comes from the backend. */
export const CAN_LAUNCH = ["go", "python", "typescript", "csharp"];

/** Whether this app knows how to launch that language at all — before asking
 *  whether the machine has the adapter for it. Two different questions, and
 *  running them together would report a missing toolchain as an unbuilt
 *  feature. */
export function canLaunchDebugger(language: string | null): boolean {
  const found = debugLanguageOf(language);
  return found !== null && CAN_LAUNCH.includes(found);
}

/** What pressing Debug will actually do to one Solution.
 *
 *  Three answers, not two, because "it will not be debugged" has two very
 *  different causes and only one of them is fixable by the person reading it:
 *  a language this app has no launch shape for is a thing to wait for, and a
 *  missing adapter is one command away. */
export type Readiness =
  | { state: "ready"; language: string; label: string }
  /** The adapter for it is not on this machine. `install` is the command. */
  | { state: "missing"; language: string; label: string; problem: string; install: string }
  /** No launch shape in this app yet, or no language recorded at all. */
  | { state: "unsupported"; language: string | null }
  /** The adapter list has not come back yet — not the same as "no".  */
  | { state: "unknown" };

/** Whether a Solution can actually be launched under a debugger right now.
 *
 *  **Asked before the press, not discovered by it.** `debugAdapters` runs every
 *  candidate rather than looking for a filename, so this rests on the adapter
 *  having actually executed — which is the difference that matters on Windows,
 *  where the `python` on PATH is usually a Store stub that prints an advert. */
export function readinessOf(
  language: string | null,
  adapters: AdapterStatus[] | null,
): Readiness {
  const found = debugLanguageOf(language);
  if (found === null || !CAN_LAUNCH.includes(found)) {
    return { state: "unsupported", language: found };
  }
  if (adapters === null) return { state: "unknown" };
  const adapter = adapters.find((a) => a.language === found);
  // An adapter this app launches for but that the list does not mention is a
  // gap in the list, not a working debugger — reported as missing with nothing
  // to install, which is at least true.
  if (!adapter) {
    return { state: "missing", language: found, label: found, problem: "", install: "" };
  }
  return adapter.available
    ? { state: "ready", language: found, label: adapter.label }
    : {
        state: "missing",
        language: found,
        label: adapter.label,
        problem: adapter.problem,
        install: adapter.install,
      };
}

/** What this machine can debug, read once.
 *
 *  Each candidate is **executed** to answer it, so this is not free — which is
 *  why it is one read shared by everything that needs it rather than a call per
 *  Solution per render.
 *
 *  **A read that failed stays `null`, not `[]`.** Those mean different things:
 *  an empty list is "nothing is installed", and null is "nobody knows". Letting
 *  a failure collapse into the first would refuse to start a debugger that is
 *  sitting right there, on the strength of a question that never got asked. */
/** A stored "start from", and why it will not travel if it will not.
 *
 *  **Three answers, because there are two ways out of the repository** and they
 *  read differently to whoever has to fix them: an absolute path is this
 *  machine's answer to the question, and a relative one full of `..` is an
 *  answer that depends on what sits *beside* the repository. Collapsing them
 *  into one boolean would mean one sentence covering both, and it would be
 *  wrong about one of them. */
export interface StartFrom {
  stored: string;
  /** Null when it is inside the working copy and will travel. */
  outside: null | "absolute" | "escapes";
}

/** What to store for a "start from", and whether it will travel.
 *
 *  **One function for the picker and the box.** They were two: the picker
 *  resolved what it was given and set a flag, and a path typed by hand went
 *  through neither — so `C:\repos\orders\api\serve.py` typed in was stored
 *  whole, with no warning, and meant a different file on the next machine.
 *  Whether a path travels is a fact about the path, not a memory of how it
 *  arrived, so it is worked out from the value both ways in.
 *
 *  - Relative in, relative out, with backslashes tidied so it matches what the
 *    picker produces.
 *  - Absolute and inside the working copy: **made relative**, because that is
 *    the same answer written portably and there is no reason to keep the
 *    machine-specific form.
 *  - Absolute and outside it: kept whole, and `outside` says so. A `.dll` built
 *    elsewhere is a legitimate answer; pretending it is portable is not. */
export function startFromFor(root: string, chosen: string): StartFrom {
  const typed = chosen.trim();
  if (typed === "") return { stored: "", outside: null };
  if (!isAbsolutePath(typed)) {
    // **Resolved against the root, not merely inspected.** `../../shared/x`
    // leaves the repository and `../orders/api/x` climbs out and straight back
    // in — which of those is which cannot be told by looking at the leading
    // dots, only by working out where they land.
    const inside = relativeTo(root, resolveAgainst(root, typed));
    return inside === null
      ? // Kept as written rather than as the absolute it resolves to: a
        // sibling checkout is a real answer, and it stays truer to what
        // somebody meant on a machine where the sibling is there.
        { stored: tidy(typed).join("/"), outside: "escapes" }
      : { stored: inside, outside: null };
  }
  const inside = relativeTo(root, typed);
  return inside === null
    ? { stored: typed, outside: "absolute" }
    : { stored: inside, outside: null };
}

/** Splits a path and resolves `.` and `..` without touching the disk.
 *
 *  **Lexical on purpose.** The real filesystem is the backend's business and a
 *  symlink could make this wrong — but the question here is what to *store*,
 *  and `api/../serve.py` should be stored as `serve.py` on any machine rather
 *  than only on one where that folder happens to exist. A leading `..` that
 *  cannot be cancelled is kept, because that is the case worth naming. */
function tidy(path: string): string[] {
  const out: string[] = [];
  for (const part of path.split(/[\\/]+/)) {
    if (part === "" || part === ".") continue;
    if (part === ".." && out.length > 0 && out[out.length - 1] !== "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out;
}

/** Where a relative path lands, starting from the working copy. */
function resolveAgainst(root: string, relative: string): string {
  const base = root.replace(/\\/g, "/").replace(/\/+$/, "");
  // A POSIX root's leading slash is lost by splitting on separators, and
  // putting it back is what keeps `/srv/app` from becoming `srv/app`.
  const lead = base.startsWith("/") ? "/" : "";
  return lead + tidy(`${base}/${relative}`).join("/");
}

/* ── One read, shared, and re-run when somebody installs something ──────── */

type Listener = () => void;
const listeners = new Set<Listener>();

/** The read that is happening right now, if one is.
 *
 *  **Deduped rather than cached.** Three components ask for this list — the run
 *  picker, the process board and each session panel — and answering each
 *  separately would execute every candidate adapter three times over. Sharing
 *  the in-flight promise collapses that to one. Sharing the *result* would be
 *  the obvious next step and is deliberately not done: a cache that outlives
 *  the read is a cache that has to be invalidated, and the thing it would go
 *  stale against — somebody installing a debugger — is exactly what this module
 *  now has to notice. */
let inFlight: Promise<AdapterStatus[]> | null = null;

/** Whether the last answer had anything missing in it.
 *
 *  The focus re-read is gated on this: probing every adapter each time the
 *  window is clicked would run several binaries for nothing, and there is only
 *  a point in looking again when the previous answer had a gap somebody might
 *  have gone off to fill. */
let anythingMissing = false;

function readAdapters(): Promise<AdapterStatus[]> {
  if (inFlight) return inFlight;
  inFlight = debugAdapters()
    .then((found) => {
      anythingMissing = found.some((a) => !a.available);
      return found;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Look again — the adapter list is read afresh and every panel is told.
 *
 *  **Because installing one is how the missing case gets fixed.** The app shows
 *  the command; somebody runs it in a terminal and comes back, and until this
 *  existed the only way to be believed was to reopen the pane. A refusal that
 *  outlives the reason for it is worse than no check at all — it is the app
 *  insisting on something that stopped being true. */
export function recheckDebuggers() {
  // Any read already going was started before the install, so its answer is the
  // one being corrected — dropped rather than shared.
  inFlight = null;
  for (const listener of [...listeners]) listener();
}

export function useDebuggers(): {
  adapters: AdapterStatus[] | null;
  /** Whether the read has finished, either way.
   *
   *  **Separate from having an answer**, because a Debug press has to wait for
   *  this and not for that. Acting while the list is still coming back would
   *  race it: the first render says "nobody knows", the press goes through, and
   *  the verdict arrives a moment later with nothing left to decide. A read that
   *  finished and failed is settled — there is nothing more to wait for. */
  settled: boolean;
  /** Read it again, everywhere. Hand this to whatever offers the install. */
  recheck: () => void;
} {
  const [adapters, setAdapters] = useState<AdapterStatus[] | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let dropped = false;

    const look = () => {
      setSettled(false);
      void readAdapters()
        .then((found) => {
          if (!dropped) setAdapters(found);
        })
        .catch(() => {
          // Left unknown on purpose — see above. Not cleared either: a failed
          // re-read must not throw away an answer that was working.
        })
        .finally(() => {
          if (!dropped) setSettled(true);
        });
    };

    look();
    listeners.add(look);

    // **Coming back from the terminal you installed it in.** The command is
    // run outside this app, so nothing here can be told it finished — but
    // returning to the window is the moment somebody expects the answer to have
    // changed. Gated on the last answer having had a gap, because executing
    // every candidate on each alt-tab would be a lot of work for nothing.
    const onFocus = () => {
      if (anythingMissing) look();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      dropped = true;
      listeners.delete(look);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return { adapters, settled, recheck: recheckDebuggers };
}
