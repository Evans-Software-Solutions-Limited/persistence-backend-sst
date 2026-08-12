import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { BrowserRouter } from "react-router";
import { initMetaPixel } from "./lib/metaPixel";

// spec-30 WS3: no-ops when VITE_META_PIXEL_ID is unset (dev/PR previews).
initMetaPixel();

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <StrictMode>
      <App />
    </StrictMode>
  </BrowserRouter>,
);
