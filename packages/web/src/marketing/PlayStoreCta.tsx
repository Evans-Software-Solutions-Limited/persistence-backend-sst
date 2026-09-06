import { GooglePlayIcon } from "./icons";
import { playStoreLive, playStoreUrl } from "./config";
import { useCampaign } from "./campaign";
import { reportStoreClick } from "@/lib/storeClick";

/**
 * The Google Play counterpart to {@link AppStoreCta}. The `hero` and `store`
 * variants keep both download placements on the same availability and
 * attribution path.
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
 * `playStoreUrl` nests campaign UTMs in Google's encoded install `referrer`,
 * while `reportStoreClick("android")` carries the destination through the
 * first-party analytics row and Meta custom data.
 *
 * The live CTA keeps the site's existing icon-led button treatment. Its
 * multicolour prism is cropped from Google's supplied web-badge artwork rather
 * than approximated with a monochrome custom path.
 */
export function PlayStoreCta({
  className,
  variant = "store",
}: {
  className?: string;
  variant?: "hero" | "store";
}) {
  const campaign = useCampaign();
  const href = playStoreUrl(campaign);
  const extra = className ? ` ${className}` : "";
  const live = playStoreLive() && href !== null;

  if (variant === "hero") {
    return live ? (
      <a
        href={href!}
        className={`btn btn-fill${extra}`}
        aria-label="Get it on Google Play"
        onClick={() => reportStoreClick("android", campaign)}
      >
        <GooglePlayIcon />
        Get it on Google Play
      </a>
    ) : (
      <span className={`btn btn-fill cta-soon${extra}`} aria-disabled="true">
        Coming to Google Play
      </span>
    );
  }

  return live ? (
    <a
      href={href!}
      className={`store-btn${extra}`}
      aria-label="Get it on Google Play"
      onClick={() => reportStoreClick("android", campaign)}
    >
      <GooglePlayIcon />
      <div className="store-btn-text">
        <span className="small">Get it on</span>
        <span className="big">Google Play</span>
      </div>
    </a>
  ) : (
    <span className={`store-btn disabled${extra}`} aria-disabled="true">
      <div className="store-btn-text">
        <span className="small">Coming soon to</span>
        <span className="big">Google Play</span>
      </div>
    </span>
  );
}
