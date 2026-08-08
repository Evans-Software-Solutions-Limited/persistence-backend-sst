import { useState, useCallback } from "react";

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
 */
export type LeadStatus = "idle" | "submitting" | "success" | "error";

const API_BASE = (import.meta.env.VITE_CORE_API_URL ?? "").replace(/\/+$/, "");

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
      try {
        const res = await fetch(`${API_BASE}/leads/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const ok = res.ok && ((await res.json().catch(() => ({}))).ok ?? false);
        setStatus(ok ? "success" : "error");
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
