import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import {
  PlanTabPresenter,
  type PlanTabProps,
  type PlanViewVM,
} from "../PlanTabPresenter";
import {
  CoachPlanSheetPresenter,
  PlanSwitchSheetPresenter,
  type CoachPlanSheetProps,
} from "../PlanSheetsPresenter";

const vm = (over: Partial<PlanViewVM> = {}): PlanViewVM => ({
  id: "p1",
  name: "Cut week",
  kind: "mine",
  updated: false,
  ownerInitial: "C",
  ownerText: "Your plan. Tap a meal to swap it or change the portion.",
  comparison: {
    targetKcal: 2050,
    plannedKcal: 1657,
    toPlanKcal: 393,
    state: "to_plan",
  },
  macroChips: [
    { letter: "P", text: "136 / 180g P" },
    { letter: "C", text: "184 / 200g C" },
    { letter: "F", text: "44 / 60g F" },
  ],
  meals: [
    {
      id: "m1",
      slot: "Breakfast",
      kcal: "410",
      name: "Greek yoghurt, berries and granola",
      carbsG: 52,
      fatG: 9,
      proteinG: 32,
    },
  ],
  gapMeal: "Meal 5",
  inShoppingList: false,
  conflict: false,
  ...over,
});

function render(over: Partial<PlanTabProps> = {}) {
  const props: PlanTabProps = {
    state: "plan",
    plan: vm(),
    notice: null,
    onOpenSwitch: jest.fn(),
    onOwnerAction: jest.fn(),
    onLogMeal: jest.fn(),
    onOpenMeal: jest.fn(),
    onLogAll: jest.fn(),
    onAddFood: jest.fn(),
    onFillWithMealprint: jest.fn(),
    onShoppingList: jest.fn(),
    onDismissConflict: jest.fn(),
    onBuildOwn: jest.fn(),
    onStartFromDay: jest.fn(),
    onMealprintBuild: jest.fn(),
    ...over,
  };
  return { props, ...renderWithTheme(<PlanTabPresenter {...props} />) };
}

describe("PlanTabPresenter — my plan (N8)", () => {
  it("shows the plan against the person's own target, with no days", () => {
    const { getByText, queryByText } = render();
    expect(getByText("Cut week")).toBeTruthy();
    expect(getByText("2,050")).toBeTruthy();
    expect(getByText("1,657")).toBeTruthy();
    expect(getByText("393")).toBeTruthy();
    expect(getByText("To plan")).toBeTruthy();
    expect(getByText("136 / 180g P")).toBeTruthy();
    expect(getByText("Breakfast · 410 kcal")).toBeTruthy();
    expect(getByText("Meal 5 · 393 kcal to plan")).toBeTruthy();
    expect(getByText("Edit")).toBeTruthy();
    expect(queryByText(/Mon|Wed|Fri|Not scheduled/)).toBeNull();
  });

  it("wires every action", () => {
    const { props, getByTestId } = render();
    fireEvent.press(getByTestId("plan-tab-switch"));
    fireEvent.press(getByTestId("plan-tab-owner-action"));
    fireEvent.press(getByTestId("plan-meal-log-m1"));
    fireEvent.press(getByTestId("plan-meal-open-m1"));
    fireEvent.press(getByTestId("plan-gap-add-food"));
    fireEvent.press(getByTestId("plan-gap-mealprint"));
    fireEvent.press(getByTestId("plan-tab-shopping"));
    fireEvent.press(getByTestId("plan-tab-log-all"));
    expect(props.onOpenSwitch).toHaveBeenCalled();
    expect(props.onOwnerAction).toHaveBeenCalled();
    expect(props.onLogMeal).toHaveBeenCalledWith("m1");
    expect(props.onOpenMeal).toHaveBeenCalledWith("m1");
    expect(props.onAddFood).toHaveBeenCalled();
    expect(props.onFillWithMealprint).toHaveBeenCalled();
    expect(props.onShoppingList).toHaveBeenCalled();
    expect(props.onLogAll).toHaveBeenCalled();
  });

  it("over target, no target, in the shopping list, a conflict and a notice", () => {
    const over = render({
      plan: vm({
        comparison: {
          targetKcal: 2000,
          plannedKcal: 2300,
          toPlanKcal: -300,
          state: "over",
        },
        gapMeal: null,
        inShoppingList: true,
        conflict: true,
      }),
      notice: "Added Cut week to today's log.",
    });
    expect(over.getByText("+300")).toBeTruthy();
    expect(over.getByText("Over")).toBeTruthy();
    expect(over.queryByTestId("plan-tab-gap")).toBeNull();
    expect(over.getByText("In your shopping list")).toBeTruthy();
    expect(over.getByTestId("plan-tab-notice")).toBeTruthy();
    fireEvent.press(over.getByTestId("plan-tab-conflict"));
    expect(over.props.onDismissConflict).toHaveBeenCalled();

    const none = render({
      plan: vm({
        comparison: {
          targetKcal: null,
          plannedKcal: 0,
          toPlanKcal: null,
          state: "no_target",
        },
        meals: [],
      }),
    });
    expect(none.getAllByText("—")).toHaveLength(2);
    expect(none.queryByTestId("plan-tab-gap")).toBeNull();
  });
});

describe("PlanTabPresenter — a coach's plan (N6)", () => {
  it("is violet, read-only, marked updated, and offers Duplicate", () => {
    const { props, getByText, getByTestId } = render({
      plan: vm({
        kind: "coach",
        updated: true,
        ownerText:
          "Set by Ellie, your coach · updated 2 Oct. You can log from it, not change it.",
      }),
    });
    expect(getByText("Duplicate")).toBeTruthy();
    expect(getByTestId("plan-tab-updated")).toBeTruthy();
    fireEvent.press(getByTestId("plan-gap-add-food"));
    fireEvent.press(getByTestId("plan-gap-mealprint"));
    fireEvent.press(getByTestId("plan-meal-open-m1"));
    expect(props.onAddFood).not.toHaveBeenCalled();
    expect(props.onFillWithMealprint).not.toHaveBeenCalled();
    expect(props.onOpenMeal).not.toHaveBeenCalled();
    // Logging from a coach plan is allowed.
    fireEvent.press(getByTestId("plan-meal-log-m1"));
    expect(props.onLogMeal).toHaveBeenCalledWith("m1");
  });
});

describe("PlanTabPresenter — no plan yet (N10) and loading", () => {
  it("offers three ways to start", () => {
    const { props, getByTestId, getByText } = render({
      state: "empty",
      plan: null,
    });
    expect(getByText("Plan what you'll eat, then tick it off")).toBeTruthy();
    expect(
      getByText("Have a coach? Plans they send you appear here automatically."),
    ).toBeTruthy();
    fireEvent.press(getByTestId("plan-empty-build"));
    fireEvent.press(getByTestId("plan-empty-day"));
    fireEvent.press(getByTestId("plan-empty-mealprint"));
    expect(props.onBuildOwn).toHaveBeenCalled();
    expect(props.onStartFromDay).toHaveBeenCalled();
    expect(props.onMealprintBuild).toHaveBeenCalled();
  });

  it("shows a loading line before the first read", () => {
    const { getByTestId } = render({ state: "loading", plan: null });
    expect(getByTestId("plan-tab-loading")).toBeTruthy();
  });
});

describe("PlanSwitchSheetPresenter (N7)", () => {
  it("lists coach plans then mine, with no schedule", () => {
    const onPick = jest.fn();
    const onNewPlan = jest.fn();
    const onMealprint = jest.fn();
    const { getByText, getByTestId, queryByText } = renderWithTheme(
      <PlanSwitchSheetPresenter
        visible
        groups={[
          {
            key: "coach-1",
            title: "From Ellie · your coach",
            coach: true,
            rows: [
              {
                id: "c1",
                name: "Training day",
                sub: "2,501 kcal",
                initial: "E",
                selected: true,
              },
            ],
          },
          {
            key: "mine",
            title: "Mine",
            coach: false,
            rows: [
              {
                id: "p1",
                name: "Cut week",
                sub: "2,050 kcal",
                initial: "C",
                selected: false,
              },
            ],
          },
        ]}
        onClose={jest.fn()}
        onPick={onPick}
        onNewPlan={onNewPlan}
        onMealprint={onMealprint}
      />,
    );
    expect(getByText("From Ellie · your coach")).toBeTruthy();
    expect(queryByText("This week")).toBeNull();
    fireEvent.press(getByTestId("plan-switch-sheet-row-p1"));
    fireEvent.press(getByTestId("plan-switch-sheet-new"));
    fireEvent.press(getByTestId("plan-switch-sheet-mealprint"));
    expect(onPick).toHaveBeenCalledWith("p1");
    expect(onNewPlan).toHaveBeenCalled();
    expect(onMealprint).toHaveBeenCalled();
  });
});

describe("CoachPlanSheetPresenter (C6)", () => {
  it("shows the note and meals; Not now / Add to my plans", () => {
    const props: CoachPlanSheetProps = {
      visible: true,
      coachName: "Ellie Hart",
      coachInitials: "EH",
      planName: "Lean bulk · Training day",
      note: "Use this on lifting days.",
      comparison: {
        targetKcal: 2500,
        plannedKcal: 2476,
        toPlanKcal: 24,
        state: "on_target",
      },
      planned: { proteinG: 180, carbsG: 300, fatG: 70 },
      macros: [],
      meals: [
        { id: "m1", slot: "Breakfast", name: "Bagel and eggs", kcal: "535" },
      ],
      onClose: jest.fn(),
      onNotNow: jest.fn(),
      onAdd: jest.fn(),
    };
    const { getByText, getByTestId } = renderWithTheme(
      <CoachPlanSheetPresenter {...props} />,
    );
    expect(getByText("From your coach · Ellie Hart")).toBeTruthy();
    expect(getByText("“Use this on lifting days.”")).toBeTruthy();
    expect(getByText("Bagel and eggs")).toBeTruthy();
    fireEvent.press(getByTestId("coach-plan-sheet-not-now"));
    fireEvent.press(getByTestId("coach-plan-sheet-add"));
    expect(props.onNotNow).toHaveBeenCalled();
    expect(props.onAdd).toHaveBeenCalled();

    const noNote = renderWithTheme(
      <CoachPlanSheetPresenter {...props} note={null} />,
    );
    expect(noNote.queryByTestId("coach-plan-sheet-note")).toBeNull();
  });
});
