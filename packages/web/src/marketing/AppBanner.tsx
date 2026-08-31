import { useState } from "react";
import { Link } from "react-router";
import { appStoreLive, playStoreLive } from "./config";

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
 * Gated on either store being live, so it renders nothing until there is a
 * download destination. The CTA lands on the shared download section where
 * visitors can choose App Store or Google Play. Hidden on desktop viewports via
 * a `min-width` media query in marketing.css rather than UA sniffing, so
 * there's no hydration mismatch risk.
 *
 * Dismissal persists in localStorage so closing it sticks across visits.
 */
export function AppBanner() {
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed());

  if ((!appStoreLive() && !playStoreLive()) || dismissed) return null;

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
      <img
        className="mkt-app-banner-icon"
        src="/apple-touch-icon.png"
        alt=""
        aria-hidden="true"
      />
      <div className="mkt-app-banner-text">
        <span className="mkt-app-banner-name">Persistence</span>
        <span className="mkt-app-banner-copy">
          Coach &amp; Train — now on iPhone and Android
        </span>
      </div>
      <Link to="/#download" className="mkt-app-banner-cta">
        Get
      </Link>
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
