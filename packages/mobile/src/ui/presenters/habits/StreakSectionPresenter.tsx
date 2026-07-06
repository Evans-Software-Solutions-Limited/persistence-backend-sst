import { Text, View } from "@tamagui/core";
import { Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { Card } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconFire } from "@/ui/components/icons";

// Freeze tokens use the prototype's `--info` blue, a distinct accent from the
// app's cyan `$primary`. The design-system token surface defines `$info` (base)
// only, so base usages take the `$info` token and the dim/soft treatments here
// use literal rgba at the prototype's alphas (dim ≈ 0.10, soft-fill ≈ 0.14) —
// rgba, not hex, so no token is invented. Kept local to this presenter.
const INFO_TOKEN = "$info";
const INFO_DIM = "rgba(96,165,250,0.10)";
const INFO_SOFT = "rgba(96,165,250,0.14)";
// The ink colour on a filled info button — matches `$bg` (the app background),
// passed as a concrete value to a Tamagui Text `color` prop.
const INFO_INK = "$bg";

/**
 * <StreakSectionPresenter> — the COLLECTION streak hero + freeze tokens on the
 * habit-setup screen (18-habit-setup, Phase 18.7 — T-18.7.7). Pure port of the
 * prototype `StreakSection` (~/Downloads/habit_design/habit-setup.jsx +
 * README § StreakSection): a flame tile + streak number + "All habits together
 * · longest N", then 4 freeze-token slots, an at-risk warning banner, the
 * "Skip this week" CTA, and a caption. At-risk swaps the card gradient/border
 * to error and promotes the CTA to a filled button.
 */

export type StreakSectionProps = {
  streak: number;
  longest: number;
  /** 0–4. */
  freezeTokens: number;
  atRisk: boolean;
  /** True once a freeze has been spent this session (CTA → "Week skipped ✓"). */
  skipped: boolean;
  onSpendFreeze: () => void;
  testID?: string;
};

export function StreakSectionPresenter({
  streak,
  longest,
  freezeTokens,
  atRisk,
  skipped,
  onSpendFreeze,
  testID = "habit-streak-section",
}: StreakSectionProps) {
  const hasTokens = freezeTokens > 0;

  return (
    <Card
      pad={0}
      radius={20}
      testID={testID}
      style={{
        overflow: "hidden",
        // The prototype's radial wash is approximated by the border tint +
        // the flame tile's gradient; RN has no radial-gradient background.
        borderColor: atRisk ? toneHex("error").dim : toneHex("ember").dim,
      }}
    >
      {/* Streak hero */}
      <View
        flexDirection="row"
        alignItems="center"
        gap={14}
        paddingHorizontal={16}
        paddingTop={16}
        paddingBottom={14}
      >
        {atRisk ? (
          <View
            width={60}
            height={60}
            borderRadius={16}
            alignItems="center"
            justifyContent="center"
            backgroundColor="$surface3"
          >
            <IconFire size={30} strokeWidth={2} color={toneHex("gold").base} />
          </View>
        ) : (
          <LinearGradient
            colors={[toneHex("ember").base, "#B8860B"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              width: 60,
              height: 60,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconFire size={30} strokeWidth={2} color="#0A0B12" />
          </LinearGradient>
        )}
        <View flex={1}>
          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.7}
            textTransform="uppercase"
            color={atRisk ? "$warning" : "$ember"}
            testID={testID ? `${testID}-eyebrow` : undefined}
          >
            {atRisk ? "Streak at risk" : "Habit streak"}
          </Text>
          <View flexDirection="row" alignItems="baseline" gap={6} marginTop={3}>
            <Text
              fontFamily="$display"
              fontWeight="800"
              fontSize={32}
              letterSpacing={-1}
              color="$text"
              testID={testID ? `${testID}-count` : undefined}
            >
              {streak}
            </Text>
            <Text fontFamily="$mono" fontSize={12} color="$text3">
              days
            </Text>
          </View>
          <Text fontFamily="$body" fontSize={11.5} color="$text3" marginTop={2}>
            All habits together · longest{" "}
            <Text fontFamily="$body" fontSize={11.5} color="$gold">
              {longest}
            </Text>
          </Text>
        </View>
      </View>

      {/* Freeze tokens */}
      <View
        borderTopWidth={1}
        borderColor="$border"
        paddingHorizontal={16}
        paddingTop={13}
        paddingBottom={16}
      >
        <View
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          marginBottom={11}
        >
          <View>
            <Text
              fontFamily="$display"
              fontSize={10.5}
              fontWeight="600"
              letterSpacing={1.7}
              textTransform="uppercase"
              color="$text3"
            >
              Freeze tokens
            </Text>
            <Text fontFamily="$body" fontSize={11} color="$text3" marginTop={3}>
              Earned automatically — 1 per 4 weeks
            </Text>
          </View>
          <View
            flexDirection="row"
            gap={5}
            testID={testID ? `${testID}-slots` : undefined}
          >
            {[0, 1, 2, 3].map((i) => {
              const filled = i < freezeTokens;
              return (
                <View
                  key={i}
                  width={30}
                  height={30}
                  borderRadius={9}
                  alignItems="center"
                  justifyContent="center"
                  borderWidth={1}
                  backgroundColor={filled ? INFO_DIM : "$surface2"}
                  borderColor={filled ? INFO_TOKEN : "$border2"}
                  style={{ opacity: filled ? 1 : 0.4 }}
                >
                  <Text fontSize={14}>🧊</Text>
                </View>
              );
            })}
          </View>
        </View>

        {atRisk && hasTokens && !skipped ? (
          <View
            paddingVertical={10}
            paddingHorizontal={12}
            borderRadius={11}
            marginBottom={11}
            backgroundColor="$errorDim"
            borderWidth={1}
            borderColor="$errorDim"
            testID={testID ? `${testID}-at-risk-banner` : undefined}
          >
            <Text
              fontFamily="$body"
              fontSize={12}
              color="$text2"
              lineHeight={17}
            >
              One more miss loses your{" "}
              <Text
                fontFamily="$body"
                fontSize={12}
                fontWeight="600"
                color="$warning"
              >
                {streak}-day streak
              </Text>
              . Skip this week to protect it.
            </Text>
          </View>
        ) : null}

        {(() => {
          // The prototype's freeze CTA is a full-width Btn in the `info` tone
          // (filled when at-risk + has tokens, else soft). `Btn`'s tone union
          // has no `info`, so this renders the same shape locally with the info
          // accent. Disabled (no tokens / already skipped) reads at 0.45 like Btn.
          const filled = atRisk && hasTokens;
          const disabled = !hasTokens || skipped;
          const label = skipped
            ? "Week skipped ✓"
            : hasTokens
              ? "Skip this week with a freeze"
              : "No freeze tokens yet";
          return (
            <Pressable
              testID={testID ? `${testID}-freeze-cta` : undefined}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() => {
                if (hasTokens && !skipped) onSpendFreeze();
              }}
              style={({ pressed }) => ({
                opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
              })}
            >
              <View
                height={44}
                borderRadius={12}
                flexDirection="row"
                alignItems="center"
                justifyContent="center"
                gap={7}
                backgroundColor={filled ? INFO_TOKEN : INFO_SOFT}
                borderWidth={1}
                borderColor="transparent"
              >
                <Text fontSize={14}>🧊</Text>
                <Text
                  fontFamily="$display"
                  fontWeight="600"
                  fontSize={14}
                  color={filled ? INFO_INK : INFO_TOKEN}
                >
                  {label}
                </Text>
              </View>
            </Pressable>
          );
        })()}
        <Text
          fontFamily="$body"
          fontSize={10.5}
          color="$text4"
          marginTop={8}
          textAlign="center"
        >
          A freeze holds every habit&rsquo;s streak for 7 days with no
          completions.
        </Text>
      </View>
    </Card>
  );
}
