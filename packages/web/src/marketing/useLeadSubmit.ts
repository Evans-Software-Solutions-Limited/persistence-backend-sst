import { useState, useCallback } from "react";
import { getFbc, getFbp, newEventId, trackLead } from "../lib/metaPixel";
import { hasConsent } from "@/lib/consent";
import { marketingApiBase } from "@/lib/marketingApiBase";

/**
 * Lightweight lead-capture submit hook for the marketing forms (waitlist +
 * coach enquiry). Uses raw `fetch` against the Core API rather than the Eden
 * `treaty<CoreApi>` client on purpose: that client sits at TS's
 * instantiation ceiling (see lib/eden.ts) and has zero call-sites, so keeping
 * these public POSTs off it avoids growing that type surface.
 *
 * The endpoints are public (no auth) and return `{ ok: boolean }`. Any non-2xx
 * or network failure resolves to the `error` state — the caller shows a retry
 * message. Honeypot + validation live server-side too; the `hp` field is passed
 * straight through.
 *
 * spec-30 WS3 click capture: every submit is decorated with `fbc`/`fbp`
 * (Meta click/browser ids, present only when captured) and a fresh
 * `event_id`. On success, the browser pixel fires `Lead` with that same
 * `event_id` so it dedups against the server-side CAPI `Lead` the endpoint
 * emits (R3.2). `turnstileToken`, when the caller includes it in `body`
 * (see `LeadForms.tsx`), passes straight through like any other field.
 *
 * spec-30 R2.7 consent carry: every submit also carries the visitor's current
 * marketing-consent choice (`getConsent() === "granted"`) so the server can
 * consent-gate its own Meta CAPI forward for this lead the same way the
 * browser pixel is gated.
 */
export type LeadStatus = "idle" | "submitting" | "success" | "error";

// Pragmatic address check — the server validates authoritatively; this only
// stops an obviously-empty/garbled submit before the round-trip.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function useLeadSubmit(path: "waitlist" | "coach") {
  const [status, setStatus] = useState<LeadStatus>("idle");

  const submit = useCallback(
    async (body: Record<string, string>): Promise<boolean> => {
      setStatus("submitting");
      const fbc = getFbc();
      const fbp = getFbp();
      const eventId = newEventId();
      const payload: Record<string, string | boolean> = {
        ...body,
        ...(fbc ? { fbc } : {}),
        ...(fbp ? { fbp } : {}),
        event_id: eventId,
        marketing_consent: hasConsent("advertising"),
      };
      try {
        const res = await fetch(`${marketingApiBase()}/leads/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const ok = res.ok && ((await res.json().catch(() => ({}))).ok ?? false);
        setStatus(ok ? "success" : "error");
        if (ok) trackLead(eventId);
        return ok;
      } catch {
        setStatus("error");
        return false;
      }
    },
    [path],
  );

  const reset = useCallback(() => setStatus("idle"), []);

  return { status, submit, reset };
}
