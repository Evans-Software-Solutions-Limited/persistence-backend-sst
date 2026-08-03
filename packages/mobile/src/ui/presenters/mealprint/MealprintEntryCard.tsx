/**
 * <MealprintEntryCard> — the Mealprint affordance on the Fuel screen, below
 * QuickAddRow (spec-26 design § 4 item 1).
 *
 * ## ⚠ FOUR states, not two — and the two extra ones are the whole point
 *
 * `useMealprintGate().allowed` is a boolean, but a boolean cannot express the
 * cold-start round trip, and `GymsSegmentContainer` is the precedent that learnt
 * this the hard way:
 *
 *  1. **pending** — `/subscriptions/me` is still in flight. `computeMealprintVerdict`
 *     denies a null subscription BY DESIGN (the alternative is flashing the card
 *     as unlocked and then 402-ing), so during that round trip a paying Premium+
 *     user is indistinguishable from a free one. Showing them a padlock for a
 *     feature they bought — on the Fuel TAB, so on every cold launch — is worse
 *     than showing them a muted card that does nothing yet.
 *  2. **stalled** — pending for longer than the container's timeout. `getMySubscription`
 *     runs with no client-side timeout, so a half-open socket never rejects and
 *     React Query's retry never fires; unguarded, the card sits muted forever.
 *     Deliberately does NOT fall through to locked: showing the paywall because
 *     the network hung is exactly the mistake state 1 exists to prevent.
 *  3. **locked** — the pitch and a CTA. There is no taster (design § 5.2 is a hard
 *     gate), so this is the only place the value proposition gets made.
 *  4. **unlocked** — opens the suggest sheet, or the first-run wizard.
 *
 * ## ⚠ No price literal
 *
 * The card says what the feature does and that it is Premium+; the number lives
 * in the paywall, sourced from the catalog. `premium_plus` ships
 * `is_active = false`, so there is no price to print yet — and a hardcoded one is
 * exactly how the prototype's retired £19.99 would have survived the reprice to
 * £29.99.
 */

import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { Pill } from "@/ui/components/foundation";
import { NEUTRAL_HEX, toneHex } from "@/ui/components/foundation/tones";
import {
  IconAlert,
  IconChevronR,
  IconLock,
  IconSparkles,
} from "@/ui/components/icons";

const PRIMARY = toneHex("primary");

export type MealprintEntryState = "pending" | "stalled" | "locked" | "unlocked";

export type MealprintEntryCardProps = {
  readonly state: MealprintEntryState;
  /**
   * True when this device has never seen preferences, or has seen defaults with
   * `isDefault: true` — i.e. tapping should open the first-run wizard rather than
   * going straight to suggestions (AC 1.1).
   *
   * ⚠ Only meaningful in the `unlocked` state. It changes the SUBTITLE, not the
   * gate: an unentitled user must not be told to set preferences up for a feature
   * they cannot reach.
   */
  readonly needsSetup?: boolean;
  /** Opens the wizard (when `needsSetup`) or the suggest sheet. */
  readonly onPress: () => void;
  /** Pushes the paywall. Only wired in the `locked` state. */
  readonly onUpgrade: () => void;
  /** Re-issues the hung subscription queries. Only wired in `stalled`. */
  readonly onRetry: () => void;
  readonly testID?: string;
};

export function MealprintEntryCard({
  state,
  needsSetup = false,
  onPress,
  onUpgrade,
  onRetry,
  testID = "mealprint-entry-card",
}: MealprintEntryCardProps) {
  if (state === "stalled") {
    return (
      <Pressable
        onPress={onRetry}
        testID="mealprint-entry-stalled"
        accessibilityRole="button"
        accessibilityLabel="Couldn't check your subscription. Tap to try again."
      >
        <View
          flexDirection="row"
          alignItems="center"
          gap={12}
          padding={16}
          borderRadius={16}
          backgroundColor="$surface"
          borderWidth={1}
          borderColor="$border2"
        >
          <View
            width={42}
            height={42}
            borderRadius={10}
            backgroundColor="$surface3"
            alignItems="center"
            justifyContent="center"
          >
            <IconAlert size={19} color={NEUTRAL_HEX.text3} />
          </View>
          <View flex={1} gap={3}>
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={15}
              color="$text"
            >
              Mealprint
            </Text>
            <Text
              fontFamily="$body"
              fontSize={12}
              lineHeight={17}
              color="$text3"
            >
              Couldn&apos;t check your subscription. Tap to try again.
            </Text>
          </View>
        </View>
      </Pressable>
    );
  }

  const isPending = state === "pending";
  const isLocked = state === "locked";
  const title = "What should I eat?";
  const subtitle = isPending
    ? "Checking your plan…"
    : isLocked
      ? "Unlock ideas that fit the calories and protein you have left"
      : needsSetup
        ? "Set up how you eat, then get ideas that fit what's left today"
        : "Ideas that fit the calories and protein you have left today";

  return (
    <Pressable
      onPress={isLocked ? onUpgrade : onPress}
      disabled={isPending}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: isPending }}
      accessibilityLabel={
        isLocked ? `${title}. Premium Plus feature, locked.` : title
      }
      style={{ opacity: isPending ? 0.6 : 1 }}
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap={12}
        padding={16}
        borderRadius={16}
        backgroundColor="$surface"
        borderWidth={1}
        borderColor="$primaryDim"
      >
        <View
          width={42}
          height={42}
          borderRadius={10}
          backgroundColor="$primaryDim"
          alignItems="center"
          justifyContent="center"
        >
          {/* Padlock ONLY when genuinely locked — never while pending, which is
              the whole reason `pending` is a separate state. */}
          {isLocked ? (
            <IconLock size={18} color={PRIMARY.base} />
          ) : (
            <IconSparkles size={19} color={PRIMARY.base} />
          )}
        </View>
        <View flex={1} gap={3}>
          <View flexDirection="row" alignItems="center" gap={8}>
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={15}
              color="$text"
            >
              {title}
            </Text>
            <Pill tone="primary" size="xs">
              PREMIUM+
            </Pill>
          </View>
          <Text fontFamily="$body" fontSize={12} lineHeight={17} color="$text3">
            {subtitle}
          </Text>
        </View>
        <IconChevronR size={16} color={PRIMARY.base} />
      </View>
    </Pressable>
  );
}
