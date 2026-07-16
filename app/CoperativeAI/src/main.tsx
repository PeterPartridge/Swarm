import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import StandaloneScreen from "./pages/StandaloneScreen";
import "./styles.css";

// Pulled-out OS windows load index.html?window=<screen>&productId=<id> and
// render just that screen; the main window renders the full shell.
const params = new URLSearchParams(window.location.search);
const screen = params.get("window");
const productId = params.get("productId");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {screen === "planning" || screen === "roadmap" ? (
      <StandaloneScreen screen={screen} productId={Number(productId)} />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
