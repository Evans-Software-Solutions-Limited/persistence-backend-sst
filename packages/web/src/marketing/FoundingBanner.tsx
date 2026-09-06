import { useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { FOUNDING_COPY, foundingOfferIsOpen } from "./foundingOffer";

const DISMISSED_KEY = "persistence.founding-banner-dismissed";

/** The strip's height, published to CSS so the fixed nav can sit below it. */
const TOPBAR_VAR = "--m-topbar-h";

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

/**
 * Publishes the strip's height as `--m-topbar-h` on the document root, and
 * clears it the moment the strip goes away.
 *
 * `.nav` is `position: fixed; top: var(--m-topbar-h, 0px)` and `.mkt` carries
 * the matching `padding-top`, so this one number is what keeps the strip and
 * the nav out of each other's band. Without it the strip covered the top half
 * of the nav and sliced the logo and the CTA through the middle.
 *
 * MEASURED rather than hardcoded, because the height is not a constant: the
 * approved wording arrives later with `LANDING_PAGE.md`, it wraps to two lines
 * on a narrow viewport, and it shifts again when the display font swaps in. A
 * constant would clip long copy or leave a gap under short copy; observing the
 * element cannot be wrong about either.
 *
 * The variable is only ever set while the strip is on screen, so every page
 * without it falls back to `0px` and lays out exactly as it did before.
 */
function useTopbarOffset(shown: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!shown || !el) {
      root.style.removeProperty(TOPBAR_VAR);
      return;
    }

    const apply = () =>
      root.style.setProperty(TOPBAR_VAR, `${el.offsetHeight}px`);
    apply();

    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(apply) : null;
    observer?.observe(el);

    return () => {
      observer?.disconnect();
      root.style.removeProperty(TOPBAR_VAR);
    };
  }, [shown]);

  return ref;
}

export function FoundingBanner() {
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(wasDismissed);

  const shown =
    foundingOfferIsOpen() && !pathname.startsWith("/founding") && !dismissed;
  const ref = useTopbarOffset(shown);

  if (!shown) return null;

  return (
    <div
      ref={ref}
      className="founding-banner"
      role="region"
      aria-label="Founding offer"
    >
      <span>{FOUNDING_COPY.bannerText}</span>
      <Link to="/founding">{FOUNDING_COPY.bannerCta}</Link>
      <button
        type="button"
        aria-label={FOUNDING_COPY.bannerDismissLabel}
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
