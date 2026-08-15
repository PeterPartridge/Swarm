import WorkspaceShell from "./pages/WorkspaceShell";
import SaveBar from "./components/SaveBar";
import { PermissionProvider } from "./lib/permissions";

export default function App() {
  return (
    <PermissionProvider>
      <WorkspaceShell />
      {/* At the root, so it is the same bar on every screen rather than one
          per page that each say something slightly different. */}
      <SaveBar />
    </PermissionProvider>
  );
}
