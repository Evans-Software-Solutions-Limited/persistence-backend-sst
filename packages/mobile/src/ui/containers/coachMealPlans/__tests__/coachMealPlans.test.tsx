/**
 * PER-135 (APP-D4) on iPhone: Library → Meals (C2), the plan editor (C3),
 * Send / Change the note (C5, C1b) and the client Nutrition tab (C3.2b).
 * In-memory adapters for the API; the plans hook (PER-133 cache and queue)
 * is mocked so each test controls the library and sees what gets saved.
 */
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import type { CoachPlanAssignment } from "@/domain/models/coachMealPlans";
import type {
  NutritionPlan,
  NutritionPlansCache,
} from "@/domain/models/nutritionPlans";
import {
  addItemToMeal,
  emptyPlanMeal,
  newDraftPlan,
  planItemFromFood,
  planItemFromRecipe,
} from "@/domain/services/nutritionPlans.service";
import { usePlanDraft } from "@/state/plan-draft";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { COACH, setupCoachForms } from "../../__tests__/coachFormsTestKit";
import { FOOD, MEAL, RECIPE } from "../../plans/__tests__/planFixtures";
import { ClientNutritionContainer } from "../ClientNutritionContainer";
import { CoachMealPlansLibraryContainer } from "../CoachMealPlansLibraryContainer";
import {
  CoachPlanEditorContainer,
  SAVE_FAILED,
  servingLabel,
  stepPortion,
} from "../CoachPlanEditorContainer";

const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  setParams: jest.fn(),
};
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  router: {
    push: (...a: unknown[]) => mockRouter.push(...a),
    back: (...a: unknown[]) => mockRouter.back(...a),
    replace: (...a: unknown[]) => mockRouter.replace(...a),
    setParams: (...a: unknown[]) => mockRouter.setParams(...a),
  },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

const mockPlans = {
  cache: {
    mine: [],
    fromCoaches: [],
    asOf: null,
    conflictPlanIds: [],
  } as NutritionPlansCache,
  isLoading: false,
  // As createPlanCommand: the plan keeps its local id until the create syncs.
  create: jest.fn(async (p: NutritionPlan) => p),
  save: jest.fn(async (p: NutritionPlan) => p),
  remove: jest.fn(async () => {}),
  clearConflict: jest.fn(),
};
jest.mock("@/ui/hooks/useNutritionPlans", () => ({
  useNutritionPlans: () => mockPlans,
}));
let mockRecipes: unknown[] | null = [];
jest.mock("@/ui/hooks/useGetRecipes", () => ({
  useGetRecipes: () => ({ data: mockRecipes }),
}));
let mockMeals: unknown[] = [];
jest.mock("@/ui/hooks/useGetMeals", () => ({
  useGetMeals: () => ({ data: mockMeals }),
}));
jest.mock("@/ui/hooks/useGetTrainerClients", () => ({
  useGetTrainerClients: () => ({
    data: [
      { id: "c1", name: "Sam Patel", status: "active" },
      { id: "c2", name: "Old Client", status: "ended" },
      { id: "c3", name: "Ana Lee", status: "active" },
    ],
  }),
}));

function plan(id: string, name: string): NutritionPlan {
  let p = newDraftPlan({
    id,
    ownerId: COACH,
    name,
    now: "2026-10-20T10:00:00.000Z",
    meals: [
      emptyPlanMeal(`${id}-m1`, "Breakfast", "breakfast", 0),
      emptyPlanMeal(`${id}-m2`, "Meal 4", "dinner", 1),
    ],
  });
  p = addItemToMeal(p, `${id}-m1`, planItemFromFood(`${id}-i1`, FOOD, 1));
  p = addItemToMeal(p, `${id}-m1`, planItemFromRecipe(`${id}-i2`, RECIPE, 1));
  return { ...p, revision: 3 };
}

const TRAIN = plan("plan-train", "Lean bulk · Training day");
const REST = plan("plan-rest", "Lean bulk · Rest day");

function assignment(
  over: Partial<CoachPlanAssignment> = {},
): CoachPlanAssignment {
  return {
    id: "asg-train",
    planId: TRAIN.id,
    note: "Use this on lifting days.",
    status: "added",
    seenRevision: 3,
    sentAt: "2026-10-21T09:00:00.000Z",
    addedAt: "2026-10-21T12:00:00.000Z",
    updatedAt: "2026-10-21T12:00:00.000Z",
    plan: TRAIN,
    updatedSinceSeen: false,
    usedDays: 9,
    loggedThisWeek: 12,
    ...over,
  };
}

const TARGET = {
  dailyKcal: 2500,
  proteinG: 180,
  carbsG: 300,
  fatG: 70,
  setByUserId: COACH,
};

beforeEach(() => {
  mockParams = {};
  Object.values(mockRouter).forEach((f) => f.mockClear());
  mockPlans.cache = {
    mine: [TRAIN, REST],
    fromCoaches: [],
    asOf: null,
    conflictPlanIds: [],
  };
  mockPlans.isLoading = false;
  mockPlans.create.mockClear();
  mockPlans.save.mockClear();
  mockPlans.remove.mockClear();
  mockPlans.clearConflict.mockClear();
  mockRecipes = [RECIPE];
  mockMeals = [MEAL];
  usePlanDraft.getState().clear();
});

function seedClient(h: ReturnType<typeof setupCoachForms>) {
  h.api.coachClientMealPlans.c1 = {
    assignments: [
      assignment(),
      assignment({
        id: "asg-rest",
        planId: REST.id,
        plan: REST,
        status: "sent",
        // The server sets seenRevision to the plan's revision on send.
        seenRevision: 3,
        sentAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        usedDays: 0,
        loggedThisWeek: 7,
      }),
    ],
    target: TARGET,
    asOf: "2026-11-26T10:00:00.000Z",
  };
  h.api.coachCalorieAdherence.c1 = {
    daysOnTarget: 5,
    daysCounted: 7,
    daysNotLogged: 1,
  };
}

describe("Library → Meals (C2, iPhone)", () => {
  it("lists plans, recipes and meals; New plan opens the editor", () => {
    const h = setupCoachForms();
    const view = h.render(<CoachMealPlansLibraryContainer />);
    expect(view.getByText("Lean bulk · Training day")).toBeTruthy();
    expect(view.getByText("Plans · 2")).toBeTruthy();
    fireEvent.press(view.getByText("Recipes · 1"));
    expect(view.getByText(RECIPE.name)).toBeTruthy();
    fireEvent.press(view.getByText("Meals · 1"));
    expect(view.getByText("Saved meal")).toBeTruthy();
    fireEvent.press(view.getByText("Plans · 2"));
    fireEvent.press(view.getByTestId("coach-meals-new"));
    expect(mockRouter.push).toHaveBeenCalledWith(
      "/(app)/coach-meal-plans/edit",
    );
  });

  it("a plan's menu: edit, delete (queued) and send to a chosen client", async () => {
    const h = setupCoachForms();
    const view = h.render(<CoachMealPlansLibraryContainer />);
    fireEvent.press(view.getByTestId("coach-meals-row-plan-train"));
    fireEvent.press(view.getByTestId("plan-action-edit"));
    expect(mockRouter.push).toHaveBeenCalledWith(
      "/(app)/coach-meal-plans/edit?id=plan-train",
    );
    fireEvent.press(view.getByTestId("coach-meals-row-plan-rest"));
    fireEvent.press(view.getByTestId("plan-action-delete"));
    expect(view.getByText("Delete Lean bulk · Rest day?")).toBeTruthy();
    fireEvent.press(view.getByTestId("plan-confirm"));
    expect(mockPlans.remove).toHaveBeenCalledWith("plan-rest");

    fireEvent.press(view.getByTestId("coach-meals-row-plan-train"));
    fireEvent.press(view.getByTestId("plan-action-send"));
    expect(view.getByText("Choose a client")).toBeTruthy();
    fireEvent.press(view.getByTestId("send-plan-client"));
    expect(view.queryByTestId("plan-pick-c2")).toBeNull();
    fireEvent.press(view.getByTestId("plan-pick-c1"));
    fireEvent.changeText(view.getByTestId("send-plan-note"), "  Lifting  ");
    fireEvent.press(view.getByTestId("send-plan-submit"));
    await waitFor(() =>
      expect(h.api.coachMealPlanCalls[0]).toMatch(
        /^assign:c1:plan-train:Lifting:plan-send-/,
      ),
    );
    expect(await view.findByText("Sent to Sam")).toBeTruthy();
  });

  it("shares a recipe with a client; again says they have it", async () => {
    const h = setupCoachForms();
    const view = h.render(<CoachMealPlansLibraryContainer />);
    fireEvent.press(view.getByText("Recipes · 1"));
    fireEvent.press(view.getByTestId(`coach-meals-row-${RECIPE.id}`));
    fireEvent.press(view.getByTestId("plan-pick-c1"));
    expect(
      await view.findByText(`${RECIPE.name} shared with Sam`),
    ).toBeTruthy();
    fireEvent.press(view.getByTestId(`coach-meals-row-${RECIPE.id}`));
    fireEvent.press(view.getByTestId("plan-pick-c1"));
    expect(
      await view.findByText(`Sam already has ${RECIPE.name}`),
    ).toBeTruthy();
  });

  it("offline note, conflict notice, empty and loading states", () => {
    const h = setupCoachForms({ online: false });
    mockPlans.cache = { ...mockPlans.cache, conflictPlanIds: ["plan-train"] };
    const view = h.render(<CoachMealPlansLibraryContainer />);
    expect(view.getByTestId("coach-meals-conflict")).toBeTruthy();
    fireEvent.press(view.getByTestId("coach-meals-conflict-dismiss"));
    expect(mockPlans.clearConflict).toHaveBeenCalledWith("plan-train");
    view.unmount();
    mockPlans.cache = { ...mockPlans.cache, mine: [], conflictPlanIds: [] };
    mockRecipes = null;
    const v2 = h.render(<CoachMealPlansLibraryContainer />);
    expect(v2.getByTestId("coach-meals-empty")).toBeTruthy();
    fireEvent.press(v2.getByText("Recipes"));
    expect(v2.getByText("Loading…")).toBeTruthy();
  });
});

describe("#577 review fixes (iPhone)", () => {
  it("choosing another client starts a new send key; the same client keeps it", async () => {
    const h = setupCoachForms();
    h.api.coachMealPlanFailures.assign.push(
      { kind: "api", code: "server", status: 500, message: "x" },
      { kind: "api", code: "server", status: 500, message: "x" },
    );
    const view = h.render(<CoachMealPlansLibraryContainer />);
    fireEvent.press(view.getByTestId("coach-meals-row-plan-train"));
    fireEvent.press(view.getByTestId("plan-action-send"));
    const choose = (id: string) => {
      fireEvent.press(view.getByTestId("send-plan-client"));
      fireEvent.press(view.getByTestId(`plan-pick-${id}`));
    };
    choose("c1");
    fireEvent.press(view.getByTestId("send-plan-submit"));
    expect(await view.findByTestId("send-plan-error")).toBeTruthy();
    choose("c1");
    fireEvent.press(view.getByTestId("send-plan-submit"));
    await waitFor(() => expect(h.api.coachMealPlanCalls).toHaveLength(2));
    choose("c3");
    fireEvent.press(view.getByTestId("send-plan-submit"));
    expect(await view.findByText("Sent to Ana")).toBeTruthy();
    const keys = h.api.coachMealPlanCalls.map((c) => c.split(":").at(-1));
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(h.api.coachMealPlanCalls[2]).toMatch(/^assign:c3:/);
  });

  it("a plan with no meals left says so instead of a silent Save", async () => {
    const h = setupCoachForms();
    const empty = { ...TRAIN, id: "plan-empty", meals: [] };
    mockPlans.cache = { ...mockPlans.cache, mine: [empty] };
    mockParams = { id: "plan-empty" };
    const view = h.render(<CoachPlanEditorContainer />);
    fireEvent.changeText(view.getByTestId("coach-plan-name"), "Empty");
    fireEvent.press(view.getByTestId("coach-plan-save"));
    expect(await view.findByTestId("coach-plan-meals-error")).toBeTruthy();
    expect(view.getByText("A plan has 1 to 20 meals.")).toBeTruthy();
    expect(mockPlans.save).not.toHaveBeenCalled();
  });
});

describe("Edit a plan (C3, iPhone)", () => {
  it("helpers: quarter portions within limits, serving labels", () => {
    expect(stepPortion(1, 1)).toBe(1.25);
    expect(stepPortion(0.25, -1)).toBe(0.25);
    expect(stepPortion(100, 1)).toBe(100);
    const item = TRAIN.meals[0]!.items[0]!;
    expect(servingLabel(item)).toBe("1 bar");
    expect(servingLabel({ ...item, servings: 1.5 })).toBe("1 bar × 1.5");
    expect(servingLabel(TRAIN.meals[0]!.items[1]!)).toBe("1 portion");
    expect(servingLabel({ ...item, food: null, recipe: null })).toBe(
      "1 serving",
    );
  });

  it("edits portions against the client's target and saves through the queue", async () => {
    const h = setupCoachForms();
    seedClient(h);
    mockParams = { id: TRAIN.id, client: "c1", clientName: "Sam Patel" };
    const view = h.render(<CoachPlanEditorContainer />);
    expect(view.getByText("Edit meal plan")).toBeTruthy();
    expect(
      await view.findByText(
        /Sam Patel · Sent .* · edits reach Sam automatically/,
      ),
    ).toBeTruthy();
    const save = view.getByTestId("coach-plan-save");
    expect(view.getByText("Save changes for Sam")).toBeTruthy();
    fireEvent.press(view.getByTestId(`coach-plan-portion-${TRAIN.id}-i1-more`));
    expect(view.getByText("1 bar × 1.25")).toBeTruthy();
    fireEvent.press(view.getByTestId(`coach-plan-portion-${TRAIN.id}-i1-less`));
    fireEvent.press(view.getByTestId(`coach-plan-portion-${TRAIN.id}-i1-less`));
    expect(view.getByText("×0.75")).toBeTruthy();
    fireEvent.press(save);
    await waitFor(() => expect(mockPlans.save).toHaveBeenCalled());
    const saved = mockPlans.save.mock.calls[0]![0];
    expect(saved.id).toBe(TRAIN.id);
    expect(saved.revision).toBe(3);
    expect(saved.meals[0].items[0].servings).toBe(0.75);
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("renames, removes, adds meals and food; refuses bad names", async () => {
    const h = setupCoachForms();
    mockParams = { id: TRAIN.id };
    const view = h.render(<CoachPlanEditorContainer />);
    const name = view.getByTestId("coach-plan-name");
    fireEvent.changeText(name, "   ");
    expect(
      await view.findByText("Give the plan a name of up to 80 characters."),
    ).toBeTruthy();
    fireEvent.changeText(name, "Cut");
    fireEvent.changeText(
      view.getByTestId(`coach-plan-meal-name-${TRAIN.id}-m1`),
      "x".repeat(41),
    );
    expect(
      await view.findByText("Give each meal a name of up to 40 characters."),
    ).toBeTruthy();
    fireEvent.changeText(
      view.getByTestId(`coach-plan-meal-name-${TRAIN.id}-m1`),
      "Brekkie",
    );
    fireEvent.press(view.getByTestId(`coach-plan-remove-${TRAIN.id}-i2`));
    expect(view.queryByText(RECIPE.name)).toBeNull();
    fireEvent.press(view.getByTestId(`coach-plan-add-${TRAIN.id}-m1`));
    expect(mockRouter.push).toHaveBeenCalledWith(
      `/(app)/fuel/plan-add?meal=${TRAIN.id}-m1`,
    );
    fireEvent.press(view.getByTestId(`coach-plan-remove-meal-${TRAIN.id}-m1`));
    expect(view.queryByText("Brekkie")).toBeNull();
    fireEvent.press(view.getByTestId("coach-plan-add-meal"));
    expect(view.getByText("Nothing in this meal yet.")).toBeTruthy();
    fireEvent.press(view.getByTestId(`coach-plan-meal-toggle-${TRAIN.id}-m2`));
    fireEvent.press(view.getByTestId("coach-plan-save"));
    await waitFor(() => expect(mockPlans.save).toHaveBeenCalled());
    const saved = mockPlans.save.mock.calls[0]![0];
    expect(saved.name).toBe("Cut");
    expect(saved.meals.map((m: { name: string }) => m.name)).toEqual([
      "Meal 4",
      "Meal 2",
    ]);
  });

  it("a new plan for a client is created, then their Nutrition tab opens Send", async () => {
    const h = setupCoachForms();
    mockParams = { client: "c1", clientName: "Sam Patel" };
    const view = h.render(<CoachPlanEditorContainer />);
    expect(view.getByText("New meal plan")).toBeTruthy();
    fireEvent.changeText(view.getByTestId("coach-plan-name"), "Cut · 1,900");
    fireEvent.press(view.getByTestId("coach-plan-save"));
    await waitFor(() => expect(mockPlans.create).toHaveBeenCalled());
    const created = mockPlans.create.mock.calls[0]![0];
    expect(created.name).toBe("Cut · 1,900");
    expect(created.id).toMatch(/^local-/);
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: "/(app)/clients/[id]",
      params: { id: "c1", tab: "nutrition", send: created.id },
    });
  });

  it("a failed save says so; conflict and offline notices; Back clears", async () => {
    const h = setupCoachForms({ online: false });
    mockPlans.save.mockResolvedValueOnce(null as never);
    mockPlans.cache = { ...mockPlans.cache, conflictPlanIds: [TRAIN.id] };
    mockParams = { id: TRAIN.id };
    const view = h.render(<CoachPlanEditorContainer />);
    expect(view.getByTestId("coach-plan-conflict")).toBeTruthy();
    fireEvent.press(view.getByTestId("coach-plan-conflict-dismiss"));
    expect(mockPlans.clearConflict).toHaveBeenCalledWith(TRAIN.id);
    await waitFor(() =>
      expect(view.getByTestId("coach-plan-offline")).toBeTruthy(),
    );
    fireEvent.changeText(view.getByTestId("coach-plan-name"), "Renamed");
    fireEvent.press(view.getByTestId("coach-plan-save"));
    expect(await view.findByText(SAVE_FAILED)).toBeTruthy();
    fireEvent.press(view.getByText("Library"));
    expect(mockRouter.back).toHaveBeenCalled();
    expect(usePlanDraft.getState().draft).toBeNull();
  });

  it("an unknown plan goes back", () => {
    const h = setupCoachForms();
    mockParams = { id: "nope" };
    h.render(<CoachPlanEditorContainer />);
    expect(mockRouter.back).toHaveBeenCalled();
  });
});

describe("Client → Nutrition (C3.2b, iPhone)", () => {
  const open = (h: ReturnType<typeof setupCoachForms>) =>
    h.render(<ClientNutritionContainer clientId="c1" clientName="Sam Patel" />);

  it("shows the target, each plan's status, usage and calorie adherence", async () => {
    const h = setupCoachForms();
    seedClient(h);
    const view = open(h);
    expect(await view.findByText("In Sam’s plans · used 9 days")).toBeTruthy();
    expect(view.getByText("2,500 kcal · 180P 300C 70F")).toBeTruthy();
    expect(
      view.getByText("Set by you · plans are measured against it"),
    ).toBeTruthy();
    // No opened / not opened: the API has no "opened" signal.
    expect(view.getByText("Sent 2 days ago")).toBeTruthy();
    expect(view.queryByText(/opened/)).toBeNull();
    expect(view.getByText("Plan meals logged this week: 19")).toBeTruthy();
    expect(view.getByText("5 of 7 days on target · 1 not logged")).toBeTruthy();
    fireEvent.press(view.getByTestId("client-plan-asg-train"));
    expect(view.getByText("Against Sam’s target")).toBeTruthy();
    expect(view.getByText("Meals · 2")).toBeTruthy();
    fireEvent.press(view.getByTestId("plan-opened-edit"));
    expect(mockRouter.push).toHaveBeenCalledWith(
      `/(app)/coach-meal-plans/edit?id=${TRAIN.id}&client=c1&clientName=Sam%20Patel`,
    );
  });

  it("no plans and no target", async () => {
    const h = setupCoachForms();
    const view = open(h);
    expect(await view.findByTestId("client-nutrition-empty")).toBeTruthy();
    expect(view.getByTestId("client-nutrition-no-target")).toBeTruthy();
    expect(view.queryByTestId("client-nutrition-calories")).toBeNull();
  });

  it("removes a plan after confirming", async () => {
    const h = setupCoachForms();
    seedClient(h);
    const view = open(h);
    fireEvent.press(await view.findByTestId("client-plan-more-asg-train"));
    expect(view.getByText("Changes reach Sam automatically")).toBeTruthy();
    expect(view.getByText("What Sam reads with the plan")).toBeTruthy();
    fireEvent.press(view.getByTestId("plan-action-remove"));
    expect(
      view.getByText(
        "Sam stops seeing it in their plans. Food they have already logged stays in their diary. It stays in your library.",
      ),
    ).toBeTruthy();
    fireEvent.press(view.getByTestId("plan-confirm"));
    await waitFor(() =>
      expect(h.api.coachMealPlanCalls).toContain("remove:c1:asg-train"),
    );
    await waitFor(() =>
      expect(view.queryByTestId("client-plan-asg-train")).toBeNull(),
    );
  });

  it("a failed remove says so; Edit plan from the menu", async () => {
    const h = setupCoachForms();
    seedClient(h);
    h.api.coachMealPlanFailures.remove.push({
      kind: "api",
      code: "server",
      status: 500,
      message: "x",
    });
    const view = open(h);
    fireEvent.press(await view.findByTestId("client-plan-more-asg-train"));
    fireEvent.press(view.getByTestId("plan-action-remove"));
    fireEvent.press(view.getByTestId("plan-confirm"));
    expect(
      await view.findByText("We couldn’t remove that plan. Try again."),
    ).toBeTruthy();
    fireEvent.press(view.getByTestId("client-plan-more-asg-train"));
    fireEvent.press(view.getByTestId("plan-action-edit"));
    expect(mockRouter.push).toHaveBeenCalledWith(
      expect.stringContaining(`edit?id=${TRAIN.id}&client=c1`),
    );
  });

  it("changes the note: the form checks length, the server's 422 lands on it", async () => {
    const h = setupCoachForms();
    seedClient(h);
    h.api.coachMealPlanFailures.note.push({
      kind: "api",
      code: "unknown",
      status: 422,
      message: "bad",
    });
    const view = open(h);
    fireEvent.press(await view.findByTestId("client-plan-more-asg-train"));
    fireEvent.press(view.getByTestId("plan-action-note"));
    const note = view.getByTestId("send-plan-note");
    expect(note.props.value).toBe("Use this on lifting days.");
    fireEvent.changeText(note, "x".repeat(501));
    expect(
      await view.findByText("Keep the note under 500 characters."),
    ).toBeTruthy();
    fireEvent.changeText(
      view.getByTestId("send-plan-note"),
      "Swap salmon for chicken",
    );
    await waitFor(
      () =>
        expect(
          view.queryByText("Keep the note under 500 characters."),
        ).toBeNull(),
      { timeout: 5000 },
    );
    fireEvent.press(view.getByTestId("send-plan-submit"));
    expect(
      await view.findByText("Keep the note under 500 characters."),
    ).toBeTruthy();
    fireEvent.changeText(view.getByTestId("send-plan-note"), "");
    await waitFor(
      () =>
        expect(
          view.queryByText("Keep the note under 500 characters."),
        ).toBeNull(),
      { timeout: 5000 },
    );
    fireEvent.press(view.getByTestId("send-plan-submit"));
    expect(await view.findByText("Note updated for Sam")).toBeTruthy();
    expect(h.api.coachMealPlanCalls).toContain("note:c1:asg-train:");
  });

  it("+ Add picks a plan and sends it; a send that fails can be retried with the same key", async () => {
    const h = setupCoachForms();
    seedClient(h);
    const cut = plan("plan-cut", "Cut · 1,900");
    mockPlans.cache = { ...mockPlans.cache, mine: [TRAIN, REST, cut] };
    h.api.coachMealPlanFailures.assign.push({
      kind: "api",
      code: "not_found",
      status: 404,
      message: "gone",
    });
    const view = open(h);
    fireEvent.press(await view.findByTestId("client-nutrition-plans-add"));
    expect(view.getAllByText("Already with Sam")).toHaveLength(2);
    fireEvent.press(view.getByTestId("plan-pick-plan-cut"));
    expect(
      view.getByText(/It goes into Sam’s plans with your note/),
    ).toBeTruthy();
    expect(view.getByText(/\/ 2,500$/)).toBeTruthy();
    fireEvent.press(view.getByTestId("send-plan-submit"));
    expect(
      await view.findByText("This plan or client isn’t available any more."),
    ).toBeTruthy();
    fireEvent.press(view.getByTestId("send-plan-submit"));
    expect(await view.findByText("Sent to Sam")).toBeTruthy();
    const keys = h.api.coachMealPlanCalls
      .filter((c) => c.startsWith("assign:"))
      .map((c) => c.split(":").at(-1));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("+ Add can build a new plan; ?send= opens Send", async () => {
    const h = setupCoachForms();
    seedClient(h);
    const view = open(h);
    fireEvent.press(await view.findByTestId("client-nutrition-plans-add"));
    fireEvent.press(view.getByTestId("plan-picker-footer"));
    expect(mockRouter.push).toHaveBeenCalledWith(
      "/(app)/coach-meal-plans/edit?client=c1&clientName=Sam%20Patel",
    );
    view.unmount();
    mockParams = { send: REST.id };
    const v2 = open(h);
    expect(await v2.findByText("Send to Sam")).toBeTruthy();
    // Still pending: the param stays until Send is finished with.
    expect(mockRouter.setParams).not.toHaveBeenCalled();
    fireEvent.press(v2.getByTestId("send-plan-submit"));
    expect(await v2.findByText("Sent to Sam")).toBeTruthy();
    expect(mockRouter.setParams).toHaveBeenCalledWith({ send: "" });
  });

  it("#577: Send for a plan built on the phone waits for its sync, survives a remount, then follows the server id", async () => {
    const h = setupCoachForms();
    seedClient(h);
    const local = { ...plan("local-abc", "Cut · 1,900") };
    mockPlans.cache = { ...mockPlans.cache, mine: [TRAIN, REST, local] };
    mockParams = { send: "local-abc" };
    const first = open(h);
    expect(
      await first.findByTestId("client-nutrition-send-waiting"),
    ).toBeTruthy();
    expect(first.queryByText("Send to Sam")).toBeNull();
    // Still pending: the param stays in the route.
    expect(mockRouter.setParams).not.toHaveBeenCalled();
    // Pull to refresh / the header loader remounts the tab: the note stays.
    first.unmount();
    const view = open(h);
    expect(
      await view.findByTestId("client-nutrition-send-waiting"),
    ).toBeTruthy();
    // A local plan can't be picked from + Add either.
    fireEvent.press(view.getByTestId("client-nutrition-plans-add"));
    expect(view.getByText("Waiting to sync")).toBeTruthy();
    fireEvent.press(view.getByTestId("plan-pick-local-abc"));
    expect(view.queryByText("Send to Sam")).toBeNull();
    // The create syncs: the alias points the local id at the server plan.
    const synced = { ...local, id: "plan-cut" };
    mockPlans.cache = {
      ...mockPlans.cache,
      mine: [TRAIN, REST, synced],
      aliases: { "local-abc": "plan-cut" },
    };
    view.rerender(
      <AdapterProvider adapters={h.adapters}>
        <ClientNutritionContainer clientId="c1" clientName="Sam Patel" />
      </AdapterProvider>,
    );
    expect(await view.findByText("Send to Sam")).toBeTruthy();
    expect(view.queryByTestId("client-nutrition-send-waiting")).toBeNull();
    fireEvent.press(view.getByTestId("send-plan-submit"));
    expect(await view.findByText("Sent to Sam")).toBeTruthy();
    expect(
      h.api.coachMealPlanCalls.some((c) => c.startsWith("assign:c1:plan-cut:")),
    ).toBe(true);
    // Done: the param is cleared, so a remount doesn't reopen Send.
    expect(mockRouter.setParams).toHaveBeenCalledWith({ send: "" });
    mockParams = {};
    view.unmount();
    const after = open(h);
    expect(await after.findByTestId("client-nutrition-plans")).toBeTruthy();
    expect(after.queryByText("Send to Sam")).toBeNull();
  });

  it("#577: dismissing the waiting note cancels the pending Send for good", async () => {
    const h = setupCoachForms();
    seedClient(h);
    mockPlans.cache = {
      ...mockPlans.cache,
      mine: [TRAIN, REST, plan("local-xyz", "Cut")],
    };
    mockParams = { send: "local-xyz" };
    const view = open(h);
    fireEvent.press(
      await view.findByTestId("client-nutrition-send-waiting-dismiss"),
    );
    expect(view.queryByTestId("client-nutrition-send-waiting")).toBeNull();
    expect(mockRouter.setParams).toHaveBeenCalledWith({ send: "" });
    mockParams = {};
    view.unmount();
    const after = open(h);
    expect(await after.findByTestId("client-nutrition-plans")).toBeTruthy();
    expect(after.queryByTestId("client-nutrition-send-waiting")).toBeNull();
  });

  it("#577: closing Send clears the param; a remount doesn't reopen it", async () => {
    const h = setupCoachForms();
    seedClient(h);
    mockParams = { send: REST.id };
    const view = open(h);
    expect(await view.findByText("Send to Sam")).toBeTruthy();
    expect(mockRouter.setParams).not.toHaveBeenCalled();
    const sheet = view
      .UNSAFE_getAllByProps({ testID: "send-plan-sheet" })
      .find((n) => typeof n.props.onClose === "function")!;
    act(() => {
      sheet.props.onClose();
    });
    await waitFor(() =>
      expect(mockRouter.setParams).toHaveBeenCalledWith({ send: "" }),
    );
    mockParams = {};
    view.unmount();
    const after = open(h);
    expect(await after.findByTestId("client-nutrition-plans")).toBeTruthy();
    expect(after.queryByText("Send to Sam")).toBeNull();
  });

  it("shares a recipe with the client", async () => {
    const h = setupCoachForms();
    seedClient(h);
    h.api.coachMealPlanFailures.share.push({
      kind: "api",
      code: "not_found",
      status: 404,
      message: "gone",
    });
    const view = open(h);
    fireEvent.press(await view.findByTestId("client-nutrition-share"));
    fireEvent.press(view.getByTestId(`plan-pick-${RECIPE.id}`));
    expect(
      await view.findByText("This recipe or client isn’t available any more."),
    ).toBeTruthy();
    fireEvent.press(view.getByTestId(`plan-pick-${RECIPE.id}`));
    expect(
      await view.findByText(`${RECIPE.name} shared with Sam`),
    ).toBeTruthy();
  });

  it("offline: the last read with its time, and changes turned off", async () => {
    const h = setupCoachForms();
    seedClient(h);
    const view = open(h);
    expect(await view.findByText("In Sam’s plans · used 9 days")).toBeTruthy();
    await act(async () => {
      h.netInfo.setConnected(false);
    });
    expect(
      await view.findByText(/^Offline · showing Sam as of \d\d:\d\d$/),
    ).toBeTruthy();
    expect(view.queryByTestId("client-nutrition-plans-add")).toBeNull();
    fireEvent.press(view.getByTestId("client-plan-more-asg-train"));
    expect(
      view.getByTestId("plan-action-remove").props.accessibilityState.disabled,
    ).toBe(true);
  });

  it("a load error, online and offline", async () => {
    const h = setupCoachForms();
    h.api.coachMealPlanFailures.read.push({
      kind: "api",
      code: "server",
      status: 500,
      message: "x",
    });
    const view = open(h);
    expect(
      await view.findByText(
        "We couldn’t load Sam’s meal plans. Tap to try again.",
      ),
    ).toBeTruthy();
    fireEvent.press(view.getByTestId("client-nutrition-error-dismiss"));
    expect(await view.findByTestId("client-nutrition-empty")).toBeTruthy();
    view.unmount();
    const off = setupCoachForms({ online: false });
    off.api.coachMealPlanFailures.read.push({
      kind: "api",
      code: "network",
      message: "x",
    });
    const v2 = open(off);
    expect(
      await v2.findByText(
        "You’re offline. Sam’s meal plans load when you’re back online.",
      ),
    ).toBeTruthy();
  });
});
