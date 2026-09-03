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
import {
  AdminAudit,
  AdminCallback,
  AdminCodes,
  AdminDashboard,
  AdminGrants,
  AdminLayout,
  AdminLogin,
  AdminLookup,
  RequireAdmin,
} from "./admin";
import { CAMPAIGN_LANDING_SLUGS } from "./marketing/campaign";
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
           * GENERATED from CAMPAIGNS rather than listed by hand, so adding a
           * printed or social channel is one entry in `CAMPAIGNS` and nothing
           * else. These were hand-listed until 20 Aug 2026, and the drift that
           * invites had already happened twice: `banner` was a CAMPAIGNS entry
           * with no route for as long as the print assets had existed, and every
           * social slug was missing until 17 Aug.
           *
           * A hand-written list used to be guarded by a test asserting the page
           * was not blank at each slug. The catch-all below silently made that
           * test unfalsifiable — and because `campaignFromPath` reads the
           * pathname rather than the matched route, a missing route no longer
           * costs attribution either, so NOTHING would have failed. Generating
           * the routes removes the failure mode instead of re-testing for it.
           *
           * `/qr/:slug` stays separate: it is one parameterised route for every
           * unrecognised QR, not one route per campaign.
           *
           * ⚠ Be aware this block is BEHAVIOURALLY INERT as things stand, and no
           * test can prove otherwise: every route here renders `<Home />`, the
           * catch-all below renders `<Home />` for any path, and attribution
           * comes from the pathname. Deleting the whole block leaves the full
           * suite green and the site identical. It is kept as the explicit
           * contract — and so that removing the catch-all one day does not
           * silently take the campaign landing pages with it — NOT because
           * anything currently depends on it.
           */}
          {CAMPAIGN_LANDING_SLUGS.map((slug) => (
            <Route key={slug} path={`/${slug}`} element={<Home />} />
          ))}
          <Route path="/qr/:slug" element={<Home />} />
          {/*
           * Internal admin (FOUNDING-OFFER). Server-enforced: every /admin API
           * call needs the JWT `app_metadata.admin` claim; the RequireAdmin
           * guard is UX only. Not linked from anywhere, noindex.
           */}
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin/callback" element={<AdminCallback />} />
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <AdminLayout />
              </RequireAdmin>
            }
          >
            <Route index element={<AdminDashboard />} />
            <Route path="grants" element={<AdminGrants />} />
            <Route path="codes" element={<AdminCodes />} />
            <Route path="lookup" element={<AdminLookup />} />
            <Route path="audit" element={<AdminAudit />} />
          </Route>
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
           * ⚠ This WEAKENS the old route-existence check, so read that test
           * before trusting it. `campaignWiring.test.tsx` used to prove a
           * CAMPAIGNS entry had a `<Route>` by rendering `<App />` at `/<slug>`
           * and asserting the page was not blank — which this catch-all now
           * satisfies whether the explicit route exists or not. That test has
           * been changed to assert the rendered CTAs are DECORATED with the
           * slug's `ct` instead, which is the property actually worth having and
           * which a bare catch-all does not provide for free.
           *
           * (Attribution itself survives a fallthrough: `MarketingLayout`
           * resolves the campaign from `useLocation().pathname`, not from the
           * matched route, so it does not depend on these routes existing. They
           * are kept explicit because that is the documented contract, and
           * because relying on the catch-all would make the coupling invisible.)
           */}
          <Route path="*" element={<Home />} />
        </Routes>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
