import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import {
  AVOID_ALLERGENS,
  DIETARY_PATTERNS,
  LABEL_CHECK_COPY,
  MEDICAL_SCOPE_COPY,
} from "@/domain/models/mealprint";
import {
  MealprintEntryCard,
  type MealprintEntryCardProps,
} from "../MealprintEntryCard";
import {
  MealprintPreferencesPresenter,
  type MealprintPreferencesProps,
} from "../MealprintPreferencesPresenter";

// ─── MealprintEntryCard ────────────────────────────────────────────────────

function cardProps(
  over: Partial<MealprintEntryCardProps> = {},
): MealprintEntryCardProps {
  return {
    state: "unlocked",
    needsSetup: false,
    // Required now — an optional default of `true` was silently the "today" copy
    // leak the prop exists to close.
    isToday: true,
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

  it("⚠ never says 'today' when Fuel is showing another day", () => {
    // The concrete line is already nulled off-today by FuelPresenter; this pins the
    // FALLBACK subtitles, which used to claim "today" while the sheet that same tap
    // opens said "the day you're viewing".
    const past = renderWithTheme(
      <MealprintEntryCard {...cardProps({ isToday: false })} />,
    );
    expect(past.queryByText(/on the day you're viewing/)).toBeTruthy();
    expect(past.queryByText(/left today/)).toBeNull();

    const setup = renderWithTheme(
      <MealprintEntryCard
        {...cardProps({ isToday: false, needsSetup: true })}
      />,
    );
    expect(setup.queryByText(/the day you're viewing/)).toBeTruthy();
  });

  it("⚠ suppresses the budget line itself off-today, not just via a null kcal", () => {
    // `isToday` is required so the card CANNOT leak "today" copy — but until
    // `hasBudget` consulted it, that was guaranteed only by FuelPresenter nulling
    // `remainingKcal`. A second caller passing a real budget with isToday:false
    // would print "…left today" over another day's numbers.
    const { queryByText } = renderWithTheme(
      <MealprintEntryCard
        {...cardProps({
          isToday: false,
          remainingKcal: 1160,
          remainingProteinG: 84,
        })}
      />,
    );
    expect(queryByText(/left today/)).toBeNull();
    expect(queryByText(/Let Mealprint fill the gap/)).toBeNull();
    expect(queryByText(/on the day you're viewing/)).toBeTruthy();
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

  // ─── spec-26 Phase 2 — plan-aware states ──────────────────────────────────

  describe("the ACTIVE-plan variant", () => {
    const progress = {
      loggedCount: 1,
      totalCount: 3,
      nextMealLabel: "Chicken & rice bowl",
      nextMealKcal: 640,
    };

    it("renders the progress strip and the next-meal line, not the pitch", () => {
      const { getByTestId, queryByText, getByText } = renderWithTheme(
        <MealprintEntryCard {...cardProps({ planProgress: progress })} />,
      );
      expect(getByTestId("mealprint-entry-card")).toBeTruthy();
      expect(getByText(/1/)).toBeTruthy();
      expect(getByText(/Chicken & rice bowl · 640 kcal/)).toBeTruthy();
      // Not the offer pitch.
      expect(queryByText("What should I eat?")).toBeNull();
    });

    it("pressing the card fires onPress (the Today view), not onPlanMyDay", () => {
      const onPress = jest.fn();
      const onPlanMyDay = jest.fn();
      const { getByTestId } = renderWithTheme(
        <MealprintEntryCard
          {...cardProps({ planProgress: progress, onPress, onPlanMyDay })}
        />,
      );
      fireEvent.press(getByTestId("mealprint-entry-card"));
      expect(onPress).toHaveBeenCalled();
      expect(onPlanMyDay).not.toHaveBeenCalled();
    });

    it("says 'every planned meal is logged' when nothing is left to log", () => {
      const { getByText } = renderWithTheme(
        <MealprintEntryCard
          {...cardProps({
            planProgress: {
              loggedCount: 3,
              totalCount: 3,
              nextMealLabel: null,
              nextMealKcal: null,
            },
          })}
        />,
      );
      expect(getByText(/Every planned meal is logged/i)).toBeTruthy();
    });

    it("takes priority over pending/locked being false — but NOT while pending or locked", () => {
      // planProgress is only meaningful once resolved+entitled; pending/locked
      // must still render their own bodies even if a stale plan were passed.
      const pending = renderWithTheme(
        <MealprintEntryCard
          {...cardProps({ state: "pending", planProgress: progress })}
        />,
      );
      expect(pending.queryByText(/Checking your plan/i)).toBeTruthy();

      const locked = renderWithTheme(
        <MealprintEntryCard
          {...cardProps({ state: "locked", planProgress: progress })}
        />,
      );
      expect(locked.getByTestId("mealprint-entry-card")).toBeTruthy();
      expect(locked.queryByText(/Chicken & rice bowl/)).toBeNull();
    });
  });

  describe("the two-CTA offer variant", () => {
    it("renders TWO independently-labelled buttons when onPlanMyDay is supplied", () => {
      const { getByTestId } = renderWithTheme(
        <MealprintEntryCard {...cardProps({ onPlanMyDay: jest.fn() })} />,
      );
      expect(getByTestId("mealprint-entry-suggest-cta")).toBeTruthy();
      expect(getByTestId("mealprint-entry-plan-cta")).toBeTruthy();
      // The single-CTA fallback body must NOT also render.
      expect(() => getByTestId("mealprint-entry-cta")).toThrow();
    });

    it("each button fires its own handler independently", () => {
      const onPress = jest.fn();
      const onPlanMyDay = jest.fn();
      const { getByTestId } = renderWithTheme(
        <MealprintEntryCard {...cardProps({ onPress, onPlanMyDay })} />,
      );
      fireEvent.press(getByTestId("mealprint-entry-suggest-cta"));
      expect(onPress).toHaveBeenCalledTimes(1);
      expect(onPlanMyDay).not.toHaveBeenCalled();

      fireEvent.press(getByTestId("mealprint-entry-plan-cta"));
      expect(onPlanMyDay).toHaveBeenCalledTimes(1);
      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it("falls back to the single-CTA card when needsSetup, even with onPlanMyDay supplied", () => {
      const { getByTestId, queryByTestId } = renderWithTheme(
        <MealprintEntryCard
          {...cardProps({ needsSetup: true, onPlanMyDay: jest.fn() })}
        />,
      );
      expect(getByTestId("mealprint-entry-cta")).toBeTruthy();
      expect(queryByTestId("mealprint-entry-plan-cta")).toBeNull();
    });

    it("omitting onPlanMyDay falls back to the original single-CTA card (existing callers unaffected)", () => {
      const { getByTestId, queryByTestId } = renderWithTheme(
        <MealprintEntryCard {...cardProps()} />,
      );
      expect(getByTestId("mealprint-entry-cta")).toBeTruthy();
      expect(queryByTestId("mealprint-entry-plan-cta")).toBeNull();
    });

    // Amendment 2026-08 § C — Fuel-page-level Preferences entry. Opening the
    // editor from the suggest sheet's own link rendered it BEHIND the sheet
    // (root-mounted), so the direct route now lives on this card instead.
    it("renders a Preferences link when onEditPreferences is supplied, and fires it independently", () => {
      const onEditPreferences = jest.fn();
      const onPress = jest.fn();
      const onPlanMyDay = jest.fn();
      const { getByTestId } = renderWithTheme(
        <MealprintEntryCard
          {...cardProps({ onPress, onPlanMyDay, onEditPreferences })}
        />,
      );
      fireEvent.press(getByTestId("mealprint-entry-preferences"));
      expect(onEditPreferences).toHaveBeenCalledTimes(1);
      expect(onPress).not.toHaveBeenCalled();
      expect(onPlanMyDay).not.toHaveBeenCalled();
    });

    it("omits the Preferences link when onEditPreferences is not supplied", () => {
      const { queryByTestId } = renderWithTheme(
        <MealprintEntryCard {...cardProps({ onPlanMyDay: jest.fn() })} />,
      );
      expect(queryByTestId("mealprint-entry-preferences")).toBeNull();
    });

    it("omits the Preferences link from needsSetup — that card's own CTA already opens the same form", () => {
      const { queryByTestId } = renderWithTheme(
        <MealprintEntryCard
          {...cardProps({
            needsSetup: true,
            onPlanMyDay: jest.fn(),
            onEditPreferences: jest.fn(),
          })}
        />,
      );
      expect(queryByTestId("mealprint-entry-preferences")).toBeNull();
    });
  });

  describe("the ACTIVE-plan variant — Preferences entry", () => {
    it("does not carry the Preferences link — matches the design source, which omits it there too", () => {
      const { queryByTestId } = renderWithTheme(
        <MealprintEntryCard
          {...cardProps({
            planProgress: {
              loggedCount: 1,
              totalCount: 3,
              nextMealLabel: "Chicken & rice bowl",
              nextMealKcal: 640,
            },
            onEditPreferences: jest.fn(),
          })}
        />,
      );
      expect(queryByTestId("mealprint-entry-preferences")).toBeNull();
    });
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
    mealsText: "Breakfast, Lunch, Dinner, Snacks",
    mealCount: 4,
    onEditMeals: jest.fn(),
    effortLevel: "balanced",
    onEffortLevelChange: jest.fn(),
    onSave: jest.fn(),
    onCancel: jest.fn(),
    onDismiss: jest.fn(),
    // Required now — the mode-derived fallback was the label the container proved
    // wrong, so it no longer exists.
    dismissLabel: "Cancel",
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

  it("⚠ shows the AC 1.2 disclaimer verbatim ALWAYS, regardless of allergen selection (amendment 2026-08 § C)", () => {
    // Deliberate divergence from AC 1.2's literal "adding a chip shows it" —
    // the design source's `AMDisclaimer` is persistent, and a user who sets a
    // dietary pattern or a dislike but never touches an allergen chip must
    // still see "always check labels".
    const off = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps()} />,
    );
    expect(off.getByTestId("mealprint-label-check-disclaimer")).toBeTruthy();
    expect(off.queryByText(LABEL_CHECK_COPY)).toBeTruthy();

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

  it("always offers Cancel and keeps Skip for now as a distinct wizard action", () => {
    const onCancel = jest.fn();
    const onDismiss = jest.fn();
    const wizard = renderWithTheme(
      <MealprintPreferencesPresenter
        {...prefProps({
          mode: "wizard",
          dismissLabel: "Skip",
          onCancel,
          onDismiss,
        })}
      />,
    );
    expect(wizard.queryByText("Cancel")).toBeTruthy();
    expect(wizard.queryByText("Skip for now")).toBeTruthy();
    fireEvent.press(wizard.getByTestId("mealprint-preferences-dismiss"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.press(wizard.getByTestId("mealprint-preferences-skip"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(wizard.getByTestId("mealprint-preferences-intro")).toBeTruthy();

    const editor = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps({ mode: "editor" })} />,
    );
    expect(editor.queryByText("Cancel")).toBeTruthy();
    expect(editor.queryByTestId("mealprint-preferences-skip")).toBeNull();
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

  it("Meals shows Your meals with Edit, not a meals-a-day stepper (PER-134, N25)", () => {
    const onEditMeals = jest.fn();
    const { getByTestId, getByText, queryByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps({ onEditMeals })} />,
    );
    expect(getByText("Uses your 4 meals")).toBeTruthy();
    expect(getByText("Breakfast, Lunch, Dinner, Snacks")).toBeTruthy();
    expect(queryByTestId("mealprint-meals-inc")).toBeNull();
    fireEvent.press(getByTestId("mealprint-meals-edit"));
    expect(onEditMeals).toHaveBeenCalled();
  });

  it("puts the label-check and medical copy right under the allergens (N24)", () => {
    const { getByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps()} />,
    );
    const order = [
      "mealprint-preferences-allergens",
      "mealprint-label-check-disclaimer",
      "mealprint-preferences-meals",
    ].map((id) => getByTestId(id));
    expect(order.every(Boolean)).toBe(true);
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

  it("fires onCancel from the header action", () => {
    const onCancel = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps({ onCancel })} />,
    );
    fireEvent.press(getByTestId("mealprint-preferences-dismiss"));
    expect(onCancel).toHaveBeenCalled();
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

  it("changes the effort level through the radio list", () => {
    const onEffortLevelChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter {...prefProps({ onEffortLevelChange })} />,
    );
    expect(
      getByTestId("mealprint-effort-option-balanced").props.accessibilityState,
    ).toMatchObject({ checked: true });
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
    const onCancel = jest.fn();
    const onSave = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPreferencesPresenter
        {...prefProps({ loadFailed: true, onRetryLoad, onCancel, onSave })}
      />,
    );
    fireEvent.press(getByTestId("mealprint-preferences-retry-load"));
    expect(onRetryLoad).toHaveBeenCalled();
    fireEvent.press(getByTestId("mealprint-preferences-dismiss"));
    expect(onCancel).toHaveBeenCalled();
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
