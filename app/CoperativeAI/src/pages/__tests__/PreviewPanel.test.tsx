import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PreviewPanel, {
  formatBody,
  parseHeaders,
} from "../../components/code/PreviewPanel";
// Moved to lib/ when Debug started labelling ports with the same guess.
import { guessDevPort, guessDevUrl } from "../../lib/devServer";

vi.mock("../../lib/backend", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/backend")>();
  return { ...original };
});

describe("guessDevUrl", () => {
  /// Each framework's own default, so the common cases open first time.
  it("reads the framework out of the run command", () => {
    expect(guessDevUrl("next dev")).toBe("http://localhost:3000");
    expect(guessDevUrl("npm run dev")).toBe("http://localhost:5173");
    expect(guessDevUrl("ng serve")).toBe("http://localhost:4200");
    expect(guessDevUrl("uvicorn app:main --reload")).toBe("http://localhost:8000");
    expect(guessDevUrl("cargo run")).toBe("http://localhost:8080");
  });

  /// A Next project's `npm run dev` is not Vite. Next is checked first, so the
  /// more specific signal wins over the generic script name.
  it("prefers the framework over the generic script name", () => {
    expect(guessDevUrl("npm run dev -- --turbo # next")).toBe("http://localhost:3000");
  });

  /// An unknown toolchain still gets an address to correct rather than a blank
  /// box, which would leave nothing to react to.
  it("falls back to a plausible port for a command it does not know", () => {
    expect(guessDevUrl("./run-my-thing.sh")).toBe("http://localhost:3000");
    expect(guessDevUrl("")).toBe("http://localhost:3000");
  });

  /// Debug labels a process with just the port, from the same table — the whole
  /// reason this moved out of the preview.
  it("gives Debug the port on its own, from the same guess", () => {
    expect(guessDevPort("npm run dev")).toBe(":5173");
    expect(guessDevPort("cargo run")).toBe(":8080");
  });
});

describe("parseHeaders", () => {
  /// Headers are pasted from docs or a curl line, so one box that takes lines is
  /// what people actually have to hand.
  it("takes name and value from each line", () => {
    expect(parseHeaders("Content-Type: application/json\nAccept: */*")).toEqual([
      { name: "Content-Type", value: "application/json" },
      { name: "Accept", value: "*/*" },
    ]);
  });

  /// A bearer token contains no colon but the scheme line does — splitting on
  /// the *first* colon keeps the value whole.
  it("keeps a value that itself contains a colon", () => {
    expect(parseHeaders("Authorization: Bearer abc:def")).toEqual([
      { name: "Authorization", value: "Bearer abc:def" },
    ]);
  });

  /// Blank lines and half-typed ones are ignored rather than sent as empty
  /// headers, which some servers reject outright.
  it("ignores blank and colonless lines", () => {
    expect(parseHeaders("\n  \nAccept: text/plain\nnonsense\n: novalue")).toEqual([
      { name: "Accept", value: "text/plain" },
    ]);
  });
});

describe("formatBody", () => {
  it("pretty-prints JSON so a response is readable", () => {
    expect(formatBody('{"a":1}', "application/json")).toBe('{\n  "a": 1\n}');
  });

  /// Reformatting non-JSON would corrupt it. An HTML error page is most useful
  /// exactly as it arrived.
  it("leaves anything that is not JSON alone", () => {
    const html = "<html><body>500</body></html>";
    expect(formatBody(html, "text/html")).toBe(html);
  });

  /// Malformed JSON is itself the finding — showing it raw is more use than an
  /// error about the formatter.
  it("shows malformed JSON as it arrived", () => {
    expect(formatBody('{"a":', "application/json")).toBe('{"a":');
  });
});

describe("PreviewPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  /// The port is inferred, never known — the run command is detected from what
  /// is in the folder, not from a config that states a port. Saying so keeps
  /// somebody from debugging their server when the guess was simply wrong.
  it("says the address was guessed", async () => {
    render(<PreviewPanel solutionId={1} runCommand="npm run dev" label="Shop API" />);
    expect(await screen.findByText(/Guessed from the run command/)).toBeInTheDocument();
    expect(await screen.findByLabelText("Preview address")).toHaveValue(
      "http://localhost:5173",
    );
  });

  /// Correcting it is remembered, because the guess is wrong often enough that
  /// retyping it every time would be the panel's most-used feature.
  it("remembers a corrected address for that Solution", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <PreviewPanel solutionId={7} runCommand="npm run dev" label="Shop API" />,
    );
    const field = await screen.findByLabelText("Preview address");
    await user.clear(field);
    await user.type(field, "http://localhost:4000");
    unmount();

    render(<PreviewPanel solutionId={7} runCommand="npm run dev" label="Shop API" />);
    expect(await screen.findByLabelText("Preview address")).toHaveValue(
      "http://localhost:4000",
    );
    // No longer a guess, so it stops calling itself one.
    expect(screen.queryByText(/Guessed from the run command/)).not.toBeInTheDocument();
  });

  /// The other half of the request: a Solution with no page to look at is only
  /// observable by calling it.
  it("calls the API and shows the status, timing and body", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('{"ok":true}', {
          status: 201,
          statusText: "Created",
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    render(<PreviewPanel solutionId={2} runCommand="cargo run" label="Shop API" />);
    await user.click(screen.getByRole("tab", { name: "API" }));
    await user.type(await screen.findByLabelText("Request path"), "api/health");
    await user.click(screen.getByLabelText("Send the request"));

    expect(await screen.findByRole("status")).toHaveTextContent(/201 Created/);
    // Pretty-printed, so a nested response is readable rather than one long line.
    expect(await screen.findByLabelText("Response body")).toHaveTextContent('"ok": true');
    // The path is joined to the base with exactly one slash.
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/health",
      expect.objectContaining({ method: "GET" }),
    );
  });

  /// Nothing listening is a different problem from a 500, so it is said
  /// differently — and points at the run's terminal, which is where the app is
  /// started from.
  it("distinguishes an unreachable server from an error response", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    render(<PreviewPanel solutionId={3} runCommand="cargo run" label="Shop API" />);
    await user.click(screen.getByRole("tab", { name: "API" }));
    await user.click(screen.getByLabelText("Send the request"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Could not reach/);
    expect(alert).toHaveTextContent(/start it from the run's terminal/);
  });

  /// fetch itself rejects a GET with a body, so the field is not offered — a
  /// control that cannot work should not be there to fill in.
  it("offers a body only for methods that can carry one", async () => {
    const user = userEvent.setup();
    render(<PreviewPanel solutionId={4} runCommand="cargo run" label="Shop API" />);
    await user.click(screen.getByRole("tab", { name: "API" }));

    expect(screen.queryByLabelText("Request body")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Request method"), "POST");
    expect(await screen.findByLabelText("Request body")).toBeInTheDocument();
  });

  /// The app half: a front end is watched in place rather than in another window.
  it("frames the running app at the address given", async () => {
    render(<PreviewPanel solutionId={5} runCommand="next dev" label="Shop web" />);
    const frame = await screen.findByTitle("Running app for Shop web");
    expect(frame).toHaveAttribute("src", "http://localhost:3000");
  });
});
