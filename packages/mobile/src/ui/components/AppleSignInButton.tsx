import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { View } from "@tamagui/core";
import * as AppleAuthentication from "expo-apple-authentication";

import { radius } from "@/ui/theme/tokens";

/**
 * Sign in with Apple button.
 *
 * This MUST stay a thin wrapper around Apple's own
 * `AppleAuthenticationButton` (`ASAuthorizationAppleIDButton`). App Review
 * rejected build 1.0 (39) under Guideline 4 — Design because the previous
 * implementation drew the button itself: a generic `<OAuthButton>` whose
 * "logo" was the U+F8FF private-use glyph rendered in the app's own font.
 * That glyph is a font artefact, not the Apple mark from Apple Design
 * Resources, so the button failed the Sign in with Apple design requirements.
 *
 * Rendering Apple's component is what makes this compliant: the logo artwork,
 * label, typeface, localisation, and light/dark variants all come from the
 * system rather than from us. Consequently:
 *
 *   - do NOT re-implement this with an image, an icon font, or a glyph;
 *   - do NOT set `backgroundColor` or `borderRadius` via `style` (use
 *     `buttonStyle` / `cornerRadius`, the only customisation Apple allows);
 *   - do NOT overlay anything on top of the button — the artwork must not be
 *     obscured. That is why the loading state below dims and blocks the
 *     control instead of swapping in a "Connecting..." label the way
 *     `<OAuthButton>` does for Google.
 *
 * @see https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple
 */

/**
 * Matches the height of the Google `<OAuthButton>` on the auth screens. The
 * HIG requires the Sign in with Apple button to be no smaller and no less
 * prominent than the other sign-in options, so the two are kept identical.
 */
const BUTTON_HEIGHT = 52;

/** Mirrors `<OAuthButton>`'s spacing scale so the two can be swapped 1:1. */
const MARGIN_TOP = { none: 0, sm: 4, md: 8, lg: 12, xl: 16 } as const;

type AppleSignInButtonProps = {
  onPress: () => void;
  isLoading: boolean;
  isDisabled: boolean;
  testID: string;
  marginTop?: keyof typeof MARGIN_TOP;
};

/**
 * `AppleAuthenticationButton` renders nothing when Sign in with Apple is
 * unavailable, which would leave a {@link BUTTON_HEIGHT}pt hole in the auth
 * layout, so Expo's guidance is to gate rendering on `isAvailableAsync()`.
 *
 * The check is async and resolves `true` on every iOS version this app
 * supports, so starting at `false` would flash an empty gap on each cold
 * start. Start optimistic instead and only collapse the row if the check
 * genuinely comes back false (or throws).
 *
 * The `active` flag is deliberately NOT test-pinned. React 19 dropped the
 * "state update on an unmounted component" warning, so a late settle is a
 * silent no-op and removing the flag changes nothing observable — any test
 * claiming to cover it would pass with the guard deleted, i.e. be a fake test.
 * It stays because it becomes load-bearing the moment this effect gains
 * dependencies and can re-run, where a stale resolve could clobber a newer one.
 */
function useAppleAuthAvailable(): boolean {
  const [isAvailable, setIsAvailable] = useState(true);

  useEffect(() => {
    let active = true;
    AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (active) setIsAvailable(available);
      })
      .catch(() => {
        if (active) setIsAvailable(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return isAvailable;
}

export function AppleSignInButton({
  onPress,
  isLoading,
  isDisabled,
  testID,
  marginTop = "none",
}: AppleSignInButtonProps) {
  const isAvailable = useAppleAuthAvailable();

  if (!isAvailable) return null;

  // An auth request is in flight (this button's own, or a sibling provider's).
  // Dim to match `<OAuthButton>`'s disabled treatment and stop taps at the
  // wrapper, leaving Apple's artwork itself untouched.
  //
  // Apple's button has no `disabled` prop, so blocking is belt-and-braces:
  // `pointerEvents` stops the touch reaching it natively, and `handlePress`
  // guards the callback so a dispatched press still can't fire a second auth
  // request. The guard is the one that's actually load-bearing — it holds
  // regardless of how Tamagui resolves `pointerEvents` into props vs style.
  const isBlocked = isLoading || isDisabled;

  const handlePress = () => {
    if (isBlocked) return;
    onPress();
  };

  return (
    <View
      height={BUTTON_HEIGHT}
      marginTop={MARGIN_TOP[marginTop]}
      opacity={isBlocked ? 0.5 : 1}
      pointerEvents={isBlocked ? "none" : "auto"}
    >
      <AppleAuthentication.AppleAuthenticationButton
        // "Continue with Apple" — keeps the copy identical to the Google
        // button beside it, and to what this screen shipped before.
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        // V2 is dark-only (locked decision #6), and white-on-dark is Apple's
        // prescribed pairing. If a light theme ever ships, this has to become
        // BLACK on light — a white button on a white background is a
        // Guideline 4 failure in its own right.
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
        cornerRadius={radius.$lg}
        style={styles.button}
        onPress={handlePress}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Apple's button needs explicit width AND height or it does not appear.
  button: { width: "100%", height: BUTTON_HEIGHT },
});
