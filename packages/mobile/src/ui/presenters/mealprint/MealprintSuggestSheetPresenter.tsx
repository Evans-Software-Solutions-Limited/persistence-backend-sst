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
import { toneHex } from "@/ui/components/foundation/tones";
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

const AMBER = toneHex("gold");
const PRIMARY = toneHex("primary");

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
      accent="primary"
      height={86}
      testID={testID}
    >
      {offline && stage === "setup" ? (
        <View gap={16} testID="mealprint-suggest-offline">
          <Text fontFamily="$body" fontSize={14} color="$text2">
            Mealprint needs a connection — try Quick Add instead.
          </Text>
        </View>
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

// ── Setup ───────────────────────────────────────────────────────────────────

function SetupStage({
  shape,
  onShapeChange,
  steer,
  onSteerChange,
  onGenerate,
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
          height={44}
          paddingHorizontal={12}
          borderRadius={12}
          backgroundColor="$surface3"
          borderWidth={1}
          borderColor="$border2"
          justifyContent="center"
        >
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
              color: "#F4F4F8",
              fontFamily: "Geist",
              fontSize: 14,
              padding: 0,
            }}
          />
        </View>
      </View>

      <Btn
        variant="filled"
        tone="primary"
        size="lg"
        full
        icon={<IconSparkles size={16} />}
        onPress={onGenerate}
        testID="mealprint-generate"
      >
        Give me ideas
      </Btn>

      <Text fontFamily="$body" fontSize={12} lineHeight={17} color="$text3">
        Mealprint works from the calories and macros you have left today, and
        from your food preferences.
      </Text>
    </View>
  );
}

function GeneratingStage() {
  return (
    <View
      alignItems="center"
      justifyContent="center"
      gap={10}
      paddingVertical={48}
      testID="mealprint-generating"
    >
      <IconSparkles size={22} color={PRIMARY.base} />
      <Text
        fontFamily="$display"
        fontWeight="700"
        fontSize={14}
        color="$primary"
      >
        Working out what fits…
      </Text>
      <Text fontFamily="$body" fontSize={12} color="$text3">
        This takes a few seconds.
      </Text>
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
  Record<MealSuggestEmptyReason, { title: string; body: string }>
> = {
  no_targets: {
    title: "Set your targets first",
    body: "Mealprint fills the gap between what you've eaten and your daily target — so it needs a target to aim at.",
  },
  budget_exhausted: {
    title: "You're done for today",
    body: "There aren't enough calories left in your day for Mealprint to suggest anything worth logging.",
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
  } = props;

  if (emptyReason !== null) {
    const copy = EMPTY_COPY[emptyReason];
    return (
      <View gap={14} testID={`mealprint-empty-${emptyReason}`}>
        <Text
          fontFamily="$display"
          fontWeight="700"
          fontSize={16}
          color="$text"
        >
          {copy.title}
        </Text>
        <Text fontFamily="$body" fontSize={13} lineHeight={19} color="$text2">
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
        <View gap={4} testID="mealprint-remaining">
          <Label>Left today</Label>
          <Text fontFamily="$mono" fontSize={14} color="$text2">
            {round(remaining.kcal)} kcal · {round(remaining.proteinG)}P{" "}
            {round(remaining.carbsG)}C {round(remaining.fatG)}F
          </Text>
        </View>
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
        tone="primary"
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
      <View gap={9}>
        <View flexDirection="row" alignItems="center" gap={8}>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={15}
            color="$text"
            flex={1}
          >
            {suggestion.name}
          </Text>
          {/* The stronger per-suggestion flag: at least one item's allergen
              content is entirely unknown. Distinct from the unconditional
              label-check line below the list. */}
          {suggestion.containsUnverified ? (
            <Pill tone="gold" size="xs">
              UNVERIFIED
            </Pill>
          ) : null}
          <IconChevronR size={15} color={PRIMARY.base} />
        </View>

        <Text fontFamily="$mono" fontSize={13} color="$primary">
          {round(suggestion.kcal)} kcal · {round(suggestion.proteinG)}P{" "}
          {round(suggestion.carbsG)}C {round(suggestion.fatG)}F
        </Text>

        {/* Untrusted model prose — plain text only, never markup or a link. */}
        <Text fontFamily="$body" fontSize={12.5} lineHeight={18} color="$text2">
          {suggestion.reason}
        </Text>

        <View gap={3}>
          {suggestion.items.map((item, itemIndex) => (
            <Text
              key={`${item.candidateId}-${itemIndex}`}
              fontFamily="$body"
              fontSize={12}
              color="$text3"
            >
              {item.name} — {formatServings(item.servings)} ×{" "}
              {item.servingLabel}
            </Text>
          ))}
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
 */
function DraftStage({
  draft,
  onToggleDraftItem,
  onSlotChange,
  draftKcal,
  onConfirm,
  confirming,
  onBackToResults,
  labelCheckRequired,
  dietaryPatterns,
  serverPartialEnforcementOnly,
  added,
}: MealprintSuggestSheetProps & { added: boolean }) {
  if (draft === null) return null;
  const keptCount = draft.items.filter((item) => item.on).length;
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
              borderColor={item.on ? "$primaryDim" : "$border"}
              opacity={item.on ? 1 : 0.55}
            >
              <View
                width={20}
                height={20}
                borderRadius={6}
                alignItems="center"
                justifyContent="center"
                backgroundColor={item.on ? "$primaryDim" : "transparent"}
                borderWidth={1}
                borderColor={item.on ? "$primary" : "$border3"}
              >
                {item.on ? <IconCheck size={13} color={PRIMARY.base} /> : null}
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

      <Btn
        variant="filled"
        tone="primary"
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
          tone="primary"
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
          tone="primary"
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
          tone="primary"
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

/** "1", "1.5", "0.25" — trailing zeros dropped so a whole serving reads whole. */
function formatServings(servings: number): string {
  return Number(servings.toFixed(2)).toString();
}
