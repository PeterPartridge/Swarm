## What I built

A console app that prints a banner, asks for a name, and greets the person or
reports why it would not.

Typed `Dave` -> `Hello, World!` / `Please enter your name` / `Hi Dave`, exit 0.
Nothing typed -> `No name entered` on stderr, no greeting, exit 1.
`Dave!123` -> `Invalid name` on stderr, no greeting, exit 1.

Four files carry it:

- `Program.cs` — the entry point, and nothing else. It hands `Console.In`,
  `Console.Out` and `Console.Error` to the app and returns its exit code.
- `ConsoleApp.cs` — the conversation: prompt, read one line, greet or report.
  The streams are passed in rather than reached for, so the code the tests drive
  is the same code that runs in the terminal.
- `NameGreeter.cs` — the validation, and the only place the wording lives.
- `NameGreeting.cs` — the result: valid-or-not plus the line to show.

Decisions worth knowing about, since the brief did not name them:

- Validation is an allow-list — letters, spaces, hyphens, apostrophes — not a
  list of banned characters (ASVS V2). That is what makes `Dave\u001b[31m`
  fail: an escape sequence the terminal would have obeyed never reaches it.
  Accented letters pass, so `Zoë` is greeted rather than rejected.
- Errors go to stderr and greetings to stdout, and the exit code is 0 or 1, so
  the app composes in a pipeline instead of only reading well to a person.
- Input is capped at 100 characters. The brief did not ask for a limit; a
  prompt that echoes an unbounded line back is a bad habit to leave in place.
- Closed stdin is treated as no name rather than a crash, so a piped or
  supervised run fails closed.

## Tests

15 tests in `tests/HelloWorld.Tests/NameInputTests.cs`, all passing. They drive
`ConsoleApp.Run` over real `StringReader`/`StringWriter` streams — what a person
types goes in, what they would see comes out. Nothing is mocked, so the tests
assert observable behaviour rather than the shape of the code.

The three the brief asked to be proved:

- `Given_the_name_Dave_it_says_Hi_Dave`
- `Given_no_name_it_reports_No_name_entered_and_greets_nobody`
- `Given_a_name_with_special_characters_it_reports_Invalid_name_and_greets_nobody`

Each asserts the actual output text and the exit code, and the two failure tests
also assert that no greeting was printed — the bug worth catching is an error
*and* a `Hi` together, which "it returned an error" alone would miss.

The rest cover whitespace-only input, closed stdin, over-length input, the
banner and prompt appearing before anything is read, and ordinary names that
must keep working: `Anne-Marie`, `Mary O'Brien`, `  Dave  ` (trimmed), `Zoë`.
The special-character cases include `<script>alert(1)</script>`, a SQL-injection
string and an ANSI escape sequence.

I ran the built app by hand across all three scenarios as well, not just the
tests. Output and exit codes above are copied from that run.

## Feedback

The work was already sitting in the worktree from attempt 4, and the attempt-5
brief is the same brief plus two additions: write this record, and actually run
the thing. So this round was verification rather than construction — I built it,
ran the suite, drove the real binary through the three scenarios, and wrote this.
Nothing needed changing. If attempts are meant to start clean, the worktree is
not being reset between them; if they are meant to accumulate, then attempt 5
was a review round and reads as one.

The developer rules are a general-purpose set applied to a console app, and most
of them have no surface here — there is no HTTP, no database, no session, no
token, no TLS, no file upload. V1 and V2 are the ones that bit, and they earned
their place: the allow-list is why an escape sequence cannot reach the terminal.
I would not read the silence on the other chapters as them having been skipped.

One rule I could not honour as written: "export the service by binding to a
port". A console app that reads a line from stdin has no port to bind. I took
the intent — no ambient state, stdin/stdout only, fast start, clean exit code —
and left the letter of it alone.

The page schema says "special characters (anything other than letters, spaces,
and hyphens/apostrophes)". I read that as the allow-list and implemented it
literally. Worth confirming digits are meant to be rejected: `Dave2` currently
fails, and some people do have numerals in a preferred name.

## Technical debt

**Build output is committed to the repository.** 24 files under `bin/` and
`obj/` are tracked from the first commit. I added a `.gitignore` for them, but
`.gitignore` does not untrack what is already in the index, so they still show
as modified on every build and every rebuild lands binary diffs in review. The
fix is one command — `git rm -r --cached bin obj` — but it rewrites what the
next commit contains, so I left it rather than fold it into a feature branch
someone is about to review. Cost to put right: a minute, plus agreeing that the
branch is the place to do it.

**No solution file.** `dotnet test` from the repository root finds nothing; the
test project has to be named by path, which is what I did. Anyone running the
obvious command gets "no projects found" and reasonably concludes there are no
tests. A `.sln` costs a minute and removes that trap.

**No CI.** Nothing runs the suite except a person remembering to. Fifteen green
tests only hold the line if something checks them.

**The wording is hard-coded in `NameGreeter`.** Fine at this size, and I would
not add a resource file for four strings today. It becomes real work the first
time a second language or a reworded prompt is asked for — noting it so that
lands as a known step rather than a surprise.

## What I could not do

Nothing in the brief was blocked.

I did not fix the tracked `bin/`/`obj/` files, for the reason given above — it
is a repository-wide change, and the brief asked me to leave the work
uncommitted for review. It is a one-line fix whenever you want it.

I did not run the app interactively at a real terminal. This session is
non-interactive, so I drove it by piping input to the built binary. That
exercises the same code path — `Console.In.ReadLine`, one line, same
validation — but it does not prove how the prompt feels when typed at by hand.
If the prompt should sit on the same line as the cursor rather than above it,
that is a change I cannot see the need for from here.

I did not use `dotnet watch run`. It is a loop that never exits, which does not
fit a non-interactive session; it is the right tool when a person is iterating.
