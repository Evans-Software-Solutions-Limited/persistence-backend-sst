import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { color, radius, space } from "@/ui/theme/tokens";

/**
 * <LoadoutScaffold> — the chrome every Loadout step shares: a back/close header,
 * a scrolling body, and an optional pinned footer.
 *
 * Extracted because the five steps are the same screen with different middles,
 * and the footer's safe-area padding is the kind of thing that gets fixed on one
 * step and forgotten on the other four.
 *
 * ⚠ `edges` deliberately includes `bottom`. The flow is a `fullScreenModal`
 * route that covers the tab bar, so nothing below it is reserving
 * home-indicator space — without the bottom edge the primary CTA sits under the
 * indicator on every notchless-bottom iPhone.
 *
 * ⚠ This is `SafeAreaView` from `react-native-safe-area-context`, not the RN
 * core one, and the distinction matters here: the app mounts NO
 * `SafeAreaProvider`, so anything reading `SafeAreaInsetsContext` gets zeros
 * (see the fallback `BottomSheet.tsx` documents). The context version's
 * `SafeAreaView` is a native view that measures the window itself, so it is
 * correct without a provider — swapping it for a `useSafeAreaInsets()` +
 * `paddingTop` idiom would silently give every Loadout step a zero inset.
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
  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID={testID}>
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
    </SafeAreaView>
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
