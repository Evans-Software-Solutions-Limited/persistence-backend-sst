import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import type { PlanDraft } from "@/domain/models/mealprint";
import {
  MealprintPlanSheetPresenter,
  type MealprintPlanSheetProps,
} from "../MealprintPlanSheetPresenter";

function draft(over: Partial<PlanDraft> = {}): PlanDraft {
  return {
    planDate: "2026-08-05",
    mealsPerDay: 4,
    target: { kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 },
    meals: [
      {
        localId: "local-1",
        meal: {
          name: "Chicken & rice bowl",
          reason: "High protein, fits the rest of your macros.",
          logSlot: "dinner",
          items: [
            {
              candidateId: "food-1",
              kind: "food",
              servings: 1.5,
              name: "Chicken breast",
              kcal: 250,
              proteinG: 30,
              carbsG: 0,
              fatG: 8,
            },
          ],
          kcal: 600,
          proteinG: 45,
          carbsG: 60,
          fatG: 15,
          containsUnverified: false,
          flaggedUnsafe: false,
        },
      },
    ],
    ...over,
  };
}

function props(
  over: Partial<MealprintPlanSheetProps> = {},
): MealprintPlanSheetProps {
  return {
    visible: true,
    onClose: jest.fn(),
    stage: "config",
    offline: false,
    preferencesSummary: null,
    mealsPerDay: 4,
    onMealsPerDayChange: jest.fn(),
    effortLevel: "balanced",
    onEffortLevelChange: jest.fn(),
    steer: "",
    onSteerChange: jest.fn(),
    dayTarget: { kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 },
    emptyReason: null,
    onGenerate: jest.fn(),
    onEditPreferences: jest.fn(),
    draft: null,
    flaggedIds: new Set(),
    swappingId: null,
    onSwapMeal: jest.fn(),
    onRemoveMeal: jest.fn(),
    onItemServingsChange: jest.fn(),
    draftTotals: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    accepting: false,
    acceptBlocked: false,
    onAccept: jest.fn(),
    acceptErrorMessage: null,
    acceptRecovery: null,
    onAcceptRecovery: jest.fn(),
    labelCheckRequired: true,
    onViewToday: jest.fn(),
    errorMessage: null,
    errorRetryable: false,
    errorIsEntitlement: false,
    onRetryGenerate: jest.fn(),
    onUpgrade: jest.fn(),
    ...over,
  };
}

describe("MealprintPlanSheetPresenter — config stage", () => {
  it("replaces the form with offline copy and hides Generate", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <MealprintPlanSheetPresenter {...props({ offline: true })} />,
    );
    expect(getByTestId("mealprint-plan-offline")).toBeTruthy();
    expect(queryByTestId("mealprint-plan-generate")).toBeNull();
  });

  it("fires onGenerate from the pinned footer action", () => {
    const onGenerate = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPlanSheetPresenter {...props({ onGenerate })} />,
    );
    fireEvent.press(getByTestId("mealprint-plan-generate"));
    expect(onGenerate).toHaveBeenCalled();
  });

  it("reports a meals-per-day change via the stepper's +/- controls", () => {
    const onMealsPerDayChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({ mealsPerDay: 4, onMealsPerDayChange })}
      />,
    );
    fireEvent.press(getByTestId("mealprint-plan-meals-per-day-inc"));
    expect(onMealsPerDayChange).toHaveBeenCalledWith(5);
  });

  it("clamps the meals-per-day stepper's -/type controls to 2..6", () => {
    const onMealsPerDayChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({ mealsPerDay: 2, onMealsPerDayChange })}
      />,
    );
    fireEvent.press(getByTestId("mealprint-plan-meals-per-day-dec"));
    expect(onMealsPerDayChange).toHaveBeenCalledWith(2); // floors at 2

    fireEvent.changeText(getByTestId("mealprint-plan-meals-per-day"), "9");
    expect(onMealsPerDayChange).toHaveBeenCalledWith(6); // ceils at 6

    // A non-numeric edit must not call through with NaN.
    onMealsPerDayChange.mockClear();
    fireEvent.changeText(getByTestId("mealprint-plan-meals-per-day"), "abc");
    expect(onMealsPerDayChange).not.toHaveBeenCalled();
  });

  it("reports an effort-level change from the segmented control", () => {
    const onEffortLevelChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPlanSheetPresenter {...props({ onEffortLevelChange })} />,
    );
    fireEvent.press(getByTestId("mealprint-plan-effort-option-quick"));
    expect(onEffortLevelChange).toHaveBeenCalledWith("quick");
  });

  it("shows the day's TARGET, not a remaining-today figure (design/backend contract)", () => {
    const { getByText } = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({
          dayTarget: { kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 },
        })}
      />,
    );
    expect(getByText(/2,200 kcal target/)).toBeTruthy();
  });

  it("renders empty-reason copy (an ANSWER, not an error) and still shows the form", () => {
    const { getByTestId } = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({ emptyReason: "no_candidates" })}
      />,
    );
    expect(getByTestId("mealprint-plan-empty-no_candidates")).toBeTruthy();
    // The form is still there — this is a recoverable state, not a dead end.
    expect(getByTestId("mealprint-plan-generate")).toBeTruthy();
  });

  it("opens the preferences editor", () => {
    const onEditPreferences = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPlanSheetPresenter {...props({ onEditPreferences })} />,
    );
    fireEvent.press(getByTestId("mealprint-plan-edit-preferences"));
    expect(onEditPreferences).toHaveBeenCalled();
  });
});

describe("MealprintPlanSheetPresenter — generating stage", () => {
  it("renders the generating body", () => {
    const { getByTestId } = renderWithTheme(
      <MealprintPlanSheetPresenter {...props({ stage: "generating" })} />,
    );
    expect(getByTestId("mealprint-plan-generating")).toBeTruthy();
  });
});

describe("MealprintPlanSheetPresenter — draft stage", () => {
  it("renders the day-total card and one meal card per draft meal", () => {
    const { getByTestId } = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({
          stage: "draft",
          draft: draft(),
          draftTotals: { kcal: 600, proteinG: 45, carbsG: 60, fatG: 15 },
        })}
      />,
    );
    expect(getByTestId("mealprint-plan-day-totals")).toBeTruthy();
    expect(getByTestId("mealprint-plan-meal-local-1")).toBeTruthy();
  });

  it("fires onSwapMeal / onRemoveMeal with the meal's localId", () => {
    const onSwapMeal = jest.fn();
    const onRemoveMeal = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({ stage: "draft", draft: draft(), onSwapMeal, onRemoveMeal })}
      />,
    );
    fireEvent.press(getByTestId("mealprint-plan-meal-swap-local-1"));
    expect(onSwapMeal).toHaveBeenCalledWith("local-1");
    fireEvent.press(getByTestId("mealprint-plan-meal-remove-local-1"));
    expect(onRemoveMeal).toHaveBeenCalledWith("local-1");
  });

  it("reports a servings increase for the tapped item via +/- controls (AC 4.4)", () => {
    const onItemServingsChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({
          stage: "draft",
          draft: draft(),
          onItemServingsChange,
        })}
      />,
    );
    fireEvent.press(
      getByTestId("mealprint-plan-item-servings-local-1-food-1-inc"),
    );
    expect(onItemServingsChange).toHaveBeenCalledWith(
      "local-1",
      "food-1",
      1.75,
    );

    fireEvent.press(
      getByTestId("mealprint-plan-item-servings-local-1-food-1-dec"),
    );
    expect(onItemServingsChange).toHaveBeenCalledWith(
      "local-1",
      "food-1",
      1.25,
    );
  });

  it("disables the item stepper on a flagged meal", () => {
    const { getByTestId } = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({
          stage: "draft",
          draft: draft(),
          flaggedIds: new Set(["local-1"]),
          acceptBlocked: true,
        })}
      />,
    );
    const inc = getByTestId("mealprint-plan-item-servings-local-1-food-1-inc");
    expect(inc.props.accessibilityState?.disabled).toBe(true);
  });

  it("disables the item stepper on the meal mid-swap", () => {
    const { getByTestId } = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({
          stage: "draft",
          draft: draft(),
          swappingId: "local-1",
        })}
      />,
    );
    const inc = getByTestId("mealprint-plan-item-servings-local-1-food-1-inc");
    expect(inc.props.accessibilityState?.disabled).toBe(true);
  });

  it("shows the flagged banner and blocks Accept when a meal is flagged", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({
          stage: "draft",
          draft: draft(),
          flaggedIds: new Set(["local-1"]),
          acceptBlocked: true,
        })}
      />,
    );
    expect(getByText(/needs a swap before you can accept/i)).toBeTruthy();
    const accept = getByTestId("mealprint-plan-accept");
    expect(accept.props.accessibilityState?.disabled).toBe(true);
  });

  it("Accept fires onAccept when not blocked", () => {
    const onAccept = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({ stage: "draft", draft: draft(), onAccept })}
      />,
    );
    fireEvent.press(getByTestId("mealprint-plan-accept"));
    expect(onAccept).toHaveBeenCalled();
  });

  it("renders an accept-error banner with the recovery action when supplied", () => {
    const onAcceptRecovery = jest.fn();
    const { getByTestId, getByText } = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({
          stage: "draft",
          draft: draft(),
          acceptErrorMessage: "You already have a plan for 2026-08-05.",
          acceptRecovery: "replace",
          onAcceptRecovery,
        })}
      />,
    );
    expect(getByText(/already have a plan/i)).toBeTruthy();
    fireEvent.press(getByTestId("mealprint-plan-accept-recovery"));
    expect(onAcceptRecovery).toHaveBeenCalled();
    expect(getByText("Replace today's plan")).toBeTruthy();
  });

  it("renders an accept-error message with NO recovery button when acceptRecovery is null", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({
          stage: "draft",
          draft: draft(),
          acceptErrorMessage: "no_targets",
          acceptRecovery: null,
        })}
      />,
    );
    expect(getByTestId("mealprint-plan-accept-error")).toBeTruthy();
    expect(queryByTestId("mealprint-plan-accept-recovery")).toBeNull();
  });

  it("shows 'Saving…' while accepting, and 'Swapping…' on the swapping meal card", () => {
    const savingButton = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({ stage: "draft", draft: draft(), accepting: true })}
      />,
    );
    expect(savingButton.getByText("Saving…")).toBeTruthy();

    const swappingCard = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({ stage: "draft", draft: draft(), swappingId: "local-1" })}
      />,
    );
    expect(swappingCard.getByText("Swapping…")).toBeTruthy();
  });

  it("does not divide by zero when the target has no kcal", () => {
    const { getByTestId } = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({
          stage: "draft",
          draft: draft({
            target: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
          }),
        })}
      />,
    );
    expect(getByTestId("mealprint-plan-day-totals")).toBeTruthy();
  });

  it("shows the 'every meal removed' message when the draft has no meals left", () => {
    const { getByText, queryByTestId } = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({
          stage: "draft",
          draft: draft({ meals: [] }),
        })}
      />,
    );
    expect(getByText(/Every meal was removed/i)).toBeTruthy();
    expect(queryByTestId("mealprint-plan-meal-local-1")).toBeNull();
  });

  it("labels the recovery 'Start over' for a regenerate recovery", () => {
    const { getByText } = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({
          stage: "draft",
          draft: draft(),
          acceptErrorMessage: "stale",
          acceptRecovery: "regenerate",
        })}
      />,
    );
    expect(getByText("Start over")).toBeTruthy();
  });

  it("renders the label-check disclaimer on labelCheckRequired", () => {
    const { getByTestId } = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({ stage: "draft", draft: draft(), labelCheckRequired: true })}
      />,
    );
    expect(getByTestId("mealprint-plan-label-check-disclaimer")).toBeTruthy();
  });

  it("renders nothing for a null draft on the draft stage (no lone confirm button over an empty body)", () => {
    const { queryByTestId } = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({ stage: "draft", draft: null })}
      />,
    );
    expect(queryByTestId("mealprint-plan-accept")).toBeNull();
  });
});

describe("MealprintPlanSheetPresenter — saved stage", () => {
  it("renders the confirmation and fires onViewToday", () => {
    const onViewToday = jest.fn();
    const { getByTestId, getByText } = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({ stage: "saved", onViewToday })}
      />,
    );
    expect(getByText(/Plan added to Fuel/i)).toBeTruthy();
    fireEvent.press(getByTestId("mealprint-plan-view-today"));
    expect(onViewToday).toHaveBeenCalled();
  });
});

describe("MealprintPlanSheetPresenter — error stage", () => {
  it("routes to Upgrade on an entitlement failure", () => {
    const onUpgrade = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({ stage: "error", errorIsEntitlement: true, onUpgrade })}
      />,
    );
    fireEvent.press(getByTestId("mealprint-plan-error-upgrade"));
    expect(onUpgrade).toHaveBeenCalled();
  });

  it("routes to Retry when retryable", () => {
    const onRetryGenerate = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPlanSheetPresenter
        {...props({ stage: "error", errorRetryable: true, onRetryGenerate })}
      />,
    );
    fireEvent.press(getByTestId("mealprint-plan-error-retry"));
    expect(onRetryGenerate).toHaveBeenCalled();
  });

  it("offers only Close when neither entitlement nor retryable (e.g. the daily ceiling)", () => {
    const onClose = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MealprintPlanSheetPresenter {...props({ stage: "error", onClose })} />,
    );
    fireEvent.press(getByTestId("mealprint-plan-error-dismiss"));
    expect(onClose).toHaveBeenCalled();
  });
});
