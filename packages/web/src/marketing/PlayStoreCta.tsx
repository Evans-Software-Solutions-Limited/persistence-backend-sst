import { GooglePlayIcon } from "./icons";
import { playStoreLive, playStoreUrl } from "./config";
import { useCampaign } from "./campaign";
import { reportStoreClick } from "@/lib/storeClick";

/**
 * The Google Play counterpart to {@link AppStoreCta}, in the `store` variant
 * that is the only one Play needs today (Home's store section).
 *
 * ─── Why this exists ───
 *
 * Home's Play button was a hardcoded, permanently-disabled
 * `<span>Coming soon to Google Play</span>`. That was harmless while the only
 * other Android affordance was the notify list beside it — but gating that list
 * on `!playStore.available` (so it retires itself on launch) turned the
 * hardcoded span into a trap: flipping the flag would have removed the notify
 * list, left the button reading "Coming soon", and had /support say "It's on
 * Google Play", so an Android visitor would have had no way to reach the app at
 * all. A flag flip has to produce a coherent page in BOTH positions.
 *
 * Mirrors `AppStoreCta`'s gate deliberately: BOTH the availability flag and a
 * non-null URL. Checking only the URL is exactly the bug `AppStoreCta` carried —
 * `available = false` there left live store links under "coming soon" prose.
 *
 * Attribution comes from the landing route's campaign the same way, so a Play
 * CTA on /flyer carries that campaign's `utm_source`/`utm_campaign`.
 *
 * ⚠ TWO known gaps, both dormant while Play is not live, both Android-launch
 * work rather than anything this component can fix alone:
 *
 * 1. The `utm_*` params `playStoreUrl` appends are NOT what the Play Console
 *    attributes on — it reads a single URL-encoded `referrer`. Left as-is, every
 *    Play install from this button records as organic.
 *
 * 2. `reportStoreClick()` is PLATFORM-BLIND. It takes no argument, the browser
 *    pixel fires `trackCustom('AppStoreClick')` (lib/metaPixel.ts) and the
 *    server writes `analytics_events.name = 'store_click'` with no field saying
 *    which store, so once Play is live an Android click is indistinguishable
 *    from an iOS one and reaches Meta under an event literally named
 *    `AppStoreClick`. Fixing it means threading a `store: "ios" | "android"`
 *    through `reportStoreClick` → the `/store-click` beacon body →
 *    `storeClickEvent`'s properties → `metaEventMap`, i.e. both sides.
 *
 * The call is otherwise safe to make here: `reportStoreClick` posts to
 * `/store-click` and reads nothing Apple-specific.
 */
export function PlayStoreCta({ className }: { className?: string }) {
  const campaign = useCampaign();
  const href = playStoreUrl(campaign);
  const extra = className ? ` ${className}` : "";
  const live = playStoreLive() && href !== null;

  const content = (
    <>
      <GooglePlayIcon />
      <div className="store-btn-text">
        <span className="small">{live ? "Get it on" : "Coming soon to"}</span>
        <span className="big">Google Play</span>
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
