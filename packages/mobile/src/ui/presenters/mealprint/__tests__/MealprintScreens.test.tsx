import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import {
  GENERIC_PARTIAL_ENFORCEMENT_COPY,
  LABEL_CHECK_COPY,
} from "@/domain/models/mealprint";
import {
  MealprintDayPresenter,
  type MealprintDayProps,
  type SwapPanelVM,
} from "../MealprintDayPresenter";
import {
  MealprintLoggedPresenter,
  MealprintSavedPresenter,
  type MealprintLoggedProps,
  type MealprintSavedProps,
} from "../MealprintDoneScreens";
import {
  MealprintHomePresenter,
  type MealprintHomeProps,
} from "../MealprintHomePresenter";
import {
  MealprintIdeasPresenter,
  type MealprintIdeasProps,
} from "../MealprintIdeasPresenter";
import { MealprintLockedPresenter } from "../MealprintLockedPresenter";
import {
  MealprintReviewPresenter,
  type MealprintReviewProps,
} from "../MealprintReviewPresenter";
import {
  MEALPRINT_STATE_COPY,
  MealprintStatePresenter,
  type MealprintState,
} from "../MealprintStatePresenter";
import { MealprintWorkingPresenter } from "../MealprintWorkingPresenter";

const HALAL_CAVEAT =
  "Halal certification isn't in our food data, so Mealprint can only exclude pork and alcohol by ingredient. Check for certification yourself.";

// -- N15 -----------------------------------------------------------------------

function home(over: Partial<MealprintHomeProps> = {}): MealprintHomeProps {
  return {
    tab: "meal",
    onTab: jest.fn(),
    onBack: jest.fn(),
    onPreferences: jest.fn(),
    meal: {
      leftLabel: "Left today",
      left: { kcal: 1893, proteinG: 146, carbsG: 255, fatG: 32 },
      occasion: "on_plan",
      onOccasion: jest.fn(),
      shape: "either",
      onShape: jest.fn(),
    },
    steer: "",
    onSteer: jest.fn(),
    steerError: null,
    notice: null,
    onSubmit: jest.fn(),
    submitDisabled: false,
    ...over,
  };
}

const dayTab = (): NonNullable<MealprintHomeProps["day"]> => ({
  target: { kcal: 2501, proteinG: 181, carbsG: 317, fatG: 56 },
  mealsText: "Breakfast, Pre-workout, Post-workout, Meal 4, Snacks",
  onEditMeals: jest.fn(),
  effortLevel: "balanced",
  effortSheetOpen: false,
  onOpenEffort: jest.fn(),
  onPickEffort: jest.fn(),
  onCloseEffort: jest.fn(),
  preferencesText: "Vegetarian · 2 allergens avoided · 3 disliked",
});

describe("MealprintHomePresenter (N15)", () => {
  it("One meal: what's left, occasion, what you're after and the steer", () => {
    const p = home();
    const { getByText, getByTestId } = renderWithTheme(
      <MealprintHomePresenter {...p} />,
    );
    expect(getByText("What should I eat?")).toBeTruthy();
    expect(getByText("Left today")).toBeTruthy();
    expect(getByTestId("mealprint-home-left-kcal").props.children).toBe(
      "1,893",
    );
    expect(getByText("146g")).toBeTruthy();
    expect(getByText("Meals that keep you on target.")).toBeTruthy();
    expect(getByText("Suggest a meal")).toBeTruthy();
    expect(
      getByText(
        "Works from what you have left today and your food preferences.",
      ),
    ).toBeTruthy();
    fireEvent.press(getByTestId("mealprint-home-shape-snack"));
    expect(p.meal!.onShape).toHaveBeenCalledWith("snack");
    fireEvent.press(getByTestId("mealprint-home-occasion-cheat_meal"));
    expect(p.meal!.onOccasion).toHaveBeenCalledWith("cheat_meal");
    fireEvent.changeText(getByTestId("mealprint-home-steer"), "sweet");
    expect(p.onSteer).toHaveBeenCalledWith("sweet");
    fireEvent.press(getByTestId("mealprint-home-tab-day"));
    expect(p.onTab).toHaveBeenCalledWith("day");
    fireEvent.press(getByTestId("mealprint-home-submit"));
    expect(p.onSubmit).toHaveBeenCalled();
    fireEvent.press(getByTestId("mealprint-home-preferences"));
    fireEvent.press(getByTestId("mealprint-home-back"));
    expect(p.onPreferences).toHaveBeenCalled();
    expect(p.onBack).toHaveBeenCalled();
  });

  it("Cheat meal hides the shape chips and changes the copy", () => {
    const p = home();
    const { queryByTestId, getByText } = renderWithTheme(
      <MealprintHomePresenter
        {...p}
        meal={{ ...p.meal!, occasion: "cheat_meal" }}
      />,
    );
    expect(queryByTestId("mealprint-home-shape-snack")).toBeNull();
    expect(getByText("Show me the options")).toBeTruthy();
    expect(getByText(/Fancy a treat\?/)).toBeTruthy();
  });

  it("without a target it says so instead of a number", () => {
    const p = home();
    const { getByTestId } = renderWithTheme(
      <MealprintHomePresenter {...p} meal={{ ...p.meal!, left: null }} />,
    );
    expect(getByTestId("mealprint-home-no-target")).toBeTruthy();
  });

  it("shows a steer error and a notice", () => {
    const { getByTestId } = renderWithTheme(
      <MealprintHomePresenter
        {...home({ steerError: "Keep it short.", notice: "Full." })}
      />,
    );
    expect(getByTestId("mealprint-home-steer-error")).toBeTruthy();
    expect(getByTestId("mealprint-home-notice")).toBeTruthy();
  });

  it("Whole day: target, Your meals, cooking and preferences rows", () => {
    const day = dayTab();
    const p = home({ tab: "day", meal: undefined, day });
    const { getByText, getByTestId } = renderWithTheme(
      <MealprintHomePresenter {...p} />,
    );
    expect(getByTestId("mealprint-home-target-kcal").props.children).toBe(
      "2,501",
    );
    expect(getByText(day.mealsText)).toBeTruthy();
    expect(getByText("Balanced · a normal amount of cooking")).toBeTruthy();
    expect(getByText(day.preferencesText!)).toBeTruthy();
    expect(getByText("Plan my day")).toBeTruthy();
    expect(
      getByText(
        "Fills your whole day. Nothing is logged until you log each meal.",
      ),
    ).toBeTruthy();
    fireEvent.press(getByTestId("mealprint-home-meals"));
    fireEvent.press(getByTestId("mealprint-home-effort"));
    fireEvent.press(getByTestId("mealprint-home-prefs-row"));
    expect(day.onEditMeals).toHaveBeenCalled();
    expect(day.onOpenEffort).toHaveBeenCalled();
    expect(p.onPreferences).toHaveBeenCalled();
  });

  it("Whole day without a target or preferences", () => {
    const day = { ...dayTab(), target: null, preferencesText: null };
    const { getByTestId, getByText } = renderWithTheme(
      <MealprintHomePresenter
        {...home({ tab: "day", meal: undefined, day })}
      />,
    );
    expect(getByTestId("mealprint-home-no-target")).toBeTruthy();
    expect(getByText("Not set up yet")).toBeTruthy();
  });

  it("the cooking sheet picks a level", () => {
    const day = { ...dayTab(), effortSheetOpen: true };
    const { getByTestId } = renderWithTheme(
      <MealprintHomePresenter
        {...home({ tab: "day", meal: undefined, day })}
      />,
    );
    fireEvent.press(getByTestId("mealprint-home-effort-quick"));
    expect(day.onPickEffort).toHaveBeenCalledWith("quick");
  });
});

// -- N16 / N26 / N27 -------------------------------------------------------------

describe("MealprintWorkingPresenter (N16)", () => {
  it("shows the skeleton screen with Cancel", () => {
    const onCancel = jest.fn();
    const onBack = jest.fn();
    const { getByText, getByTestId } = renderWithTheme(
      <MealprintWorkingPresenter
        body="Fitting…"
        onBack={onBack}
        onCancel={onCancel}
      />,
    );
    expect(getByText("Working out what fits…")).toBeTruthy();
    fireEvent.press(getByTestId("mealprint-working-cancel"));
    fireEvent.press(getByTestId("mealprint-working-back"));
    expect(onCancel).toHaveBeenCalled();
    expect(onBack).toHaveBeenCalled();
  });
});

describe("MealprintLockedPresenter (N26)", () => {
  it("is the Premium+ page with no taster, no price and no 'Core'", () => {
    const onUpgrade = jest.fn();
    const onBack = jest.fn();
    const { getByText, queryByText, getByTestId } = renderWithTheme(
      <MealprintLockedPresenter onBack={onBack} onUpgrade={onUpgrade} />,
    );
    expect(getByText("Premium+")).toBeTruthy();
    expect(getByText("Meals that fit\nwhat's left.")).toBeTruthy();
    expect(getByText("A shopping list")).toBeTruthy();
    expect(queryByText(/Core/)).toBeNull();
    expect(queryByText(/£|\$/)).toBeNull();
    fireEvent.press(getByTestId("mealprint-locked-upgrade"));
    fireEvent.press(getByTestId("mealprint-locked-not-now"));
    expect(onUpgrade).toHaveBeenCalled();
    expect(onBack).toHaveBeenCalled();
  });
});

describe("MealprintStatePresenter (N27)", () => {
  it.each(Object.keys(MEALPRINT_STATE_COPY) as MealprintState[])(
    "%s: one layout with its copy and buttons",
    (state) => {
      const copy = MEALPRINT_STATE_COPY[state];
      const onPrimary = jest.fn();
      const onSecondary = jest.fn();
      const { getByText, queryByTestId, getByTestId } = renderWithTheme(
        <MealprintStatePresenter
          state={state}
          onBack={jest.fn()}
          onPrimary={onPrimary}
          onSecondary={onSecondary}
        />,
      );
      expect(getByTestId(`mealprint-state-${state}`)).toBeTruthy();
      expect(getByText(copy.title)).toBeTruthy();
      expect(getByText(copy.body)).toBeTruthy();
      fireEvent.press(getByTestId("mealprint-state-secondary"));
      expect(onSecondary).toHaveBeenCalled();
      if (copy.primary) {
        fireEvent.press(getByTestId("mealprint-state-primary"));
        expect(onPrimary).toHaveBeenCalled();
      } else {
        expect(queryByTestId("mealprint-state-primary")).toBeNull();
      }
    },
  );

  it("uses the canvas copy word for word", () => {
    expect(MEALPRINT_STATE_COPY.cap.body).toBe(
      "You've used all of today's Mealprint suggestions — they reset tomorrow.",
    );
    expect(MEALPRINT_STATE_COPY.offline.secondary).toBe("Back to Log");
  });
});

// -- N17 / N18 ---------------------------------------------------------------------

function ideas(over: Partial<MealprintIdeasProps> = {}): MealprintIdeasProps {
  return {
    ideas: [
      {
        name: "Chicken, rice and greens bowl",
        reason: "High protein for the 146g you still need.",
        kcal: 612,
        proteinG: 54,
        carbsG: 74,
        fatG: 11,
      },
    ],
    left: { kcal: 1893, proteinG: 146, carbsG: 255, fatG: 32 },
    leftLabel: "kcal left today",
    dietaryPatterns: [],
    serverPartialEnforcementOnly: false,
    onBack: jest.fn(),
    onPreferences: jest.fn(),
    onSelect: jest.fn(),
    onMore: jest.fn(),
    moreDisabled: false,
    notice: null,
    ...over,
  };
}

describe("MealprintIdeasPresenter (N17)", () => {
  it("lists ideas with the label-check copy and asks again", () => {
    const p = ideas();
    const { getByText, getByTestId, queryByTestId } = renderWithTheme(
      <MealprintIdeasPresenter {...p} />,
    );
    expect(getByText("Mealprint · 1 idea")).toBeTruthy();
    expect(getByText("Chicken, rice and greens bowl")).toBeTruthy();
    expect(getByText("54P")).toBeTruthy();
    expect(getByText(LABEL_CHECK_COPY)).toBeTruthy();
    expect(queryByTestId("mealprint-ideas-caveat-partial")).toBeNull();
    fireEvent.press(getByTestId("mealprint-ideas-idea-0"));
    expect(p.onSelect).toHaveBeenCalledWith(0);
    fireEvent.press(getByTestId("mealprint-ideas-more"));
    expect(p.onMore).toHaveBeenCalled();
  });

  it("adds the halal caveat from the diet, or the generic one from the server", () => {
    const halal = renderWithTheme(
      <MealprintIdeasPresenter {...ideas({ dietaryPatterns: ["halal"] })} />,
    );
    expect(halal.getByText(HALAL_CAVEAT)).toBeTruthy();
    const server = renderWithTheme(
      <MealprintIdeasPresenter
        {...ideas({ serverPartialEnforcementOnly: true, left: null })}
      />,
    );
    expect(server.getByText(GENERIC_PARTIAL_ENFORCEMENT_COPY)).toBeTruthy();
    expect(server.queryByTestId("mealprint-ideas-left")).toBeNull();
  });

  it("shows a notice", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <MealprintIdeasPresenter
        {...ideas({
          notice: "Full",
          ideas: [...ideas().ideas, ...ideas().ideas],
        })}
      />,
    );
    expect(getByTestId("mealprint-ideas-notice")).toBeTruthy();
    expect(getByText("Mealprint · 2 ideas")).toBeTruthy();
  });
});

function review(
  over: Partial<MealprintReviewProps> = {},
): MealprintReviewProps {
  return {
    name: "Chicken, rice and greens bowl",
    totals: { kcal: 612, proteinG: 54, carbsG: 74, fatG: 11 },
    items: [
      { name: "Chicken breast", serving: "1.5 × 100 g", kcal: 248, on: true },
      { name: "Rice", serving: "1 × 180 g", kcal: 234, on: false },
    ],
    onToggleItem: jest.fn(),
    logToName: "Meal 4",
    logToMeals: [
      { id: "um-4", name: "Meal 4" },
      { id: "um-b", name: "Breakfast" },
    ],
    logToSelectedId: "um-4",
    logToOpen: false,
    onOpenLogTo: jest.fn(),
    onPickLogTo: jest.fn(),
    onCloseLogTo: jest.fn(),
    dietaryPatterns: [],
    serverPartialEnforcementOnly: false,
    confirming: false,
    added: false,
    errorMessage: null,
    onLog: jest.fn(),
    onBackToIdeas: jest.fn(),
    ...over,
  };
}

describe("MealprintReviewPresenter (N18)", () => {
  it("ticks items, logs to a meal, and carries the label-check copy", () => {
    const p = review();
    const { getByText, getByTestId } = renderWithTheme(
      <MealprintReviewPresenter {...p} />,
    );
    expect(getByText("Log 612 kcal")).toBeTruthy();
    expect(getByText(LABEL_CHECK_COPY)).toBeTruthy();
    expect(getByTestId("mealprint-review-log-to-name").props.children).toBe(
      "Meal 4",
    );
    expect(
      getByTestId("mealprint-review-item-1").props.accessibilityState,
    ).toMatchObject({ checked: false });
    fireEvent.press(getByTestId("mealprint-review-item-1"));
    expect(p.onToggleItem).toHaveBeenCalledWith(1);
    fireEvent.press(getByTestId("mealprint-review-log-to"));
    expect(p.onOpenLogTo).toHaveBeenCalled();
    fireEvent.press(getByTestId("mealprint-review-log"));
    expect(p.onLog).toHaveBeenCalled();
    fireEvent.press(getByTestId("mealprint-review-back"));
    expect(p.onBackToIdeas).toHaveBeenCalled();
  });

  it("nothing ticked: Pick something to log, disabled", () => {
    const p = review({
      items: review().items.map((i) => ({ ...i, on: false })),
    });
    const { getByText, getByTestId } = renderWithTheme(
      <MealprintReviewPresenter {...p} />,
    );
    expect(getByText("Pick something to log")).toBeTruthy();
    fireEvent.press(getByTestId("mealprint-review-log"));
    expect(p.onLog).not.toHaveBeenCalled();
  });

  it("after logging: Added ✓; a part-failure shows its message", () => {
    const added = renderWithTheme(
      <MealprintReviewPresenter {...review({ added: true })} />,
    );
    expect(added.getByText("Added ✓")).toBeTruthy();
    const failed = renderWithTheme(
      <MealprintReviewPresenter {...review({ errorMessage: "Check" })} />,
    );
    expect(failed.getByTestId("mealprint-review-error")).toBeTruthy();
  });

  it("the Log to sheet picks a meal", () => {
    const p = review({ logToOpen: true });
    const { getByTestId } = renderWithTheme(
      <MealprintReviewPresenter {...p} />,
    );
    fireEvent.press(getByTestId("mealprint-review-log-to-um-b"));
    expect(p.onPickLogTo).toHaveBeenCalledWith("um-b");
  });
});

// -- N19 / N20 -----------------------------------------------------------------

function panel(over: Partial<SwapPanelVM> = {}): SwapPanelVM {
  return {
    localId: "m4",
    feedback: "",
    onFeedback: jest.fn(),
    feedbackError: null,
    sentFor: null,
    chips: [
      { label: "High protein", on: true },
      { label: "Lighter", on: false },
    ],
    onChip: jest.fn(),
    options: [
      {
        name: "Turkey chilli with rice",
        items: "Turkey · rice",
        kcal: 652,
        delta: "+12 kcal",
        deltaQuiet: true,
      },
      {
        name: "Cod, sweet potato and peas",
        items: "Cod · sweet potato",
        kcal: 590,
        delta: "−50 kcal",
        deltaQuiet: false,
      },
    ],
    loading: false,
    error: null,
    onSend: jest.fn(),
    onPick: jest.fn(),
    onMore: jest.fn(),
    moreDisabled: false,
    onClose: jest.fn(),
    closeLabel: "Keep this meal",
    ...over,
  };
}

function day(over: Partial<MealprintDayProps> = {}): MealprintDayProps {
  return {
    totals: { kcal: 2476, proteinG: 180, carbsG: 304, fatG: 58 },
    target: { kcal: 2501, proteinG: 181, carbsG: 317, fatG: 56 },
    meals: [
      {
        localId: "m1",
        slot: "Breakfast",
        name: "Protein oats with berries",
        items: "Oats · whey · blueberries",
        kcal: 548,
        flagged: false,
        swapped: true,
        portionLabel: "×1",
        canLess: true,
        canMore: false,
      },
      {
        localId: "m4",
        slot: "Meal 4",
        name: "Salmon, potatoes and green beans",
        items: "Salmon · potatoes · beans",
        kcal: 640,
        flagged: true,
        swapped: false,
        portionLabel: "×1",
        canLess: true,
        canMore: true,
      },
    ],
    openId: null,
    swap: null,
    onTapMeal: jest.fn(),
    onSwap: jest.fn(),
    onLess: jest.fn(),
    onMore: jest.fn(),
    onUndo: jest.fn(),
    onRemove: jest.fn(),
    dietaryPatterns: [],
    blockedLabel: null,
    busy: false,
    errorMessage: null,
    errorAction: null,
    onLogAll: jest.fn(),
    onSave: jest.fn(),
    onShoppingList: jest.fn(),
    onBack: jest.fn(),
    ...over,
  };
}

describe("MealprintDayPresenter (N19/N20)", () => {
  it("shows totals against the target, flagged and swapped meals, and the caveat", () => {
    const p = day();
    const { getByText, getByTestId } = renderWithTheme(
      <MealprintDayPresenter {...p} />,
    );
    expect(getByTestId("mealprint-day-total").props.children).toBe("2,476");
    expect(getByText("of 2,501 kcal")).toBeTruthy();
    expect(getByText("180/181")).toBeTruthy();
    expect(getByText("CHECK")).toBeTruthy();
    expect(getByText("SWAPPED")).toBeTruthy();
    expect(
      getByText("This meal needs a swap before you can accept."),
    ).toBeTruthy();
    expect(getByText(LABEL_CHECK_COPY)).toBeTruthy();
    fireEvent.press(getByTestId("mealprint-day-meal-m1-tap"));
    expect(p.onTapMeal).toHaveBeenCalledWith("m1");
    fireEvent.press(getByTestId("mealprint-day-meal-m4-swap"));
    expect(p.onSwap).toHaveBeenCalledWith("m4");
  });

  it("the two ways out and the shopping list", () => {
    const p = day();
    const { getByTestId } = renderWithTheme(<MealprintDayPresenter {...p} />);
    fireEvent.press(getByTestId("mealprint-day-log-all"));
    fireEvent.press(getByTestId("mealprint-day-save"));
    fireEvent.press(getByTestId("mealprint-day-shopping"));
    expect(p.onLogAll).toHaveBeenCalled();
    expect(p.onSave).toHaveBeenCalled();
    expect(p.onShoppingList).toHaveBeenCalled();
  });

  it("blocked: one disabled button saying why", () => {
    const p = day({ blockedLabel: "Swap the flagged meal to continue" });
    const { getByText, queryByTestId } = renderWithTheme(
      <MealprintDayPresenter {...p} />,
    );
    expect(getByText("Swap the flagged meal to continue")).toBeTruthy();
    expect(queryByTestId("mealprint-day-save")).toBeNull();
  });

  it("an error with a way out", () => {
    const onPress = jest.fn();
    const { getByTestId, getByText } = renderWithTheme(
      <MealprintDayPresenter
        {...day({
          errorMessage: "You already have a Mealprint plan for today.",
          errorAction: { label: "Replace it", onPress },
        })}
      />,
    );
    expect(
      getByText("You already have a Mealprint plan for today."),
    ).toBeTruthy();
    fireEvent.press(getByTestId("mealprint-day-error-action"));
    expect(onPress).toHaveBeenCalled();
  });

  it("tap a meal: portion stepper, Undo swap and Remove", () => {
    const p = day({ openId: "m1" });
    const { getByTestId } = renderWithTheme(<MealprintDayPresenter {...p} />);
    expect(getByTestId("mealprint-day-meal-m1-portion").props.children).toBe(
      "×1",
    );
    fireEvent.press(getByTestId("mealprint-day-meal-m1-less"));
    fireEvent.press(getByTestId("mealprint-day-meal-m1-more")); // disabled
    fireEvent.press(getByTestId("mealprint-day-meal-m1-undo"));
    fireEvent.press(getByTestId("mealprint-day-meal-m1-remove"));
    expect(p.onLess).toHaveBeenCalledWith("m1");
    expect(p.onMore).not.toHaveBeenCalled();
    expect(p.onUndo).toHaveBeenCalledWith("m1");
    expect(p.onRemove).toHaveBeenCalledWith("m1");
  });

  it("the swap panel: feedback, chips, 3 options with the kcal difference, more and keep", () => {
    const sw = panel({ sentFor: "Something warm" });
    const { getByTestId, getByText, queryByText } = renderWithTheme(
      <MealprintDayPresenter {...day({ swap: sw })} />,
    );
    // Other meals shrink to one line while a panel is open.
    expect(queryByText("Oats · whey · blueberries")).toBeNull();
    expect(getByText("+12 kcal")).toBeTruthy();
    expect(getByText("−50 kcal")).toBeTruthy();
    expect(
      getByText(
        "Updated for “Something warm” · your food preferences still apply",
      ),
    ).toBeTruthy();
    fireEvent.changeText(getByTestId("mealprint-day-swap-feedback"), "no rice");
    expect(sw.onFeedback).toHaveBeenCalledWith("no rice");
    fireEvent.press(getByTestId("mealprint-day-swap-send"));
    fireEvent.press(getByTestId("mealprint-day-swap-chip-Lighter"));
    fireEvent.press(getByTestId("mealprint-day-swap-option-1"));
    fireEvent.press(getByTestId("mealprint-day-swap-more"));
    fireEvent.press(getByTestId("mealprint-day-swap-close"));
    expect(sw.onSend).toHaveBeenCalled();
    expect(sw.onChip).toHaveBeenCalledWith("Lighter");
    expect(sw.onPick).toHaveBeenCalledWith(1);
    expect(sw.onMore).toHaveBeenCalled();
    expect(sw.onClose).toHaveBeenCalled();
    expect(getByText("Keep this meal")).toBeTruthy();
  });

  it("the swap panel while loading, and with an error", () => {
    const loading = renderWithTheme(
      <MealprintDayPresenter {...day({ swap: panel({ loading: true }) })} />,
    );
    expect(loading.getByTestId("mealprint-day-swap-loading")).toBeTruthy();
    const failed = renderWithTheme(
      <MealprintDayPresenter
        {...day({
          swap: panel({ error: "No replacement", feedbackError: "Too long" }),
        })}
      />,
    );
    expect(failed.getByTestId("mealprint-day-swap-error")).toBeTruthy();
    expect(failed.getByText("Too long")).toBeTruthy();
  });
});

// -- N21 / N22 -------------------------------------------------------------------

function saved(over: Partial<MealprintSavedProps> = {}): MealprintSavedProps {
  return {
    name: "Mealprint",
    onName: jest.fn(),
    onNameDone: jest.fn(),
    nameError: null,
    mealCount: 5,
    kcal: 2488,
    proteinG: 179,
    onClose: jest.fn(),
    onViewInPlan: jest.fn(),
    onShoppingList: jest.fn(),
    inShoppingList: false,
    shoppingBusy: false,
    ...over,
  };
}

describe("MealprintSavedPresenter (N21)", () => {
  it("saved under Mine with a name, no days to pick", () => {
    const p = saved();
    const { getByText, getByTestId, queryByText } = renderWithTheme(
      <MealprintSavedPresenter {...p} />,
    );
    expect(getByText("Saved to your plans")).toBeTruthy();
    expect(getByText("2,488")).toBeTruthy();
    expect(queryByText(/Use on|days it runs|Mon|Tue/)).toBeNull();
    fireEvent.changeText(getByTestId("mealprint-saved-name"), "Training day");
    expect(p.onName).toHaveBeenCalledWith("Training day");
    fireEvent(getByTestId("mealprint-saved-name"), "submitEditing");
    expect(p.onNameDone).toHaveBeenCalled();
    fireEvent.press(getByTestId("mealprint-saved-view"));
    fireEvent.press(getByTestId("mealprint-saved-shopping"));
    fireEvent.press(getByTestId("mealprint-saved-close"));
    expect(p.onViewInPlan).toHaveBeenCalled();
    expect(p.onShoppingList).toHaveBeenCalled();
    expect(p.onClose).toHaveBeenCalled();
    expect(getByText("Add to shopping list")).toBeTruthy();
  });

  it("once on the list, offers to view it; shows a name error", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <MealprintSavedPresenter
        {...saved({ inShoppingList: true, nameError: "Name the plan." })}
      />,
    );
    expect(getByText("View shopping list")).toBeTruthy();
    expect(getByTestId("mealprint-saved-name-error")).toBeTruthy();
  });
});

function logged(
  over: Partial<MealprintLoggedProps> = {},
): MealprintLoggedProps {
  return {
    loggedCount: 3,
    skippedNames: "Breakfast and Snacks",
    rows: [
      {
        key: "a",
        mealName: "Breakfast",
        detail: "Skipped · already has food",
        kcal: null,
        skipped: true,
      },
      {
        key: "b",
        mealName: "Meal 4",
        detail: "Turkey chilli with rice",
        kcal: 652,
        skipped: false,
      },
    ],
    eatenKcal: 2334,
    targetKcal: 2501,
    onClose: jest.fn(),
    onViewInLog: jest.fn(),
    onUndo: jest.fn(),
    undoing: false,
    undone: false,
    ...over,
  };
}

describe("MealprintLoggedPresenter (N22)", () => {
  it("says what was logged and skipped, Eaten · Target · Left, and offers Undo", () => {
    const p = logged();
    const { getByText, getByTestId } = renderWithTheme(
      <MealprintLoggedPresenter {...p} />,
    );
    expect(getByText("3 meals logged")).toBeTruthy();
    expect(
      getByText(
        "Added to today's Log. Breakfast and Snacks already had food, so we left them alone.",
      ),
    ).toBeTruthy();
    expect(getByText("167")).toBeTruthy();
    expect(getByText("Left")).toBeTruthy();
    fireEvent.press(getByTestId("mealprint-logged-undo"));
    fireEvent.press(getByTestId("mealprint-logged-view"));
    expect(p.onUndo).toHaveBeenCalled();
    expect(p.onViewInLog).toHaveBeenCalled();
  });

  it("one skipped meal reads 'it'; nothing skipped; over target", () => {
    const one = renderWithTheme(
      <MealprintLoggedPresenter
        {...logged({ loggedCount: 1, skippedNames: "Breakfast" })}
      />,
    );
    expect(one.getByText("1 meal logged")).toBeTruthy();
    expect(one.getByText(/so we left it alone\./)).toBeTruthy();
    const none = renderWithTheme(
      <MealprintLoggedPresenter
        {...logged({ skippedNames: null, eatenKcal: 2600 })}
      />,
    );
    expect(none.getByText("Added to today's Log.")).toBeTruthy();
    expect(none.getByText("Over")).toBeTruthy();
    const noTarget = renderWithTheme(
      <MealprintLoggedPresenter {...logged({ targetKcal: null })} />,
    );
    expect(noTarget.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("after Undo: no Undo button, and it says so", () => {
    const { getByText, queryByTestId } = renderWithTheme(
      <MealprintLoggedPresenter {...logged({ undone: true })} />,
    );
    expect(getByText("Undone")).toBeTruthy();
    expect(queryByTestId("mealprint-logged-undo")).toBeNull();
  });
});
