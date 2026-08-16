import { useSyncExternalStore } from "react";
import * as Linking from "expo-linking";

/**
 * Reliable capture of the Supabase auth-callback deep link
 * (`persistencemobile://auth/callback#access_token=…`).
 *
 * WHY THIS EXISTS (prod incident 2026-08-16): `AuthCallbackContainer` read the
 * launch URL only via `Linking.useURL()`, whose listener attaches when the
 * container mounts. On a WARM start — the app already running when the user taps
 * the email-confirmation link, which is the COMMON sign-up case — the OS fires
 * the `url` event and Expo Router navigates to `/auth/callback` BEFORE the
 * container (and its `useURL` listener) mount, so the event is missed, `url`
 * stays `null`, and the confirmation screen spins forever. React Native does
 * not replay linking events, so a listener attached late never sees them.
 *
 * This captures the URL at an always-mounted point: `initAuthCallbackCapture`
 * is called from the root layout, so the OS-linking listeners are live before a
 * warm-start deep link can arrive and the URL is already stored by the time the
 * container mounts. It reads the raw native URL (fragment intact), covering both
 * `getInitialURL` (cold start) and the `url` event (warm start).
 */

// Matches `.../auth/callback...` on any of the app's custom-scheme variants (or
// the web-bridge https URL, or an `exp://` dev URL) — we only stash auth links,
// never unrelated deep links (invite codes, notification taps).
const AUTH_CALLBACK_RE = /auth\/callback/i;

let capturedUrl: string | null = null;
let installed = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function capture(url: string | null): void {
  if (!url || !AUTH_CALLBACK_RE.test(url)) return;
  capturedUrl = url;
  emit();
}

/**
 * Install the OS-linking listeners ONCE. Call from the root layout so the
 * listeners are live before a warm-start deep link can arrive. Idempotent — a
 * second call is a no-op, so a hot reload can't stack duplicate listeners.
 */
export function initAuthCallbackCapture(): void {
  if (installed) return;
  installed = true;
  // Cold start: the app was launched by the deep link.
  void Linking.getInitialURL()
    .then(capture)
    .catch(() => {});
  // Warm start: the app was already running (the common sign-up case).
  Linking.addEventListener("url", ({ url }) => capture(url));
}

/**
 * Clear the captured URL once the container has consumed it, so a later mount
 * (e.g. the user opens a second link) can't re-process a stale one.
 */
export function clearAuthCallbackUrl(): void {
  if (capturedUrl === null) return;
  capturedUrl = null;
  emit();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): string | null {
  return capturedUrl;
}

/** The most-recently captured auth-callback URL, or `null`. */
export function useAuthCallbackUrl(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test-only: reset the module singleton between cases. */
export function __resetAuthCallbackCaptureForTests(): void {
  capturedUrl = null;
  installed = false;
  listeners.clear();
}
