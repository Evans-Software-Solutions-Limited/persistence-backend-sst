import { useState } from "react";
import { Link, useLocation } from "react-router";
import { FOUNDING_COPY, foundingOfferIsOpen } from "./foundingOffer";

const DISMISSED_KEY = "persistence.founding-banner-dismissed";

/**
 * Top-of-page banner pointing at the founding offer, for the weeks it is open
 * (FOUNDING-OFFER BRIEF § 2, 2026-09-05 amendment).
 *
 * Renders nothing in three cases, each for its own reason:
 *  - after the close date, so it disappears on its own rather than needing a
 *    deploy on 1 October;
 *  - on `/founding` itself, where it would advertise the page it is already on;
 *  - once dismissed, remembered per browser so it does not nag on every visit.
 *
 * `localStorage` is wrapped in try/catch: a locked-down browser must lose the
 * dismissal, not the page.
 */
function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function FoundingBanner() {
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(wasDismissed);

  if (!foundingOfferIsOpen()) return null;
  if (pathname.startsWith("/founding")) return null;
  if (dismissed) return null;

  return (
    <div className="founding-banner" role="region" aria-label="Founding offer">
      <span>{FOUNDING_COPY.bannerText}</span>
      <Link to="/founding">{FOUNDING_COPY.bannerCta}</Link>
      <button
        type="button"
        aria-label="Dismiss the founding offer notice"
        onClick={() => {
          setDismissed(true);
          try {
            window.localStorage.setItem(DISMISSED_KEY, "1");
          } catch {
            // A browser that refuses storage still gets the banner closed for
            // this page view; it simply returns on the next one.
          }
        }}
      >
        ×
      </button>
    </div>
  );
}
