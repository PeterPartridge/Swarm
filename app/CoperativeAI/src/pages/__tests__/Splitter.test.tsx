import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import Splitter from "../../components/common/Splitter";

function Harness({ start = 200, min = 100, max = 400 }: { start?: number; min?: number; max?: number }) {
  const [width, setWidth] = useState(start);
  return (
    <>
      <div style={{ width }}>the pane</div>
      <Splitter label="the file tree" value={width} min={min} max={max} onChange={setWidth} />
      <span>width: {width}</span>
    </>
  );
}

/** Dispatches a pointer event that actually carries coordinates.
 *
 *  **jsdom has no `PointerEvent`**, so `fireEvent.pointerMove(el, { clientX })`
 *  builds a plain Event and the coordinate is dropped — the handler sees
 *  `undefined` and the pane moves by NaN. A `MouseEvent` of the same type is a
 *  real event with real coordinates, and every listener here is registered by
 *  type rather than by interface. */
function pointer(target: Window | Element, type: string, at: { clientX?: number; clientY?: number }) {
  fireEvent(target, new MouseEvent(type, { bubbles: true, ...at }));
}

describe("a draggable divider", () => {
  /// **The panes were whatever somebody guessed once** — the lane 17.5rem, the
  /// tree 13.5rem — which is fine on the screen those numbers were chosen on.
  /// Reading code is the reason the view exists, so the room it gets is the
  /// reader's to decide.
  it("resizes the pane by how far the pointer moved", () => {
    render(<Harness />);
    const bar = screen.getByRole("separator", { name: "Resize the file tree" });

    pointer(bar, "pointerdown", { clientX: 500 });
    pointer(window, "pointermove", { clientX: 560 });
    expect(screen.getByText("width: 260")).toBeInTheDocument();

    // Still dragging: a second move is measured from where the drag began, not
    // from the last one, so a pane cannot creep.
    pointer(window, "pointermove", { clientX: 520 });
    expect(screen.getByText("width: 220")).toBeInTheDocument();

    pointer(window, "pointerup", {});
    pointer(window, "pointermove", { clientX: 900 });
    expect(screen.getByText("width: 220")).toBeInTheDocument();
  });

  /// A pane dragged past nothing is a pane nobody can get back, and one dragged
  /// over the whole window hides everything else.
  it("stops at its limits", () => {
    render(<Harness start={200} min={100} max={300} />);
    const bar = screen.getByRole("separator", { name: "Resize the file tree" });

    pointer(bar, "pointerdown", { clientX: 0 });
    pointer(window, "pointermove", { clientX: -900 });
    expect(screen.getByText("width: 100")).toBeInTheDocument();
    pointer(window, "pointermove", { clientX: 900 });
    expect(screen.getByText("width: 300")).toBeInTheDocument();
  });

  /// **A divider that only answers to a drag cannot be moved by somebody who
  /// cannot drag.** Arrow keys move it, and the separator carries the value it
  /// is at so a screen reader can say where it is.
  it("moves with the arrow keys, and says where it is", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const bar = screen.getByRole("separator", { name: "Resize the file tree" });
    expect(bar).toHaveAttribute("aria-valuenow", "200");

    bar.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("width: 224")).toBeInTheDocument();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByText("width: 176")).toBeInTheDocument();
  });

  /// The other axis is the same gesture turned ninety degrees, and says so.
  it("drags up and down when it divides top from bottom", () => {
    function Vertical() {
      const [height, setHeight] = useState(300);
      return (
        <>
          <Splitter
            label="the code"
            orientation="horizontal"
            value={height}
            min={100}
            max={800}
            onChange={setHeight}
          />
          <span>height: {height}</span>
        </>
      );
    }
    render(<Vertical />);
    const bar = screen.getByRole("separator", { name: "Resize the code" });
    expect(bar).toHaveAttribute("aria-orientation", "horizontal");

    pointer(bar, "pointerdown", { clientY: 400 });
    pointer(window, "pointermove", { clientY: 500 });
    expect(screen.getByText("height: 400")).toBeInTheDocument();
  });
});
