import { useEffect, type RefObject } from "react";
import { useNavigation } from "expo-router";
import type { ScrollView } from "react-native";

/**
 * Scroll a tab screen's ScrollView back to the top whenever its tab is pressed
 * in the tab bar — both re-tapping the focused tab and switching to it from
 * another tab (a "good app experience" expectation; tab screens otherwise keep
 * their last scroll offset because react-native-screens keeps them mounted).
 *
 * The custom <NavTabBar> emits a cancellable `tabPress` to the pressed tab's
 * route key before navigating (app/(app)/(tabs)/_layout.tsx), so the pressed
 * screen receives the event even when it isn't focused yet — which is what lets
 * a tab *switch* reset to the top, not just a re-tap.
 *
 * Called from the CONTAINER (which owns the ref); the pure presenter just
 * attaches the forwarded ref to its ScrollView.
 */
export function useScrollToTopOnTabPress(
  ref: RefObject<ScrollView | null>,
): void {
  const navigation = useNavigation();
  useEffect(() => {
    // `tabPress` isn't in the base navigation event map's types (it's a
    // bottom-tabs event), but the tab navigator emits it — listen by name.
    const unsubscribe = navigation.addListener(
      "tabPress" as never,
      (() => {
        ref.current?.scrollTo({ y: 0, animated: true });
      }) as never,
    );
    return unsubscribe;
  }, [navigation, ref]);
}
