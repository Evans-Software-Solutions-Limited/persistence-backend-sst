import { createContext, useContext } from "react";
import { CAMPAIGNS } from "./config";

/**
 * Campaign attribution, resolved once per marketing page render and read by
 * every "get the app" CTA beneath it.
 *
 * Why a context and not a prop: the four App Store links on a campaign landing
 * page do not share a parent that owns the route. Two are Home's own (hero +
 * store section), but `MarketingNav` and `AppBanner` are siblings inside
 * `MarketingLayout`. Prop-drilling the slug would mean threading it through
 * every marketing page and the layout's whole surface; a context lets
 * `MarketingLayout` — which already calls `useLocation()` — resolve it once.
 *
 * The default value is `undefined`, deliberately: components rendered outside a
 * provider (unit tests, non-marketing pages) fall back to the bare, undecorated
 * store URL rather than throwing. That keeps `useCampaign` safe to call from a
 * component with no router above it.
 *
 * No component is exported from this module on purpose — `MarketingLayout`
 * renders `CampaignContext.Provider` itself, which keeps this file free of JSX
 * and satisfies react-refresh's only-export-components rule.
 */
export const CampaignContext = createContext<string | undefined>(undefined);

function isKnownCampaign(slug: string): boolean {
  // hasOwnProperty, not `in`: CAMPAIGNS is a plain object, so `in` would answer
  // true for inherited keys like "constructor" and "toString".
  return Object.prototype.hasOwnProperty.call(CAMPAIGNS, slug);
}

/**
 * Maps a landing-route pathname to a campaign slug in {@link CAMPAIGNS}.
 *
 * `/uon` → "uon", `/tt` → "tt". `/qr/:slug` resolves to the slug when it has an
 * entry of its own and to "default" otherwise, which is exactly what the
 * `default` entry exists for. Any other path (`/`, `/pricing`, …) returns
 * undefined, so ordinary marketing pages keep the bare store URL and never
 * attribute an organic visit to a campaign that did not drive it.
 */
export function campaignFromPath(pathname: string): string | undefined {
  const [first, second] = pathname.split("/").filter(Boolean);
  if (!first) return undefined;
  if (first === "qr") {
    return second && isKnownCampaign(second) ? second : "default";
  }
  return isKnownCampaign(first) ? first : undefined;
}

/** The current route's campaign slug, or undefined outside a campaign route. */
export function useCampaign(): string | undefined {
  return useContext(CampaignContext);
}
