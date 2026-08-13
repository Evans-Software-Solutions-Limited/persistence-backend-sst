import { useEffect } from "react";
import { Navigate, Routes, Route, useLocation } from "react-router";
import Home from "./pages/Home";
import Pricing from "./pages/Pricing";
import Support from "./pages/Support";
import Login from "./pages/Login";
import AuthCallback from "./pages/AuthCallback";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import DeleteAccount from "./pages/DeleteAccount";
import OrganisationAdmin from "./pages/OrganisationAdmin";
import { ThemeProvider } from "./components/theme-provider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  initMetaPixel,
  teardownMetaPixel,
  trackPageView,
} from "./lib/metaPixel";
import { getConsent, subscribe } from "./lib/consent";

const queryClient = new QueryClient();

/**
 * Bridges consent → the Meta Pixel across every route (spec-30 R3.5). On mount
 * it loads the pixel only if the visitor has ALREADY granted consent (a
 * returning visitor); it then reacts to live changes — loading on grant, tearing
 * down (clearing `_fbp`/`_fbc`) on withdrawal. First-time consent is captured by
 * `ConsentBanner` (marketing pages). `initMetaPixel` self-guards on consent, so
 * this can never load the pixel without it. Renders nothing.
 */
function MetaConsentEffect() {
  useEffect(() => {
    if (getConsent() === "granted") initMetaPixel();
    return subscribe((state) => {
      if (state === "granted") initMetaPixel();
      else if (state === "denied") teardownMetaPixel();
    });
  }, []);
  return null;
}

/**
 * Fires the Meta Pixel `PageView` on every client-side route change (the
 * pixel's own script load already covers the first paint). Presentation-
 * neutral — renders nothing. No-ops when the pixel isn't loaded (spec-30 WS3).
 */
function PageViewTracker() {
  const location = useLocation();
  useEffect(() => {
    trackPageView();
  }, [location.pathname]);
  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark">
        <MetaConsentEffect />
        <PageViewTracker />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/support" element={<Support />} />
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/delete-account" element={<DeleteAccount />} />
          {/*
           * Campaign landing routes (spec-30 R3.4): render the same Home
           * hero as "/" for now — Home's store CTAs are not yet
           * campaign-aware (the store isn't live, see marketing/config.ts),
           * so these routes just give printed/QR assets a distinct path for
           * store-console install attribution today. Wiring the CTA
           * decoration through is a follow-up once appStore.available flips.
           */}
          <Route path="/uon" element={<Home />} />
          <Route path="/flyer" element={<Home />} />
          <Route path="/qr/:slug" element={<Home />} />
          <Route
            path="/org-admin"
            element={
              import.meta.env.DEV ? (
                <OrganisationAdmin />
              ) : (
                <Navigate to="/pricing" replace />
              )
            }
          />
        </Routes>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
