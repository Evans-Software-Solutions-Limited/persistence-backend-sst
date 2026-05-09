/**
 * ActiveSessionBanner — "session in progress" affordance ported 1:1
 * from `persistence-mobile/components/workouts/ActiveWorkoutBanner`.
 *
 * Two variants split exactly the way legacy did:
 *
 *  - `global` (default): `position: absolute, bottom: 0`. Mounted
 *    once in `(app)/_layout.tsx`. Renders only when we're NOT inside
 *    `(tabs)` (the tabs variant takes over there) AND not in
 *    `(auth)` (legacy `isInAuthLayout` check). Slide-up entry.
 *
 *  - `tabs`: in-flow style, mounted inside `(app)/(tabs)/_layout.tsx`
 *    above the tab bar. Floats at `bottom: tabBarHeight` so the tab
 *    bar's own safe-area inset is preserved — no SafeAreaView on the
 *    banner itself. No entry animation: the banner's mount lifecycle
 *    matches the tabs layout's, so it's there from first render.
 *
 * Both variants hide while on the session screen itself (would stack
 * on top of the screen's footer buttons).
 *
 * Spec: persistence-mobile/components/workouts/ActiveWorkoutBanner
 *       specs/05-active-session/requirements.md STORY-005
 */

import { Ionicons } from "@expo/vector-icons";
import { router, useSegments } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import type { WorkoutSession } from "@/domain/models/session";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { Spacing, Typography } from "@/ui/theme/workoutsLegacyTheme";
import { colorPalette } from "@/ui/theme/tokens";

const formatElapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export type ActiveSessionBannerProps = {
  /**
   * `global` (default): absolute-positioned at `bottom: 0`, mounted
   * in `(app)/_layout.tsx` for non-tabs surfaces. `tabs`: floats
   * just above the tab bar, mounted inside `(tabs)/_layout.tsx`.
   */
  variant?: "global" | "tabs";
  /** Test seam — fixed clock for jest. */
  clock?: () => number;
  /**
   * Test seam — bypass the AdapterProvider lookup so the banner can
   * be rendered in isolation.
   */
  sessionOverride?: WorkoutSession | null;
};

/**
 * Reads the active session from SQLite on mount + on focus / route
 * changes. Uses `useSegments` to hide while on the session screen
 * itself (would stack with the screen's footer) and to keep the
 * `global` variant out of `(tabs)` and `(auth)` segments — the tabs
 * variant covers (tabs), and (auth) shouldn't surface a workout-in-
 * progress affordance on the sign-in flow.
 */
export function ActiveSessionBanner(props: ActiveSessionBannerProps = {}) {
  const variant = props.variant ?? "global";
  const { storage } = useAdapters();
  const { session: authSession } = useAuth();
  const userId = authSession?.userId ?? null;
  const insets = useSafeAreaInsets();

  const segments = useSegments();
  const isOnSessionScreen = useMemo(
    () =>
      // Expo Router segments include intermediate group names; check
      // any segment for "session" so /(app)/session and
      // /(app)/session/summary both hide the banner.
      Array.isArray(segments) && segments.some((s) => s === "session"),
    [segments],
  );
  const isInTabsLayout = useMemo(
    () => Array.isArray(segments) && segments.includes("(tabs)"),
    [segments],
  );
  const isInAuthLayout = useMemo(
    () => Array.isArray(segments) && segments.includes("(auth)"),
    [segments],
  );

  // Re-read the cache on every segments change (cheap synchronous
  // SQLite read) — covers the case where the user finishes a session
  // and routes back to a tab; the banner needs to disappear without
  // a separate notify channel.
  const [session, setSession] = useState<WorkoutSession | null>(
    props.sessionOverride ?? null,
  );
  useEffect(() => {
    if (props.sessionOverride !== undefined) {
      setSession(props.sessionOverride);
      return;
    }
    if (!userId) {
      setSession(null);
      return;
    }
    setSession(storage.getActiveSession(userId));
  }, [storage, userId, segments, props.sessionOverride]);

  const clock = props.clock ?? (() => Date.now());
  const startedAtMs = session ? Date.parse(session.startedAt) : NaN;
  const computeElapsed = () =>
    Number.isFinite(startedAtMs) ? Math.max(0, clock() - startedAtMs) : 0;
  const [elapsedMs, setElapsedMs] = useState(computeElapsed);

  useEffect(() => {
    if (!session) return;
    setElapsedMs(computeElapsed());
    const id = setInterval(() => setElapsedMs(computeElapsed()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.startedAt]);

  const translateY = useRef(new Animated.Value(24)).current;
  // Only the global variant slides in; the tabs variant is mounted
  // inside the tabs layout and is there from first frame, so the
  // animation is unwanted (and would also conflict with tab transitions).
  useEffect(() => {
    if (!session || isOnSessionScreen) return;
    if (variant !== "global") return;
    Animated.timing(translateY, {
      toValue: 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [session, isOnSessionScreen, variant, translateY]);

  // Visibility gate. The tabs variant only mounts inside (tabs); it
  // doesn't need an extra `isInTabsLayout` check. The global variant
  // hides on (tabs) AND (auth) so it never overlaps the tabs banner
  // and doesn't surface during sign-in.
  if (!session || isOnSessionScreen) return null;
  if (variant === "global" && (isInTabsLayout || isInAuthLayout)) return null;

  const onPress = () => {
    router.push(`/(app)/session?sessionId=${session.id}` as never);
  };

  if (variant === "tabs") {
    // Tab-bar height mirrors `(tabs)/_layout.tsx` (60 + insets.bottom).
    // Floating just above it keeps the tab bar's hit-area intact.
    const tabBarHeight = 60 + insets.bottom;
    return (
      <View style={[styles.tabsContainer, { bottom: tabBarHeight }]}>
        <Pressable
          onPress={onPress}
          style={styles.tabsRow}
          testID="active-session-banner"
        >
          <View style={styles.leftSection}>
            <Ionicons name="stopwatch-outline" size={20} color="#fff" />
            <Text style={styles.time}>{formatElapsed(elapsedMs)}</Text>
          </View>
          <View style={styles.centerSection}>
            <Text
              style={styles.title}
              numberOfLines={1}
              ellipsizeMode="tail"
              testID="active-session-banner-title"
            >
              {session.name || "Active Workout"}
            </Text>
          </View>
          <Ionicons name="chevron-up" size={18} color="#fff" />
        </Pressable>
      </View>
    );
  }

  return (
    <Animated.View
      style={[styles.globalContainer, { transform: [{ translateY }] }]}
      pointerEvents="box-none"
    >
      <SafeAreaView edges={["bottom"]} style={styles.globalSafeArea}>
        <Pressable
          onPress={onPress}
          style={styles.row}
          testID="active-session-banner"
        >
          <View style={styles.leftSection}>
            <Ionicons name="stopwatch-outline" size={20} color="#fff" />
            <Text style={styles.time}>{formatElapsed(elapsedMs)}</Text>
          </View>
          <View style={styles.centerSection}>
            <Text
              style={styles.title}
              numberOfLines={1}
              ellipsizeMode="tail"
              testID="active-session-banner-title"
            >
              {session.name || "Active Workout"}
            </Text>
          </View>
          <Ionicons name="chevron-up" size={18} color="#fff" />
        </Pressable>
      </SafeAreaView>
    </Animated.View>
  );
}

// Geometry + colours match legacy ActiveWorkoutBanner. `globalContainer`
// mirrors `globalContainer` (full-width, bottom: 0, slide-up); `tabsContainer`
// mirrors `tabsBanner` (height 56, sits above the tab bar via dynamic
// `bottom: tabBarHeight`).
const styles = StyleSheet.create({
  globalContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colorPalette.primary800,
    borderTopWidth: 1,
    borderTopColor: colorPalette.primary700,
    zIndex: 1000,
    shadowColor: colorPalette.primary500,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 10,
  },
  globalSafeArea: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    minHeight: 72,
    justifyContent: "flex-start",
  },
  tabsContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: colorPalette.primary800,
    borderTopWidth: 1,
    borderTopColor: colorPalette.primary700,
    height: 56,
    zIndex: 1000,
    shadowColor: colorPalette.primary500,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 10,
  },
  tabsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flex: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flex: 1,
    width: "100%",
  },
  leftSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  centerSection: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  time: {
    ...Typography.body2,
    color: "#fff",
    fontWeight: "600",
  },
  title: {
    ...Typography.body2,
    color: "#fff",
    fontWeight: "600",
  },
});
