import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { fireEvent, within } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import {
  AVOID_ALLERGENS,
  DIETARY_PATTERNS,
  LABEL_CHECK_COPY,
  MEDICAL_SCOPE_COPY,
  draftFromSuggestion,
  type MealSuggestion,
} from "@/domain/models/mealprint";
import {
  MealprintEntryCard,
  type MealprintEntryCardProps,
} from "../MealprintEntryCard";
import {
  MealprintPreferencesPresenter,
  type MealprintPreferencesProps,
} from "../MealprintPreferencesPresenter";
import {
  MealprintSuggestSheetPresenter,
  type MealprintSuggestSheetProps,
} from "../MealprintSuggestSheetPresenter";

// ─── MealprintEntryCard ────────────────────────────────────────────────────

function cardProps(
  over: Partial<MealprintEntryCardProps> = {},
): MealprintEntryCardProps {
  return {
    state: "unlocked",
    needsSetup: false,
    onPress: jest.fn(),
    onUpgrade: jest.fn(),
    onRetry: jest.fn(),
    ...over,
  };
}

describe("MealprintEntryCard", () => {
  it("opens the flow when unlocked", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintEntryCard {...cardProps({ onPress })} />,
    );
    fireEvent.press(getByTestId("mealprint-entry-card"));
    expect(onPress).toHaveBeenCalled();
  });

  it("routes a locked press to the UPGRADE handler, not the flow", () => {
    const onPress = jest.fn();
    const onUpgrade = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintEntryCard
        {...cardProps({ state: "locked", onPress, onUpgrade })}
      />,
    );
    fireEvent.press(getByTestId("mealprint-entry-card"));
    expect(onUpgrade).toHaveBeenCalled();
    expect(onPress).not.toHaveBeenCalled();
  });

  it("⚠ does NOT say 'unlock' while pending — the padlock copy belongs to `locked` alone", () => {
    // During the cold-start `/subscriptions/me` round trip a paying Premium+ user
    // is indistinguishable from a free one, and Fuel is a tab, so locked copy here
    // pitches the feature to its owner on every launch.
    const { queryByText } = renderWithTheme(
      <MealprintEntryCard {...cardProps({ state: "pending" })} />,
    );
    expect(queryByText(/Unlock/i)).toBeNull();
    expect(queryByText(/Checking your plan/i)).toBeTruthy();
  });

  it("is inert while pending", () => {
    const onPress = jest.fn();
    const onUpgrade = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintEntryCard
        {...cardProps({ state: "pending", onPress, onUpgrade })}
      />,
    );
    fireEvent.press(getByTestId("mealprint-entry-card"));
    expect(onPress).not.toHaveBeenCalled();
    expect(onUpgrade).not.toHaveBeenCalled();
  });

  it("renders a distinct stalled body whose press RETRIES (never upsells)", () => {
    const onUpgrade = jest.fn();
    const onRetry = jest.fn();
    const { getByTestId, queryByTestId } = renderWithTheme(
      <MealprintEntryCard
        {...cardProps({ state: "stalled", onRetry, onUpgrade })}
      />,
    );
    expect(queryByTestId("mealprint-entry-card")).toBeNull();
    fireEvent.press(getByTestId("mealprint-entry-stalled"));
    expect(onRetry).toHaveBeenCalled();
    expect(onUpgrade).not.toHaveBeenCalled();
  });

  it("says 'set up' only when unlocked AND needing setup", () => {
    const setup = renderWithTheme(
      <MealprintEntryCard {...cardProps({ needsSetup: true })} />,
    );
    expect(setup.queryByText(/Set up how you eat/i)).toBeTruthy();

    // ⚠ An unentitled user must not be told to configure a feature they cannot
    // reach.
    const locked = renderWithTheme(
      <MealprintEntryCard
        {...cardProps({ state: "locked", needsSetup: true })}
      />,
    );
    expect(locked.queryByText(/Set up how you eat/i)).toBeNull();
  });

  it("shows a state-appropriate CTA, and names it in the card's a11y label", () => {
    // ⚠ The CTA is an APPEARANCE over the card's single touch target, not a
    // nested Pressable — see its comment. So the contract is (a) the right label
    // renders, and (b) the card announces it, because a nested button's text
    // would never be announced on iOS.
    const unlocked = renderWithTheme(<MealprintEntryCard {...cardProps()} />);
    expect(unlocked.getByTestId("mealprint-entry-cta")).toBeTruthy();
    expect(unlocked.queryByText("Suggest a meal")).toBeTruthy();
    expect(
      unlocked.getByTestId("mealprint-entry-card").props.accessibilityLabel,
    ).toMatch(/Suggest a meal/);

    const setup = renderWithTheme(
      <MealprintEntryCard {...cardProps({ needsSetup: true })} />,
    );
    expect(setup.queryByText("Set up Mealprint")).toBeTruthy();
    expect(
      setup.getByTestId("mealprint-entry-card").props.accessibilityLabel,
    ).toMatch(/Set up Mealprint/);

    const locked = renderWithTheme(
      <MealprintEntryCard {...cardProps({ state: "locked" })} />,
    );
    expect(locked.queryByText("See Premium+")).toBeTruthy();
    const lockedLabel = locked.getByTestId("mealprint-entry-card").props
      .accessibilityLabel;
    expect(lockedLabel).toMatch(/locked/i);
    // ⚠ Inspector Brad proved this was unguarded: dropping `${cta}` from the
    // locked branch left all 91 tests green.
    expect(lockedLabel).toMatch(/See Premium\+/);
  });

  it("⚠ speaks the SUBTITLE in the a11y label — the card is one grouped element", () => {
    // Without it the concrete budget line, which is the entire reason for showing
    // one, never reaches VoiceOver.
    const withBudget = renderWithTheme(
      <MealprintEntryCard
        {...cardProps({ remainingKcal: 1160, remainingProteinG: 84 })}
      />,
    );
    expect(
      withBudget.getByTestId("mealprint-entry-card").props.accessibilityLabel,
    ).toMatch(/1,160 kcal and 84g protein left today/);

    const setup = renderWithTheme(
      <MealprintEntryCard {...cardProps({ needsSetup: true })} />,
    );
    expect(
      setup.getByTestId("mealprint-entry-card").props.accessibilityLabel,
    ).toMatch(/Set up how you eat/);
  });

  it("⚠ exposes exactly ONE pressable, so VoiceOver hears the CTA and Android sees no duplicate", () => {
    // A <Btn> here would nest a Pressable inside the card's Pressable: on iOS the
    // inner text is never announced, on Android it reads as a second button with
    // the same action.
    const { getByTestId } = renderWithTheme(
      <MealprintEntryCard {...cardProps()} />,
    );
    const cta = getByTestId("mealprint-entry-cta");
    expect(cta.props.accessibilityRole).toBeUndefined();
    expect(cta.props.onStartShouldSetResponder).toBeUndefined();
  });

  it("⚠ shows no CTA while pending — an inert card must not invite the tap it eats", () => {
    const { queryByTestId } = renderWithTheme(
      <MealprintEntryCard {...cardProps({ state: "pending" })} />,
    );
    expect(queryByTestId("mealprint-entry-cta")).toBeNull();
  });

  it("leads on the real remaining budget when Fuel knows it", () => {
    const { queryByText } = renderWithTheme(
      <MealprintEntryCard
        {...cardProps({ remainingKcal: 1160, remainingProteinG: 84 })}
      />,
    );
    expect(queryByText(/1,160 kcal and 84g protein left today/)).toBeTruthy();
  });

  it("drops protein from the line when there is none owing, keeping the sentence", () => {
    const { queryByText } = renderWithTheme(
      <MealprintEntryCard
        {...cardProps({ remainingKcal: 620, remainingProteinG: -5 })}
      />,
    );
    expect(queryByText(/620 kcal left today/)).toBeTruthy();
    expect(queryByText(/protein/)).toBeNull();
  });

  it("falls back to the generic line with no budget, and never quotes one over a padlock", () => {
    const noBudget = renderWithTheme(
      <MealprintEntryCard {...cardProps({ remainingKcal: null })} />,
    );
    expect(
      noBudget.queryByText(/Ideas that fit the calories and protein/),
    ).toBeTruthy();

    // ⚠ Quoting a real number to someone who cannot act on it sharpens an
    // upsell rather than helping them.
    const locked = renderWithTheme(
      <MealprintEntryCard
        {...cardProps({ state: "locked", remainingKcal: 1160 })}
      />,
    );
    expect(locked.queryByText(/1,160/)).toBeNull();

    // …and the same while the entitlement is still unknown.
    const pending = renderWithTheme(
      <MealprintEntryCard
        {...cardProps({ state: "pending", remainingKcal: 1160 })}
      />,
    );
    expect(pending.queryByText(/1,160/)).toBeNull();
  });

  it("prints no price literal in any state", () => {
    // premium_plus ships is_active=false, so there is no price yet — and a
    // hardcoded one is how the retired £19.99 would have survived the reprice.
    for (const state of ["pending", "locked", "unlocked", "stalled"] as const) {
      const { queryByText } = renderWithTheme(
        <MealprintEntryCard {...cardProps({ state })} />,
      );
      expect(queryByText(/£/)).toBeNull();
    }
  });
});

// ─── MealprintPreferencesPresenter ─────────────────────────────────────────

function prefProps(
  over: Partial<MealprintPreferencesProps> = {},
): MealprintPreferencesProps {
  return {
    mode: "editor",
    isLoadingInitial: false,
    isSaving: false,
    errorMessage: null,
    loadFailed: false,
    onRetryLoad: jest.fn(),
    dietaryPatterns: [],
    onTogglePattern: jest.fn(),
    avoidAllergens: [],
    onToggleAllergen: jest.fn(),
    avoidFoods: [],
    avoidFoodDraft: "",
    onAvoidFoodDraftChange: jest.fn(),
    onAddAvoidFood: jest.fn(),
    onRemoveAvoidFood: jest.fn(),
    likedFoods: [],
    likedFoodDraft: "",
    onLikedFoodDraftChange: jest.fn(),
    onAddLikedFood: jest.fn(),
    onRemoveLikedFood: jest.fn(),
    mealsPerDay: 4,
    onMealsPerDayChange: jest.fn(),
    effortLevel: "balanced",
    onEffortLevelChange: jest.fn(),
    onSave: jest.fn(),
    onDismiss: jest.fn(),
    ...over,
  };
}

describe("MealprintPreferencesPresenter", () => {
  it("renders a chip per pattern and per allergen", () => {
    const { getByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps()} />,
    );
    for (const pattern of DIETARY_PATTERNS) {
      expect(getByTestId(`mealprint-pattern-${pattern}`)).toBeTruthy();
    }
    for (const allergen of AVOID_ALLERGENS) {
      expect(getByTestId(`mealprint-allergen-${allergen}`)).toBeTruthy();
    }
  });

  it("⚠ shows the AC 1.2 disclaimer verbatim once an allergen chip is active", () => {
    const off = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps()} />,
    );
    expect(off.queryByTestId("mealprint-label-check-disclaimer")).toBeNull();

    const on = renderWithTheme(
      <MealprintPreferencesPresenter
        {...prefProps({ avoidAllergens: ["peanuts"] })}
      />,
    );
    expect(on.getByTestId("mealprint-label-check-disclaimer")).toBeTruthy();
    expect(on.queryByText(LABEL_CHECK_COPY)).toBeTruthy();
  });

  it("⚠ tells the user the dislike list is name-matched only, so 'peanuts' typed there is not an allergy declaration", () => {
    const { getByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps()} />,
    );
    const footnote = getByTestId("mealprint-dislike-footnote");
    expect(footnote).toBeTruthy();
    expect(getByTestId("mealprint-dislike-footnote").props.children).toMatch(
      /allergen chips above/i,
    );
  });

  it("gives the LIKE list no such footnote (it makes no safety claim to disclaim)", () => {
    const { queryByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps()} />,
    );
    expect(queryByTestId("mealprint-like-footnote")).toBeNull();
  });

  it("shows the halal/kosher enforcement caveat only for those patterns", () => {
    const vegan = renderWithTheme(
      <MealprintPreferencesPresenter
        {...prefProps({ dietaryPatterns: ["vegan"] })}
      />,
    );
    expect(vegan.queryByTestId("mealprint-partial-enforcement")).toBeNull();

    const halal = renderWithTheme(
      <MealprintPreferencesPresenter
        {...prefProps({ dietaryPatterns: ["halal"] })}
      />,
    );
    expect(halal.getByTestId("mealprint-partial-enforcement")).toBeTruthy();
  });

  it("shows the medical-scope line (AC 1.5) in BOTH modes", () => {
    for (const mode of ["wizard", "editor"] as const) {
      const { getByTestId } = renderWithTheme(
        <MealprintPreferencesPresenter {...prefProps({ mode })} />,
      );
      expect(getByTestId("mealprint-medical-scope").props.children).toBe(
        MEDICAL_SCOPE_COPY,
      );
    }
  });

  it("labels the dismiss action Skip in the wizard and Cancel in the editor", () => {
    const wizard = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps({ mode: "wizard" })} />,
    );
    expect(wizard.queryByText("Skip")).toBeTruthy();
    expect(wizard.getByTestId("mealprint-preferences-intro")).toBeTruthy();

    const editor = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps({ mode: "editor" })} />,
    );
    expect(editor.queryByText("Cancel")).toBeTruthy();
    expect(editor.queryByTestId("mealprint-preferences-intro")).toBeNull();
  });

  it("toggles a pattern and an allergen through their handlers", () => {
    const onTogglePattern = jest.fn();
    const onToggleAllergen = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter
        {...prefProps({ onTogglePattern, onToggleAllergen })}
      />,
    );
    fireEvent.press(getByTestId("mealprint-pattern-vegan"));
    expect(onTogglePattern).toHaveBeenCalledWith("vegan");
    fireEvent.press(getByTestId("mealprint-allergen-sesame"));
    expect(onToggleAllergen).toHaveBeenCalledWith("sesame");
  });

  it("clamps the meals stepper at 2 and 6", () => {
    const low = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps({ mealsPerDay: 2 })} />,
    );
    expect(
      low.getByTestId("mealprint-meals-dec").props.accessibilityState,
    ).toMatchObject({ disabled: true });

    const high = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps({ mealsPerDay: 6 })} />,
    );
    expect(
      high.getByTestId("mealprint-meals-inc").props.accessibilityState,
    ).toMatchObject({ disabled: true });
  });

  it("steps the meal count through the handler", () => {
    const onMealsPerDayChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter
        {...prefProps({ mealsPerDay: 4, onMealsPerDayChange })}
      />,
    );
    fireEvent.press(getByTestId("mealprint-meals-inc"));
    expect(onMealsPerDayChange).toHaveBeenCalledWith(5);
    fireEvent.press(getByTestId("mealprint-meals-dec"));
    expect(onMealsPerDayChange).toHaveBeenCalledWith(3);
  });

  it("disables Add on an empty free-text draft and enables it once typed", () => {
    const onAddAvoidFood = jest.fn();
    const empty = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps({ onAddAvoidFood })} />,
    );
    fireEvent.press(empty.getByTestId("mealprint-dislike-add"));
    expect(onAddAvoidFood).not.toHaveBeenCalled();

    const typed = renderWithTheme(
      <MealprintPreferencesPresenter
        {...prefProps({ avoidFoodDraft: "olives", onAddAvoidFood })}
      />,
    );
    fireEvent.press(typed.getByTestId("mealprint-dislike-add"));
    expect(onAddAvoidFood).toHaveBeenCalled();
  });

  it("removes a free-text chip on press", () => {
    const onRemoveAvoidFood = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter
        {...prefProps({ avoidFoods: ["olives"], onRemoveAvoidFood })}
      />,
    );
    fireEvent.press(getByTestId("mealprint-dislike-chip-olives"));
    expect(onRemoveAvoidFood).toHaveBeenCalledWith("olives");
  });

  it("shows the loader instead of the form on a cold cache", () => {
    const { queryByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter
        {...prefProps({ isLoadingInitial: true })}
      />,
    );
    expect(queryByTestId("mealprint-preferences-save")).toBeNull();
  });

  it("surfaces the server's error message rather than a generic one", () => {
    const { getByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter
        {...prefProps({ errorMessage: "avoidFoods: 61 items exceeds 60" })}
      />,
    );
    expect(
      getByTestId("mealprint-preferences-error").props.children,
    ).toBeTruthy();
  });
});

// ─── MealprintSuggestSheetPresenter ────────────────────────────────────────

function suggestion(over: Partial<MealSuggestion> = {}): MealSuggestion {
  return {
    name: "Greek yoghurt & berries",
    reason: "Gets your protein in for 195 kcal.",
    items: [
      {
        candidateId: "food-1",
        kind: "food",
        name: "Greek yoghurt 0%",
        servings: 1.5,
        servingLabel: "170 g pot",
        kcal: 150,
        proteinG: 25,
        carbsG: 9,
        fatG: 0,
        unverified: false,
      },
    ],
    kcal: 195,
    proteinG: 26,
    carbsG: 20,
    fatG: 0,
    containsUnverified: false,
    partialEnforcementOnly: false,
    ...over,
  };
}

function sheetProps(
  over: Partial<MealprintSuggestSheetProps> = {},
): MealprintSuggestSheetProps {
  return {
    visible: true,
    onClose: jest.fn(),
    stage: "setup",
    offline: false,
    shape: "either",
    onShapeChange: jest.fn(),
    steer: "",
    onSteerChange: jest.fn(),
    onGenerate: jest.fn(),
    suggestions: [],
    emptyReason: null,
    remaining: null,
    labelCheckRequired: false,
    dietaryPatterns: [],
    serverPartialEnforcementOnly: false,
    isToday: true,
    onSelectSuggestion: jest.fn(),
    draft: null,
    onToggleDraftItem: jest.fn(),
    onSlotChange: jest.fn(),
    draftKcal: 0,
    onConfirm: jest.fn(),
    confirming: false,
    onBackToResults: jest.fn(),
    errorMessage: null,
    errorRetryable: false,
    errorIsEntitlement: false,
    onRetry: jest.fn(),
    onUpgrade: jest.fn(),
    ...over,
  };
}

describe("MealprintSuggestSheetPresenter", () => {
  it("replaces the setup body with Snap-parity offline copy", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <MealprintSuggestSheetPresenter {...sheetProps({ offline: true })} />,
    );
    expect(getByTestId("mealprint-suggest-offline")).toBeTruthy();
    expect(queryByTestId("mealprint-generate")).toBeNull();
  });

  it("generates from the setup stage", () => {
    const onGenerate = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintSuggestSheetPresenter {...sheetProps({ onGenerate })} />,
    );
    fireEvent.press(getByTestId("mealprint-generate"));
    expect(onGenerate).toHaveBeenCalled();
  });

  it("offers all three shapes and reports a change", () => {
    const onShapeChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintSuggestSheetPresenter {...sheetProps({ onShapeChange })} />,
    );
    fireEvent.press(getByTestId("mealprint-shape-option-snack"));
    expect(onShapeChange).toHaveBeenCalledWith("snack");
    expect(getByTestId("mealprint-shape-option-meal")).toBeTruthy();
    expect(getByTestId("mealprint-shape-option-either")).toBeTruthy();
  });

  it("renders the generating stage", () => {
    const { getByTestId } = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({ stage: "generating" })}
      />,
    );
    expect(getByTestId("mealprint-generating")).toBeTruthy();
  });

  it("⚠ renders the label-check disclaimer on labelCheckRequired, NOT on containsUnverified", () => {
    // The server sends `labelCheckRequired: true` unconditionally because
    // `mapOffAllergenTags` returns `[]` for any product with ingredient text
    // WITHOUT knowing OFF parsed it — so a foreign-language label is
    // indistinguishable from a clean analysis. Gating on the narrower
    // `containsUnverified` would hide the disclaimer exactly where it matters.
    const gated = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({
          stage: "results",
          suggestions: [suggestion({ containsUnverified: true })],
          labelCheckRequired: false,
        })}
      />,
    );
    expect(gated.queryByTestId("mealprint-label-check-disclaimer")).toBeNull();

    const required = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({
          stage: "results",
          suggestions: [suggestion({ containsUnverified: false })],
          labelCheckRequired: true,
        })}
      />,
    );
    expect(
      required.getByTestId("mealprint-label-check-disclaimer"),
    ).toBeTruthy();
    expect(required.queryByText(LABEL_CHECK_COPY)).toBeTruthy();
  });

  it("flags a suggestion whose allergen content is unknown, separately from the disclaimer", () => {
    const { queryByText } = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({
          stage: "results",
          suggestions: [suggestion({ containsUnverified: true })],
          labelCheckRequired: true,
        })}
      />,
    );
    expect(queryByText("UNVERIFIED")).toBeTruthy();
  });

  it("selects a suggestion by index", () => {
    const onSelectSuggestion = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({
          stage: "results",
          suggestions: [suggestion(), suggestion({ name: "Protein shake" })],
          labelCheckRequired: true,
          onSelectSuggestion,
        })}
      />,
    );
    fireEvent.press(getByTestId("mealprint-suggestion-1"));
    expect(onSelectSuggestion).toHaveBeenCalledWith(1);
  });

  it("⚠ explains each emptyReason specifically, and no_candidates points at loosening a chip", () => {
    // no_candidates is the EXPECTED state until the Open Food Facts re-seed lands,
    // so its copy has to be actionable rather than reading as a bug.
    const noCandidates = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({ stage: "results", emptyReason: "no_candidates" })}
      />,
    );
    expect(
      noCandidates.getByTestId("mealprint-empty-no_candidates"),
    ).toBeTruthy();
    expect(
      noCandidates.queryByText(/removing an allergen or a dislike/i),
    ).toBeTruthy();

    const noTargets = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({ stage: "results", emptyReason: "no_targets" })}
      />,
    );
    expect(noTargets.getByTestId("mealprint-empty-no_targets")).toBeTruthy();

    const exhausted = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({ stage: "results", emptyReason: "budget_exhausted" })}
      />,
    );
    expect(
      exhausted.getByTestId("mealprint-empty-budget_exhausted"),
    ).toBeTruthy();
  });

  it("does not show the disclaimer or a regenerate CTA on an empty result", () => {
    const { queryByTestId } = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({
          stage: "results",
          emptyReason: "no_candidates",
          labelCheckRequired: true,
        })}
      />,
    );
    expect(queryByTestId("mealprint-label-check-disclaimer")).toBeNull();
    expect(queryByTestId("mealprint-regenerate")).toBeNull();
  });

  it("shows the remaining budget when the server reported one", () => {
    const { getByTestId } = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({
          stage: "results",
          suggestions: [suggestion()],
          labelCheckRequired: true,
          remaining: { kcal: 620.4, proteinG: 42.2, carbsG: 60, fatG: 20 },
        })}
      />,
    );
    expect(getByTestId("mealprint-remaining")).toBeTruthy();
  });

  it("shows the halal/kosher caveat on the results stage too", () => {
    const { getByTestId } = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({
          stage: "results",
          suggestions: [suggestion()],
          labelCheckRequired: true,
          dietaryPatterns: ["kosher"],
        })}
      />,
    );
    expect(getByTestId("mealprint-partial-enforcement")).toBeTruthy();
  });

  it("toggles a draft item and disables the confirm when nothing is kept", () => {
    const draft = draftFromSuggestion(suggestion(), "snack");
    const onToggleDraftItem = jest.fn();
    const kept = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({
          stage: "draft",
          draft,
          draftKcal: 150,
          onToggleDraftItem,
        })}
      />,
    );
    fireEvent.press(kept.getByTestId("mealprint-draft-item-0"));
    expect(onToggleDraftItem).toHaveBeenCalledWith(0);
    expect(
      kept.getByTestId("mealprint-draft-confirm").props.accessibilityState,
    ).toMatchObject({ disabled: false });

    const none = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({
          stage: "draft",
          draft: {
            ...draft,
            items: draft.items.map((i) => ({ ...i, on: false })),
          },
          draftKcal: 0,
        })}
      />,
    );
    expect(
      none.getByTestId("mealprint-draft-confirm").props.accessibilityState,
    ).toMatchObject({ disabled: true });
  });

  it("repeats the disclaimer on the draft stage — it is the step that logs", () => {
    const { getByTestId } = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({
          stage: "draft",
          draft: draftFromSuggestion(suggestion(), "snack"),
          draftKcal: 150,
          labelCheckRequired: true,
        })}
      />,
    );
    expect(getByTestId("mealprint-draft-label-check-disclaimer")).toBeTruthy();
  });

  it("confirms the draft, and reports Added once logged", () => {
    const onConfirm = jest.fn();
    const draft = draftFromSuggestion(suggestion(), "snack");
    const { getByTestId } = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({ stage: "draft", draft, draftKcal: 150, onConfirm })}
      />,
    );
    fireEvent.press(getByTestId("mealprint-draft-confirm"));
    expect(onConfirm).toHaveBeenCalled();

    const added = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({ stage: "added", draft, draftKcal: 150 })}
      />,
    );
    expect(
      added.getByTestId("mealprint-draft-confirm").props.accessibilityState,
    ).toMatchObject({ disabled: true });
  });

  it("goes back to the results from the draft", () => {
    const onBackToResults = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({
          stage: "draft",
          draft: draftFromSuggestion(suggestion(), "snack"),
          draftKcal: 150,
          onBackToResults,
        })}
      />,
    );
    fireEvent.press(getByTestId("mealprint-draft-back"));
    expect(onBackToResults).toHaveBeenCalled();
  });

  it("renders nothing for a draft stage with no draft", () => {
    const { queryByTestId } = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({ stage: "draft", draft: null })}
      />,
    );
    expect(queryByTestId("mealprint-draft")).toBeNull();
    // ⚠ And no orphan footer either — a pinned confirm under an empty body is a
    // button that logs an absent draft.
    expect(queryByTestId("bottom-sheet-footer")).toBeNull();
    expect(queryByTestId("mealprint-draft-confirm")).toBeNull();
  });

  // ⚠ The draft stage stacks items + meal picker + two conditional caveats in an
  // 86% sheet, so a confirm at the end of that stack sits below the fold — on the
  // step that writes to a food log. These pin it OUTSIDE the scrolling body.
  // Jest renders gorhom as plain Views, so this is the strongest available proof;
  // the fold itself still needs the simulator.
  describe("the commit action is pinned, not scrolled to", () => {
    const draft = draftFromSuggestion(
      suggestion({
        items: [
          suggestion().items[0],
          { ...suggestion().items[0], candidateId: "food-2", name: "Oatcakes" },
        ],
      }),
      "snack",
    );

    it("puts the draft confirm in the sheet footer, not the scrolling body", () => {
      const { getByTestId, UNSAFE_getByType } = renderWithTheme(
        <MealprintSuggestSheetPresenter
          {...sheetProps({
            stage: "draft",
            draft,
            draftKcal: 300,
            // Both caveats on — the worst case for the fold.
            labelCheckRequired: true,
            dietaryPatterns: ["halal"],
            serverPartialEnforcementOnly: true,
          })}
        />,
      );
      expect(
        within(getByTestId("bottom-sheet-footer")).getByTestId(
          "mealprint-draft-confirm",
        ),
      ).toBeTruthy();

      // The scroll view holds the draft body and the caveats — and NOT the
      // confirm. That is the whole point: the stack it sits above is exactly what
      // pushed it off-screen.
      const scroll = UNSAFE_getByType(BottomSheetScrollView);
      expect(within(scroll).getByTestId("mealprint-draft")).toBeTruthy();
      expect(
        within(scroll).getByTestId("mealprint-draft-label-check-disclaimer"),
      ).toBeTruthy();
      expect(
        within(scroll).queryByTestId("mealprint-draft-confirm"),
      ).toBeNull();
    });

    it("still fires onConfirm, and still disables at zero kept items, from the footer", () => {
      const onConfirm = jest.fn();
      const kept = renderWithTheme(
        <MealprintSuggestSheetPresenter
          {...sheetProps({ stage: "draft", draft, draftKcal: 300, onConfirm })}
        />,
      );
      fireEvent.press(
        within(kept.getByTestId("bottom-sheet-footer")).getByTestId(
          "mealprint-draft-confirm",
        ),
      );
      expect(onConfirm).toHaveBeenCalled();

      const none = renderWithTheme(
        <MealprintSuggestSheetPresenter
          {...sheetProps({
            stage: "draft",
            draft: {
              ...draft,
              items: draft.items.map((i) => ({ ...i, on: false })),
            },
            draftKcal: 0,
          })}
        />,
      );
      expect(
        none.getByTestId("mealprint-draft-confirm").props.accessibilityState,
      ).toMatchObject({ disabled: true });
    });

    it("pins the setup stage's Generate action too — the keyboard would push it off", () => {
      const { getByTestId } = renderWithTheme(
        <MealprintSuggestSheetPresenter {...sheetProps({ stage: "setup" })} />,
      );
      expect(
        within(getByTestId("bottom-sheet-footer")).getByTestId(
          "mealprint-generate",
        ),
      ).toBeTruthy();
    });

    it("pins nothing on the stages whose actions are inline", () => {
      for (const stage of ["generating", "results", "error"] as const) {
        const { queryByTestId } = renderWithTheme(
          <MealprintSuggestSheetPresenter
            {...sheetProps({ stage, suggestions: [suggestion()] })}
          />,
        );
        expect(queryByTestId("bottom-sheet-footer")).toBeNull();
      }
    });

    it("pins nothing while offline — there is no action to offer", () => {
      const { queryByTestId } = renderWithTheme(
        <MealprintSuggestSheetPresenter
          {...sheetProps({ stage: "setup", offline: true })}
        />,
      );
      expect(queryByTestId("bottom-sheet-footer")).toBeNull();
      expect(queryByTestId("mealprint-generate")).toBeNull();
    });
  });

  it("⚠ never claims 'today' when Fuel is showing another day — the sheet LOGS to that day", () => {
    // Same defect class as the entry card's budget line, one component over. The
    // container generates and logs against `useFuelSheets().date`.
    const past = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({ stage: "setup", isToday: false })}
      />,
    );
    expect(past.queryByText(/you have left today/)).toBeNull();
    expect(past.queryByText(/day you're viewing/)).toBeTruthy();
    expect(past.queryByText(/goes to that day/)).toBeTruthy();

    const today = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({ stage: "setup", isToday: true })}
      />,
    );
    expect(today.queryByText(/you have left today/)).toBeTruthy();
  });

  it("labels the remaining-budget panel for the day it describes", () => {
    const remaining = { kcal: 620, proteinG: 42, carbsG: 60, fatG: 20 };
    const past = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({
          stage: "results",
          suggestions: [suggestion()],
          remaining,
          isToday: false,
        })}
      />,
    );
    expect(past.queryByText("Left that day")).toBeTruthy();
    expect(past.queryByText("Left today")).toBeNull();
  });

  it("⚠ offers NO retry on a non-retryable failure (the daily ceiling)", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({
          stage: "error",
          errorMessage: "You've used all of today's Mealprint suggestions.",
          errorRetryable: false,
        })}
      />,
    );
    expect(queryByTestId("mealprint-error-retry")).toBeNull();
    expect(getByTestId("mealprint-error-dismiss")).toBeTruthy();
  });

  it("offers a retry on a retryable failure", () => {
    const onRetry = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({
          stage: "error",
          errorMessage: "Mealprint is unavailable right now.",
          errorRetryable: true,
          onRetry,
        })}
      />,
    );
    fireEvent.press(getByTestId("mealprint-error-retry"));
    expect(onRetry).toHaveBeenCalled();
  });

  it("offers the PAYWALL on a 402, not a retry that would 402 again", () => {
    const onUpgrade = jest.fn();
    const { getByTestId, queryByTestId } = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({
          stage: "error",
          errorMessage: "Mealprint is a Premium+ feature.",
          errorRetryable: false,
          errorIsEntitlement: true,
          onUpgrade,
        })}
      />,
    );
    expect(queryByTestId("mealprint-error-retry")).toBeNull();
    fireEvent.press(getByTestId("mealprint-error-upgrade"));
    expect(onUpgrade).toHaveBeenCalled();
  });

  it("falls back to generic error copy when none was supplied", () => {
    const { queryByText } = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({ stage: "error", errorMessage: null })}
      />,
    );
    expect(queryByText(/Couldn't reach Mealprint/i)).toBeTruthy();
  });
});

describe("MealprintPreferencesPresenter — saving and full-list states", () => {
  it("reports Saving on both the header action and the wizard CTA", () => {
    const editor = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps({ isSaving: true })} />,
    );
    expect(editor.queryByText("Saving…")).toBeTruthy();

    const wizard = renderWithTheme(
      <MealprintPreferencesPresenter
        {...prefProps({ mode: "wizard", isSaving: true })}
      />,
    );
    // The wizard shows its own primary CTA in addition to the header action.
    expect(wizard.queryAllByText(/Saving…/).length).toBeGreaterThan(1);
  });

  it("shows the wizard CTA only in wizard mode, and fires onSave", () => {
    const onSave = jest.fn();
    const wizard = renderWithTheme(
      <MealprintPreferencesPresenter
        {...prefProps({ mode: "wizard", onSave })}
      />,
    );
    fireEvent.press(wizard.getByTestId("mealprint-preferences-wizard-cta"));
    expect(onSave).toHaveBeenCalled();

    const editor = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps({ mode: "editor" })} />,
    );
    expect(editor.queryByTestId("mealprint-preferences-wizard-cta")).toBeNull();
  });

  it("fires onSave from the header action", () => {
    const onSave = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps({ onSave })} />,
    );
    fireEvent.press(getByTestId("mealprint-preferences-save"));
    expect(onSave).toHaveBeenCalled();
  });

  it("fires onDismiss from the header action", () => {
    const onDismiss = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps({ onDismiss })} />,
    );
    fireEvent.press(getByTestId("mealprint-preferences-dismiss"));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("adds a free-text entry on submit from the keyboard", () => {
    const onAddAvoidFood = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter
        {...prefProps({ avoidFoodDraft: "olives", onAddAvoidFood })}
      />,
    );
    fireEvent(getByTestId("mealprint-dislike-input"), "submitEditing");
    expect(onAddAvoidFood).toHaveBeenCalled();
  });

  it("does NOT submit an empty draft from the keyboard", () => {
    const onAddAvoidFood = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps({ onAddAvoidFood })} />,
    );
    fireEvent(getByTestId("mealprint-dislike-input"), "submitEditing");
    expect(onAddAvoidFood).not.toHaveBeenCalled();
  });

  it("locks the input at the item cap and says so, rather than silently ignoring the tap", () => {
    // The cap mirrors the server's `MAX_FREE_TEXT_ITEMS`; the write is queued, so a
    // server rejection would surface minutes later on the sync-failure screen.
    const full = Array.from({ length: 60 }, (_, i) => `food-${i}`);
    const onAddAvoidFood = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter
        {...prefProps({
          avoidFoods: full,
          avoidFoodDraft: "one more",
          onAddAvoidFood,
        })}
      />,
    );
    expect(getByTestId("mealprint-dislike-input").props.editable).toBe(false);
    expect(getByTestId("mealprint-dislike-input").props.placeholder).toMatch(
      /maximum/i,
    );
    fireEvent.press(getByTestId("mealprint-dislike-add"));
    expect(onAddAvoidFood).not.toHaveBeenCalled();
  });

  it("reports the effort blurb for the selected level", () => {
    const { queryByText } = renderWithTheme(
      <MealprintPreferencesPresenter
        {...prefProps({ effortLevel: "high_maintenance" })}
      />,
    );
    expect(queryByText(/Batch-prep/i)).toBeTruthy();
  });

  it("changes the effort level through the segmented control", () => {
    const onEffortLevelChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps({ onEffortLevelChange })} />,
    );
    fireEvent.press(getByTestId("mealprint-effort-option-quick"));
    expect(onEffortLevelChange).toHaveBeenCalledWith("quick");
  });

  it("reports a free-text draft change", () => {
    const onAvoidFoodDraftChange = jest.fn();
    const onLikedFoodDraftChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter
        {...prefProps({ onAvoidFoodDraftChange, onLikedFoodDraftChange })}
      />,
    );
    fireEvent.changeText(getByTestId("mealprint-dislike-input"), "olives");
    expect(onAvoidFoodDraftChange).toHaveBeenCalledWith("olives");
    fireEvent.changeText(getByTestId("mealprint-like-input"), "tofu");
    expect(onLikedFoodDraftChange).toHaveBeenCalledWith("tofu");
  });
});

describe("MealprintPreferencesPresenter — the load-failure guard (Inspector 🔴)", () => {
  it("⚠ replaces the ENTIRE form with a retry panel, so there is no Save to press", () => {
    // `PUT /nutrition/preferences` is a full last-write-wins replacement, and the
    // form renders empty defaults until it is seeded — so an editable form over an
    // unread server row is a delete button for the user's allergen list.
    const { getByTestId, queryByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps({ loadFailed: true })} />,
    );
    expect(getByTestId("mealprint-preferences-load-failed")).toBeTruthy();
    expect(queryByTestId("mealprint-preferences-save")).toBeNull();
    expect(queryByTestId("mealprint-preferences-wizard-cta")).toBeNull();
    expect(queryByTestId("mealprint-allergen-peanuts")).toBeNull();
    expect(queryByTestId("mealprint-dislike-input")).toBeNull();
  });

  it("says WHY the form is withheld, not just that something failed", () => {
    const { queryByText } = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps({ loadFailed: true })} />,
    );
    expect(queryByText(/would clear your allergens/i)).toBeTruthy();
  });

  it("retries the read, and Back leaves without writing", () => {
    const onRetryLoad = jest.fn();
    const onDismiss = jest.fn();
    const onSave = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter
        {...prefProps({ loadFailed: true, onRetryLoad, onDismiss, onSave })}
      />,
    );
    fireEvent.press(getByTestId("mealprint-preferences-retry-load"));
    expect(onRetryLoad).toHaveBeenCalled();
    fireEvent.press(getByTestId("mealprint-preferences-dismiss"));
    expect(onDismiss).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("withholds the form in wizard mode too — Skip is a real write", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter
        {...prefProps({ mode: "wizard", loadFailed: true })}
      />,
    );
    expect(getByTestId("mealprint-preferences-load-failed")).toBeTruthy();
    expect(queryByTestId("mealprint-preferences-wizard-cta")).toBeNull();
  });

  it("prefers the loader over the retry panel while the read is still in flight", () => {
    const { queryByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter
        {...prefProps({ isLoadingInitial: true, loadFailed: true })}
      />,
    );
    expect(queryByTestId("mealprint-preferences-load-failed")).toBeNull();
  });
});

describe("MealprintSuggestSheetPresenter — the partial-enforcement floor (Inspector 🟠)", () => {
  const results = {
    stage: "results" as const,
    suggestions: [suggestion()],
    labelCheckRequired: true,
  };

  it("⚠ falls back to the GENERIC caveat when the server flagged it but the patterns are unknown", () => {
    // A halal user on a fresh install whose preferences fetch has not landed used
    // to get a server-flagged result with no caveat at all (locked decision 10).
    const { getByTestId, queryByText } = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({
          ...results,
          dietaryPatterns: [],
          serverPartialEnforcementOnly: true,
        })}
      />,
    );
    expect(getByTestId("mealprint-partial-enforcement")).toBeTruthy();
    // Vague on purpose — naming "pork and alcohol" here would guess which of
    // halal/kosher is active.
    expect(queryByText(/pork/i)).toBeNull();
    expect(queryByText(/no certification information/i)).toBeTruthy();
  });

  it("prefers the SPECIFIC copy when the patterns are known", () => {
    const { queryByText } = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({
          ...results,
          dietaryPatterns: ["halal"],
          serverPartialEnforcementOnly: true,
        })}
      />,
    );
    expect(queryByText(/pork.*alcohol/i)).toBeTruthy();
  });

  it("shows nothing when neither the server nor the patterns say so", () => {
    const { queryByTestId } = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({
          ...results,
          dietaryPatterns: ["vegan"],
          serverPartialEnforcementOnly: false,
        })}
      />,
    );
    expect(queryByTestId("mealprint-partial-enforcement")).toBeNull();
  });

  it("⚠ repeats the caveat on the DRAFT stage — that is the step that logs", () => {
    const { getByTestId } = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({
          stage: "draft",
          draft: draftFromSuggestion(suggestion(), "snack"),
          draftKcal: 150,
          labelCheckRequired: true,
          dietaryPatterns: ["kosher"],
          serverPartialEnforcementOnly: true,
        })}
      />,
    );
    expect(getByTestId("mealprint-draft-partial-enforcement")).toBeTruthy();
  });

  it("omits the draft-stage caveat when nothing is partially enforced", () => {
    const { queryByTestId } = renderWithTheme(
      <MealprintSuggestSheetPresenter
        {...sheetProps({
          stage: "draft",
          draft: draftFromSuggestion(suggestion(), "snack"),
          draftKcal: 150,
          labelCheckRequired: true,
        })}
      />,
    );
    expect(queryByTestId("mealprint-draft-partial-enforcement")).toBeNull();
  });
});
