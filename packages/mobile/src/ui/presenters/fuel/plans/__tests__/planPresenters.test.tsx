import { act, fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../../__tests__/test-utils";
import { reorderableTestApi } from "../../../../../../__tests__/reorderable-test-api";
import type { TargetComparison } from "@/domain/services/nutritionPlans.service";
import { NewPlanPresenter, type NewPlanProps } from "../NewPlanPresenter";
import {
  PlanMealsSheetPresenter,
  type PlanMealsSheetProps,
} from "../PlanMealsSheetPresenter";
import {
  PlanTargetSummaryPresenter,
  ringCentre,
} from "../PlanTargetSummaryPresenter";
import {
  PlanBuilderPresenter,
  type PlanBuilderProps,
} from "../PlanBuilderPresenter";
import {
  PlanOptionsSheetPresenter,
  type PlanOptionsSheetProps,
} from "../PlanOptionsSheetPresenter";
import {
  PlanItemAmountSheetPresenter,
  type PlanItemAmountSheetProps,
} from "../PlanItemAmountSheetPresenter";
import { PlanSavedPresenter } from "../PlanSavedPresenter";
import {
  PlanAddFoodPresenter,
  type PlanAddFoodProps,
} from "../PlanAddFoodPresenter";
import {
  PlanQuickItemSheetPresenter,
  type PlanQuickItemSheetProps,
} from "../PlanQuickItemSheetPresenter";

const cmp = (
  state: TargetComparison["state"],
  planned: number,
  target: number | null = 2371,
): TargetComparison => ({
  state,
  plannedKcal: planned,
  targetKcal: target,
  toPlanKcal: target === null ? null : target - planned,
});

const MACROS = [
  {
    key: "protein",
    label: "Protein",
    letter: "P",
    plannedG: 165,
    targetG: 178,
  },
  { key: "carbs", label: "Carbs", letter: "C", plannedG: 254, targetG: 240 },
  { key: "fat", label: "Fat", letter: "F", plannedG: 62, targetG: 77 },
] as const;

describe("PlanTargetSummaryPresenter (N29/N32 ring)", () => {
  it("ring centre follows the canvas ringV rules", () => {
    expect(ringCentre(cmp("on_target", 2300))).toEqual({
      value: "2,300",
      label: "of 2,371",
    });
    expect(ringCentre(cmp("to_plan", 0))).toEqual({
      value: "2,371",
      label: "To plan",
    });
    expect(ringCentre(cmp("over", 2600))).toEqual({
      value: "+229",
      label: "Over",
    });
    expect(ringCentre(cmp("no_target", 500, null))).toEqual({
      value: "500",
      label: "kcal",
    });
  });

  it("shows Target · Planned · To plan, On target within 100", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <PlanTargetSummaryPresenter
        comparison={cmp("on_target", 2300)}
        planned={{ proteinG: 165, carbsG: 254, fatG: 62 }}
        macros={[...MACROS]}
      />,
    );
    expect(getByText("On target")).toBeTruthy();
    expect(getByText("Within 100")).toBeTruthy();
    expect(getByText("Planned")).toBeTruthy();
    expect(getByText(" / 178g")).toBeTruthy();
    expect(getByTestId("plan-summary-ring").props.accessibilityLabel).toBe(
      "2,300 of 2,371 kcal planned",
    );
  });

  it("shows over and no-target states", () => {
    const over = renderWithTheme(
      <PlanTargetSummaryPresenter
        comparison={cmp("over", 2600)}
        planned={{ proteinG: 1, carbsG: 1, fatG: 1 }}
        macros={[...MACROS]}
      />,
    );
    expect(over.getAllByText("+229").length).toBe(2);
    expect(over.getAllByText("Over").length).toBe(2);
    const none = renderWithTheme(
      <PlanTargetSummaryPresenter
        comparison={cmp("no_target", 0, null)}
        planned={{ proteinG: 0, carbsG: 0, fatG: 0 }}
        macros={MACROS.map((m) => ({ ...m, targetG: null }))}
      />,
    );
    expect(none.getAllByText("—").length).toBe(2);
    expect(none.getByTestId("plan-summary-ring").props.accessibilityLabel).toBe(
      "0 kcal planned",
    );
    const toPlan = renderWithTheme(
      <PlanTargetSummaryPresenter
        comparison={cmp("to_plan", 1000)}
        planned={{ proteinG: 50, carbsG: 50, fatG: 10 }}
        macros={[...MACROS]}
      />,
    );
    expect(toPlan.getAllByText("1,371").length).toBe(2);
  });
});

describe("NewPlanPresenter (N28)", () => {
  const render = (over: Partial<NewPlanProps> = {}) => {
    const props: NewPlanProps = {
      onBack: jest.fn(),
      name: "",
      onName: jest.fn(),
      targetValue: "2,371 kcal",
      onTarget: jest.fn(),
      mealsText: "Breakfast, Lunch",
      onEditMeals: jest.fn(),
      options: [
        {
          key: "empty",
          label: "Empty meals",
          sub: "Fill each meal yourself",
          selected: true,
          gold: false,
        },
        {
          key: "mealprint",
          label: "Let Mealprint fill it",
          sub: "Every meal, then swap what you don't like",
          selected: false,
          gold: true,
        },
      ],
      onOption: jest.fn(),
      ctaLabel: "Start building",
      canContinue: true,
      onContinue: jest.fn(),
      calendarVisible: false,
      calendarDay: "2026-11-22",
      maxDay: "2026-11-23",
      onPickDay: jest.fn(),
      onCloseCalendar: jest.fn(),
      planPickerVisible: true,
      plans: [{ id: "p1", name: "Training day", sub: "4 meals · 2,400 kcal" }],
      onPickPlan: jest.fn(),
      onClosePlanPicker: jest.fn(),
      ...over,
    };
    return { ...renderWithTheme(<NewPlanPresenter {...props} />), props };
  };

  it("renders the canvas copy without any days", () => {
    const { getByText, getAllByText, queryByText } = render();
    expect(getAllByText("New plan").length).toBeGreaterThan(0);
    expect(
      getByText("A plan is a set of meals for a kind of day."),
    ).toBeTruthy();
    expect(getByText("Opens your targets calculator")).toBeTruthy();
    expect(getByText("2,371 kcal")).toBeTruthy();
    expect(getByText("Start from")).toBeTruthy();
    expect(getByText("Premium+")).toBeTruthy();
    expect(queryByText(/Days it runs|Use on/)).toBeNull();
  });

  it("wires every control", () => {
    const { getByTestId, props } = render();
    fireEvent.changeText(getByTestId("new-plan-name"), "Rest day");
    expect(props.onName).toHaveBeenCalledWith("Rest day");
    fireEvent.press(getByTestId("new-plan-target"));
    fireEvent.press(getByTestId("new-plan-meals"));
    fireEvent.press(getByTestId("new-plan-from-mealprint"));
    fireEvent.press(getByTestId("new-plan-cta"));
    fireEvent.press(getByTestId("new-plan-back"));
    fireEvent.press(getByTestId("new-plan-plan-p1"));
    expect(props.onTarget).toHaveBeenCalled();
    expect(props.onEditMeals).toHaveBeenCalled();
    expect(props.onOption).toHaveBeenCalledWith("mealprint");
    expect(props.onContinue).toHaveBeenCalled();
    expect(props.onBack).toHaveBeenCalled();
    expect(props.onPickPlan).toHaveBeenCalledWith("p1");
  });

  it("disables the CTA when it can't continue", () => {
    const { getByTestId, props } = render({ canContinue: false });
    fireEvent.press(getByTestId("new-plan-cta"));
    expect(props.onContinue).not.toHaveBeenCalled();
  });
});

describe("PlanMealsSheetPresenter (N28b)", () => {
  const render = (over: Partial<PlanMealsSheetProps> = {}) => {
    const props: PlanMealsSheetProps = {
      visible: true,
      onClose: jest.fn(),
      meals: [
        { id: "a", name: "Breakfast", sub: "Default", ticked: true },
        { id: "b", name: "Pre-workout", sub: "Added by you", ticked: false },
      ],
      editable: true,
      full: false,
      onToggle: jest.fn(),
      onRename: jest.fn(),
      onReorder: jest.fn(),
      onAdd: jest.fn(),
      ...over,
    };
    return {
      ...renderWithTheme(<PlanMealsSheetPresenter {...props} />),
      props,
    };
  };

  it("ticks, renames, adds, reorders and closes", () => {
    const { getByTestId, getByText, props } = render();
    expect(
      getByText(
        "Tick the meals this plan has. Rename or reorder them here too.",
      ),
    ).toBeTruthy();
    expect(
      getByTestId("plan-meal-tick-a").props.accessibilityState.checked,
    ).toBe(true);
    fireEvent.press(getByTestId("plan-meal-tick-b"));
    expect(props.onToggle).toHaveBeenCalledWith("b");

    fireEvent.press(getByTestId("plan-meal-rename-b"));
    const input = getByTestId("plan-meal-rename-input-b");
    fireEvent.changeText(input, "Pre-gym");
    fireEvent(input, "submitEditing");
    expect(props.onRename).toHaveBeenCalledWith("b", "Pre-gym");

    fireEvent.press(getByTestId("plan-meal-rename-a"));
    const blank = getByTestId("plan-meal-rename-input-a");
    fireEvent.changeText(blank, " ");
    fireEvent(blank, "blur");
    expect(props.onRename).toHaveBeenCalledTimes(1);

    fireEvent.press(getByTestId("plan-meals-sheet-add"));
    const add = getByTestId("plan-meals-sheet-new-name");
    fireEvent.changeText(add, "Supper");
    fireEvent(add, "submitEditing");
    expect(props.onAdd).toHaveBeenCalledWith("Supper");

    act(() => {
      reorderableTestApi.dragStart("a");
      reorderableTestApi.drop("a", 1, { a: 1, b: 0 });
    });
    expect(props.onReorder).toHaveBeenCalledWith(["b", "a"]);

    fireEvent.press(getByTestId("plan-meals-sheet-done"));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("is read-only with placeholders", () => {
    const { getByTestId, queryByTestId } = render({ editable: false });
    expect(getByTestId("plan-meals-sheet-offline")).toBeTruthy();
    expect(queryByTestId("plan-meal-rename-a")).toBeNull();
  });
});

describe("PlanBuilderPresenter (N29/N32/N34)", () => {
  const render = (over: Partial<PlanBuilderProps> = {}) => {
    const props: PlanBuilderProps = {
      mode: "new",
      onBack: jest.fn(),
      onOptions: jest.fn(),
      name: "Rest day",
      subtitle: "Mine · target 2,371 kcal",
      summary: {
        comparison: cmp("to_plan", 520),
        planned: { proteinG: 36, carbsG: 48, fatG: 20 },
        macros: [...MACROS],
      },
      meals: [
        {
          id: "m1",
          name: "Breakfast",
          kcalText: "520 kcal",
          items: [
            {
              id: "i1",
              name: "Scrambled eggs on sourdough",
              sub: "My meal · 1 serving",
              kcal: "520",
            },
          ],
        },
        { id: "m2", name: "Lunch", kcalText: "", items: [] },
      ],
      onAddToMeal: jest.fn(),
      onFromPastDay: jest.fn(),
      onItem: jest.fn(),
      onAddMeal: jest.fn(),
      notice: null,
      ctaLabel: "Save plan",
      canSave: true,
      saving: false,
      onSave: jest.fn(),
      ...over,
    };
    return { ...renderWithTheme(<PlanBuilderPresenter {...props} />), props };
  };

  it("renders a filled plan and wires the rows", () => {
    const { getByText, getByTestId, getByLabelText, props } = render();
    expect(getByText("Mine · target 2,371 kcal")).toBeTruthy();
    expect(getByText("Nothing yet")).toBeTruthy();
    expect(getByLabelText("Add to Lunch")).toBeTruthy();
    fireEvent.press(getByTestId("plan-builder-item-i1"));
    expect(props.onItem).toHaveBeenCalledWith("m1", "i1");
    fireEvent.press(getByTestId("plan-builder-add-m1"));
    fireEvent.press(getByTestId("plan-builder-addfood-m2"));
    expect(props.onAddToMeal).toHaveBeenNthCalledWith(1, "m1");
    expect(props.onAddToMeal).toHaveBeenNthCalledWith(2, "m2");
    fireEvent.press(getByTestId("plan-builder-pastday-m2"));
    expect(props.onFromPastDay).toHaveBeenCalledWith("m2");
    fireEvent.press(getByTestId("plan-builder-add-meal"));
    expect(props.onAddMeal).toHaveBeenCalled();
    fireEvent.press(getByTestId("plan-builder-top-save"));
    fireEvent.press(getByTestId("plan-builder-cta"));
    expect(props.onSave).toHaveBeenCalledTimes(2);
    fireEvent.press(getByTestId("plan-builder-back"));
    expect(props.onBack).toHaveBeenCalled();
  });

  it("can't save an empty new plan", () => {
    const { getByText, getByTestId, props } = render({
      canSave: false,
      ctaLabel: "Add something to save",
    });
    expect(getByText("Add something to save")).toBeTruthy();
    fireEvent.press(getByTestId("plan-builder-cta"));
    fireEvent.press(getByTestId("plan-builder-top-save"));
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("edit mode shows Edit plan, ⋯ and a notice", () => {
    const { getByText, getByTestId, queryByTestId, props } = render({
      mode: "edit",
      ctaLabel: "Save changes",
      notice: "Nothing was logged in Lunch that day.",
    });
    expect(getByText("Edit plan")).toBeTruthy();
    expect(getByText("Save changes")).toBeTruthy();
    expect(getByTestId("plan-builder-notice")).toBeTruthy();
    expect(queryByTestId("plan-builder-top-save")).toBeNull();
    fireEvent.press(getByTestId("plan-builder-options"));
    expect(props.onOptions).toHaveBeenCalled();
  });
});

describe("PlanOptionsSheetPresenter (N34)", () => {
  const render = (over: Partial<PlanOptionsSheetProps> = {}) => {
    const props: PlanOptionsSheetProps = {
      view: "menu",
      onClose: jest.fn(),
      planName: "Rest day",
      targetValue: "2,371",
      mealsText: "Breakfast, Lunch, Dinner, Snacks",
      onStartRename: jest.fn(),
      onRename: jest.fn(),
      onTarget: jest.fn(),
      onMeals: jest.fn(),
      onDuplicate: jest.fn(),
      onAskDelete: jest.fn(),
      onDelete: jest.fn(),
      ...over,
    };
    return {
      ...renderWithTheme(<PlanOptionsSheetPresenter {...props} />),
      props,
    };
  };

  it("lists the options without Days it runs", () => {
    const { getByText, queryByText, getByTestId, props } = render();
    expect(getByText("Breakfast, Lunch, Dinner, Snacks")).toBeTruthy();
    expect(queryByText("Days it runs")).toBeNull();
    for (const id of [
      "rename",
      "target",
      "meals",
      "duplicate",
      "delete",
      "cancel",
    ])
      fireEvent.press(getByTestId(`plan-options-${id}`));
    expect(props.onStartRename).toHaveBeenCalled();
    expect(props.onTarget).toHaveBeenCalled();
    expect(props.onMeals).toHaveBeenCalled();
    expect(props.onDuplicate).toHaveBeenCalled();
    expect(props.onAskDelete).toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it("renames", () => {
    const { getByTestId, props } = render({ view: "rename" });
    const input = getByTestId("plan-options-name");
    fireEvent.changeText(input, "  ");
    fireEvent.press(getByTestId("plan-options-rename-save"));
    fireEvent(input, "submitEditing");
    expect(props.onRename).not.toHaveBeenCalled();
    fireEvent.changeText(input, " Easy day ");
    fireEvent(input, "submitEditing");
    fireEvent.press(getByTestId("plan-options-rename-save"));
    expect(props.onRename).toHaveBeenCalledWith("Easy day");
    expect(props.onRename).toHaveBeenCalledTimes(2);
  });

  it("confirms a delete without the days line", () => {
    const { getByText, queryByText, getByTestId, props } = render({
      view: "delete",
    });
    expect(getByText("Delete Rest day?")).toBeTruthy();
    expect(
      getByText("Food you have already logged stays in your diary."),
    ).toBeTruthy();
    expect(queryByText(/It comes off/)).toBeNull();
    fireEvent.press(getByTestId("plan-options-confirm-cancel"));
    fireEvent.press(getByTestId("plan-options-confirm-delete"));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onDelete).toHaveBeenCalled();
  });
});

describe("PlanItemAmountSheetPresenter (N31)", () => {
  const render = (over: Partial<PlanItemAmountSheetProps> = {}) => {
    const props: PlanItemAmountSheetProps = {
      visible: true,
      onClose: jest.fn(),
      mode: "edit",
      name: "Protein bar",
      sub: "1 bar",
      servingSize: "1 bar",
      amount: "1",
      onAmount: jest.fn(),
      chips: [
        { value: 0.5, label: "½", selected: false },
        { value: 1, label: "1", selected: true },
      ],
      onChip: jest.fn(),
      mealName: "Snacks",
      meals: [
        { id: "m1", name: "Breakfast" },
        { id: "m4", name: "Snacks" },
      ],
      onMeal: jest.fn(),
      kcal: 198,
      macros: [
        { label: "Protein", grams: 20, pct: 40 },
        { label: "Carbs", grams: 20, pct: 40 },
        { label: "Fat", grams: 7, pct: 20 },
      ],
      canSave: true,
      onSave: jest.fn(),
      onRemove: jest.fn(),
      ...over,
    };
    return {
      ...renderWithTheme(<PlanItemAmountSheetPresenter {...props} />),
      props,
    };
  };

  it("edits an amount, the meal, then saves or removes", () => {
    const { getByText, getAllByText, getByTestId, props } = render();
    expect(getByText("Serving size")).toBeTruthy();
    expect(getByText(" type any amount")).toBeTruthy();
    expect(getAllByText("40%")).toHaveLength(2);
    fireEvent.changeText(getByTestId("plan-amount-amount"), "2");
    expect(props.onAmount).toHaveBeenCalledWith("2");
    fireEvent.press(getByTestId("plan-amount-chip-0.5"));
    expect(props.onChip).toHaveBeenCalledWith(0.5);
    fireEvent.press(getByTestId("plan-amount-meal"));
    fireEvent.press(getByTestId("plan-amount-meal-m1"));
    expect(props.onMeal).toHaveBeenCalledWith("m1");
    fireEvent.press(getByTestId("plan-amount-save"));
    fireEvent.press(getByTestId("plan-amount-remove"));
    expect(props.onSave).toHaveBeenCalled();
    expect(props.onRemove).toHaveBeenCalled();
    expect(getByText("Remove from plan")).toBeTruthy();
  });

  it("adds in add mode", () => {
    const { getByText, queryByTestId } = render({ mode: "add", kcal: 0 });
    expect(getByText("Add to Snacks · 0 kcal")).toBeTruthy();
    expect(queryByTestId("plan-amount-remove")).toBeNull();
  });
});

describe("PlanSavedPresenter (N33)", () => {
  it("shows the trimmed copy and its buttons", () => {
    const props = {
      name: "Rest day",
      mealCount: 4,
      kcal: 2237,
      proteinG: 165,
      onClose: jest.fn(),
      onViewInPlan: jest.fn(),
      onShoppingList: jest.fn(),
      addingToList: false,
    };
    const { getByText, queryByText, getByTestId } = renderWithTheme(
      <PlanSavedPresenter {...props} />,
    );
    expect(getByText("Saved to your plans")).toBeTruthy();
    expect(getByText("Under Mine in Plan.")).toBeTruthy();
    expect(getByText("2,237")).toBeTruthy();
    expect(getByText("165g")).toBeTruthy();
    expect(queryByText(/Use on|Runs on/)).toBeNull();
    fireEvent.press(getByTestId("plan-saved-view"));
    fireEvent.press(getByTestId("plan-saved-shopping"));
    fireEvent.press(getByTestId("plan-saved-close"));
    expect(props.onViewInPlan).toHaveBeenCalled();
    expect(props.onShoppingList).toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });
});

describe("PlanAddFoodPresenter (N30)", () => {
  const render = (over: Partial<PlanAddFoodProps> = {}) => {
    const props: PlanAddFoodProps = {
      onBack: jest.fn(),
      mealName: "Breakfast",
      planName: "Rest day",
      onOpenMealPicker: jest.fn(),
      mealPickerVisible: true,
      meals: [
        { id: "m1", name: "Breakfast" },
        { id: "m2", name: "Lunch" },
      ],
      onSelectMeal: jest.fn(),
      onCloseMealPicker: jest.fn(),
      query: "",
      onQuery: jest.fn(),
      tab: "all",
      onTab: jest.fn(),
      onQuickLog: jest.fn(),
      sectionTitle: "History",
      rows: [
        { key: "e:1", name: "Bagel", sub: "1 bagel · 230 kcal", picked: false },
        { key: "e:2", name: "Large egg", sub: "1 egg · 72 kcal", picked: true },
      ],
      emptyText: "Nothing yet",
      onToggle: jest.fn(),
      onRow: jest.fn(),
      ctaLabel: "Add 1 item to Breakfast",
      canAdd: true,
      onAdd: jest.fn(),
      ...over,
    };
    return {
      ...renderWithTheme(<PlanAddFoodPresenter {...props} />),
      props,
    };
  };

  it("renders plan mode and wires everything", () => {
    const { getByText, getByTestId, getByLabelText, props } = render();
    expect(
      getByText("Adding to your Rest day plan, not today's log"),
    ).toBeTruthy();
    expect(getByText("History")).toBeTruthy();
    expect(getByLabelText("Remove Large egg")).toBeTruthy();
    fireEvent.changeText(getByTestId("plan-add-search"), "oat");
    expect(props.onQuery).toHaveBeenCalledWith("oat");
    fireEvent.press(getByTestId("plan-add-tab-recipes"));
    expect(props.onTab).toHaveBeenCalledWith("recipes");
    fireEvent.press(getByTestId("plan-add-quick"));
    expect(props.onQuickLog).toHaveBeenCalled();
    fireEvent.press(getByTestId("plan-add-scan"));
    fireEvent.press(getByTestId("plan-add-photo"));
    expect(getByTestId("plan-add-scan").props.accessibilityState.disabled).toBe(
      true,
    );
    fireEvent.press(getByTestId("plan-add-toggle-e:1"));
    expect(props.onToggle).toHaveBeenCalledWith("e:1");
    fireEvent.press(getByTestId("plan-add-row-e:1"));
    expect(props.onRow).toHaveBeenCalledWith("e:1");
    fireEvent.press(getByTestId("plan-add-title"));
    expect(props.onOpenMealPicker).toHaveBeenCalled();
    fireEvent.press(getByTestId("plan-add-meal-m2"));
    expect(props.onSelectMeal).toHaveBeenCalledWith("m2");
    fireEvent.press(getByTestId("plan-add-cta"));
    expect(props.onAdd).toHaveBeenCalled();
    fireEvent.press(getByTestId("plan-add-back"));
    expect(props.onBack).toHaveBeenCalled();
  });

  it("shows the empty text and a disabled CTA", () => {
    const { getByText, getByTestId, props } = render({
      rows: [],
      canAdd: false,
      ctaLabel: "Tap + to add, or tap a food for its amount",
    });
    expect(getByText("Nothing yet")).toBeTruthy();
    fireEvent.press(getByTestId("plan-add-cta"));
    expect(props.onAdd).not.toHaveBeenCalled();
  });
});

describe("PlanQuickItemSheetPresenter", () => {
  const render = (over: Partial<PlanQuickItemSheetProps> = {}) => {
    const props: PlanQuickItemSheetProps = {
      visible: true,
      onClose: jest.fn(),
      values: { name: "", kcal: "450", protein: "", carbs: "", fat: "" },
      onChange: jest.fn(),
      mealName: "Breakfast",
      kcalLabel: "450",
      warning: "Your macros add up to 640 kcal. We'll add the 450 you typed.",
      canAdd: true,
      onAdd: jest.fn(),
      ...over,
    };
    return {
      ...renderWithTheme(<PlanQuickItemSheetPresenter {...props} />),
      props,
    };
  };

  it("adds to the plan, never logs", () => {
    const { getByText, getByTestId, queryByText, props } = render();
    expect(getByText("Add 450 kcal to Breakfast")).toBeTruthy();
    expect(queryByText(/^Log /)).toBeNull();
    expect(getByTestId("plan-quick-warning")).toBeTruthy();
    fireEvent.changeText(getByTestId("plan-quick-protein"), "30");
    expect(props.onChange).toHaveBeenCalledWith("protein", "30");
    fireEvent.press(getByTestId("plan-quick-add"));
    expect(props.onAdd).toHaveBeenCalled();
  });

  it("without calories", () => {
    const { getByText } = render({
      kcalLabel: "",
      warning: null,
      canAdd: false,
    });
    expect(getByText("Add to Breakfast")).toBeTruthy();
  });
});
