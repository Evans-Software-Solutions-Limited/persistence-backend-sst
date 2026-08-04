/**
 * <MealprintSuggestSheetPresenter> — the fill-my-macros sheet (spec-26 T-1.5,
 * STORY-003). Pure: every value and handler is a prop.
 *
 * Stages: `setup` → `generating` → `results` (or `empty`) → `draft` → `added`,
 * plus `error`. The container owns the call, the stage and the draft.
 *
 * ## ⚠ The label-check disclaimer renders on `labelCheckRequired`, NEVER on
 * `containsUnverified`
 *
 * The server returns `labelCheckRequired: true` unconditionally and documents
 * why: `mapOffAllergenTags` returns `[]` — indistinguishable from "analysed,
 * nothing found" — whenever a product has ingredient text, WITHOUT knowing Open
 * Food Facts actually parsed it. A foreign-language ingredient list, a
 * "see packaging" placeholder and a genuinely clean analysis all look identical,
 * and those are precisely the rows most likely to be wrong. Gating the disclaimer
 * on the narrower `containsUnverified` would therefore hide it exactly where it
 * matters most. `containsUnverified` is rendered separately, as the STRONGER
 * per-suggestion "we don't know what's in this at all" flag.
 *
 * {@link LABEL_CHECK_COPY} is AC 1.2 verbatim and is a legal surface. Do not
 * paraphrase, shorten, or split it.
 *
 * ## ⚠ `emptyReason` is an ANSWER, not an error
 *
 * All three empty reasons are 200s that consumed no inference and no daily
 * ceiling, so each gets specific, actionable copy rather than a generic failure —
 * and `no_candidates` in particular is the EXPECTED state for any user with an
 * allergen chip set until the Open Food Facts re-seed lands (the tag columns are
 * NULL on every seeded row and the filter treats NULL as unknown-and-unsafe, which
 * is correct fail-closed behaviour). Its copy points at loosening a chip or adding
 * your own foods, because that is what actually helps today.
 *
 * ## ⚠ No `flex: 1` in this body
 *
 * `BottomSheet` gives its children an explicit height derived from the snap
 * fraction; a `flex: 1` child of that column sizes to its CONTENT, so the inner
 * scroll view's viewport equals its content, nothing overflows and nothing
 * scrolls — the recurring "sheet won't scroll" bug, which looks like a gesture
 * problem and is not. Jest mocks gorhom, so no test can prove this: verify on the
 * simulator.
 *
 * ## ⚠ The confirm action is PINNED, not the last thing in the scroll
 *
 * The draft stage stacks items + meal picker + the label-check caveat + the
 * partial-enforcement caveat. On a multi-item suggestion with both caveats
 * active, a "Log N kcal" button at the end of that stack sits below the fold of
 * an 86 % sheet — and it is the button that WRITES TO A FOOD LOG. Relying on the
 * body scrolling to reach it makes reachability a property of content length,
 * which the user does not control.
 *
 * So the confirm lives in `BottomSheet`'s `footer`, outside the scroll. It is
 * hoisted to the top-level component for that reason; {@link DraftStage} renders
 * everything above it. Same for the setup stage's Generate button, which the
 * steer field's keyboard would otherwise push out of view.
 */

import { Pressable, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import {
  BottomSheet,
  Btn,
  Card,
  Pill,
  Segmented,
} from "@/ui/components/foundation";
import { NEUTRAL_HEX, toneHex } from "@/ui/components/foundation/tones";
import {
  IconAlert,
  IconCheck,
  IconChevronR,
  IconSparkles,
} from "@/ui/components/icons";
import type { MealSlot } from "@/domain/models/nutrition";
import {
  GENERIC_PARTIAL_ENFORCEMENT_COPY,
  LABEL_CHECK_COPY,
  MAX_STEER_LENGTH,
  SUGGEST_SHAPE_LABELS,
  partialEnforcementCopy,
  type MealprintDraft,
  type MealSuggestEmptyReason,
  type MealSuggestRemaining,
  type MealSuggestion,
  type SuggestShape,
} from "@/domain/models/mealprint";
import { MealPickerPresenter } from "../MealPickerPresenter";

/**
 * ⚠ ONE colour, TWO roles, and they must not be confused.
 *
 * `GOLD` is Mealprint's feature accent (see `MealprintEntryCard`'s design note:
 * nutrition is gold, and Fuel already is). `AMBER` is the safety channel — the
 * caveat panels. They resolve to the same token today, which is exactly why the
 * caveats carry a warning GLYPH and a bordered tinted panel rather than relying
 * on hue: a solid gold CTA and a 10 %-alpha bordered amber note are different
 * objects at a glance, and the glyph is what survives if the palette ever moves.
 * Do not "tidy" these into one constant.
 */
const GOLD = toneHex("gold");
const AMBER = toneHex("gold");

export type MealprintSuggestStage =
  | "setup"
  | "generating"
  | "results"
  | "draft"
  | "added"
  | "error";

export type MealprintSuggestSheetProps = {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly stage: MealprintSuggestStage;
  /** True when the device is offline — replaces the setup body (Snap parity). */
  readonly offline: boolean;

  readonly shape: SuggestShape;
  readonly onShapeChange: (shape: SuggestShape) => void;
  readonly steer: string;
  readonly onSteerChange: (steer: string) => void;
  readonly onGenerate: () => void;

  readonly suggestions: readonly MealSuggestion[];
  readonly emptyReason: MealSuggestEmptyReason | null;
  readonly remaining: MealSuggestRemaining | null;
  /** ⚠ Always true from the server. Gates {@link LABEL_CHECK_COPY}. */
  readonly labelCheckRequired: boolean;
  /** Active dietary patterns, for the halal/kosher enforcement caveat. */
  readonly dietaryPatterns: readonly string[];
  /**
   * The server's `partialEnforcementOnly` verdict.
   *
   * ⚠ The FLOOR beneath {@link dietaryPatterns}, not a duplicate of it. The
   * patterns are read from a local cache that may be empty on a fresh install or
   * after a failed fetch — and a halal user must still get a caveat on a result
   * the server flagged. When the patterns ARE known they win, because they let the
   * copy name what is actually enforced.
   */
  readonly serverPartialEnforcementOnly: boolean;
  /**
   * False when Fuel is showing a day other than today.
   *
   * ⚠ The sheet generates AND LOGS against the VIEWED day (the container reads
   * `useFuelSheets().date`), so saying "today" is a false claim about which day the
   * numbers describe and which day the Log button writes to. Same defect the entry
   * card's budget line had; this is the surface that card leads to, and the one
   * where the write happens.
   */
  readonly isToday: boolean;
  readonly onSelectSuggestion: (index: number) => void;

  readonly draft: MealprintDraft | null;
  readonly onToggleDraftItem: (index: number) => void;
  readonly onSlotChange: (slot: MealSlot) => void;
  readonly draftKcal: number;
  readonly onConfirm: () => void;
  readonly confirming: boolean;
  readonly onBackToResults: () => void;

  readonly errorMessage: string | null;
  readonly errorRetryable: boolean;
  /** True on a 402 — the recovery is the paywall, not a retry that will 402 again. */
  readonly errorIsEntitlement: boolean;
  readonly onRetry: () => void;
  readonly onUpgrade: () => void;

  readonly testID?: string;
};

const round = (value: number) => Math.round(value);

export function MealprintSuggestSheetPresenter(
  props: MealprintSuggestSheetProps,
) {
  const {
    visible,
    onClose,
    stage,
    offline,
    testID = "mealprint-suggest-sheet",
  } = props;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="What can I eat?"
      eyebrow="MEALPRINT · AI"
      accent="gold"
      height={86}
      footer={resolveFooter(props)}
      testID={testID}
    >
      {offline && stage === "setup" ? (
        <OfflineStage />
      ) : stage === "setup" ? (
        <SetupStage {...props} />
      ) : stage === "generating" ? (
        <GeneratingStage />
      ) : stage === "results" ? (
        <ResultsStage {...props} />
      ) : stage === "draft" || stage === "added" ? (
        <DraftStage {...props} added={stage === "added"} />
      ) : (
        <ErrorStage {...props} />
      )}
    </BottomSheet>
  );
}

/**
 * The pinned action for the current stage, or `undefined` for the stages whose
 * only action is inline (results' regenerate, error's three recoveries).
 *
 * ⚠ Returns `undefined` for a `draft` stage with a null draft. {@link DraftStage}
 * renders nothing in that case, and a lone confirm button pinned under an empty
 * body would be a button that logs an absent draft.
 */
function resolveFooter(props: MealprintSuggestSheetProps) {
  const { stage, offline, draft } = props;

  if (stage === "setup") {
    return offline ? undefined : <GenerateAction {...props} />;
  }
  if ((stage === "draft" || stage === "added") && draft !== null) {
    return <ConfirmAction {...props} added={stage === "added"} />;
  }
  return undefined;
}

function GenerateAction({ onGenerate }: MealprintSuggestSheetProps) {
  return (
    <Btn
      variant="filled"
      tone="gold"
      size="lg"
      full
      icon={<IconSparkles size={16} />}
      onPress={onGenerate}
      testID="mealprint-generate"
    >
      Give me ideas
    </Btn>
  );
}

function ConfirmAction({
  draft,
  draftKcal,
  onConfirm,
  confirming,
  added,
}: MealprintSuggestSheetProps & { added: boolean }) {
  if (draft === null) return null;
  const keptCount = draft.items.filter((item) => item.on).length;
  return (
    <Btn
      variant="filled"
      tone="gold"
      size="lg"
      full
      onPress={onConfirm}
      // `keptCount === 0` disables rather than logging nothing silently.
      disabled={added || confirming || keptCount === 0}
      testID="mealprint-draft-confirm"
    >
      {added
        ? "Added ✓"
        : confirming
          ? "Adding…"
          : `Log ${round(draftKcal)} kcal`}
    </Btn>
  );
}

function OfflineStage() {
  return (
    <View gap={12} paddingVertical={20} testID="mealprint-suggest-offline">
      <StageIcon glyph="alert" />
      <Text
        fontFamily="$display"
        fontWeight="700"
        fontSize={16}
        color="$text"
        textAlign="center"
      >
        You&apos;re offline
      </Text>
      <Text
        fontFamily="$body"
        fontSize={13}
        lineHeight={19}
        color="$text3"
        textAlign="center"
      >
        Mealprint needs a connection — try Quick Add instead.
      </Text>
    </View>
  );
}

// ── Setup ───────────────────────────────────────────────────────────────────

/**
 * ⚠ No remaining-budget panel here, and that is not an oversight.
 *
 * The design leads the sheet on the budget, and an earlier version of this pass
 * rendered {@link RemainingPanel} on setup — dead code. `remaining` comes from
 * `suggest.result?.remaining`, and the container resolves `setup` exactly when the
 * hook is `idle`, where `result` is always null (both `run()` and `reset()` null
 * it, and it is only ever set alongside `ready`). So the panel could never appear
 * before generating.
 *
 * Showing it here properly needs Fuel's own remaining figures threaded into this
 * container — a real data path, not a prop that only exists post-result. The entry
 * card that opens this sheet already states the budget, so the pre-generate gap is
 * covered for now.
 */
function SetupStage({
  shape,
  onShapeChange,
  steer,
  onSteerChange,
  isToday,
}: MealprintSuggestSheetProps) {
  return (
    <View gap={18}>
      <View gap={7}>
        <Label>What are you after</Label>
        <Segmented
          testID="mealprint-shape"
          options={(["snack", "meal", "either"] as const).map((value) => ({
            value,
            label: SUGGEST_SHAPE_LABELS[value],
          }))}
          value={shape}
          onChange={(value) => onShapeChange(value as SuggestShape)}
        />
      </View>

      <View gap={7}>
        <Label>Anything specific? (optional)</Label>
        <View
          flexDirection="row"
          alignItems="center"
          gap={8}
          height={46}
          paddingHorizontal={12}
          borderRadius={12}
          backgroundColor="$surface3"
          borderWidth={1}
          borderColor="$border2"
        >
          <IconSparkles size={14} color={NEUTRAL_HEX.text3} />
          <TextInput
            value={steer}
            onChangeText={onSteerChange}
            placeholder="Something sweet, using the chicken I have in…"
            placeholderTextColor="#8A8A98"
            maxLength={MAX_STEER_LENGTH}
            returnKeyType="done"
            accessibilityLabel="What you fancy"
            testID="mealprint-steer-input"
            style={{
              flex: 1,
              color: "#F4F4F8",
              fontFamily: "Geist",
              fontSize: 14,
              padding: 0,
            }}
          />
        </View>
      </View>

      <Text fontFamily="$body" fontSize={12} lineHeight={17} color="$text3">
        {isToday
          ? "Mealprint works from the calories and macros you have left today, and from your food preferences."
          : "Mealprint works from the calories and macros left on the day you're viewing, and from your food preferences. Anything you log goes to that day."}
      </Text>
    </View>
  );
}

function GeneratingStage() {
  return (
    <View
      alignItems="center"
      justifyContent="center"
      gap={12}
      paddingVertical={56}
      testID="mealprint-generating"
    >
      <View
        width={72}
        height={72}
        borderRadius={36}
        alignItems="center"
        justifyContent="center"
        backgroundColor="$goldDim"
        borderWidth={1}
        borderColor="$goldGlow"
      >
        <IconSparkles size={30} color={GOLD.base} />
      </View>
      <Text fontFamily="$display" fontWeight="700" fontSize={17} color="$text">
        Working out what fits…
      </Text>
      <Text
        fontFamily="$body"
        fontSize={13}
        lineHeight={19}
        color="$text3"
        textAlign="center"
      >
        Fitting a meal to your remaining macros and preferences. This takes a
        few seconds.
      </Text>
    </View>
  );
}

/** The remaining-budget readout — kcal as the headline, macros as a three-up row. */
function RemainingPanel({
  remaining,
  isToday,
}: {
  remaining: MealSuggestRemaining;
  isToday: boolean;
}) {
  return (
    <Card pad={14} radius={14} accent="gold" testID="mealprint-remaining">
      <View
        flexDirection="row"
        alignItems="baseline"
        justifyContent="space-between"
        marginBottom={10}
      >
        <Label>{isToday ? "Left today" : "Left that day"}</Label>
        <View flexDirection="row" alignItems="baseline" gap={4}>
          <Text fontFamily="$mono" fontWeight="600" fontSize={22} color="$gold">
            {round(remaining.kcal).toLocaleString("en-US")}
          </Text>
          <Text fontFamily="$mono" fontSize={11} color="$text3">
            kcal
          </Text>
        </View>
      </View>
      <View flexDirection="row" gap={8}>
        {(
          [
            ["Protein", remaining.proteinG],
            ["Carbs", remaining.carbsG],
            ["Fat", remaining.fatG],
          ] as const
        ).map(([label, grams]) => (
          <View
            key={label}
            flex={1}
            paddingHorizontal={10}
            paddingVertical={8}
            borderRadius={10}
            backgroundColor="$surface"
            borderWidth={1}
            borderColor="$border"
          >
            <Text
              fontFamily="$display"
              fontSize={9}
              fontWeight="600"
              letterSpacing={1.2}
              textTransform="uppercase"
              color="$text3"
            >
              {label}
            </Text>
            <Text
              fontFamily="$mono"
              fontWeight="600"
              fontSize={15}
              color="$text"
              marginTop={3}
            >
              {round(grams)}g
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** A centred glyph disc for the empty / offline / error bodies. */
function StageIcon({ glyph }: { glyph: "alert" | "sparkles" }) {
  return (
    <View alignItems="center">
      <View
        width={56}
        height={56}
        borderRadius={28}
        alignItems="center"
        justifyContent="center"
        backgroundColor="$goldDim"
        borderWidth={1}
        borderColor="$border2"
      >
        {glyph === "alert" ? (
          <IconAlert size={24} color={AMBER.base} />
        ) : (
          <IconSparkles size={24} color={GOLD.base} />
        )}
      </View>
    </View>
  );
}

// ── Results ─────────────────────────────────────────────────────────────────

/**
 * Copy per {@link MealSuggestEmptyReason}. Each names the actual cause and the
 * action that resolves it — see the file docstring for why a generic error would
 * be wrong here, and `no_candidates` in particular.
 */
const EMPTY_COPY: Readonly<
  Record<
    MealSuggestEmptyReason | "budget_exhausted_other_day",
    { title: string; body: string }
  >
> = {
  no_targets: {
    title: "Set your targets first",
    body: "Mealprint fills the gap between what you've eaten and your daily target — so it needs a target to aim at.",
  },
  // ⚠ The only DAY-DEPENDENT empty reason — `no_targets` and `no_candidates` are
  // day-agnostic. The server answers for the VIEWED day, so "today" is a false
  // claim on any other one. Same defect the setup copy and the entry card were
  // fixed for; this was the third instance in the same function.
  budget_exhausted: {
    title: "You're done for today",
    body: "There aren't enough calories left in your day for Mealprint to suggest anything worth logging.",
  },
  budget_exhausted_other_day: {
    title: "That day is already full",
    body: "There aren't enough calories left on the day you're viewing for Mealprint to suggest anything worth logging.",
  },
  no_candidates: {
    title: "Nothing matched your preferences",
    body: "Your dietary pattern and avoid list rule out everything we can currently vouch for. Try removing an allergen or a dislike, or add a few of your own foods and recipes.",
  },
};

/**
 * The partial-enforcement caveat, preferring the SPECIFIC copy when this device
 * knows which pattern is active and falling back to the generic one when only the
 * server's flag is available.
 *
 * ⚠ Returning `null` when the server says `true` is the bug this replaced: the
 * patterns come from a local cache that is empty on a fresh install and stays
 * empty if the preferences fetch fails, so a halal user could be shown a flagged
 * result with no caveat at all (locked decision 10).
 */
function resolvePartialCaveat(
  dietaryPatterns: readonly string[],
  serverPartialEnforcementOnly: boolean,
): string | null {
  const specific = partialEnforcementCopy(dietaryPatterns);
  if (specific !== null) return specific;
  return serverPartialEnforcementOnly ? GENERIC_PARTIAL_ENFORCEMENT_COPY : null;
}

function ResultsStage(props: MealprintSuggestSheetProps) {
  const {
    suggestions,
    emptyReason,
    remaining,
    labelCheckRequired,
    dietaryPatterns,
    serverPartialEnforcementOnly,
    onSelectSuggestion,
    onRetry,
    isToday,
  } = props;

  if (emptyReason !== null) {
    const copy =
      emptyReason === "budget_exhausted" && !isToday
        ? EMPTY_COPY.budget_exhausted_other_day
        : EMPTY_COPY[emptyReason];
    return (
      <View
        gap={12}
        paddingVertical={16}
        testID={`mealprint-empty-${emptyReason}`}
      >
        {/* ⚠ Composed as an ANSWER, not a failure. `no_candidates` in particular
            is the first thing a real entitled user will see until the Open Food
            Facts re-seed lands, so it gets the same care as the happy path: a
            neutral glyph rather than an error one, and the body centred with the
            actions it names. */}
        <StageIcon glyph="alert" />
        <Text
          fontFamily="$display"
          fontWeight="700"
          fontSize={17}
          color="$text"
          textAlign="center"
        >
          {copy.title}
        </Text>
        <Text
          fontFamily="$body"
          fontSize={13}
          lineHeight={19.5}
          color="$text2"
          textAlign="center"
        >
          {copy.body}
        </Text>
      </View>
    );
  }

  const partialCaveat = resolvePartialCaveat(
    dietaryPatterns,
    serverPartialEnforcementOnly,
  );

  return (
    <View gap={14}>
      {remaining ? (
        <RemainingPanel remaining={remaining} isToday={isToday} />
      ) : null}

      {suggestions.map((suggestion, index) => (
        <SuggestionCard
          key={`${suggestion.name}-${index}`}
          suggestion={suggestion}
          index={index}
          onPress={() => onSelectSuggestion(index)}
        />
      ))}

      {/* ⚠ On `labelCheckRequired` — which is always true. NOT on
          `containsUnverified`. See the file docstring. */}
      {labelCheckRequired ? (
        <Caveat
          text={LABEL_CHECK_COPY}
          testID="mealprint-label-check-disclaimer"
        />
      ) : null}

      {partialCaveat ? (
        <Caveat text={partialCaveat} testID="mealprint-partial-enforcement" />
      ) : null}

      <Btn
        variant="outline"
        tone="gold"
        size="md"
        full
        onPress={onRetry}
        testID="mealprint-regenerate"
      >
        Show me something else
      </Btn>
    </View>
  );
}

function SuggestionCard({
  suggestion,
  index,
  onPress,
}: {
  suggestion: MealSuggestion;
  index: number;
  onPress: () => void;
}) {
  return (
    <Card
      pad={14}
      radius={14}
      onPress={onPress}
      testID={`mealprint-suggestion-${index}`}
      accessibilityRole="button"
      accessibilityLabel={`${suggestion.name}, ${round(suggestion.kcal)} calories`}
    >
      <View gap={10}>
        {/* The stronger per-suggestion flag: at least one item's allergen
            content is entirely unknown. Distinct from the unconditional
            label-check line below the list. Given its own row so it reads as a
            property of the suggestion rather than a decoration on the title. */}
        {suggestion.containsUnverified ? (
          <View flexDirection="row">
            <Pill tone="gold" size="xs">
              UNVERIFIED
            </Pill>
          </View>
        ) : null}

        {/* Name left, calories right — the two things a user compares across
            cards, each in a fixed column so the eye can scan down either. */}
        <View flexDirection="row" alignItems="flex-start" gap={10}>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={15.5}
            lineHeight={21}
            color="$text"
            flex={1}
          >
            {suggestion.name}
          </Text>
          <View alignItems="flex-end" flexShrink={0}>
            <Text
              fontFamily="$mono"
              fontWeight="600"
              fontSize={19}
              color="$gold"
            >
              {round(suggestion.kcal).toLocaleString("en-US")}
            </Text>
            <Text
              fontFamily="$display"
              fontSize={8.5}
              fontWeight="600"
              letterSpacing={1.2}
              color="$text3"
            >
              KCAL
            </Text>
          </View>
        </View>

        {/* Untrusted model prose — plain text only, never markup or a link.
            The sparkle marks it as the model's reasoning rather than our copy. */}
        <View flexDirection="row" gap={7}>
          <View paddingTop={2}>
            <IconSparkles size={12} color={GOLD.base} />
          </View>
          <Text
            fontFamily="$body"
            fontSize={12.5}
            lineHeight={18}
            color="$text2"
            flex={1}
          >
            {suggestion.reason}
          </Text>
        </View>

        <View flexDirection="row" gap={6}>
          <Pill tone="primary" size="xs">
            P {round(suggestion.proteinG)}g
          </Pill>
          <Pill tone="gold" size="xs">
            C {round(suggestion.carbsG)}g
          </Pill>
          <Pill tone="ember" size="xs">
            F {round(suggestion.fatG)}g
          </Pill>
        </View>

        <View gap={4} paddingTop={2}>
          {suggestion.items.map((item, itemIndex) => (
            <View
              key={`${item.candidateId}-${itemIndex}`}
              flexDirection="row"
              alignItems="center"
              gap={8}
            >
              <View
                width={4}
                height={4}
                borderRadius={2}
                backgroundColor="$text4"
                flexShrink={0}
              />
              <Text
                fontFamily="$body"
                fontSize={12}
                color="$text3"
                flex={1}
                numberOfLines={2}
              >
                {item.name} — {formatServings(item.servings)} ×{" "}
                {item.servingLabel}
              </Text>
            </View>
          ))}
        </View>

        <View
          flexDirection="row"
          alignItems="center"
          justifyContent="flex-end"
          gap={4}
          paddingTop={2}
        >
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={12.5}
            color="$gold"
          >
            Review and log
          </Text>
          <IconChevronR size={14} color={GOLD.base} />
        </View>
      </View>
    </Card>
  );
}

// ── Draft confirm ───────────────────────────────────────────────────────────

/**
 * The draft-confirm step (locked decision 3): nothing is logged until the user
 * says so, and each item can be dropped first.
 *
 * ⚠ Items are toggled, not RESCALED. `AiDraftConfirmPresenter` offers a grams
 * editor, and it is right to — a Snap estimate is a guess about a portion. A
 * Mealprint item is `1.5 × "30 g scoop"` of a specific catalogue row, and its
 * macros were recomputed server-side from that row. A grams box against a serving
 * multiplier would either be a lie about the unit or a client-side recompute of
 * numbers the whole pipeline exists to keep server-authoritative. Portion editing
 * belongs in the plan-review flow (AC 4.4), where the contract supports it.
 *
 * ⚠ The confirm button is NOT rendered here — {@link resolveFooter} pins it in
 * the sheet footer. See the file docstring: this stack (items + picker + two
 * conditional caveats) is exactly what pushed it below the fold of an 86 % sheet.
 */
function DraftStage({
  draft,
  onToggleDraftItem,
  onSlotChange,
  confirming,
  onBackToResults,
  labelCheckRequired,
  dietaryPatterns,
  serverPartialEnforcementOnly,
  added,
}: MealprintSuggestSheetProps & { added: boolean }) {
  if (draft === null) return null;
  const partialCaveat = resolvePartialCaveat(
    dietaryPatterns,
    serverPartialEnforcementOnly,
  );

  return (
    <View gap={16} testID="mealprint-draft">
      <View flexDirection="row" alignItems="center" gap={8}>
        <Text
          fontFamily="$display"
          fontWeight="700"
          fontSize={16}
          color="$text"
          flex={1}
        >
          {draft.suggestion.name}
        </Text>
        <Pressable
          onPress={onBackToResults}
          disabled={added || confirming}
          testID="mealprint-draft-back"
          accessibilityRole="button"
          accessibilityLabel="Back to the other ideas"
        >
          <Text fontFamily="$body" fontSize={12.5} color="$text3">
            Back
          </Text>
        </Pressable>
      </View>

      <View gap={8}>
        {draft.items.map((item, index) => (
          <Pressable
            key={`${item.candidateId}-${index}`}
            onPress={() => onToggleDraftItem(index)}
            disabled={added || confirming}
            testID={`mealprint-draft-item-${index}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.on }}
            accessibilityLabel={item.name}
          >
            <View
              flexDirection="row"
              alignItems="center"
              gap={10}
              paddingHorizontal={12}
              paddingVertical={11}
              borderRadius={12}
              backgroundColor={item.on ? "$surface2" : "$surface"}
              borderWidth={1}
              borderColor={item.on ? "$goldDim" : "$border"}
              opacity={item.on ? 1 : 0.55}
            >
              <View
                width={20}
                height={20}
                borderRadius={6}
                alignItems="center"
                justifyContent="center"
                backgroundColor={item.on ? "$goldDim" : "transparent"}
                borderWidth={1}
                borderColor={item.on ? "$gold" : "$border3"}
              >
                {item.on ? <IconCheck size={13} color={GOLD.base} /> : null}
              </View>
              <View flex={1} gap={2}>
                <Text
                  fontFamily="$body"
                  fontSize={13.5}
                  color="$text"
                  numberOfLines={2}
                >
                  {item.name}
                </Text>
                <Text fontFamily="$body" fontSize={11.5} color="$text3">
                  {formatServings(item.servings)} × {item.servingLabel}
                  {item.unverified ? " · allergens unknown" : ""}
                </Text>
              </View>
              <Text fontFamily="$mono" fontSize={13} color="$text2">
                {round(item.kcal)}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>

      <MealPickerPresenter
        value={draft.slot}
        onChange={onSlotChange}
        testID="mealprint-draft-slot"
      />

      {labelCheckRequired ? (
        <Caveat
          text={LABEL_CHECK_COPY}
          testID="mealprint-draft-label-check-disclaimer"
        />
      ) : null}

      {/* ⚠ Repeated here, not only on the results list. This is the step that
          LOGS — a user who scrolled past the caveat while browsing three cards
          should still meet it at the point of committing one to their day. */}
      {partialCaveat ? (
        <Caveat
          text={partialCaveat}
          testID="mealprint-draft-partial-enforcement"
        />
      ) : null}
    </View>
  );
}

function ErrorStage({
  errorMessage,
  errorRetryable,
  errorIsEntitlement,
  onRetry,
  onUpgrade,
  onClose,
}: MealprintSuggestSheetProps) {
  return (
    <View gap={16} testID="mealprint-suggest-error">
      <Text fontFamily="$body" fontSize={14} lineHeight={20} color="$text2">
        {errorMessage ?? "Couldn't reach Mealprint."}
      </Text>
      {/* Three distinct recoveries, because the three failure classes have three
          different right answers. ⚠ In particular there is NO retry button on the
          daily ceiling: "try again" is actively wrong advice for the rest of the
          day, and offering it is how a user burns a minute discovering that. */}
      {errorIsEntitlement ? (
        <Btn
          variant="filled"
          tone="gold"
          size="lg"
          full
          onPress={onUpgrade}
          testID="mealprint-error-upgrade"
        >
          See Premium+
        </Btn>
      ) : errorRetryable ? (
        <Btn
          variant="filled"
          tone="gold"
          size="lg"
          full
          onPress={onRetry}
          testID="mealprint-error-retry"
        >
          Try again
        </Btn>
      ) : (
        <Btn
          variant="outline"
          tone="gold"
          size="md"
          full
          onPress={onClose}
          testID="mealprint-error-dismiss"
        >
          Close
        </Btn>
      )}
    </View>
  );
}

// ── Bits ────────────────────────────────────────────────────────────────────

function Label({ children }: { children: string }) {
  return (
    <Text
      fontFamily="$display"
      fontSize={10.5}
      fontWeight="600"
      letterSpacing={1.5}
      textTransform="uppercase"
      color="$text3"
      paddingLeft={2}
    >
      {children}
    </Text>
  );
}

function Caveat({ text, testID }: { text: string; testID: string }) {
  return (
    <View
      flexDirection="row"
      gap={8}
      paddingHorizontal={12}
      paddingVertical={10}
      borderRadius={10}
      // Via AMBER, not the raw token: the two-constant split exists so the
      // safety channel can move independently of the feature gold, and a
      // hardcoded "$goldDim" here would leave the panel behind when it does.
      backgroundColor={AMBER.dim}
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

/** "1", "1.5", "0.25" — trailing zeros dropped so a whole serving reads whole. */
function formatServings(servings: number): string {
  return Number(servings.toFixed(2)).toString();
}
