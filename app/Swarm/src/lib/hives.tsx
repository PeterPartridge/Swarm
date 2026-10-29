import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { HIVES, type Hive } from "@hives/registry";

/** Every Hive this Swarm can show, read at run time.
 *
 *  **The three built in, then any installed from outside.** `HIVES` is a
 *  module constant and stays the list of what this Swarm contains; this is the
 *  list the rail, the palette, the screen and Admin draw from, because a Hive
 *  installed from a URL is not known until the app is running.
 *
 *  The default — no provider — is the built-ins alone, so a screen rendered
 *  without one behaves exactly as it did before Hives could be installed. */
export interface HivesValue {
  hives: readonly Hive[];
  /** Read the installed list again, after an install or a removal. */
  reload: () => Promise<void>;
}

export const HivesContext = createContext<HivesValue>({ hives: HIVES, reload: async () => {} });

export const useHives = () => useContext(HivesContext);

/** Provides the run-time list. `load` returns the Hives from outside to add
 *  after the built-ins; until it answers, and if it fails, the list is the
 *  built-ins alone. */
export function HivesProvider({
  load,
  children,
}: {
  load: () => Promise<Hive[]>;
  children: ReactNode;
}) {
  const [hives, setHives] = useState<readonly Hive[]>(HIVES);

  const reload = useCallback(async () => {
    try {
      const outside = await load();
      setHives([...HIVES, ...outside.filter((h) => !HIVES.some((b) => b.id === h.id))]);
    } catch {
      setHives(HIVES);
    }
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return <HivesContext.Provider value={{ hives, reload }}>{children}</HivesContext.Provider>;
}
