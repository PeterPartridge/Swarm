import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getActivePermissions, type ActivePermissions } from "./backend";

/** The places gated by a flag of their own. The Hives are gated by their
 *  grants instead — see `canAccessHive`. */
export type Area = "admin" | "marketing" | "design";
export type GatedField = "cost" | "profit" | "chargeable";

/** Full access — the safe default while loading and when no user is active. */
const FULL_ACCESS: ActivePermissions = {
  memberId: null,
  role: null,
  hives: [],
  allHives: true,
  canAdmin: true,
  seeCost: true,
  seeProfit: true,
  seeChargeable: true,
  canManageBudget: true,
  canMarketing: true,
  canDesign: true,
};

interface PermissionValue {
  perms: ActivePermissions;
  reload: () => Promise<void>;
  canAccess: (area: Area) => boolean;
  /** May open this Hive: granted it, or sees them all. */
  canAccessHive: (hiveId: string) => boolean;
  canSeeField: (field: GatedField) => boolean;
  /** May change AI budgets, thresholds, and the provider chain. Deliberately
   *  separate from seeing spend — reading what was spent and deciding what may
   *  be spent are different powers. */
  canManageBudget: () => boolean;
}

const PermissionContext = createContext<PermissionValue>({
  perms: FULL_ACCESS,
  reload: async () => {},
  canAccess: () => true,
  canAccessHive: () => true,
  canSeeField: () => true,
  canManageBudget: () => true,
});

export function PermissionProvider({ children }: { children: ReactNode }) {
  const [perms, setPerms] = useState<ActivePermissions>(FULL_ACCESS);

  const reload = useCallback(async () => {
    try {
      setPerms(await getActivePermissions());
    } catch {
      // Outside Tauri (browser preview / tests without a mock) → full access.
      setPerms(FULL_ACCESS);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const canAccess = (area: Area) => {
    switch (area) {
      case "marketing":
        return perms.canMarketing;
      case "design":
        return perms.canDesign;
      default:
        return perms.canAdmin;
    }
  };

  const canAccessHive = (hiveId: string) => perms.allHives || perms.hives.includes(hiveId);

  const canSeeField = (field: GatedField) =>
    field === "cost"
      ? perms.seeCost
      : field === "profit"
        ? perms.seeProfit
        : perms.seeChargeable;

  const canManageBudget = () => perms.canManageBudget;

  return (
    <PermissionContext.Provider
      value={{ perms, reload, canAccess, canAccessHive, canSeeField, canManageBudget }}
    >
      {children}
    </PermissionContext.Provider>
  );
}

export const usePermissions = () => useContext(PermissionContext);
