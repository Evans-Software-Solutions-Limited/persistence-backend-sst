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
import { hasConsent, subscribe } from "./lib/consent";

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
    if (hasConsent("advertising")) initMetaPixel();
    return subscribe((choices) => {
      if (choices.advertising) initMetaPixel();
      else teardownMetaPixel();
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
           * Campaign landing routes (spec-30 R3.4): all render Home, and each
           * decorates every store CTA on the page with its own `ct` — see
           * marketing/campaign.ts, which maps the pathname to a CAMPAIGNS
           * entry, and MarketingLayout, which provides it.
           *
           * Adding a channel is two lines that must land together: an entry in
           * CAMPAIGNS and a Route here. A CAMPAIGNS entry on its own attributes
           * nothing — that was the state of this file until 17 Aug 2026, when
           * appStoreUrl() was fully tested and simply never called with a slug.
           *
           * These are also where the `/g/:slug` edge redirect sends every
           * non-iOS scan (marketing/edgeRedirect.ts, wired in infra/web.ts), so
           * a slug reachable as /g/<slug> with no Route here is a blank page on
           * a printed QR. `campaignWiring.test.tsx` asserts the two lists match.
           */}
          <Route path="/uon" element={<Home />} />
          <Route path="/flyer" element={<Home />} />
          {/*
           * `banner` has been a CAMPAIGNS entry since the print assets were
           * specced, but had no Route until 17 Aug 2026 — a scan of the printed
           * banner would have attributed nothing and rendered nothing.
           */}
          <Route path="/banner" element={<Home />} />
          <Route path="/social" element={<Home />} />
          <Route path="/tt" element={<Home />} />
          <Route path="/ig" element={<Home />} />
          <Route path="/li" element={<Home />} />
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
          {/*
           * Catch-all — keep this last.
           *
           * The server hands back `index.html` for every path, which reads like
           * a catch-all SPA shell but is not one: a path with no Route above
           * matched nothing and React Router rendered nothing. The result was a
           * blank dark page served with HTTP 200 and the correct <title>, so it
           * looked like the site was broken rather than the URL being wrong.
           * Verified on production 19 Aug 2026 against an unlisted path.
           *
           * Home is the right fallback rather than a 404 page: this is a
           * single-page marketing site with no deep content to be "not found",
           * and `campaignFromPath()` returns undefined for an unknown first
           * segment, so a mistyped or retired URL renders the ordinary,
           * undecorated homepage and attributes nothing to a campaign that did
           * not drive it.
           *
           * This is a safety net, not a substitute for the explicit campaign
           * routes above — those exist so each slug decorates its CTAs with its
           * own `ct`, and `campaignWiring.test.tsx` still asserts every CAMPAIGNS
           * entry has one.
           */}
          <Route path="*" element={<Home />} />
        </Routes>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
