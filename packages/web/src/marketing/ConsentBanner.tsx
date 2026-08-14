import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  clearMetaCookies,
  getChoices,
  isConsentDecided,
  setConsent,
  type ConsentChoices,
} from "@/lib/consent";
import { initMetaPixel, trackPageView } from "@/lib/metaPixel";

/**
 * Marketing-cookie consent banner (spec-30 R3.5). Rendered once from
 * `MarketingLayout`. Shows on first visit (no decision under the current
 * consent version) and whenever the footer's "Cookie settings" link re-opens it
 * — the withdrawal route, so consent is genuinely revocable.
 *
 * CATEGORY model (see lib/consent): "Accept all" / "Reject all" are one click
 * each and equally prominent (ICO expectation); "Manage" reveals per-category
 * toggles so a visitor can accept some non-essential cookies and not others.
 * Strictly-necessary cookies are always on and shown as such (no toggle). There
 * is no "X"/dismiss that could imply consent, and no consent-by-scroll. Default
 * is every non-essential category OFF until an explicit choice.
 */
export const CONSENT_REOPEN_EVENT = "persistence:consent-reopen";

export function ConsentBanner() {
  // Show initially only when the visitor hasn't decided under the current
  // version. The footer link re-opens it later without disturbing the stored
  // answer until they re-choose.
  const [open, setOpen] = useState<boolean>(() => !isConsentDecided());
  const [managing, setManaging] = useState(false);
  // Draft state for the Manage panel's toggles, seeded from the stored choice
  // (all-off when undecided).
  const [advertising, setAdvertising] = useState<boolean>(
    () => getChoices().advertising,
  );

  useEffect(() => {
    const reopen = () => {
      // Re-seed the toggles from the current stored choice so the panel
      // reflects reality when re-opened from the footer.
      setAdvertising(getChoices().advertising);
      setManaging(false);
      setOpen(true);
    };
    window.addEventListener(CONSENT_REOPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_REOPEN_EVENT, reopen);
  }, []);

  if (!open) return null;

  // Persist a final set of choices and bring the pixel into line: load it (and
  // fire the first PageView) when advertising is granted, or clear its cookies
  // when it isn't. Then close.
  const apply = (choices: ConsentChoices) => {
    setConsent(choices);
    if (choices.advertising) {
      initMetaPixel();
      trackPageView();
    } else {
      clearMetaCookies();
    }
    setManaging(false);
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
          We use optional cookies to measure whether our ads bring people to
          Persistence. No training, food or health data is ever shared.{" "}
          <Link to="/privacy">Privacy policy</Link>.
        </p>

        {managing && (
          <div className="mkt-consent-prefs">
            <div className="mkt-consent-cat mkt-consent-cat-locked">
              <div className="mkt-consent-cat-text">
                <span className="mkt-consent-cat-name">Strictly necessary</span>
                <span className="mkt-consent-cat-desc">
                  Required for the site to work (theme, security).
                </span>
              </div>
              <span className="mkt-consent-always">Always on</span>
            </div>
            <label className="mkt-consent-cat" htmlFor="cat-advertising">
              <div className="mkt-consent-cat-text">
                <span className="mkt-consent-cat-name">Advertising</span>
                <span className="mkt-consent-cat-desc">
                  A Meta (Facebook) cookie that measures whether our ads bring
                  people here. Off by default.
                </span>
              </div>
              <input
                id="cat-advertising"
                type="checkbox"
                checked={advertising}
                onChange={(e) => setAdvertising(e.target.checked)}
              />
            </label>
          </div>
        )}

        {/* "Accept all" and "Reject all" are equal-weight and one click each
            (ICO expectation); "Manage" is the lower-key path to per-category
            choice. In Manage mode "Save choices" applies the toggles above. */}
        <div className="mkt-consent-actions">
          {managing ? (
            <button
              type="button"
              className="btn btn-line"
              onClick={() => apply({ advertising })}
            >
              Save choices
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-ghost mkt-consent-manage"
              onClick={() => setManaging(true)}
            >
              Manage
            </button>
          )}
          <button
            type="button"
            className="btn btn-line"
            onClick={() => apply({ advertising: false })}
          >
            Reject all
          </button>
          <button
            type="button"
            className="btn btn-line"
            onClick={() => apply({ advertising: true })}
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}
