import { Text, View } from "@tamagui/core";
import type { ComponentType } from "react";
import { useEffect } from "react";
import { Pressable } from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

/**
 * <TabBar> — bottom tab bar, accent recolours the active state.
 * Ports ~/Downloads/handoff/design-source/tab-bar.jsx:4-83.
 * Implements 01-design-system/design.md § Foundation primitives #10 +
 * STORY-003 AC 3.8.
 *
 * Revised 2026-05-31 (14-navigation Phase 14.6, T-14.6.2): the active-tab
 * accent (pill + label + icon) now ANIMATES between $primary (athlete) and
 * $accentTrainer (coach) over 200ms (cubic-bezier 0.2,0.7,0.2,1) when `mode`
 * changes, rather than swapping instantly. Honours the OS reduce-motion
 * setting (jumps to the final colour). See
 * 01-design-system/design.md § "10. <TabBar>" Revised 2026-05-31.
 */

/** Minimal shape of a Lucide icon component (size/color/strokeWidth props). */
export type TabBarIcon = ComponentType<{
  size?: number;
  color?: string;
  strokeWidth?: number;
}>;

export type TabSpec = {
  id: string;
  icon: TabBarIcon;
  label: string;
  badge?: string;
};

export type TabBarMode = "athlete" | "coach";

export type TabBarProps = {
  /** 3-5 tabs. */
  tabs: TabSpec[];
  active: string;
  onChange: (id: string) => void;
  mode?: TabBarMode;
  testID?: string;
};

// Concrete accent colours per mode (active tint). Animated consumers
// (Animated.View / Animated.Text) can't resolve Tamagui `$tokens`, so the
// interpolation runs over the resolved hex values.
const ACCENT_HEX = { athlete: "#22D3EE", coach: "#A78BFA" } as const;
const ACCENT_GLOW = {
  athlete: "rgba(34,211,238,0.22)",
  coach: "rgba(167,139,250,0.22)",
} as const;
const INACTIVE = "#8A8A98"; // $text3 — icons take a concrete colour string.

// 0 = athlete, 1 = coach. The shared value animates between them so every
// active-tab accent interpolation reads a single driver.
const MODE_PROGRESS = { athlete: 0, coach: 1 } as const;
const ACCENT_DURATION_MS = 200;

const AnimatedText = Animated.Text;

function TabBtn({
  tab,
  active,
  onPress,
  mode,
  progress,
}: {
  tab: TabSpec;
  active: boolean;
  onPress: () => void;
  mode: TabBarMode;
  /** Shared value: 0 (athlete) → 1 (coach). */
  progress: { value: number };
}) {
  const Icon = tab.icon;
  // Icon glyph colour is a direct mode swap (the spec animates the pill +
  // label; the icon recolours with the mode). Inactive icons stay $text3.
  const iconColor = active ? ACCENT_HEX[mode] : INACTIVE;

  // Active-tab accent interpolations (athlete cyan → coach violet). Inactive
  // tabs stay $text3 and don't animate.
  const pillStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [ACCENT_HEX.athlete, ACCENT_HEX.coach],
    ),
    shadowColor: interpolateColor(
      progress.value,
      [0, 1],
      [ACCENT_GLOW.athlete, ACCENT_GLOW.coach],
    ),
  }));

  const labelStyle = useAnimatedStyle(() => ({
    color: active
      ? interpolateColor(
          progress.value,
          [0, 1],
          [ACCENT_HEX.athlete, ACCENT_HEX.coach],
        )
      : INACTIVE,
  }));

  return (
    <Pressable
      testID={`tabbar-tab-${tab.id}`}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={tab.label}
      style={{ flex: 1 }}
    >
      <View
        alignItems="center"
        justifyContent="center"
        gap={3}
        paddingTop={8}
        paddingBottom={6}
        paddingHorizontal={4}
        borderRadius={16}
        position="relative"
        minHeight={44}
      >
        {active ? (
          <Animated.View
            testID={`tabbar-tab-${tab.id}-pill`}
            style={[
              {
                position: "absolute",
                top: 4,
                width: 30,
                height: 4,
                borderRadius: 2,
                shadowOpacity: 1,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 0 },
              },
              pillStyle,
            ]}
          />
        ) : null}

        <View marginTop={4} flexDirection="row">
          <Icon size={22} color={iconColor} strokeWidth={active ? 2 : 1.75} />
        </View>

        <AnimatedText
          style={[
            {
              fontFamily: "Geist",
              fontSize: 10,
              letterSpacing: 0.2,
              fontWeight: active ? "600" : "500",
            },
            labelStyle,
          ]}
        >
          {tab.label}
        </AnimatedText>

        {tab.badge ? (
          <View
            testID={`tabbar-tab-${tab.id}-badge`}
            position="absolute"
            top={6}
            right="50%"
            marginRight={-22}
            backgroundColor="$ember"
            borderRadius={4}
            paddingVertical={1}
            paddingHorizontal={5}
            minWidth={16}
            alignItems="center"
          >
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={9}
              color="$bg"
            >
              {tab.badge}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export function TabBar({
  tabs,
  active,
  onChange,
  mode = "athlete",
  testID,
}: TabBarProps) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(MODE_PROGRESS[mode]);

  // Animate the accent driver when the mode flips (cyan ↔ violet, 200ms). On
  // reduce-motion, jump straight to the target so the colour is correct
  // without the transition. Closes 14-navigation STORY-003 AC 3.7.
  useEffect(() => {
    const target = MODE_PROGRESS[mode];
    if (reduceMotion) {
      progress.value = target;
      return;
    }
    progress.value = withTiming(target, {
      duration: ACCENT_DURATION_MS,
      easing: Easing.bezier(0.2, 0.7, 0.2, 1),
    });
  }, [mode, reduceMotion, progress]);

  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      flexDirection="row"
      alignItems="center"
      justifyContent="space-around"
      marginHorizontal={12}
      paddingVertical={8}
      paddingHorizontal={4}
      borderRadius={22}
      backgroundColor="rgba(18,20,29,0.86)"
      borderColor="$border2"
      borderWidth={1}
      position="relative"
      style={{
        shadowColor: "rgba(0,0,0,0.6)",
        shadowOpacity: 1,
        shadowRadius: 32,
        shadowOffset: { width: 0, height: 8 },
      }}
    >
      {mode === "coach" ? (
        <View
          testID="tabbar-coach-dot"
          position="absolute"
          top={-10}
          left="50%"
          marginLeft={-22}
          backgroundColor="$accentTrainer"
          borderRadius={6}
          paddingVertical={3}
          paddingHorizontal={8}
        >
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={9.5}
            letterSpacing={1.5}
            color="$accentTrainerInk"
          >
            COACH
          </Text>
        </View>
      ) : null}

      {tabs.map((tab) => (
        <TabBtn
          key={tab.id}
          tab={tab}
          active={active === tab.id}
          onPress={() => onChange(tab.id)}
          mode={mode}
          progress={progress}
        />
      ))}
    </View>
  );
}
