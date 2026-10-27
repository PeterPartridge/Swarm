/** Where a dev server is *probably* listening, given the command that starts it.
 *
 *  A guess, and labelled as one everywhere it is shown. The Solution's run
 *  command is detected from what is in the folder, not from a config that states
 *  a port, so the app genuinely does not know — and a URL presented as fact
 *  would send people hunting a bug in their server when the guess was simply
 *  wrong. First match wins; the ports are each framework's own default.
 *
 *  It lives in `lib/` rather than beside the preview because two panes want it
 *  now — the preview frames the URL, Debug labels the port on a process — and a
 *  second copy of this table would drift the first time somebody added a
 *  framework to one of them. */
export function guessDevUrl(runCommand: string): string {
  const command = runCommand.toLowerCase();
  const guesses: [RegExp, number][] = [
    [/\bnext\b/, 3000],
    [/\bnuxt\b/, 3000],
    [/\bvite\b|\bnpm run dev\b|\bpnpm dev\b|\byarn dev\b/, 5173],
    [/\bng serve\b/, 4200],
    [/\bdotnet\b/, 5000],
    [/\brails\b/, 3000],
    [/\bdjango\b|manage\.py runserver/, 8000],
    [/\bflask\b/, 5000],
    [/\buvicorn\b|\bfastapi\b/, 8000],
    [/\bcargo\b|\bair\b|\bgo run\b/, 8080],
  ];
  const match = guesses.find(([pattern]) => pattern.test(command));
  return `http://localhost:${match ? match[1] : 3000}`;
}

/** Just the `:port` part of the guess, for labelling a process. */
export function guessDevPort(runCommand: string): string {
  return guessDevUrl(runCommand).replace("http://localhost", "");
}
