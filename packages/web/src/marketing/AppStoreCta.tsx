import { AppleIcon } from "./icons";
import { appStoreUrl } from "./config";
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
 * Until `config.appStoreUrl()` returns a real URL (the store isn't live yet, so
 * this is the only state that renders today) it renders the exact disabled
 * placeholder each call-site used before — byte-identical. Once live, it renders
 * a real `<a href>` with proper "get the app" copy (NOT "coming soon"), dropping
 * the `cta-soon`/`disabled` classes, and reports the click via
 * `reportStoreClick()` (browser pixel `AppStoreClick` + server beacon, deduped
 * by a shared event id — see `lib/storeClick.ts`) without blocking navigation.
 */
export function AppStoreCta({ variant, campaign, className }: AppStoreCtaProps) {
  const href = appStoreUrl(campaign);
  const extra = className ? ` ${className}` : "";
  const live = href !== null;

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
