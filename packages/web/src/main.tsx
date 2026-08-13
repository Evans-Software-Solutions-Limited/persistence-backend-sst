import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { BrowserRouter } from "react-router";

// spec-30 R3.5: the Meta Pixel is NOT initialised here. It loads only from the
// consent layer (see App.tsx `MetaConsentEffect` + `ConsentBanner`), once the
// visitor has explicitly opted in — never on first paint.

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <StrictMode>
      <App />
    </StrictMode>
  </BrowserRouter>,
);
