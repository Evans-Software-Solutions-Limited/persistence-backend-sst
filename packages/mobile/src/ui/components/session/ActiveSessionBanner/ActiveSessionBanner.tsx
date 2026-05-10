/**
 * ActiveSessionBanner — single banner mounted once in `(app)/_layout.tsx`.
 *
 * Visually faithful to legacy `persistence-mobile/components/workouts/
 * ActiveWorkoutBanner` — same colors, content, and per-context dimensions
 * (compact 56pt above the tab bar; ~72pt + bottom safe area on detail
 * screens). Internally collapsed to one component to avoid the two-banner
 * overlap legacy had during back-pop transitions: when both `global`
 * (mounted in `(app)`) and `tabs` (mounted in `(tabs)`) were rendered,
 * `useSegments()` lagged behind the gesture and both banners briefly
 * co-existed mid-swipe.
 *
 * Position is computed from `useSegments()` and animated between
 * `bottom: 0` (detail screens) and `bottom: tabBarHeight` (tab screens)
 * via a 180ms ease-out so the post-gesture settle feels intentional
 * rather than a snap. Hidden entirely on the active-session modal and
 * during `(auth)`.
 *
 * Spec: persistence-mobile/components/workouts/ActiveWorkoutBanner
 *       specs/05-active-session/requirements.md STORY-005
 */

import { Ionicons } from "@expo/vector-icons";
import { router, useSegments } from "expo-router";
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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

export function ActiveSessionBanner(props: ActiveSessionBannerProps) {
  const { storage } = useAdapters();
  const { session: authSession } = useAuth();
  const userId = authSession?.userId ?? null;
  const insets = useSafeAreaInsets();

  // `useSegments` is typed against the typed-routes tuple by default,
  // which narrows literal `.includes()` checks to `never` for group
  // segments like `(auth)`. Widen to plain `string[]` so the runtime
  // checks below typecheck.
  const segments = useSegments() as readonly string[];
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

  // Tab-bar height mirrors `(tabs)/_layout.tsx` (60 + insets.bottom).
  const tabBarHeight = 60 + insets.bottom;
  const targetBottom = isInTabsLayout ? tabBarHeight : 0;

  // Lazy initializer reads from SQLite synchronously on mount so the
  // first render already has the right state — no useEffect lag where
  // session=null until the next frame. Subsequent reads are handled
  // by the segments-change effect below.
  const [session, setSession] = useState<WorkoutSession | null>(() => {
    if (props.sessionOverride !== undefined)
      return props.sessionOverride ?? null;
    if (!userId) return null;
    return storage.getActiveSession(userId);
  });
  useEffect(() => {
    if (props.sessionOverride !== undefined) {
      setSession(props.sessionOverride ?? null);
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

  // Animate `bottom` between 0 and tabBarHeight when segments change
  // *while the banner is visible*. While hidden (session screen / auth /
  // no session), the animation must not run — otherwise `animatedBottom`
  // tracks `targetBottom` to whatever the hidden segments imply (often
  // 0), and on visibility-restore the banner re-appears at the stale
  // value for one frame before sliding to the correct spot. Track the
  // previous visibility in a ref and snap (no animation) on the
  // hidden→visible transition; only run the timing animation for
  // visible→visible position changes (e.g. tabs → detail).
  //
  // `useLayoutEffect` (not `useEffect`) so the snap runs *between*
  // commit and paint — without that, the first frame after a
  // hidden→visible transition paints the stale `animatedBottom` value
  // and only corrects on the next frame. Same effect for the start of
  // the timing animation: it kicks off in the same frame the user
  // already sees, so visible→visible navigation feels immediately
  // active rather than a frame behind.
  //
  // `useNativeDriver: false` because `bottom` is a layout prop — for a
  // 180ms one-shot per navigation event the JS-thread cost is fine.
  // The cleanup stops the animation on unmount / before the next run;
  // without it an in-flight JS-thread animation can outlive its host
  // (test teardown, fast nav) and re-touch state after the surrounding
  // environment is gone — surfaces in jest as "ReferenceError: ...
  // environment torn down".
  const isHidden = !session || isOnSessionScreen || isInAuthLayout;
  const animatedBottom = useRef(new Animated.Value(targetBottom)).current;
  const wasHiddenRef = useRef(false);
  useLayoutEffect(() => {
    if (isHidden) {
      wasHiddenRef.current = true;
      return;
    }
    if (wasHiddenRef.current) {
      wasHiddenRef.current = false;
      animatedBottom.setValue(targetBottom);
      return;
    }
    const animation = Animated.timing(animatedBottom, {
      toValue: targetBottom,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [isHidden, targetBottom, animatedBottom]);

  if (isHidden) return null;

  const onPress = () => {
    router.push(`/(app)/session?sessionId=${session.id}` as never);
  };

  // Style switches between "compact" (in tabs, 56pt above the tab bar)
  // and "tall" (detail screens, sits at bottom 0 with bottom safe area
  // padding so the home indicator is clear). Both share the same chrome
  // (bg, border, shadow) — only height + padding differ.
  const isCompact = isInTabsLayout;
  const containerStyle = isCompact
    ? styles.containerCompact
    : [styles.containerTall, { paddingBottom: insets.bottom + Spacing.md }];

  return (
    <Animated.View
      style={[styles.container, containerStyle, { bottom: animatedBottom }]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={onPress}
        style={isCompact ? styles.rowCompact : styles.rowTall}
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
    </Animated.View>
  );
}

// Geometry + colours match legacy ActiveWorkoutBanner. `containerCompact`
// mirrors the legacy `tabsBanner` (height 56, paddingVertical sm).
// `containerTall` mirrors `globalContainer` + `globalSafeArea` collapsed
// (minHeight 72, paddingTop md, with bottom safe-area padding applied
// inline at render so it tracks the device insets).
const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
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
  containerCompact: {
    height: 56,
  },
  containerTall: {
    minHeight: 72,
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  rowCompact: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flex: 1,
  },
  rowTall: {
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
