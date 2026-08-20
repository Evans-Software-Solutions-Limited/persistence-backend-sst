import { AppleIcon } from "./icons";
import { appStoreLive, appStoreUrl } from "./config";
import { useCampaign } from "./campaign";
import { reportStoreClick } from "@/lib/storeClick";

export type AppStoreCtaVariant = "hero" | "store" | "nav";

export interface AppStoreCtaProps {
  variant: AppStoreCtaVariant;
  campaign?: string;
  className?: string;
}

/**
 * Shared "get the app" CTA (spec-30 R3.8). Centralises the three "Coming to
 * the App Store" placeholders that used to be hardcoded per call-site (Home
 * hero, Home store section, `MarketingNav`) so the outbound-click reporter is
 * wired up once.
 *
 * While `config.appStoreUrl()` returns null it renders the exact disabled
 * placeholder each call-site used before — byte-identical. The App Store went
 * live on 15 Aug 2026, so that is now the DEAD branch and the live one below is
 * what renders; it is kept because a listing can be pulled. Live, it renders
 * a real `<a href>` with proper "get the app" copy (NOT "coming soon"), dropping
 * the `cta-soon`/`disabled` classes, and reports the click via
 * `reportStoreClick()` (browser pixel `AppStoreClick` + server beacon, deduped
 * by a shared event id — see `lib/storeClick.ts`) without blocking navigation.
 */
export function AppStoreCta({ variant, campaign, className }: AppStoreCtaProps) {
  // An explicit prop wins; otherwise inherit the landing route's campaign, so
  // a CTA on /uon attributes without every call-site having to know the route.
  const routeCampaign = useCampaign();
  const href = appStoreUrl(campaign ?? routeCampaign);
  const extra = className ? ` ${className}` : "";
  // BOTH flags, not just the URL. This read `href !== null` alone, which meant
  // setting `appStore.available = false` — the documented way to pull the
  // listing — changed the prose on Home, /support and /login to "Coming to
  // iPhone" while leaving every CTA on those same pages a live `<a href>`
  // reading "Get it on the App Store". `AppBanner` has always checked both;
  // this was the outlier.
  const live = appStoreLive() && href !== null;

  if (variant === "hero") {
    const content = (
      <>
        <AppleIcon />
        {live ? "Get it on the App Store" : "Coming to the App Store"}
      </>
    );
    return live ? (
      <a
        href={href!}
        className={`btn btn-fill${extra}`}
        onClick={() => reportStoreClick()}
      >
        {content}
      </a>
    ) : (
      <span className={`btn btn-fill cta-soon${extra}`} aria-disabled="true">
        {content}
      </span>
    );
  }

  if (variant === "store") {
    const content = (
      <>
        <AppleIcon />
        <div className="store-btn-text">
          <span className="small">{live ? "Download on the" : "Coming soon to"}</span>
          <span className="big">App Store</span>
        </div>
      </>
    );
    return live ? (
      <a
        href={href!}
        className={`store-btn${extra}`}
        onClick={() => reportStoreClick()}
      >
        {content}
      </a>
    ) : (
      <span className={`store-btn disabled${extra}`} aria-disabled="true">
        {content}
      </span>
    );
  }

  // nav
  return live ? (
    <a
      href={href!}
      className={`nav-btn${extra}`}
      onClick={() => reportStoreClick()}
    >
      Get the app
    </a>
  ) : (
    <span className={`nav-btn disabled${extra}`} aria-disabled="true">
      Coming to App Store
    </span>
  );
}
