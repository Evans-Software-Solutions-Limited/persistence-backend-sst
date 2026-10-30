import type { ReactNode } from "react";
import { Pressable, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, ScreenGlow } from "@/ui/components/foundation";
import { IconChevronR } from "@/ui/components/icons";
import { TogetherAudienceSegment } from "./TogetherAudienceSegment";
import { TogetherBackButton } from "./TogetherBackButton";
import { TogetherEyebrow } from "./TogetherEyebrow";
import { TogetherSwitch } from "./TogetherSwitch";
import type { TogetherLobbyAudience } from "@/domain/ports/togetherLobby.port";
import type { TogetherSharingDefaults } from "@/state/together-settings";
import { color } from "@/ui/theme/tokens";
import { tint } from "@/ui/theme/tint";
import {
  TogetherSharingRefused,
  TogetherSharingRows,
} from "./TogetherSharingPresenter";
import type { SharingChange, TogetherSharingState } from "./togetherSharing";

/**
 * Canvas row 4 "Together settings": what every new session starts with, and
 * while a session is live (phone 4), a card above the defaults for that
 * session only.
 */
export function TogetherSettingsPresenter(p: {
  /** The session running now; its switches write to it, not to the defaults. */
  live?: {
    title: string;
    state: TogetherSharingState;
    onChange(change: SharingChange): void;
  } | null;
  audience: TogetherLobbyAudience;
  onAudience(value: TogetherLobbyAudience): void;
  sharing: TogetherSharingDefaults;
  onSharing(key: keyof TogetherSharingDefaults, value: boolean): void;
  /** null while the profile is loading or unavailable. */
  discoverable: boolean | null;
  onDiscoverable(value: boolean): void;
  partnersCount: number | null;
  blockedCount: number | null;
  onPartners(): void;
  onBlocked(): void;
  busy?: boolean;
  notice?: string;
  onBack(): void;
}) {
  const insets = useSafeAreaInsets();
  const row = (
    title: string,
    detail: string | undefined,
    trailing: ReactNode,
    first: boolean,
    onPress?: () => void,
    label?: string,
  ) => {
    const body = (
      <View
        flexDirection="row"
        alignItems="center"
        gap={12}
        paddingVertical={12}
        borderTopWidth={first ? 0 : 1}
        borderColor="$border"
      >
        <View flex={1} gap={2}>
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={14}
            lineHeight={18}
            color="$text"
          >
            {title}
          </Text>
          {!!detail && (
            <Text
              fontFamily="$body"
              fontSize={12}
              lineHeight={17}
              color="$text3"
            >
              {detail}
            </Text>
          )}
        </View>
        {trailing}
      </View>
    );
    return onPress ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label ?? title}
        onPress={onPress}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      >
        {body}
      </Pressable>
    ) : (
      body
    );
  };
  const toggle = (
    label: string,
    value: boolean,
    onChange: (value: boolean) => void,
  ) => (
    <TogetherSwitch
      accessibilityLabel={label}
      value={value}
      disabled={p.busy}
      onValueChange={onChange}
    />
  );
  const count = (n: number | null) => (
    <Text fontFamily="$body" fontSize={12} lineHeight={17} color="$text3">
      {n === null ? "…" : String(n)}
    </Text>
  );
  const chevron = <IconChevronR size={16} color={color.$text3} />;
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID="together-settings"
    >
      <ScreenGlow />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 0,
          paddingBottom: insets.bottom + 30,
          gap: 14,
        }}
      >
        <TogetherBackButton onPress={p.onBack} />
        <View gap={4}>
          <TogetherEyebrow>Train together</TogetherEyebrow>
          <Text
            fontFamily="$display"
            fontWeight="800"
            fontSize={32}
            lineHeight={38}
            letterSpacing={-1}
            color="$text"
          >
            Settings
          </Text>
        </View>
        {p.live && (
          <View gap={8} testID="together-settings-live">
            <View
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
              gap={12}
            >
              <Text
                fontFamily="$display"
                fontWeight="600"
                fontSize={10.5}
                lineHeight={14}
                letterSpacing={1.7}
                color="$primary"
                flexShrink={1}
                numberOfLines={1}
              >
                {`NOW · ${p.live.title.toUpperCase()}`}
              </Text>
              <Text
                fontFamily="$body"
                fontSize={12}
                lineHeight={17}
                color="$text3"
              >
                Ends with the session
              </Text>
            </View>
            <View
              backgroundColor="$surface"
              borderRadius={14}
              borderWidth={1}
              paddingHorizontal={14}
              paddingVertical={4}
              style={{ borderColor: tint(color.$primary, 0.35) }}
            >
              <TogetherSharingRows
                state={p.live.state}
                onChange={p.live.onChange}
                variant="card"
              />
            </View>
            {p.live.state.refused && (
              <TogetherSharingRefused refusal={p.live.state.refused} />
            )}
          </View>
        )}
        <View gap={8}>
          <TogetherEyebrow>Every new session starts with</TogetherEyebrow>
          <TogetherAudienceSegment
            value={p.audience}
            online={false}
            onChange={p.onAudience}
            copy={false}
            accessibilityLabel="Default who can join"
          />
          <Card surface={0} padX={14} padY={4}>
            {row(
              "Show my numbers",
              undefined,
              toggle("Default: show my numbers", p.sharing.numbers, (v) =>
                p.onSharing("numbers", v),
              ),
              true,
            )}
            {row(
              "Share previous values",
              "With everyone in the session",
              toggle(
                "Default: share previous values",
                p.sharing.previous,
                (v) => p.onSharing("previous", v),
              ),
              false,
            )}
            {row(
              "Let others fill in my sets",
              undefined,
              toggle(
                "Default: let others fill in my sets",
                p.sharing.logging,
                (v) => p.onSharing("logging", v),
              ),
              false,
            )}
          </Card>
        </View>
        <Card surface={0} padX={14} padY={4}>
          {row(
            "Let people find me by name",
            p.discoverable === null
              ? "Your code and QR work either way."
              : `${p.discoverable ? "On" : "Off"}. Your code and QR work either way.`,
            p.discoverable === null
              ? count(null)
              : toggle(
                  "Let people find me by name",
                  p.discoverable,
                  p.onDiscoverable,
                ),
            true,
          )}
          {row(
            "Training partners",
            undefined,
            <>
              {count(p.partnersCount)}
              {chevron}
            </>,
            false,
            p.onPartners,
          )}
          {row(
            "Blocked people",
            undefined,
            <>
              {count(p.blockedCount)}
              {chevron}
            </>,
            false,
            p.onBlocked,
          )}
        </Card>
        {!!p.notice && (
          <Text
            fontFamily="$body"
            fontSize={12}
            lineHeight={17}
            color="$warning"
            accessibilityRole="alert"
          >
            {p.notice}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}
