import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import StandaloneBuildPane from "./pages/StandaloneBuildPane";
import StandaloneConsole from "./pages/StandaloneConsole";
import StandaloneScreen from "./pages/StandaloneScreen";
import "./styles.css";

// Pulled-out OS windows load index.html?window=<screen>&productId=<id> and
// render just that screen; the main window renders the full shell.
const params = new URLSearchParams(window.location.search);
const screen = params.get("window");
const productId = params.get("productId");

// This list must agree with WORKSPACE_SCREENS and the Rust SCREENS constant —
// R2 grew both and missed this one, so a Marketing pop-out rendered the whole
// app shell inside its little window.
const STANDALONE_SCREENS = ["strategy", "planning", "roadmap", "marketing", "design", "overview"];

/** The console is pulled out per **Solution**, not per Product, so it is not in
 *  those three lists and does not have to be kept in step with them. It carries
 *  a solutionId and, when a shell is already running, the id to adopt. */
const console_ = screen === "console";

/** The Build view's two other pull-outs, scoped the same way the console is:
 *  one to a work item, one to a file in a Solution. Not in the screens list
 *  above for the same reason — they carry their own arguments. */
const buildPane = screen === "workItem" || screen === "file";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {console_ ? (
      <StandaloneConsole
        solutionId={Number(params.get("solutionId"))}
        terminalId={params.get("terminalId")}
      />
    ) : buildPane ? (
      screen === "workItem" ? (
        <StandaloneBuildPane
          pane="workItem"
          workItemId={Number(params.get("workItemId"))}
        />
      ) : (
        <StandaloneBuildPane
          pane="file"
          solutionId={Number(params.get("solutionId"))}
          path={params.get("path") ?? ""}
        />
      )
    ) : screen !== null && STANDALONE_SCREENS.includes(screen) ? (
      <StandaloneScreen
        screen={screen as Parameters<typeof StandaloneScreen>[0]["screen"]}
        productId={Number(productId)}
      />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
