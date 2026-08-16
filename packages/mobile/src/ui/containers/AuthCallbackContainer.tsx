import { useEffect, useRef } from "react";
import { View } from "@tamagui/core";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { parseAuthCallbackUrl } from "@/application/auth/callback-tokens";
import { usePasswordRecovery } from "@/state/password-recovery";
import { useAdapters } from "@/ui/hooks/useAdapters";
import {
  clearAuthCallbackUrl,
  useAuthCallbackUrl,
} from "@/ui/hooks/useAuthCallbackUrl";
import { PLogoDrawLoader } from "@/ui/components";

/**
 * Safety net: if no token-bearing URL ever resolves (a link that never carried
 * the app the tokens, or an OS/linking edge case), never leave the user on a
 * permanent spinner — bounce to sign-in, where a now email-confirmed account
 * can simply sign in. Generous so a slow warm-start capture still wins first.
 */
const AUTH_CALLBACK_TIMEOUT_MS = 12_000;

/**
 * <AuthCallbackContainer> — handler for the `persistencemobile://auth/callback`
 * deep link (Supabase email-confirmation / password-recovery / OAuth
 * redirect). The web callback page — the Supabase Site URL — is the desktop
 * landing and the first hop on mobile; it deep-links here so the app can
 * finish sign-in on-device. Before this route existed, a cold open dead-ended
 * on Expo Router's Unmatched route.
 *
 * The tokens ride in the URL fragment, which Expo Router strips from the
 * routed path, so we read the raw launch URL via `Linking.useURL()` (null
 * until the OS hands it over on a cold start) and parse it ourselves. On
 * success we set the session and let `AuthGate` route on the new session —
 * the same handoff the OAuth/email flows rely on, which avoids racing the
 * auth-state update. A `type=recovery` link additionally flags
 * [[password-recovery]] before establishing the session, so AuthGate diverts
 * to the set-new-password screen instead of the tabs. A missing/invalid link
 * (no tokens, or an expired/used token) bounces to sign-in.
 */
export function AuthCallbackContainer() {
  // Prefer the root-captured URL (survives a warm start, where the deep-link
  // event fires before this container mounts and `useURL` would miss it — prod
  // incident 2026-08-16). Fall back to `useURL` for a cold start or if capture
  // hasn't populated yet.
  const capturedUrl = useAuthCallbackUrl();
  const hookUrl = Linking.useURL();
  const url = capturedUrl ?? hookUrl;
  const { auth } = useAdapters();
  const router = useRouter();
  // `handled` guards re-entry of the URL effect (useURL can re-emit the same
  // URL). `settled` tracks whether a TERMINAL outcome was reached (session
  // established, or bounced) — it, not `handled`, gates the safety-net timeout,
  // so a URL that started processing but STALLED (e.g. setSession hangs offline)
  // is still rescued.
  const handled = useRef(false);
  const settled = useRef(false);

  // Safety net: the confirm screen must never spin forever (AuthGate exempts
  // this route, so nothing else rescues it). Covers BOTH "no token URL ever
  // arrived" AND "URL arrived but session establishment stalled". After the
  // timeout, bounce to sign-in — a now-confirmed account can just sign in.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (settled.current) return;
      settled.current = true;
      // Defensive: if a recovery link stalled, don't leave the flag armed to
      // divert a later normal sign-in. No-op when not armed.
      usePasswordRecovery.getState().clear();
      router.replace("/(auth)/sign-in");
    }, AUTH_CALLBACK_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [router]);

  useEffect(() => {
    if (url == null || handled.current) return;
    handled.current = true;
    // Consumed — clear so a later mount can't reprocess a stale link.
    clearAuthCallbackUrl();

    const { accessToken, refreshToken, type } = parseAuthCallbackUrl(url);
    if (!accessToken || !refreshToken) {
      // Error fragment or a link with no session — nothing to establish.
      settled.current = true;
      router.replace("/(auth)/sign-in");
      return;
    }

    // Flag recovery BEFORE the session lands so AuthGate — which reacts to the
    // session synchronously — diverts to set-new-password rather than the tabs
    // (peeked there, cleared by the set-new-password screen). Signup/OAuth
    // confirmations carry no `type=recovery`, so they fall through to the tabs.
    const isRecovery = type === "recovery";
    if (isRecovery) usePasswordRecovery.getState().begin();

    void (async () => {
      try {
        const result = await auth.setSessionFromTokens(
          accessToken,
          refreshToken,
        );
        if (!result.ok) {
          // Undo the recovery flag so it can't divert a later normal sign-in.
          if (isRecovery) usePasswordRecovery.getState().clear();
          settled.current = true;
          router.replace("/(auth)/sign-in");
          return;
        }
        // Success: AuthGate routes on the new session (tabs, or
        // set-new-password when the recovery flag is set).
        settled.current = true;
      } catch {
        // Defensive — the adapter is contracted to return a Result, but never
        // leave the user stranded on the loader if it throws anyway.
        if (isRecovery) usePasswordRecovery.getState().clear();
        settled.current = true;
        router.replace("/(auth)/sign-in");
      }
    })();
  }, [url, auth, router]);

  return (
    <View
      flex={1}
      justifyContent="center"
      alignItems="center"
      backgroundColor="$background"
    >
      <PLogoDrawLoader />
    </View>
  );
}
