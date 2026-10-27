import { useCallback, useEffect, useRef, useState } from "react";

/** How far one arrow-key press moves a divider, in pixels. */
const STEP = 24;

/** A divider somebody can drag, and reach with a keyboard.
 *
 *  **The panes were fixed at what somebody guessed once.** The lane 17.5rem,
 *  the tree 13.5rem, the code whatever was left — which is fine on the screen
 *  those numbers were chosen on and wrong on every other. Reading code is the
 *  reason this view exists, so the room it gets should be the reader's to
 *  decide.
 *
 *  **Pointer events rather than mouse events**, so a trackpad, a pen and a
 *  touchscreen all work, and `setPointerCapture` keeps the drag alive when the
 *  pointer leaves the two-pixel divider — which it does immediately, because a
 *  two-pixel target is not something anybody tracks precisely.
 *
 *  **Arrow keys move it too.** A divider that only answers to a drag is a
 *  divider somebody who cannot drag cannot move, and `role="separator"` with a
 *  value is what says so to a screen reader. */
export default function Splitter({
  label,
  value,
  min,
  max,
  orientation = "vertical",
  onChange,
}: {
  /** What this divider sizes, in words: "the file tree", "the code". */
  label: string;
  /** The current size of the pane before it, in pixels. */
  value: number;
  min: number;
  max: number;
  /** `vertical` divides left from right and is dragged sideways; `horizontal`
   *  divides top from bottom and is dragged up and down. */
  orientation?: "vertical" | "horizontal";
  onChange: (next: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  /// Where the pointer was and how big the pane was when the drag began, so the
  /// new size is the old one plus how far the pointer moved — rather than the
  /// pointer's position, which would jump the pane to the cursor on grab.
  const from = useRef({ at: 0, was: 0 });

  const clamp = useCallback(
    (next: number) => Math.min(max, Math.max(min, Math.round(next))),
    [min, max],
  );

  // On the window, not the divider: a pointer that leaves the element mid-drag
  // must keep moving it, and `setPointerCapture` is not available in every
  // environment this runs in (jsdom among them).
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const moved =
        orientation === "vertical" ? e.clientX - from.current.at : e.clientY - from.current.at;
      onChange(clamp(from.current.was + moved));
    };
    const stop = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging, orientation, onChange, clamp]);

  return (
    <div
      role="separator"
      aria-label={`Resize ${label}`}
      aria-orientation={orientation}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={`splitter ${orientation} ${dragging ? "dragging" : ""}`}
      onPointerDown={(e) => {
        from.current = {
          at: orientation === "vertical" ? e.clientX : e.clientY,
          was: value,
        };
        setDragging(true);
      }}
      onKeyDown={(e) => {
        const back = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
        const on = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
        if (e.key === back) onChange(clamp(value - STEP));
        else if (e.key === on) onChange(clamp(value + STEP));
        else return;
        e.preventDefault();
      }}
    />
  );
}
