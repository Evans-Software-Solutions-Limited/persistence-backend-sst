import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  clearMetaCookies,
  getConsent,
  setConsent,
} from "@/lib/consent";
import { initMetaPixel, trackPageView } from "@/lib/metaPixel";

/**
 * Marketing-cookie consent banner (spec-30 R3.5). Rendered once from
 * `MarketingLayout`. Shows on first visit (stored consent `"unset"`) and
 * whenever the footer's "Cookie settings" link re-opens it — the withdrawal
 * route, so consent is genuinely revocable.
 *
 * Accept and Reject have EQUAL prominence and are each a single click (ICO
 * expectation); there is no "X"/dismiss that could imply consent, and no
 * consent-by-scroll. Default is no consent — the pixel stays off until Accept.
 */
export const CONSENT_REOPEN_EVENT = "persistence:consent-reopen";

export function ConsentBanner() {
  // Show initially only when the visitor hasn't chosen yet. The footer link
  // re-opens it later without disturbing the stored answer until they re-choose.
  const [open, setOpen] = useState<boolean>(() => getConsent() === "unset");

  useEffect(() => {
    const reopen = () => setOpen(true);
    window.addEventListener(CONSENT_REOPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_REOPEN_EVENT, reopen);
  }, []);

  if (!open) return null;

  const accept = () => {
    setConsent("granted");
    initMetaPixel();
    trackPageView();
    setOpen(false);
  };

  const reject = () => {
    setConsent("denied");
    clearMetaCookies();
    setOpen(false);
  };

  return (
    <div
      className="mkt-consent"
      role="dialog"
      aria-modal="false"
      aria-label="Cookie consent"
    >
      <div className="mkt-consent-inner">
        <p className="mkt-consent-copy">
          We&rsquo;d like to set one Meta (Facebook) cookie to measure whether
          our ads bring people to Persistence. Nothing about your training, food
          or health is ever shared. <Link to="/privacy">Privacy policy</Link>.
        </p>
        {/* Equal-weight buttons (same class) — Reject is exactly as prominent
            and as easy as Accept (ICO expectation); no dark-pattern styling. */}
        <div className="mkt-consent-actions">
          <button type="button" className="btn btn-line" onClick={reject}>
            Reject
          </button>
          <button type="button" className="btn btn-line" onClick={accept}>
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
