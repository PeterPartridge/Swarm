import WorkspaceShell from "./pages/WorkspaceShell";
import { PermissionProvider } from "./lib/permissions";

export default function App() {
  return (
    <PermissionProvider>
      <WorkspaceShell />
    </PermissionProvider>
  );
}
