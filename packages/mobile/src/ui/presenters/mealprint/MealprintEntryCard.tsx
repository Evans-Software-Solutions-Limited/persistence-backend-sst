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
 *
 * ## Design — gold, because Fuel is gold
 *
 * The design source (`gtm-d8-anymeal-*.jsx`, post-dating the 01-design-system
 * handoff) makes nutrition GOLD throughout: the wordmark, the sparkles, the
 * gradient wash on this very card. Our Fuel tab already agrees — `MacroHeroPresenter`
 * is "a single gold ring" and `QuickAddRowPresenter` tints in gold. This card
 * shipped `primary` (cyan), which made the one cyan object on a gold screen.
 *
 * ⚠ Gold here does NOT weaken the allergen-chip distinction (AC 1.2), because
 * that distinction is local to the preferences screen — where the pattern chips
 * stay cyan pills and the allergen chips stay amber squares. The rule this file
 * follows: gold marks Mealprint where it is being OFFERED or GENERATED; cyan
 * stays the control accent where preferences are being SET; amber is reserved for
 * safety and never competes with a gold fill in the same block.
 */

import { Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Text, View } from "@tamagui/core";
import { Pill } from "@/ui/components/foundation";
import { NEUTRAL_HEX, toneHex } from "@/ui/components/foundation/tones";
import { IconAlert, IconLock, IconSparkles } from "@/ui/components/icons";

const GOLD = toneHex("gold");

/** The design's card wash: `linear-gradient(135deg, gold-dim 0%, transparent 70%)`. */
const WASH = [GOLD.dim, "rgba(245,197,24,0)"] as const;
const WASH_START = { x: 0, y: 0 } as const;
const WASH_END = { x: 1, y: 1 } as const;

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
  /**
   * Calories left in the day, when Fuel knows them. Makes the pitch concrete —
   * the design's card leads on the actual gap rather than a generic promise.
   *
   * ⚠ Null whenever there is no target set or the day has not loaded, and NOT
   * shown in `locked`: quoting a real number to someone who cannot act on it
   * sharpens an upsell rather than helping them.
   */
  readonly remainingKcal?: number | null;
  /** Protein left in the day. Only rendered alongside {@link remainingKcal}. */
  readonly remainingProteinG?: number | null;
  /**
   * False when Fuel is showing a day other than today.
   *
   * ⚠ Separate from {@link remainingKcal} being null. Nulling the budget kills the
   * CONCRETE line but the fallbacks still said "today", so the card and the sheet it
   * opens contradicted each other on one tap — the sheet says "the day you're
   * viewing… anything you log goes to that day".
   *
   * ⚠ REQUIRED, on the same reasoning that made `dismissLabel` required: an optional
   * default of `true` is silently the "today" copy leak this prop exists to close,
   * available to the next caller. The sheet's own `isToday` is required too.
   */
  readonly isToday: boolean;
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
  remainingKcal = null,
  remainingProteinG = null,
  isToday,
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
          borderRadius={18}
          backgroundColor="$surface"
          borderWidth={1}
          borderColor="$border2"
        >
          <View
            width={42}
            height={42}
            borderRadius={12}
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

  // ⚠ The concrete line is for entitled users only. See `remainingKcal`.
  //
  // ⚠ `isToday` is in this condition so the prop ENFORCES ITSELF. `budgetLine`
  // ends "…left today", and today-ness was previously guaranteed only by the one
  // caller nulling `remainingKcal` off-today (`FuelPresenter`) — a second caller
  // passing a real `remainingKcal` with `isToday: false` would reopen the very
  // copy leak this required prop exists to close.
  const hasBudget =
    !isLocked &&
    !isPending &&
    isToday &&
    remainingKcal !== null &&
    remainingKcal !== undefined &&
    remainingKcal > 0;

  const subtitle = isPending
    ? "Checking your plan…"
    : isLocked
      ? "Unlock ideas that fit the calories and protein you have left"
      : needsSetup
        ? isToday
          ? "Set up how you eat, then get ideas that fit what's left today"
          : "Set up how you eat, then get ideas that fit the day you're viewing"
        : hasBudget
          ? budgetLine(remainingKcal, remainingProteinG)
          : isToday
            ? "Ideas that fit the calories and protein you have left today"
            : "Ideas that fit what's left on the day you're viewing";

  const cta = isLocked
    ? "See Premium+"
    : needsSetup
      ? "Set up Mealprint"
      : "Suggest a meal";

  return (
    <Pressable
      onPress={isLocked ? onUpgrade : onPress}
      disabled={isPending}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: isPending }}
      // ⚠ The whole card is ONE a11y element (RN `Pressable` defaults
      // `accessible`), and the CTA below is a nested Pressable. On iOS that makes
      // the button's text unreachable to VoiceOver, so the label has to carry it —
      // otherwise the state-specific "Set up Mealprint" is never announced at all.
      // The inner button is hidden from a11y for the same reason: on Android it
      // stays focusable and would otherwise read as a second button with the same
      // action.
      // ⚠ Carries the SUBTITLE in every state, not just `pending`. The card is one
      // grouped a11y element, so this string is all a screen reader gets — and
      // without the subtitle the concrete budget line ("You have 260 kcal and 28g
      // protein left today"), which is the whole point of showing it, never reaches
      // VoiceOver at all. Same for `needsSetup`'s explanatory line.
      accessibilityLabel={
        isLocked
          ? `${title}. ${subtitle}. Premium Plus feature, locked. ${cta}.`
          : isPending
            ? `${title}. ${subtitle}`
            : `${title}. ${subtitle}. ${cta}.`
      }
      // The CTA is not a Pressable any more, so the card has to supply the press
      // feedback `Btn` used to — otherwise the one element that looks like a button
      // does not react to touch.
      style={({ pressed }) => ({ opacity: pressed && !isPending ? 0.85 : 1 })}
    >
      <View
        borderRadius={18}
        overflow="hidden"
        backgroundColor="$surface"
        borderWidth={1}
        // Muted while pending: the card is visibly inert without being a padlock.
        borderColor={isPending ? "$border2" : "$goldDim"}
        opacity={isPending ? 0.6 : 1}
      >
        <LinearGradient
          // The wash is the feature's signature. Suppressed while pending so a
          // dead card does not advertise itself mid-round-trip.
          colors={
            isPending ? ["rgba(245,197,24,0)", "rgba(245,197,24,0)"] : WASH
          }
          start={WASH_START}
          end={WASH_END}
          style={{ padding: 16 }}
        >
          {/* Brand row — wordmark + tier, with the state's glyph */}
          <View
            flexDirection="row"
            alignItems="center"
            gap={8}
            marginBottom={10}
          >
            {/* ⚠ Padlock ONLY when genuinely locked — never while pending, which
                is the whole reason `pending` is a separate state. */}
            {isLocked ? (
              <IconLock size={15} color={GOLD.base} />
            ) : (
              <IconSparkles size={15} color={GOLD.base} />
            )}
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={14}
              letterSpacing={-0.2}
              color="$gold"
            >
              Mealprint
            </Text>
            <Pill tone="gold" size="xs">
              PREMIUM+
            </Pill>
          </View>

          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={18}
            letterSpacing={-0.3}
            color="$text"
          >
            {title}
          </Text>
          <Text
            fontFamily="$body"
            fontSize={12.5}
            lineHeight={18}
            color="$text2"
            marginTop={4}
          >
            {subtitle}
          </Text>

          {/* No CTA while pending — there is nothing to press yet, and a live
              button on an inert card invites the tap the `disabled` then eats. */}
          {isPending ? null : (
            /* ⚠ NOT a <Btn>, and not a Pressable at all.
             *
             * A real button here would be a Pressable nested inside the card's
             * own Pressable, which costs more than it buys: RN's `Pressable`
             * defaults `accessible`, so on iOS the card is one a11y element and
             * the nested button's text is never announced, while on Android the
             * child stays focusable and reads as a second button firing the same
             * action. The card handles the press for the whole surface — so this
             * is the button's APPEARANCE over the card's single touch target, and
             * the card's `accessibilityLabel` speaks the CTA text. One target,
             * one announcement, no duplicate. Mirrors <Btn variant="filled"
             * tone="gold" size="md"> (see Btn's SIZE_SPEC.md). */
            <View
              marginTop={14}
              height={44}
              borderRadius={12}
              flexDirection="row"
              alignItems="center"
              justifyContent="center"
              gap={7}
              paddingHorizontal={16}
              backgroundColor="$gold"
              testID="mealprint-entry-cta"
            >
              {isLocked ? (
                <IconLock size={14} color={GOLD.ink} />
              ) : (
                <IconSparkles size={14} color={GOLD.ink} />
              )}
              <Text
                fontFamily="$display"
                fontWeight="600"
                fontSize={14}
                color="$goldInk"
              >
                {cta}
              </Text>
            </View>
          )}
        </LinearGradient>
      </View>
    </Pressable>
  );
}

/**
 * "You have 620 kcal and 42g protein left today."
 *
 * Protein is dropped rather than shown as a negative or a zero: a user already
 * over on protein is not helped by being told so here, and the sentence still
 * works without it.
 */
function budgetLine(
  remainingKcal: number,
  remainingProteinG: number | null | undefined,
): string {
  // ⚠ Locale PINNED to match `MacroHeroPresenter`, which does the same. This
  // card sits directly beneath that hero, and an unpinned call would print
  // "1.160" here against the hero's "1,160" for the same number on a de-DE
  // device.
  const kcal = Math.round(remainingKcal).toLocaleString("en-US");
  const protein =
    remainingProteinG !== null &&
    remainingProteinG !== undefined &&
    remainingProteinG > 0
      ? ` and ${Math.round(remainingProteinG)}g protein`
      : "";
  return `You have ${kcal} kcal${protein} left today. Let Mealprint fill the gap.`;
}
