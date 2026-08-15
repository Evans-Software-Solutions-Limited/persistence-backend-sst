import { useState } from "react";
import { AppleIcon } from "./icons";
import { appStore, appStoreUrl } from "./config";
import { reportStoreClick } from "@/lib/storeClick";

const STORAGE_KEY = "mkt.appBanner.dismissed";

/**
 * Every storage access is guarded, mirroring `lib/consent.ts` — Safari private
 * mode throws on `localStorage`, and the only safe failure here is toward
 * showing the banner again next visit, never toward crashing the page.
 */
function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistDismissed(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // ignore — worst case the banner reappears next visit.
  }
}

/**
 * Mobile-only "get the app" banner — the cross-platform companion to the
 * native `apple-itunes-app` Smart App Banner meta tag in `index.html` (which
 * only iOS Safari renders). Mounted at the very top of `MarketingLayout`,
 * above `MarketingNav`, on every marketing page.
 *
 * Gated on `appStore.available` (and `appStoreUrl()` returning non-null) so it
 * renders nothing until the store listing goes live — same source of truth as
 * `AppStoreCta`. Hidden on desktop viewports via a `min-width` media query in
 * marketing.css rather than UA sniffing, so there's no hydration mismatch risk.
 *
 * Dismissal persists in localStorage so closing it sticks across visits.
 */
export function AppBanner() {
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed());

  const href = appStoreUrl();
  if (!appStore.available || !href || dismissed) return null;

  const dismiss = () => {
    persistDismissed();
    setDismissed(true);
  };

  return (
    <div
      className="mkt-app-banner"
      role="region"
      aria-label="Get the Persistence app"
    >
      <AppleIcon className="mkt-app-banner-icon" />
      <div className="mkt-app-banner-text">
        <span className="mkt-app-banner-name">Persistence</span>
        <span className="mkt-app-banner-copy">
          Coach &amp; Train — now on the App Store
        </span>
      </div>
      <a
        href={href}
        className="mkt-app-banner-cta"
        onClick={() => reportStoreClick()}
      >
        Get
      </a>
      <button
        type="button"
        className="mkt-app-banner-close"
        aria-label="Dismiss"
        onClick={dismiss}
      >
        ×
      </button>
    </div>
  );
}
