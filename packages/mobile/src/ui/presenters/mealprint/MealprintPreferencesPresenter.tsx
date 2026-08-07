/**
 * <MealprintPreferencesPresenter> — the Mealprint food-preferences surface
 * (spec-26 STORY-001, T-0.6). ONE presenter serves both entry points:
 *
 *  - **wizard** — first run from the Fuel Mealprint card. Skippable (AC 1.4);
 *    the skip means {@link DEFAULT_MEALPRINT_PREFERENCES}.
 *  - **editor** — the "Food preferences" row on Fuel Targets. Same controls, a
 *    Cancel instead of a Skip, and no intro.
 *
 * Pure: every value and handler is a prop.
 *
 * ## ⚠ The two safety surfaces here are not decoration
 *
 * 1. **Allergen chips are visually distinct from dislikes (AC 1.2)**, and the
 *    distinction is load-bearing rather than stylistic. The two lists are filtered
 *    by completely different mechanisms with completely different guarantees: an
 *    allergen chip is matched on Open Food Facts `allergens_tags` and **fails
 *    closed** (a row whose tags cannot be interpreted is excluded, never cleared),
 *    while a dislike is matched on a normalised NAME TOKEN and carries no safety
 *    claim at all. A user who types "peanuts" into the dislike box and believes
 *    they have declared an allergy has been misled by the UI. Hence the amber
 *    treatment, the warning glyph, the separate section, and copy on the dislike
 *    field pointing at the allergen chips.
 *
 * 2. **{@link LABEL_CHECK_COPY} + {@link MEDICAL_SCOPE_COPY} render together, in
 *    ONE always-visible panel, regardless of allergen selection** (amendment
 *    2026-08 § C). AC 1.2 reads as "adding a chip shows it"; this screen
 *    deliberately diverges, because AC 1.2's authoring predates the design
 *    source review — `gtm-d8-anymeal-parts.jsx:220-228`'s `AMDisclaimer` is
 *    persistent, and prototype fidelity wins per this repo's port discipline. A
 *    user who sets a dietary pattern or a dislike but never touches an
 *    allergen chip must still see "always check labels" — the copy is a legal
 *    surface either way, do not paraphrase, shorten, or split it. See
 *    `domain/models/mealprint.ts` for why the equivalent disclaimer on the
 *    suggest/plan/draft surfaces stays gated on `labelCheckRequired` — THAT
 *    gating is untouched; this divergence is local to this screen only.
 *
 * ## ⚠ Halal / kosher say what is ENFORCED, never that it is certified
 *
 * Certification appears nowhere in the food data. {@link partialEnforcementCopy}
 * names the determinable subset (pork; plus alcohol for halal, shellfish for
 * kosher) and nothing more — locked decision 10. Implying certification would be
 * a compliance claim with no basis, on a feature whose stated scope is lifestyle
 * rather than prescription.
 *
 * Spec: specs/26-mealprint-meal-planning/requirements.md STORY-001
 *       specs/26-mealprint-meal-planning/design.md § 4
 */

import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";

import { Btn, Card, HeaderBar, Segmented } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import {
  IconAlert,
  IconCheck,
  IconMinus,
  IconPlus,
  IconX,
} from "@/ui/components/icons";
import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import {
  ALLERGEN_LABELS,
  AVOID_ALLERGENS,
  DIETARY_PATTERNS,
  DIETARY_PATTERN_LABELS,
  EFFORT_LEVELS,
  EFFORT_LEVEL_BLURBS,
  EFFORT_LEVEL_LABELS,
  LABEL_CHECK_COPY,
  MAX_FREE_TEXT_ITEMS,
  MAX_FREE_TEXT_LENGTH,
  MAX_MEALS_PER_DAY,
  MEDICAL_SCOPE_COPY,
  MIN_MEALS_PER_DAY,
  partialEnforcementCopy,
  type AllergenKey,
  type DietaryPattern,
  type EffortLevel,
} from "@/domain/models/mealprint";

const AMBER = toneHex("gold");
const PRIMARY = toneHex("primary");

export type MealprintPreferencesMode = "wizard" | "editor";

export type MealprintPreferencesProps = {
  readonly mode: MealprintPreferencesMode;
  /** True on the very first paint while the cached row is still absent. */
  readonly isLoadingInitial: boolean;
  readonly isSaving: boolean;
  /**
   * Container-supplied failure text for a state the user can act on.
   *
   * ⚠ Today the only two values are "you're not signed in" and "we couldn't load
   * your preferences, so there's nothing to save yet" — NOT a server validation
   * message. The save is queued, so a rejected PUT surfaces on the sync-failure
   * screen rather than here; see `ApiPort.setMealprintPreferences` for the full
   * note. Do not add a generic "something went wrong" to this: every value here
   * should tell the user what to do next.
   */
  readonly errorMessage: string | null;
  /**
   * ⚠ TRUE when the preferences could not be read AND this device has nothing
   * cached — so the form would render empty defaults over a server row we never
   * saw.
   *
   * The whole form is replaced by a retry panel in that state, and this is a
   * SAFETY guard rather than a nicety: `PUT /nutrition/preferences` is a full
   * last-write-wins replacement, so an unseeded Save (or the wizard's Skip, which
   * is a real write) would delete the user's saved allergen list. `commit()` also
   * refuses independently — this is the half that stops the user reaching the
   * button at all.
   */
  readonly loadFailed: boolean;
  /** Re-read the preferences. Only wired in the `loadFailed` state. */
  readonly onRetryLoad: () => void;

  readonly dietaryPatterns: readonly DietaryPattern[];
  readonly onTogglePattern: (pattern: DietaryPattern) => void;

  readonly avoidAllergens: readonly AllergenKey[];
  readonly onToggleAllergen: (allergen: AllergenKey) => void;

  readonly avoidFoods: readonly string[];
  readonly avoidFoodDraft: string;
  readonly onAvoidFoodDraftChange: (text: string) => void;
  readonly onAddAvoidFood: () => void;
  readonly onRemoveAvoidFood: (value: string) => void;

  readonly likedFoods: readonly string[];
  readonly likedFoodDraft: string;
  readonly onLikedFoodDraftChange: (text: string) => void;
  readonly onAddLikedFood: () => void;
  readonly onRemoveLikedFood: (value: string) => void;

  readonly mealsPerDay: number;
  readonly onMealsPerDayChange: (value: number) => void;

  readonly effortLevel: EffortLevel;
  readonly onEffortLevelChange: (value: EffortLevel) => void;

  readonly onSave: () => void;
  /** Wizard first run: "Skip for now" (saves the defaults). Otherwise "Cancel". */
  readonly onDismiss: () => void;
  /**
   * Text for the dismiss action.
   *
   * ⚠ Container-supplied rather than derived from {@link mode}, because it has to
   * follow what dismiss actually DOES. The wizard writes the defaults only on a
   * genuine first run; when the user already has saved choices it just leaves, and
   * labelling that "Skip" would promise to discard answers it in fact keeps. See
   * `MealprintPreferencesContainer`'s `hasSavedChoices`.
   *
   * ⚠ REQUIRED. It was optional with a `mode`-derived fallback, which is exactly the
   * label the container proved wrong — silently available to the next caller.
   */
  readonly dismissLabel: string;
  readonly testID?: string;
};

export function MealprintPreferencesPresenter({
  mode,
  isLoadingInitial,
  isSaving,
  errorMessage,
  loadFailed,
  onRetryLoad,
  dietaryPatterns,
  onTogglePattern,
  avoidAllergens,
  onToggleAllergen,
  avoidFoods,
  avoidFoodDraft,
  onAvoidFoodDraftChange,
  onAddAvoidFood,
  onRemoveAvoidFood,
  likedFoods,
  likedFoodDraft,
  onLikedFoodDraftChange,
  onAddLikedFood,
  onRemoveLikedFood,
  mealsPerDay,
  onMealsPerDayChange,
  effortLevel,
  onEffortLevelChange,
  onSave,
  onDismiss,
  dismissLabel,
  testID = "mealprint-preferences-screen",
}: MealprintPreferencesProps) {
  const insets = useSafeAreaInsets();
  const isWizard = mode === "wizard";
  const dismissText = dismissLabel;
  const partialCaveat = partialEnforcementCopy(dietaryPatterns);

  if (isLoadingInitial) {
    return (
      <View
        flex={1}
        backgroundColor="$bg"
        alignItems="center"
        justifyContent="center"
        paddingTop={insets.top}
        testID={testID}
      >
        <PLogoDrawLoader />
      </View>
    );
  }

  // ⚠ Before the form, not alongside it. See `loadFailed` — an editable form here
  // is a delete button for the user's allergen list.
  if (loadFailed) {
    return (
      <View
        flex={1}
        backgroundColor="$bg"
        paddingTop={insets.top}
        testID={testID}
      >
        <HeaderBar
          title={isWizard ? "Set up Mealprint" : "Food preferences"}
          leading={
            <Pressable
              onPress={onDismiss}
              testID="mealprint-preferences-dismiss"
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Text fontFamily="$body" fontSize={14} color="$text3">
                Back
              </Text>
            </Pressable>
          }
        />
        <View
          flex={1}
          alignItems="center"
          justifyContent="center"
          paddingHorizontal={24}
          gap={12}
          testID="mealprint-preferences-load-failed"
        >
          <IconAlert size={22} color={AMBER.base} />
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={16}
            color="$text"
            textAlign="center"
          >
            Couldn&apos;t load your preferences
          </Text>
          <Text
            fontFamily="$body"
            fontSize={13}
            lineHeight={19}
            color="$text3"
            textAlign="center"
          >
            We won&apos;t show the form until we can read what you already have
            — saving over it would clear your allergens.
          </Text>
          <Btn
            variant="filled"
            tone="primary"
            size="lg"
            full
            onPress={onRetryLoad}
            testID="mealprint-preferences-retry-load"
          >
            Try again
          </Btn>
        </View>
      </View>
    );
  }

  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID={testID}
    >
      <HeaderBar
        title={isWizard ? "Set up Mealprint" : "Food preferences"}
        leading={
          <Pressable
            onPress={onDismiss}
            disabled={isSaving}
            testID="mealprint-preferences-dismiss"
            accessibilityRole="button"
            accessibilityLabel={
              dismissText === "Skip" ? "Skip for now" : dismissText
            }
          >
            <Text fontFamily="$body" fontSize={14} color="$text3">
              {dismissText}
            </Text>
          </Pressable>
        }
        trailing={
          <Pressable
            onPress={onSave}
            disabled={isSaving}
            testID="mealprint-preferences-save"
            accessibilityRole="button"
            accessibilityLabel="Save food preferences"
            accessibilityState={{ disabled: isSaving }}
          >
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={14}
              color={isSaving ? "$text4" : "$primary"}
            >
              {isSaving ? "Saving…" : "Save"}
            </Text>
          </Pressable>
        }
      />

      {/* ⚠ The KeyboardAvoidingView must WRAP both the scroll view and the
          pinned footer, and the footer must be INSIDE it.
          `CreateExercisePresenter` documents the same requirement verbatim: iOS
          does not resize the window, so a footer that is a SIBLING of the KAV
          stays put and the keyboard covers it. This screen has two
          always-visible text inputs (dislikes + likes), so on the first-run
          wizard the sequence "tap Add a food you dislike → press Save and
          continue" would otherwise be impossible — the commit button occluded on
          the screen whose whole purpose is to commit. Before the CTA was pinned
          it was the last scroll row, which the keyboard could be scrolled past;
          pinning it is what created the need for this. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 14,
            // The wizard's pinned footer takes over the bottom inset; paying it
            // twice would leave a dead band of scroll above the CTA.
            paddingBottom: isWizard ? 28 : 40 + insets.bottom,
            gap: 20,
          }}
          showsVerticalScrollIndicator={false}
          // ⚠ Required, not cosmetic. This screen has two always-visible text
          // fields, and without it RN's responder capture eats the FIRST tap on
          // every chip, stepper and segment while a field is focused — the exact
          // failure `Segmented`'s own ScrollView documents.
          keyboardShouldPersistTaps="handled"
        >
          {errorMessage ? (
            <View
              paddingHorizontal={14}
              paddingVertical={10}
              borderRadius={12}
              backgroundColor="$errorDim"
              borderWidth={1}
              borderColor="$error"
              testID="mealprint-preferences-error"
            >
              <Text
                fontFamily="$body"
                fontSize={13}
                color="$error"
                textAlign="center"
              >
                {errorMessage}
              </Text>
            </View>
          ) : null}

          {isWizard ? (
            <Text
              fontFamily="$body"
              fontSize={13}
              lineHeight={19}
              color="$text2"
              testID="mealprint-preferences-intro"
            >
              Tell Mealprint how you eat and it will only ever suggest food you
              actually want. You can change any of this later
              {/* ⚠ Follows the dismiss action. Offering to "skip it entirely"
                  while the button says Cancel promises to discard answers that
                  are in fact kept — see `dismissLabel`. */}
              {dismissText === "Skip"
                ? ", or skip it entirely."
                : ". Your saved choices are already filled in below."}
            </Text>
          ) : null}

          {/* ── Dietary pattern ─────────────────────────────────────────── */}
          <Section
            title="How you eat"
            sub="Pick any that apply"
            testID="mealprint-preferences-patterns"
          >
            <View flexDirection="row" flexWrap="wrap" gap={8}>
              {DIETARY_PATTERNS.map((pattern) => (
                <ToggleChip
                  key={pattern}
                  label={DIETARY_PATTERN_LABELS[pattern]}
                  selected={dietaryPatterns.includes(pattern)}
                  onPress={() => onTogglePattern(pattern)}
                  testID={`mealprint-pattern-${pattern}`}
                />
              ))}
            </View>
            {partialCaveat ? (
              <Caveat
                text={partialCaveat}
                testID="mealprint-partial-enforcement"
              />
            ) : null}
          </Section>

          {/* ── Allergens ───────────────────────────────────────────────── */}
          <Section
            title="Allergens to avoid"
            sub="Hard-filtered by ingredient data"
            safety
            testID="mealprint-preferences-allergens"
          >
            <View flexDirection="row" flexWrap="wrap" gap={8}>
              {AVOID_ALLERGENS.map((allergen) => (
                <AllergenChip
                  key={allergen}
                  label={ALLERGEN_LABELS[allergen]}
                  selected={avoidAllergens.includes(allergen)}
                  onPress={() => onToggleAllergen(allergen)}
                  testID={`mealprint-allergen-${allergen}`}
                />
              ))}
            </View>
          </Section>

          {/* ── Dislikes ────────────────────────────────────────────────── */}
          <FreeTextSection
            title="Foods you'd rather not eat"
            sub="Mushrooms, olives, anything you just don't like"
            placeholder="Add a food you dislike"
            values={avoidFoods}
            draft={avoidFoodDraft}
            onDraftChange={onAvoidFoodDraftChange}
            onAdd={onAddAvoidFood}
            onRemove={onRemoveAvoidFood}
            idPrefix="mealprint-dislike"
            /* ⚠ The one place the UI states the guarantee gap outright. Without it
             a user types "peanuts" here and reasonably believes they have
             declared an allergy — this list is name-matched only. */
            footnote="These are matched by name only. For an allergy, use the allergen chips above."
          />

          {/* ── Likes ───────────────────────────────────────────────────── */}
          <FreeTextSection
            title="Foods you want more of"
            sub="Mealprint will lean towards these"
            placeholder="Add a food you like"
            values={likedFoods}
            draft={likedFoodDraft}
            onDraftChange={onLikedFoodDraftChange}
            onAdd={onAddLikedFood}
            onRemove={onRemoveLikedFood}
            idPrefix="mealprint-like"
          />

          {/* ── Meals per day ───────────────────────────────────────────── */}
          <Section
            title="Meals a day"
            sub={`${MIN_MEALS_PER_DAY}–${MAX_MEALS_PER_DAY}`}
            testID="mealprint-preferences-meals"
          >
            <Card pad={14} radius={12}>
              <View
                flexDirection="row"
                alignItems="center"
                justifyContent="space-between"
              >
                <StepperButton
                  kind="dec"
                  disabled={mealsPerDay <= MIN_MEALS_PER_DAY}
                  onPress={() =>
                    onMealsPerDayChange(
                      Math.max(MIN_MEALS_PER_DAY, mealsPerDay - 1),
                    )
                  }
                  testID="mealprint-meals-dec"
                />
                <Text
                  fontFamily="$mono"
                  fontWeight="600"
                  fontSize={28}
                  color="$text"
                  testID="mealprint-meals-value"
                >
                  {mealsPerDay}
                </Text>
                <StepperButton
                  kind="inc"
                  disabled={mealsPerDay >= MAX_MEALS_PER_DAY}
                  onPress={() =>
                    onMealsPerDayChange(
                      Math.min(MAX_MEALS_PER_DAY, mealsPerDay + 1),
                    )
                  }
                  testID="mealprint-meals-inc"
                />
              </View>
            </Card>
          </Section>

          {/* ── Effort ──────────────────────────────────────────────────── */}
          <Section
            title="How much cooking"
            testID="mealprint-preferences-effort"
          >
            <Segmented
              testID="mealprint-effort"
              accent="gold"
              full
              options={EFFORT_LEVELS.map((level) => ({
                value: level,
                label: EFFORT_LEVEL_LABELS[level],
              }))}
              value={effortLevel}
              onChange={(value) => onEffortLevelChange(value as EffortLevel)}
            />
            <Text fontFamily="$body" fontSize={12} color="$text3">
              {EFFORT_LEVEL_BLURBS[effortLevel]}
            </Text>
          </Section>

          {/* AC 1.5 / locked decision 10 + amendment 2026-08 § C. Rendered
            unconditionally in BOTH modes — the AC asks for the wizard footer,
            and a disclaimer that vanishes the moment the screen becomes an
            editor, or the moment no allergen chip is active, would be a
            strange place to stop saying either line. See the file docstring
            for why this diverges from AC 1.2's literal "adding a chip shows
            it" wording. */}
          <PersistentDisclaimer />
        </ScrollView>

        {/* ⚠ PINNED, not the last row of the scroll. This form is seven sections
            long and grows further with each conditional caveat, so a CTA at the
            end of the stack is reachable only by scrolling past everything — on
            the FIRST-RUN screen, where the user has no idea how long the form is.
            The header Save covers the editor; the wizard gets the explicit
            commit. Ports the prototype's `AMSticky` (design-source
            `screens.jsx:23`). Inside the KAV — see the note above it. */}
        {isWizard ? (
          <View
            paddingHorizontal={16}
            paddingTop={12}
            paddingBottom={12 + insets.bottom}
            borderTopWidth={1}
            borderColor="$border"
            backgroundColor="$surface"
          >
            <Btn
              variant="filled"
              tone="primary"
              size="lg"
              full
              icon={<IconCheck size={16} />}
              onPress={onSave}
              disabled={isSaving}
              testID="mealprint-preferences-wizard-cta"
            >
              {isSaving ? "Saving…" : "Save and continue"}
            </Btn>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Building blocks ─────────────────────────────────────────────────────────

/**
 * A titled block.
 *
 * `safety` marks the section as part of the amber channel — an alert glyph beside
 * the heading and an amber sub-line. Used by the allergen section ONLY, so that
 * AC 1.2's "visually distinct" holds at section level and not just at chip level:
 * a user scanning the form sees the amber band before they read a single chip.
 */
function Section({
  title,
  sub,
  safety = false,
  children,
  testID,
}: {
  title: string;
  sub?: string;
  safety?: boolean;
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <View gap={10} testID={testID}>
      <View
        flexDirection="row"
        alignItems="center"
        gap={7}
        // ⚠ Both halves fix a real clip found on an iPhone 17 Pro: with the row
        // unwrapped and the sub unshrinkable, "Foods you'd rather not eat" +
        // "Mushrooms, olives, anything you just don't like" ran off the right
        // edge, losing the last three words. `flexWrap` lets a long sub drop to
        // its own line; `flexShrink` on the sub lets it wrap rather than push.
        flexWrap="wrap"
      >
        {safety ? <IconAlert size={15} color={AMBER.base} /> : null}
        <Text
          fontFamily="$display"
          fontWeight="700"
          fontSize={16}
          color="$text"
        >
          {title}
        </Text>
        {sub ? (
          <Text
            fontFamily="$body"
            fontSize={11.5}
            color={safety ? "$gold" : "$text3"}
            flexShrink={1}
          >
            {sub}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/**
 * A neutral, primary-accented multi-select chip — dietary patterns.
 *
 * ⚠ Deliberately a DIFFERENT shape and colour from {@link AllergenChip}. See the
 * presenter docstring: the two lists have different enforcement guarantees, and
 * making them look alike is how a user comes to believe a dislike is an allergy
 * declaration.
 */
function ToggleChip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap={6}
        height={38}
        paddingHorizontal={13}
        borderRadius={19}
        backgroundColor={selected ? "$primaryDim" : "$surface2"}
        borderWidth={1}
        borderColor={selected ? "$primary" : "$border2"}
      >
        {selected ? <IconCheck size={14} color={PRIMARY.base} /> : null}
        <Text
          fontFamily="$display"
          fontWeight="600"
          fontSize={13}
          color={selected ? "$primary" : "$text2"}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * An allergen chip: amber, square-shouldered, and carrying a warning glyph when
 * active (AC 1.2's "visually distinct").
 *
 * ⚠ Amber rather than the error red on purpose. Red reads as "something is
 * wrong"; selecting an allergen is a correct and expected action, and the amber
 * says "this one is a safety constraint, treated differently" without implying a
 * fault.
 */
function AllergenChip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={
        selected ? `${label}, avoiding` : `${label}, not avoiding`
      }
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap={6}
        height={38}
        paddingHorizontal={12}
        // Square-shouldered (8) against the patterns' pill (19) — the shape
        // difference survives greyscale and colour-blindness, which a hue
        // difference alone does not.
        borderRadius={8}
        backgroundColor={selected ? "$goldDim" : "$surface2"}
        borderWidth={1}
        borderColor={selected ? "$gold" : "$border2"}
      >
        {selected ? <IconAlert size={14} color={AMBER.base} /> : null}
        <Text
          fontFamily="$display"
          fontWeight="600"
          fontSize={13}
          color={selected ? "$gold" : "$text2"}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

/** An amber note — the label-check disclaimer and the halal/kosher caveat. */
function Caveat({ text, testID }: { text: string; testID: string }) {
  return (
    <View
      flexDirection="row"
      gap={8}
      paddingHorizontal={12}
      paddingVertical={10}
      borderRadius={10}
      backgroundColor="$goldDim"
      borderWidth={1}
      borderColor="$border2"
      testID={testID}
    >
      <View paddingTop={1}>
        <IconAlert size={14} color={AMBER.base} />
      </View>
      <Text
        fontFamily="$body"
        fontSize={12}
        lineHeight={17.5}
        color="$text2"
        flex={1}
      >
        {text}
      </Text>
    </View>
  );
}

/**
 * The persistent safety disclaimer (amendment 2026-08 § C) — carries BOTH
 * {@link LABEL_CHECK_COPY} and {@link MEDICAL_SCOPE_COPY}, ALWAYS visible on
 * this screen regardless of allergen selection. Mirrors the design source's
 * always-on `AMDisclaimer` (`gtm-d8-anymeal-parts.jsx:220-228`) — see the file
 * docstring for why this diverges from AC 1.2's "adding a chip shows it"
 * wording, and why that gating is untouched everywhere else (suggest/plan/
 * draft still key off `labelCheckRequired`).
 *
 * ⚠ Both lines stay the reviewed CONSTANTS verbatim — this only changes WHEN
 * they render, never what they say.
 */
function PersistentDisclaimer() {
  return (
    <View
      flexDirection="row"
      gap={10}
      paddingHorizontal={14}
      paddingVertical={12}
      borderRadius={12}
      backgroundColor="$goldDim"
      borderWidth={1}
      borderColor="$border2"
      testID="mealprint-label-check-disclaimer"
    >
      <View paddingTop={1}>
        <IconAlert size={15} color={AMBER.base} />
      </View>
      <View flex={1} gap={4}>
        <Text fontFamily="$body" fontSize={12} lineHeight={17.5} color="$text2">
          {LABEL_CHECK_COPY}
        </Text>
        <Text
          fontFamily="$body"
          fontSize={11.5}
          lineHeight={17}
          color="$text4"
          testID="mealprint-medical-scope"
        >
          {MEDICAL_SCOPE_COPY}
        </Text>
      </View>
    </View>
  );
}

/**
 * A free-text list: an input that adds on submit, plus removable chips.
 *
 * The cap is enforced HERE as well as server-side, and the count is shown once
 * the list is close to full — mirroring `MAX_FREE_TEXT_ITEMS` /
 * `MAX_FREE_TEXT_LENGTH` so a rejected save is unreachable from this screen
 * rather than merely unlikely. (Every entry lands in the model prompt, which is
 * why the backend bounds it at all.)
 */
function FreeTextSection({
  title,
  sub,
  placeholder,
  values,
  draft,
  onDraftChange,
  onAdd,
  onRemove,
  idPrefix,
  footnote,
}: {
  title: string;
  sub: string;
  placeholder: string;
  values: readonly string[];
  draft: string;
  onDraftChange: (text: string) => void;
  onAdd: () => void;
  onRemove: (value: string) => void;
  idPrefix: string;
  footnote?: string;
}) {
  const full = values.length >= MAX_FREE_TEXT_ITEMS;
  const canAdd = !full && draft.trim().length > 0;
  return (
    <Section title={title} sub={sub} testID={`${idPrefix}-section`}>
      <View flexDirection="row" gap={8} alignItems="center">
        <View
          flex={1}
          height={44}
          paddingHorizontal={12}
          borderRadius={12}
          backgroundColor="$surface3"
          borderWidth={1}
          borderColor="$border2"
          justifyContent="center"
        >
          <TextInput
            value={draft}
            onChangeText={onDraftChange}
            onSubmitEditing={() => {
              if (canAdd) onAdd();
            }}
            editable={!full}
            placeholder={full ? "That's the maximum" : placeholder}
            placeholderTextColor="#8A8A98"
            maxLength={MAX_FREE_TEXT_LENGTH}
            returnKeyType="done"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={title}
            testID={`${idPrefix}-input`}
            style={{
              color: "#F4F4F8",
              fontFamily: "Geist",
              fontSize: 14,
              padding: 0,
            }}
          />
        </View>
        <Btn
          variant="outline"
          tone="primary"
          size="md"
          onPress={onAdd}
          disabled={!canAdd}
          testID={`${idPrefix}-add`}
        >
          Add
        </Btn>
      </View>

      {values.length > 0 ? (
        <View flexDirection="row" flexWrap="wrap" gap={8}>
          {values.map((value) => (
            <Pressable
              key={value}
              onPress={() => onRemove(value)}
              testID={`${idPrefix}-chip-${value}`}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${value}`}
            >
              <View
                flexDirection="row"
                alignItems="center"
                gap={6}
                height={34}
                paddingLeft={12}
                paddingRight={9}
                borderRadius={17}
                backgroundColor="$surface3"
                borderWidth={1}
                borderColor="$border2"
              >
                <Text fontFamily="$body" fontSize={13} color="$text2">
                  {value}
                </Text>
                <IconX size={13} color="#8A8A98" />
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      {footnote ? (
        <Text
          fontFamily="$body"
          fontSize={11.5}
          lineHeight={17}
          color="$text3"
          testID={`${idPrefix}-footnote`}
        >
          {footnote}
        </Text>
      ) : null}
    </Section>
  );
}

function StepperButton({
  kind,
  disabled,
  onPress,
  testID,
}: {
  kind: "inc" | "dec";
  disabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={kind === "inc" ? "One more meal" : "One fewer meal"}
      accessibilityState={{ disabled }}
      style={{ opacity: disabled ? 0.35 : 1 }}
    >
      <View
        width={44}
        height={44}
        borderRadius={12}
        backgroundColor="$surface3"
        borderWidth={1}
        borderColor="$border2"
        alignItems="center"
        justifyContent="center"
      >
        {kind === "inc" ? (
          <IconPlus size={18} color={PRIMARY.base} />
        ) : (
          <IconMinus size={18} color={PRIMARY.base} />
        )}
      </View>
    </Pressable>
  );
}
