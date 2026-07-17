import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getActivePermissions, type ActivePermissions } from "./backend";

export type Area = "product" | "develop" | "test" | "admin";
export type GatedField = "cost" | "profit" | "chargeable";

/** Full access — the safe default while loading and when no user is active. */
const FULL_ACCESS: ActivePermissions = {
  memberId: null,
  role: null,
  canProduct: true,
  canDevelop: true,
  canTest: true,
  canAdmin: true,
  seeCost: true,
  seeProfit: true,
  seeChargeable: true,
};

interface PermissionValue {
  perms: ActivePermissions;
  reload: () => Promise<void>;
  canAccess: (area: Area) => boolean;
  canSeeField: (field: GatedField) => boolean;
}

const PermissionContext = createContext<PermissionValue>({
  perms: FULL_ACCESS,
  reload: async () => {},
  canAccess: () => true,
  canSeeField: () => true,
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

  const canAccess = (area: Area) =>
    area === "product"
      ? perms.canProduct
      : area === "develop"
        ? perms.canDevelop
        : area === "test"
          ? perms.canTest
          : perms.canAdmin;

  const canSeeField = (field: GatedField) =>
    field === "cost"
      ? perms.seeCost
      : field === "profit"
        ? perms.seeProfit
        : perms.seeChargeable;

  return (
    <PermissionContext.Provider value={{ perms, reload, canAccess, canSeeField }}>
      {children}
    </PermissionContext.Provider>
  );
}

export const usePermissions = () => useContext(PermissionContext);
