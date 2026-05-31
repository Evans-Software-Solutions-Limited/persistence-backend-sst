import { Text, View } from "@tamagui/core";
import type { ComponentType } from "react";
import { Pressable } from "react-native";

/**
 * <TabBar> — bottom tab bar, accent recolours the active state.
 * Ports ~/Downloads/handoff/design-source/tab-bar.jsx:4-83.
 * Implements 01-design-system/design.md § Foundation primitives #10 +
 * STORY-003 AC 3.8.
 *
 * This PR ships the prop-driven primitive only. The navigation tree, the
 * useUserMode slice, safe-area-inset composition, and deep-link redirects are
 * owned by 14-navigation (per requirements.md Out-of-scope).
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

// Concrete accent colours per mode (active tint + glow shadow colour).
const ACCENT = {
  athlete: { color: "$primary", glow: "rgba(34,211,238,0.22)" },
  coach: { color: "$accentTrainer", glow: "rgba(167,139,250,0.22)" },
} as const;

const INACTIVE = "#8A8A98"; // $text3 — icons take a concrete colour string.
const ACTIVE_HEX = { athlete: "#22D3EE", coach: "#A78BFA" } as const;

function TabBtn({
  tab,
  active,
  onPress,
  mode,
}: {
  tab: TabSpec;
  active: boolean;
  onPress: () => void;
  mode: TabBarMode;
}) {
  const Icon = tab.icon;
  const accent = ACCENT[mode];
  const iconColor = active ? ACTIVE_HEX[mode] : INACTIVE;

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
          <View
            testID={`tabbar-tab-${tab.id}-pill`}
            position="absolute"
            top={4}
            width={30}
            height={4}
            borderRadius={2}
            backgroundColor={accent.color}
            style={{
              shadowColor: accent.glow,
              shadowOpacity: 1,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 0 },
            }}
          />
        ) : null}

        <View marginTop={4} flexDirection="row">
          <Icon size={22} color={iconColor} strokeWidth={active ? 2 : 1.75} />
        </View>

        <Text
          fontFamily="$display"
          fontSize={10}
          letterSpacing={0.2}
          fontWeight={active ? "600" : "500"}
          color={active ? accent.color : "$text3"}
        >
          {tab.label}
        </Text>

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
        />
      ))}
    </View>
  );
}
