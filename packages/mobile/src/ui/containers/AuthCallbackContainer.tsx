import { useEffect, useRef } from "react";
import { View } from "@tamagui/core";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { parseAuthCallbackUrl } from "@/application/auth/callback-tokens";
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
 * success we set the session and let `AuthGate` route into the app when the
 * session propagates — the same handoff the OAuth/email flows rely on, which
 * avoids racing the auth-state update. A missing/invalid link (no tokens, or
 * an expired/used token) bounces to sign-in.
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

    const { accessToken, refreshToken } = parseAuthCallbackUrl(url);
    if (!accessToken || !refreshToken) {
      // Error fragment or a link with no session — nothing to establish.
      router.replace("/(auth)/sign-in");
      return;
    }

    void (async () => {
      try {
        const result = await auth.setSessionFromTokens(
          accessToken,
          refreshToken,
        );
        if (!result.ok) {
          router.replace("/(auth)/sign-in");
        }
        // Success: AuthGate routes into the app once the session propagates.
      } catch {
        // Defensive — the adapter is contracted to return a Result, but never
        // leave the user stranded on the loader if it throws anyway.
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
