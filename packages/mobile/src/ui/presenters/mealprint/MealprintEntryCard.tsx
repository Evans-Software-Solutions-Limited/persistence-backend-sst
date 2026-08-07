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
 * ## Plan-aware states (spec-26 Phase 2, T-2.7)
 *
 * `unlocked` now branches THREE ways rather than one, mirroring the design
 * source's `AMFuelScreen` (`hasPlan` prop):
 *
 *  - `needsSetup` → unchanged: one CTA, "Set up Mealprint".
 *  - no active plan, preferences set → TWO real CTAs, "Suggest a meal" AND
 *    "Plan my day" (design: `gridTemplateColumns: '1fr 1fr'`). This is why the
 *    outer container stops being a single `Pressable` in this shape — see the
 *    docstring on the two-CTA branch below for why faking a second button the
 *    way the single-CTA card fakes its one would break VoiceOver on the first
 *    button as well as the second.
 *  - `planProgress` present → the ACTIVE variant: an "ACTIVE" pill, a
 *    logged/total counter, a per-meal progress strip and a "Next: …" line.
 *    The whole card is one Pressable again (single action: open the Today
 *    view), same shape as the original single-CTA card.
 *
 * ## Fuel-page-level Preferences entry (amendment 2026-08 § C)
 *
 * The dietary-preferences editor is a PUSHED screen (`fuel/preferences.tsx`),
 * not a root-mounted sheet. Opening it from inside a root-mounted gorhom sheet
 * renders it BEHIND that sheet — root-mounted sheets sit above the navigator
 * stack — so the editor needs a Fuel-page-level entry point rather than a link
 * buried in the suggest sheet (which is where it used to live). This card is
 * that entry point: {@link MealprintEntryCardProps.onEditPreferences}, wired
 * only into the two-CTA offer variant. See that prop's own docstring for why
 * `needsSetup` and the ACTIVE variant deliberately do not carry it.
 *
 * ## ⚠ No price literal
 *
 * The card says what the feature does and that it is Premium+; the number lives
 * in the paywall, sourced from StoreKit with the live tier API as fallback. A
 * hardcoded number is exactly how a retired value survives a reprice.
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
import {
  IconAlert,
  IconApple,
  IconLock,
  IconSettings,
  IconSparkles,
} from "@/ui/components/icons";

const GOLD = toneHex("gold");

/** The design's card wash: `linear-gradient(135deg, gold-dim 0%, transparent 70%)`. */
const WASH = [GOLD.dim, "rgba(245,197,24,0)"] as const;
const WASH_START = { x: 0, y: 0 } as const;
const WASH_END = { x: 1, y: 1 } as const;

export type MealprintEntryState = "pending" | "stalled" | "locked" | "unlocked";

/** Today's active-plan progress — presence alone selects the ACTIVE variant. */
export type MealprintPlanProgress = {
  readonly loggedCount: number;
  readonly totalCount: number;
  /** Label + kcal of the first not-yet-logged meal, or both null when every
   * meal is logged (the progress strip alone says "done"). */
  readonly nextMealLabel: string | null;
  readonly nextMealKcal: number | null;
};

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
  /**
   * Present + non-null ⇒ the day has an active plan; renders the ACTIVE
   * variant and `onPress` opens the Today view instead of the suggest sheet.
   * Only meaningful in `unlocked` — an unentitled/pending/stalled user never
   * has a plan to show progress on.
   */
  readonly planProgress?: MealprintPlanProgress | null;
  /**
   * Primary action: the first-run wizard (`needsSetup`), "Suggest a meal"
   * (no plan, preferences set), or the Today view (`planProgress` present).
   */
  readonly onPress: () => void;
  /**
   * "Plan my day" — the SECOND cta, rendered only in the no-active-plan,
   * no-first-run shape (design's two-button row). Omitting it collapses back
   * to the single-CTA card (e.g. a caller not yet wired for the plan flow).
   */
  readonly onPlanMyDay?: () => void;
  /**
   * Pushes `/(app)/fuel/preferences?mode=editor` (fuel-page-level entry,
   * amendment 2026-08 § C). Rendered as a small, light link in the two-CTA
   * offer card's header only — the shape once setup is done and the card's
   * two real actions (Suggest / Plan) otherwise have NO route to the editor
   * at all. Omitted from `needsSetup` deliberately: that card's one action
   * already opens the SAME form in wizard mode, so a second link there would
   * duplicate the card's own CTA. Omitted from the ACTIVE-plan variant to
   * match the design source, which does not carry it there either.
   *
   * ⚠ Optional so existing callers/tests that do not care about this entry
   * point are unaffected — mirrors {@link onPlanMyDay}'s own optionality.
   */
  readonly onEditPreferences?: () => void;
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
  planProgress = null,
  onPress,
  onPlanMyDay,
  onEditPreferences,
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

  // ── ACTIVE-plan variant — today has a plan, show progress instead of a pitch.
  if (!isPending && !isLocked && planProgress !== null) {
    return (
      <MealprintActivePlanCard
        progress={planProgress}
        onPress={onPress}
        testID={testID}
      />
    );
  }

  // ── Two-CTA variant — no active plan, preferences already set: "Suggest a
  // meal" AND "Plan my day" side by side (design's two-button row). The outer
  // wrapper is a plain View, not a Pressable, because the two children below
  // are the real, independently-actionable buttons — see the function's own
  // docstring for why faking this the single-CTA way would break both of them
  // for VoiceOver rather than just one.
  if (!isPending && !isLocked && !needsSetup && onPlanMyDay !== undefined) {
    return (
      <MealprintOfferCard
        remainingKcal={remainingKcal}
        remainingProteinG={remainingProteinG}
        isToday={isToday}
        onSuggest={onPress}
        onPlanMyDay={onPlanMyDay}
        onEditPreferences={onEditPreferences}
        testID={testID}
      />
    );
  }

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
 * The ACTIVE-plan variant (design's `AMFuelScreen` `hasPlan` card): a logged/
 * total counter, a per-meal progress strip, and a "Next: …" line. One
 * Pressable, one action (open the Today view) — same single-CTA shape as the
 * card this replaces, just with different content.
 */
function MealprintActivePlanCard({
  progress,
  onPress,
  testID,
}: {
  progress: MealprintPlanProgress;
  onPress: () => void;
  testID: string;
}) {
  const { loggedCount, totalCount, nextMealLabel, nextMealKcal } = progress;
  const nextLine =
    nextMealLabel !== null && nextMealKcal !== null
      ? `Next: ${nextMealLabel} · ${Math.round(nextMealKcal)} kcal`
      : "Every planned meal is logged";

  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`Today's Mealprint plan. ${loggedCount} of ${totalCount} meals logged. ${nextLine}. View plan.`}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <View
        borderRadius={18}
        padding={16}
        backgroundColor="$surface"
        borderWidth={1}
        borderColor="$goldDim"
      >
        <View
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          marginBottom={10}
        >
          <View flexDirection="row" alignItems="center" gap={8}>
            <IconSparkles size={15} color={GOLD.base} />
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={14}
              letterSpacing={-0.2}
              color="$gold"
            >
              Mealprint
            </Text>
            <Pill tone="success" size="xs">
              ACTIVE
            </Pill>
          </View>
        </View>

        <View flexDirection="row" alignItems="center" gap={14}>
          <View alignItems="center">
            <Text
              fontFamily="$mono"
              fontWeight="600"
              fontSize={22}
              color="$gold"
            >
              {loggedCount}
              <Text fontFamily="$mono" fontSize={14} color="$text3">
                /{totalCount}
              </Text>
            </Text>
            <Text
              fontFamily="$display"
              fontSize={8.5}
              fontWeight="600"
              letterSpacing={1.2}
              color="$text3"
            >
              LOGGED
            </Text>
          </View>
          <View flex={1} gap={8}>
            <View flexDirection="row" gap={4}>
              {Array.from({ length: totalCount }).map((_, index) => (
                <View
                  key={index}
                  flex={1}
                  height={6}
                  borderRadius={3}
                  backgroundColor={index < loggedCount ? "$gold" : "$surface4"}
                />
              ))}
            </View>
            <Text fontFamily="$body" fontSize={12} color="$text2">
              {nextLine}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

/**
 * The two-CTA "offer" variant — no active plan, preferences already set:
 * "Suggest a meal" and "Plan my day" as two REAL, independently-actionable
 * buttons.
 *
 * ⚠ NOT structured like the single-CTA card's fake bottom button. That
 * approach relies on the OUTER Pressable owning the one and only action, with
 * a nested decorative `View` supplying the CTA's appearance — correct with one
 * action, broken with two: nesting a real Pressable inside another Pressable
 * makes RN's default `accessible` swallow the inner one's own label on iOS
 * (exactly the defect the single-CTA comment describes), and it cannot express
 * "these are two different actions" at all. So this wrapper is a plain `View`,
 * and each button below is its own `Pressable` with its own label.
 */
function MealprintOfferCard({
  remainingKcal,
  remainingProteinG,
  isToday,
  onSuggest,
  onPlanMyDay,
  onEditPreferences,
  testID,
}: {
  remainingKcal: number | null | undefined;
  remainingProteinG: number | null | undefined;
  isToday: boolean;
  onSuggest: () => void;
  onPlanMyDay: () => void;
  onEditPreferences?: () => void;
  testID: string;
}) {
  const hasBudget =
    isToday &&
    remainingKcal !== null &&
    remainingKcal !== undefined &&
    remainingKcal > 0;
  const subtitle = hasBudget
    ? budgetLine(remainingKcal!, remainingProteinG)
    : isToday
      ? "Ideas that fit the calories and protein you have left today"
      : "Ideas that fit what's left on the day you're viewing";

  return (
    <View
      borderRadius={18}
      overflow="hidden"
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$goldDim"
      testID={testID}
    >
      <LinearGradient
        colors={WASH}
        start={WASH_START}
        end={WASH_END}
        style={{ padding: 16 }}
      >
        <View
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          gap={8}
          marginBottom={10}
        >
          <View flexDirection="row" alignItems="center" gap={8}>
            <IconSparkles size={15} color={GOLD.base} />
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
          {/* Fuel-page-level Preferences entry (amendment 2026-08 § C) —
              design source `gtm-d8-anymeal-screens.jsx:87`. Light, muted text
              rather than a filled control: this card's two real actions are
              Suggest/Plan, and this link is a secondary route, not a third
              CTA competing with them. */}
          {onEditPreferences ? (
            <Pressable
              onPress={onEditPreferences}
              testID="mealprint-entry-preferences"
              accessibilityRole="button"
              accessibilityLabel="Edit food preferences"
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <View flexDirection="row" alignItems="center" gap={4}>
                <IconSettings size={12} color={NEUTRAL_HEX.text3} />
                <Text
                  fontFamily="$display"
                  fontWeight="600"
                  fontSize={11.5}
                  color="$text3"
                >
                  Preferences
                </Text>
              </View>
            </Pressable>
          ) : null}
        </View>

        <Text
          fontFamily="$display"
          fontWeight="700"
          fontSize={18}
          letterSpacing={-0.3}
          color="$text"
        >
          What should I eat?
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

        <View flexDirection="row" gap={8} marginTop={14}>
          <Pressable
            onPress={onSuggest}
            testID="mealprint-entry-suggest-cta"
            accessibilityRole="button"
            accessibilityLabel="Suggest a meal"
            style={({ pressed }) => ({
              flex: 1,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <View
              height={44}
              borderRadius={12}
              flexDirection="row"
              alignItems="center"
              justifyContent="center"
              gap={7}
              paddingHorizontal={12}
              backgroundColor="$surface3"
              borderWidth={1}
              borderColor="$goldDim"
            >
              <IconSparkles size={14} color={GOLD.base} />
              <Text
                fontFamily="$display"
                fontWeight="600"
                fontSize={13.5}
                color="$gold"
              >
                Suggest a meal
              </Text>
            </View>
          </Pressable>
          <Pressable
            onPress={onPlanMyDay}
            testID="mealprint-entry-plan-cta"
            accessibilityRole="button"
            accessibilityLabel="Plan my day"
            style={({ pressed }) => ({
              flex: 1,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <View
              height={44}
              borderRadius={12}
              flexDirection="row"
              alignItems="center"
              justifyContent="center"
              gap={7}
              paddingHorizontal={12}
              backgroundColor="$gold"
            >
              <IconApple size={14} color={GOLD.ink} />
              <Text
                fontFamily="$display"
                fontWeight="600"
                fontSize={13.5}
                color="$goldInk"
              >
                Plan my day
              </Text>
            </View>
          </Pressable>
        </View>
      </LinearGradient>
    </View>
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
