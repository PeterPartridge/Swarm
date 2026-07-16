---
form: page-brief
page: "Terminal"
solution: "CoperativeAI"
depends-on: ["workspaceShell.md"]
status: filled            # blank | filled | approved | built
---

# Page Brief — Terminal

> **Who fills this in:** Product describes what the page is for; Developers add the building details.
>
> **How:** answer each question in plain English directly under its heading. Lines starting with `>` are guidance — anything else you write under a heading is your answer.

---

## Part 1 — What This Page Is For *(Product answers — set once)*

### why-exists — Why does this page exist?
So developers can run real terminal commands inside the app — a genuine OS shell in a panel of the Develop environment, working in the active repository's folder.

---

## Part 2 — What It Should Do *(Product answers — can change each round)*

### actions — What should someone be able to do on this page?
- Someone (who: a developer) can: open a terminal panel running their OS shell (PowerShell/cmd on Windows, the default shell on Linux).
- Someone (who: a developer) can: type any command and see its live output, exactly as in a normal terminal.
- Someone (who: a developer) can: have the terminal start in the active repository's folder.
- Someone (who: a developer) can: close the terminal, which ends the shell process.

### look — What should it look like?
A terminal panel in the Develop environment — dark text area, monospaced font, like a normal terminal. Develop tab colour as accent on the panel frame.

### information — What information does this page show or collect?
- The shell's live output and the user's typed input. Nothing is stored.

### who-can-use — Who is allowed to use this page?
Anyone using the app — single-user local desktop application, no login.

---

## Part 3 — Building Details *(Developers answer)*

### data-stored — What information needs to be stored, and what does each bit look like?
Nothing — per the solution's security rules, terminal output is never logged or persisted by the application.

### in-memory — Does anything need to be remembered while the page is open (not saved permanently)?
The running shell process and its scrollback buffer.

### tests — How will we know it works? What should we test?
- Opening the terminal starts a real shell process (portable-pty) and shows its prompt.
- Running a command (e.g. printing the working directory) shows the correct output, and the working directory is the active repository.
- Resizing the panel resizes the shell (no wrapped/garbled output).
- Closing the panel ends the shell process (no orphaned processes).

### limits — Any known limits or things to watch out for?
Windows ConPTY quirks (resize, UTF-8, killing the process tree) — spike this first. The shell runs with the same permissions as the OS user, local only, per the solution's security rules.

### model-and-effort — Which AI model and effort level should this page use by default?
Most capable model, high effort.

---

## Part 4 — changes-over-time

> Each time you come back to improve the page, add a bullet describing what you want to change. Keep changes small.
> - Round 2: …
