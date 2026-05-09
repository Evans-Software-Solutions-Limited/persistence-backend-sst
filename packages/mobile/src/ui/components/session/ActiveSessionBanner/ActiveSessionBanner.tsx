/**
 * Global ActiveSessionBanner — bottom-of-screen "session in progress"
 * affordance, ported 1:1 from
 * `persistence-mobile/components/workouts/ActiveWorkoutBanner` (the
 * `ActiveWorkoutGlobalBanner` variant). Tap → re-enters the active
 * session screen.
 *
 * Mounted in `(app)/_layout.tsx` alongside `useSyncWorker`. Visible
 * whenever an in-progress session exists in the local cache AND the
 * user is NOT already on the session screen — otherwise the banner
 * would stack on top of itself. Tap → return to the session.
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
import { SafeAreaView } from "react-native-safe-area-context";
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
 * itself (would stack with the screen's footer).
 */
export function ActiveSessionBanner(props: ActiveSessionBannerProps = {}) {
  const { storage } = useAdapters();
  const { session: authSession } = useAuth();
  const userId = authSession?.userId ?? null;

  const segments = useSegments();
  const isOnSessionScreen = useMemo(
    () =>
      // Expo Router segments include intermediate group names; check
      // any segment for "session" so /(app)/session and
      // /(app)/session/summary both hide the banner.
      Array.isArray(segments) && segments.some((s) => s === "session"),
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
  useEffect(() => {
    if (!session || isOnSessionScreen) return;
    Animated.timing(translateY, {
      toValue: 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [session, isOnSessionScreen, translateY]);

  if (!session || isOnSessionScreen) return null;

  const onPress = () => {
    router.push(`/(app)/session?sessionId=${session.id}` as never);
  };

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

// Geometry + colours match legacy ActiveWorkoutGlobalBanner.
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
