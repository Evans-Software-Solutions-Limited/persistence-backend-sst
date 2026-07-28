import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, radius, space } from "@/ui/theme/tokens";

/**
 * <LoadoutScaffold> — the chrome every Loadout step shares: a back/close header,
 * a scrolling body, and an optional pinned footer.
 *
 * Extracted because the five steps are the same screen with different middles,
 * and the footer's safe-area padding is the kind of thing that gets fixed on one
 * step and forgotten on the other four.
 *
 * ## ⚠ Insets come from `useSafeAreaInsets()`, NOT from `<SafeAreaView>`
 *
 * This looks like a step backwards and is the fix for a device bug. Brad's run
 * showed the header rendered flush against the status bar, its title overlapping
 * the clock — on the same component that had been correctly inset a run earlier.
 *
 * `SafeAreaView` from `react-native-safe-area-context` is a purely NATIVE view
 * (`specs/NativeSafeAreaView`). It measures its own window and **never reads
 * `SafeAreaInsetsContext`** — so a `SafeAreaProvider` cannot correct it. That is
 * fine on an ordinary screen, and wrong here: this flow is a
 * `presentation: "fullScreenModal"` route, which react-native-screens presents
 * as its own view controller, and the native measurement inside it came back
 * zero. Intermittently, which is the signature of a measurement race rather than
 * a missing inset.
 *
 * `useSafeAreaInsets()` reads the context instead, and the route seeds a
 * `SafeAreaProvider` with `initialWindowMetrics` — so the values are the
 * window's, correct on the first frame, with nothing to measure and nothing to
 * race. See `app/(app)/loadout.tsx` for why that provider is scoped to the route
 * rather than added at the app root.
 *
 * ⚠ It therefore THROWS if this scaffold is ever rendered outside that provider,
 * and that is deliberate — a silent `?? 0` fallback is precisely the failure
 * being fixed. `renderWithTheme` supplies one for tests.
 *
 * ⚠ The bottom inset is not optional. The route covers the tab bar, so nothing
 * below is reserving home-indicator space — without it the primary CTA sits
 * under the indicator on every notchless-bottom iPhone.
 */

export type LoadoutScaffoldProps = {
  readonly title: string;
  readonly eyebrow?: string;
  /** Omit for a step with no way back (the success screen). */
  readonly onBack?: () => void;
  /** `close` renders an ✕ instead of an arrow — used where back would be ambiguous. */
  readonly backIcon?: "arrow" | "close";
  readonly backLabel?: string;
  readonly trailing?: ReactNode;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  readonly testID?: string;
};

export function LoadoutScaffold({
  title,
  eyebrow,
  onBack,
  backIcon = "arrow",
  backLabel = "Back",
  trailing,
  footer,
  children,
  testID,
}: LoadoutScaffoldProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
      testID={testID}
    >
      <View style={styles.header}>
        {onBack ? (
          <TouchableOpacity
            onPress={onBack}
            style={styles.iconButton}
            testID={`${testID ?? "loadout"}-back`}
            accessibilityRole="button"
            accessibilityLabel={backLabel}
            hitSlop={8}
          >
            <Ionicons
              name={backIcon === "close" ? "close" : "arrow-back"}
              size={22}
              color={color.$text}
            />
          </TouchableOpacity>
        ) : (
          <View style={styles.iconButton} />
        )}
        <View style={styles.headerTitles}>
          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <View style={styles.trailing}>{trailing}</View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>

      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.$bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.$base,
    paddingVertical: space.$md,
    gap: space.$sm,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: radius.$md,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitles: { flex: 1 },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.1,
    fontWeight: "700",
    color: color.$primary,
  },
  title: { fontSize: 17, fontWeight: "700", color: color.$text },
  trailing: { minWidth: 36, alignItems: "flex-end" },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: space.$base,
    paddingBottom: space.$2xl,
    gap: space.$base,
  },
  footer: {
    flexDirection: "row",
    gap: space.$sm,
    paddingHorizontal: space.$base,
    paddingTop: space.$md,
    paddingBottom: space.$sm,
    borderTopWidth: 1,
    borderTopColor: color.$border,
    backgroundColor: color.$surface,
  },
});
