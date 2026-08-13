import { getConsent } from "./consent";
import { getFbc, getFbp, newEventId, trackAppStoreClick } from "./metaPixel";

const API_BASE = (import.meta.env.VITE_CORE_API_URL ?? "").replace(/\/+$/, "");

/**
 * Outbound App Store click reporter (spec-30 R3.8). Fires the browser pixel
 * custom event (`trackAppStoreClick`, itself consent-gated) and beacons the
 * server `/store-click` endpoint with the same `event_id` so the two dedup
 * against each other on the Meta side, plus the click/browser ids and the
 * visitor's current marketing-consent choice (R2.7) so the server can
 * consent-gate its own Meta CAPI forward.
 *
 * The click navigates away immediately, so a plain `fetch` risks being
 * cancelled mid-flight; `navigator.sendBeacon` is used when available since
 * it's designed to survive page unload, with a `keepalive: true` fetch as
 * the fallback. Any send failure is swallowed in a try/catch — a broken
 * beacon must never block the outbound navigation.
 */
export function reportStoreClick(): string {
  const eventId = newEventId();
  trackAppStoreClick(eventId);

  const body = JSON.stringify({
    event_id: eventId,
    fbc: getFbc() ?? undefined,
    fbp: getFbp() ?? undefined,
    marketing_consent: getConsent() === "granted",
  });

  try {
    const url = `${API_BASE}/store-click`;
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    } else {
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {
        // ignore — a beacon failure must never block navigation.
      });
    }
  } catch {
    // ignore — a beacon failure must never block navigation.
  }

  return eventId;
}
