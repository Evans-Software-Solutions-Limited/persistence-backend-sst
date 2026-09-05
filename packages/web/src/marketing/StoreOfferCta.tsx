import { STORE_OFFER_CAMPAIGNS, storeOfferUrl } from "./config";
import { useCampaign } from "./campaign";
import { currentPlatform } from "@/lib/platform";
import { reportStoreClick } from "@/lib/storeClick";

export type StoreOfferCtaVariant = "hero" | "store";

export interface StoreOfferCtaProps {
  variant: StoreOfferCtaVariant;
  /**
   * Campaign slugs this CTA is allowed to appear on. Defaults to
   * {@link STORE_OFFER_CAMPAIGNS}, which is what the Home mounts want: cold ad
   * traffic sees the offer, an organic visitor on `/` does not.
   *
   * `null` disables the gate entirely, for a page that IS the offer's
   * destination however the visitor arrived.
   */
  campaigns?: readonly string[] | null;
  className?: string;
}

/**
 * The store founders'-rate CTA — an App Store / Play **offer-code redemption
 * link**, not the ordinary store listing.
 *
 * WEB ONLY, and structurally so: nothing about the founders' offer may appear
 * inside the mobile app (Apple 3.1.3(b)), so this component lives in
 * `packages/web` and `packages/mobile` never imports from here.
 *
 * Three things must all hold before it renders anything:
 *
 *  1. the route's campaign is in the allow-list (see `campaigns`);
 *  2. the visitor is on a platform we can redeem on — a redemption URL opens
 *     the App Store, so showing it to a desktop or a crawler is a dead end;
 *  3. that platform's URL is configured for this stage.
 *
 * (3) is the launch switch. It stays unset until a code has been redeemed end
 * to end on a fresh Apple ID and a `user_subscriptions` row confirmed
 * server-side — RevenueCat skips anonymous ids, so an unverified rail would
 * take money for access our database never hears about.
 *
 * The click still goes through `reportStoreClick`, carrying the campaign like
 * every other store CTA: a redemption is an outbound store click, and keeping
 * it on the same event means the admin attribution tables count it without
 * knowing this component exists.
 *
 * No price appears here. The amount Apple charges is the nearest Apple tier to
 * the intended figure, is set in App Store Connect, and is read back from there
 * before it goes in any copy — so the only claim this makes is the renewal
 * behaviour and the eligibility, both of which are properties of the offer type
 * rather than of a number.
 */
export function StoreOfferCta({
  variant,
  campaigns = STORE_OFFER_CAMPAIGNS,
  className,
}: StoreOfferCtaProps) {
  const campaign = useCampaign();
  const platform = currentPlatform();

  if (campaigns !== null && (!campaign || !campaigns.includes(campaign))) {
    return null;
  }
  if (platform === "other") return null;

  const href = storeOfferUrl(platform);
  if (!href) return null;

  const extra = className ? ` ${className}` : "";
  return (
    <div className={`store-offer store-offer-${variant}${extra}`}>
      <a
        href={href}
        className="btn btn-accent"
        onClick={() => reportStoreClick(platform, campaign)}
      >
        Redeem the founders' rate
      </a>
      <p className="store-offer-note">
        New subscribers only. Renews at the standard price unless cancelled.
      </p>
    </div>
  );
}
