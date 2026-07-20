import { useEffect, useRef } from "react";
import { View } from "@tamagui/core";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { parseAuthCallbackUrl } from "@/application/auth/callback-tokens";
import { usePasswordRecovery } from "@/state/password-recovery";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { PLogoDrawLoader } from "@/ui/components";

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
  const url = Linking.useURL();
  const { auth } = useAdapters();
  const router = useRouter();
  // The launch URL is stable, but `useURL` can re-emit it; guard so the
  // session is only established once per mount.
  const handled = useRef(false);

  useEffect(() => {
    if (url == null || handled.current) return;
    handled.current = true;

    const { accessToken, refreshToken, type } = parseAuthCallbackUrl(url);
    if (!accessToken || !refreshToken) {
      // Error fragment or a link with no session — nothing to establish.
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
          router.replace("/(auth)/sign-in");
        }
        // Success: AuthGate routes on the new session (tabs, or
        // set-new-password when the recovery flag is set).
      } catch {
        // Defensive — the adapter is contracted to return a Result, but never
        // leave the user stranded on the loader if it throws anyway.
        if (isRecovery) usePasswordRecovery.getState().clear();
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
