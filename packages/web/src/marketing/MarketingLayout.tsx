import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import "./fonts";
import "./marketing.css";
import { MarketingNav } from "./MarketingNav";
import { MarketingFooter } from "./MarketingFooter";
import { ConsentBanner } from "./ConsentBanner";
import { AppBanner } from "./AppBanner";
import { CampaignContext, campaignFromPath } from "./campaign";
import {
  normalizeReferralCode,
  storedReferralCode,
  storeReferralCode,
} from "./referral";

/**
 * Shell for every marketing page: scoped `.mkt` root (so its warm editorial
 * theme never leaks onto /privacy, /terms or /login), fixed background glow +
 * film-grain layers, fixed nav and shared footer. Also resolves `#hash`
 * targets after client-side navigation (react-router doesn't scroll to hashes
 * on its own).
 */
export function MarketingLayout({
  children,
  current,
}: {
  children: ReactNode;
  current?: "pricing";
}) {
  const { pathname, hash, search } = useLocation();
  const queryReferralCode = normalizeReferralCode(
    new URLSearchParams(search).get("ref"),
  );
  const referralCode = queryReferralCode ?? storedReferralCode();
  const referralSource = queryReferralCode ? search : `stored:${referralCode}`;
  const [dismissedReferralSource, setDismissedReferralSource] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (queryReferralCode) storeReferralCode(queryReferralCode);
  }, [queryReferralCode]);

  useEffect(() => {
    // Guard against a bare "#" or any non-selector hash before querySelector.
    if (hash.length > 1) {
      const el = document.querySelector(hash);
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);

  return (
    // Renders no DOM of its own — every store CTA beneath this point (Home's
    // hero + store buttons, MarketingNav, AppBanner) inherits the campaign.
    <CampaignContext.Provider value={campaignFromPath(pathname)}>
      <div className="mkt">
        <div className="mkt-bg" aria-hidden="true" />
        <AppBanner />
        <MarketingNav current={current} />
        {referralCode && dismissedReferralSource !== referralSource && (
          <div className="referral-banner" role="status">
            <span>
              Referral code <strong>{referralCode}</strong> noted — enter it in
              the app after you sign up.
            </span>
            <button
              type="button"
              aria-label="Dismiss referral code notice"
              onClick={() => setDismissedReferralSource(referralSource)}
            >
              ×
            </button>
          </div>
        )}
        <main>{children}</main>
        <MarketingFooter />
        <ConsentBanner />
      </div>
    </CampaignContext.Provider>
  );
}
