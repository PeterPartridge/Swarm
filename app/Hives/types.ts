import type { ComponentType, ReactNode } from "react";

/** A place inside a Hive the shell was asked to open, stamped with when it was
 *  asked so asking for the same place twice still moves. */
export interface RequestedView {
  id: string;
  at: number;
}

/** What the shell hands every Hive's screen. */
export interface HiveProps {
  requestedView: RequestedView | null;
}

/** One entry the ⌘K palette offers into a Hive. Each must be a view the
 *  screen really opens — a palette entry that lands nowhere is the one thing a
 *  palette must never have. */
export interface HiveView {
  id: string;
  label: string;
  glyph: string;
}

/** A work area: everything the shell needs to put it on the rail, colour it,
 *  gate it and draw it. Adding a Hive is a folder holding one of these, and a
 *  line in `registry.ts`. */
export interface Hive {
  /** What its colour, its permission and the palette's way in are keyed by. */
  id: string;
  label: string;
  /** The children of a 20×20 SVG, drawn in `currentColor`. */
  icon: ReactNode;
  /** Its colour until the person picks another. */
  color: string;
  Screen: ComponentType<HiveProps>;
  views?: HiveView[];
}
