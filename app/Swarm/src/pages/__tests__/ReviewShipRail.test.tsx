import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import ReviewShipRail from "../../components/ai/ReviewShipRail";
import { clearFailure, reportFailure } from "../../lib/failures";

function rail() {
  return (
    <ReviewShipRail
      agentLabel="Add checkout"
      run={null}
      solution={null}
      review={null}
      reviewing={false}
      onReview={vi.fn()}
      onSettle={vi.fn()}
      settled={null}
      tests={null}
      selectedPath={null}
      selectedChange={null}
    />
  );
}

describe("the failure box on the rail", () => {
  beforeEach(() => clearFailure());

  /// **Execute failed and nothing appeared.** The message was said by the panel
  /// that ran it, at the top of a section long enough to have scrolled it away,
  /// four components from the one place on this screen that is always visible.
  it("shows what failed, in the words the backend used", () => {
    render(rail());
    act(() =>
      reportFailure(
        "Execute",
        "'Shop API' is not a git repository, so there is no branch to cut a checkout from.",
      ),
    );

    const box = screen.getByRole("alert");
    expect(box).toHaveTextContent("Execute");
    expect(box).toHaveTextContent(/not a git repository/);
  });

  /// A failure that arrived while you were looking at another agent is still
  /// the last thing that went wrong when you come back.
  it("shows one that happened before it was on screen", () => {
    reportFailure("Execute", "the plan has not been approved yet");
    render(rail());
    expect(screen.getByRole("alert")).toHaveTextContent(/not been approved/);
  });

  /// Read and understood is a decision a person makes. Nothing clears it on
  /// their behalf — not a reload, not a later success somewhere else.
  it("stays until it is dismissed", async () => {
    const user = userEvent.setup();
    render(rail());
    act(() => reportFailure("Execute", "something broke"));

    await user.click(screen.getByRole("button", { name: "Dismiss this failure" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says nothing when nothing has failed", () => {
    render(rail());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
