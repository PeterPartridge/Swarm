import type { Hive } from "./types";
import product from "./product/hive";
import develop from "./develop/hive";
import test from "./test/hive";

/** Every Hive, in the order the rail shows them.
 *
 *  The one list the shell reads: the rail, the screen it draws, the palette's
 *  way in and the colour settings all come from here, so a new Hive is a
 *  folder and a line below rather than an edit in four places. */
export const HIVES: readonly Hive[] = [product, develop, test];

export type { Hive, HiveProps, HiveView, RequestedView } from "./types";
