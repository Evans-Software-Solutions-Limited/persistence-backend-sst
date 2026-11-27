import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ClientPage } from "../clients/ClientPage";
import { MealPlansLibraryContainer } from "../nutrition/MealPlansLibraryContainer";
import { PlanEditorContainer } from "../nutrition/PlanEditorContainer";
import {
  CLIENT_ID,
  ROSTER,
  apiError,
  currentPath,
  fakeApi,
  renderCoach,
  setOnline,
} from "./helpers";
import {
  CLIENT_MEAL_PLANS,
  LIBRARY_PLANS,
  assignment,
  libraryPlan,
} from "./mealPlanFixtures";

beforeEach(() => setOnline(true));
afterEach(() => {
  cleanup();
  setOnline(true);
  vi.useRealTimers();
});

const openLibrary = (api = fakeApi()) =>
  renderCoach(<MealPlansLibraryContainer />, {
    route: "/coach/library/meal-plans",
    path: "/coach/library/meal-plans",
    api,
  });

const openEditor = (route: string, api = fakeApi()) =>
  renderCoach(<PlanEditorContainer />, {
    route,
    path: route.includes("/new")
      ? "/coach/library/meal-plans/new"
      : "/coach/library/meal-plans/:planId/edit",
    api,
  });

const openTab = (api = fakeApi(), search = "") =>
  renderCoach(<ClientPage />, {
    route: `/coach/clients/${CLIENT_ID}/nutrition${search}`,
    path: "/coach/clients/:clientId/:tab?",
    api,
  });

describe("Library → Meal plans (C2)", () => {
  it("lists plans, recipes and saved meals in their tabs", async () => {
    openLibrary();
    expect(await screen.findByText("Lean bulk · Training day")).toBeTruthy();
    expect(
      screen
        .getByRole("tab", { name: "Meal plans" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByText("2 meals · 186P 294C 63F")).toBeTruthy();
    expect(screen.getByText("2,476")).toBeTruthy();
    expect(
      await screen.findByRole("radio", { name: "Recipes · 2" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Recipes · 2" }));
    expect(screen.getByText("Imported from a link · 6 portions")).toBeTruthy();
    expect(screen.getByText("612")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Meals · 1" }));
    expect(screen.getByText("Greek yoghurt and granola")).toBeTruthy();
    expect(screen.getByText("Saved meal")).toBeTruthy();
  });

  it("shows empty libraries and a load error", async () => {
    openLibrary(
      fakeApi({
        libraryPlans: vi.fn().mockResolvedValue([]),
        recipes: vi.fn().mockResolvedValue([]),
        savedMeals: vi.fn().mockRejectedValue(apiError(500, null)),
      }),
    );
    expect(
      await screen.findByText(
        "No plans yet. Build one, then send it to a client with a note.",
      ),
    ).toBeTruthy();
    fireEvent.click(await screen.findByRole("radio", { name: "Recipes · 0" }));
    expect(screen.getByText(/No recipes yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /^Meals/ }));
    expect(await screen.findByText(/No saved meals yet/)).toBeTruthy();
    cleanup();
    openLibrary(
      fakeApi({ libraryPlans: vi.fn().mockRejectedValue(apiError(500, null)) }),
    );
    expect(
      await screen.findByText("We couldn’t load your meal plans."),
    ).toBeTruthy();
  });

  it("deletes a plan after confirming", async () => {
    const api = fakeApi();
    openLibrary(api);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Delete Lean bulk · Training day",
      }),
    );
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText(/Food they have already logged/)).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(api.archivePlan).toHaveBeenCalledWith("plan-train"),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says when a delete fails offline, and Cancel keeps the plan", async () => {
    const api = fakeApi({
      archivePlan: vi.fn().mockRejectedValue(apiError(0, null, true)),
    });
    openLibrary(api);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Delete Lean bulk · Rest day",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Delete Lean bulk · Rest day" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      await screen.findByText(
        "You’re offline. Deleting a plan needs a connection.",
      ),
    ).toBeTruthy();
    cleanup();
    openLibrary(
      fakeApi({ archivePlan: vi.fn().mockRejectedValue(apiError(500, null)) }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Delete Lean bulk · Rest day",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      await screen.findByText("We couldn’t delete that plan. Try again."),
    ).toBeTruthy();
  });

  it("sends a plan to a chosen client with a note", async () => {
    const api = fakeApi({ assignPlan: vi.fn().mockResolvedValue({}) });
    openLibrary(api);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Send Lean bulk · Training day to a client",
      }),
    );
    const dlg = screen.getByRole("dialog");
    const send = within(dlg).getByRole("button", { name: "Send" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dlg).getByLabelText("Send to"), {
      target: { value: CLIENT_ID },
    });
    expect(await within(dlg).findByText("2,476 / 2,500")).toBeTruthy();
    fireEvent.change(within(dlg).getByLabelText("Note for Sam"), {
      target: { value: "  Lifting days  " },
    });
    fireEvent.click(within(dlg).getByRole("button", { name: "Send to Sam" }));
    await waitFor(() =>
      expect(api.assignPlan).toHaveBeenCalledWith(
        CLIENT_ID,
        "plan-train",
        "Lifting days",
        expect.any(String),
      ),
    );
    expect(await screen.findByText("Sent to Sam")).toBeTruthy();
  });

  it("shares a recipe with a client", async () => {
    const api = fakeApi({
      shareRecipe: vi
        .fn()
        .mockResolvedValueOnce({ created: true })
        .mockResolvedValueOnce({ created: false }),
    });
    openLibrary(api);
    fireEvent.click(await screen.findByRole("radio", { name: "Recipes · 2" }));
    fireEvent.click(
      screen.getAllByRole("button", { name: "Share with a client" })[0]!,
    );
    let dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText("612 kcal a portion")).toBeTruthy();
    fireEvent.change(within(dlg).getByLabelText("Share with"), {
      target: { value: CLIENT_ID },
    });
    fireEvent.click(within(dlg).getByRole("button", { name: "Share" }));
    expect(
      await screen.findByText("Chicken, rice and greens bowl shared with Sam"),
    ).toBeTruthy();
    expect(api.shareRecipe).toHaveBeenCalledWith(CLIENT_ID, "rec-bowl");
    fireEvent.click(
      screen.getAllByRole("button", { name: "Share with a client" })[0]!,
    );
    dlg = screen.getByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText("Share with"), {
      target: { value: CLIENT_ID },
    });
    fireEvent.click(within(dlg).getByRole("button", { name: "Share" }));
    expect(
      await screen.findByText("Sam already has Chicken, rice and greens bowl"),
    ).toBeTruthy();
  });

  it("offline: says so and turns off New, Send and Delete", async () => {
    setOnline(false);
    openLibrary();
    expect(await screen.findByText("Lean bulk · Training day")).toBeTruthy();
    expect(screen.getByText(/Offline · showing your library/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "New plan" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Send Lean bulk · Training day to a client",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("opens the editor for a new plan or a row", async () => {
    openLibrary();
    fireEvent.click(await screen.findByRole("button", { name: "New plan" }));
    expect(currentPath()).toBe("/coach/library/meal-plans/new");
    cleanup();
    openLibrary();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Edit Lean bulk · Training day",
      }),
    );
    expect(currentPath()).toBe("/coach/library/meal-plans/plan-train/edit");
  });
});

describe("Edit a plan (C3) and Add to a meal (C4)", () => {
  const EDIT = `/coach/library/meal-plans/plan-train/edit?client=${CLIENT_ID}`;

  it("measures the plan against the client's target and saves with the revision", async () => {
    const api = fakeApi({
      replacePlan: vi
        .fn()
        .mockImplementation(async (_id, input) =>
          libraryPlan({ name: input.name, revision: 4 }),
        ),
    });
    openEditor(EDIT, api);
    expect(await screen.findByText("Edit meal plan")).toBeTruthy();
    expect(
      await screen.findByText(
        "Sam Patel · Sent 21 Oct · edits reach Sam automatically",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Sam’s target")).toBeTruthy();
    // Planned from the items: 300 + 918 + 1,280 = 2,498 → within 100.
    expect(screen.getAllByText("2,498").length).toBeGreaterThan(0);
    expect(screen.getByText("On target")).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save changes for Sam" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "More Porridge oats" }));
    expect(screen.getByText("80 g × 1.25")).toBeTruthy();
    expect(screen.getByText("×1.25")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Less Porridge oats" }));
    fireEvent.click(screen.getByRole("button", { name: "Less Porridge oats" }));
    expect(screen.getByText("80 g × 0.75")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Save changes for Sam" }),
    );
    await waitFor(() => expect(api.replacePlan).toHaveBeenCalled());
    const [id, input, revision] = api.replacePlan.mock.calls[0]!;
    expect(id).toBe("plan-train");
    expect(revision).toBe(3);
    expect(input.meals[0].items[0]).toEqual({
      servings: 0.75,
      sortOrder: 0,
      foodId: "food-oats",
    });
    await waitFor(() =>
      expect(currentPath()).toBe(`/coach/clients/${CLIENT_ID}/nutrition`),
    );
  });

  it("renames, removes items and meals, adds a meal; refuses bad names", async () => {
    openEditor("/coach/library/meal-plans/plan-train/edit");
    const name = (await screen.findByLabelText(
      "Plan name",
    )) as HTMLInputElement;
    expect(name.value).toBe("Lean bulk · Training day");
    expect(screen.getByText("Target")).toBeTruthy();
    expect(screen.getByText("No target")).toBeTruthy();
    expect(
      screen.getByText(/Open this plan from a client’s Nutrition tab/),
    ).toBeTruthy();
    fireEvent.change(name, { target: { value: "  " } });
    expect(
      await screen.findByText("Give the plan a name of up to 80 characters."),
    ).toBeTruthy();
    fireEvent.change(name, { target: { value: "Cut" } });
    fireEvent.change(screen.getByLabelText("Meal name"), {
      target: { value: "x".repeat(41) },
    });
    expect(
      await screen.findByText("Give each meal a name of up to 40 characters."),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Meal name"), {
      target: { value: "Brekkie" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Porridge oats" }),
    );
    expect(screen.queryByText("Porridge oats")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Brekkie" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand Meal 4" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Meal 4" }));
    expect(screen.queryByText("Meal 4")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add a meal" }));
    expect((screen.getByLabelText("Meal name") as HTMLInputElement).value).toBe(
      "Meal 2",
    );
    expect(screen.getByText("Nothing in this meal yet.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Save plan" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("adds foods, recipes and saved meals to a meal", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = fakeApi();
    openEditor("/coach/library/meal-plans/plan-train/edit", api);
    fireEvent.click(
      await screen.findByRole("button", { name: "Add to Breakfast" }),
    );
    const dlg = screen.getByRole("dialog", { name: "Add to Breakfast" });
    expect(
      within(dlg).getByText("Type at least 2 letters to search foods."),
    ).toBeTruthy();
    expect(
      (
        within(dlg).getByRole("button", {
          name: "Pick something to add",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.change(within(dlg).getByLabelText(/Search foods/), {
      target: { value: "fish" },
    });
    await vi.advanceTimersByTimeAsync(350);
    expect(await within(dlg).findByText("Cod loin · Fishmonger")).toBeTruthy();
    expect(api.searchFoods).toHaveBeenCalledWith("fish");
    fireEvent.click(
      within(dlg).getByRole("checkbox", { name: /Salmon fillet/ }),
    );
    fireEvent.click(within(dlg).getByRole("radio", { name: "Your recipes" }));
    // The search text filters recipes too.
    expect(within(dlg).getByText("No recipes match.")).toBeTruthy();
    fireEvent.change(within(dlg).getByLabelText(/Search foods/), {
      target: { value: "" },
    });
    fireEvent.click(
      within(dlg).getByRole("checkbox", { name: /Turkey chilli/ }),
    );
    fireEvent.click(within(dlg).getByRole("radio", { name: "Saved meals" }));
    const yog = within(dlg).getByRole("checkbox", { name: /Greek yoghurt/ });
    fireEvent.click(yog);
    fireEvent.click(yog);
    fireEvent.click(yog);
    fireEvent.click(
      within(dlg).getByRole("button", { name: "Add 3 items to Breakfast" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Salmon fillet")).toBeTruthy();
    expect(screen.getByText("Turkey chilli with rice")).toBeTruthy();
    expect(screen.getByText("Greek yoghurt and granola")).toBeTruthy();
  });

  it("a 409 loads the latest version and says so", async () => {
    const current = libraryPlan({ name: "Changed on phone", revision: 5 });
    const api = fakeApi({
      replacePlan: vi
        .fn()
        .mockRejectedValue(
          apiError(409, { error: "revision_conflict", current }),
        ),
    });
    openEditor("/coach/library/meal-plans/plan-train/edit", api);
    fireEvent.click(
      await screen.findByRole("button", { name: "More Porridge oats" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    expect(
      await screen.findByText(
        "This plan was changed somewhere else. You're seeing the latest version.",
      ),
    ).toBeTruthy();
    expect((screen.getByLabelText("Plan name") as HTMLInputElement).value).toBe(
      "Changed on phone",
    );
  });

  it("maps the server's refusals onto the form, or a banner", async () => {
    const replacePlan = vi
      .fn()
      .mockRejectedValueOnce(apiError(400, { error: "food_not_found" }))
      .mockRejectedValueOnce(apiError(0, null, true))
      .mockRejectedValueOnce(apiError(404, { error: "not_found" }))
      .mockRejectedValueOnce(apiError(409, { error: "revision_conflict" }));
    openEditor(
      "/coach/library/meal-plans/plan-train/edit",
      fakeApi({ replacePlan }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "More Porridge oats" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    expect(
      await screen.findByText(/A food in this plan is no longer available/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "More Porridge oats" }));
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    expect(await screen.findByText(/Your changes are still here/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    expect(
      await screen.findByText("This plan isn’t in your library any more."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    expect(await screen.findByText(/changed somewhere else/)).toBeTruthy();
  });

  it("a new plan for a client is created once, then Send opens on their tab", async () => {
    const api = fakeApi({
      createPlan: vi.fn().mockResolvedValue(libraryPlan({ id: "plan-new" })),
    });
    openEditor(`/coach/library/meal-plans/new?client=${CLIENT_ID}`, api);
    expect(await screen.findByText("New meal plan")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Save plan" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Plan name"), {
      target: { value: "Cut · 1,900" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(api.createPlan).toHaveBeenCalled());
    expect(api.createPlan.mock.calls[0]![0]).toEqual({
      name: "Cut · 1,900",
      meals: [
        { name: "Meal 1", logSlot: "breakfast", sortOrder: 0, items: [] },
      ],
    });
    expect(typeof api.createPlan.mock.calls[0]![1]).toBe("string");
    await waitFor(() =>
      expect(currentPath()).toBe(
        `/coach/clients/${CLIENT_ID}/nutrition?send=plan-new`,
      ),
    );
  });

  it("a new library plan goes back to the library; trainer-only refusal", async () => {
    const createPlan = vi
      .fn()
      .mockRejectedValueOnce(apiError(403, { error: "manual_meal_plans" }))
      .mockResolvedValueOnce(libraryPlan({ id: "plan-new" }));
    openEditor("/coach/library/meal-plans/new", fakeApi({ createPlan }));
    fireEvent.change(await screen.findByLabelText("Plan name"), {
      target: { value: "Cut" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    expect(
      await screen.findByText("Your account can’t create meal plans."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    await waitFor(() =>
      expect(currentPath()).toBe("/coach/library/meal-plans"),
    );
  });

  it("a plan not in the library, or offline", async () => {
    openEditor("/coach/library/meal-plans/nope/edit");
    expect(
      await screen.findByText("This plan isn’t in your library."),
    ).toBeTruthy();
    cleanup();
    setOnline(false);
    openEditor(
      "/coach/library/meal-plans/plan-train/edit",
      fakeApi({
        libraryPlans: vi.fn().mockRejectedValue(apiError(0, null, true)),
      }),
    );
    expect(
      await screen.findByText(
        "You’re offline. This plan loads when you’re back online.",
      ),
    ).toBeTruthy();
  });
});

describe("#577 review fixes (web)", () => {
  it("a portion under 0.25 from the phone saves; one the API refuses shows by the item", async () => {
    const small = libraryPlan({
      meals: [
        {
          ...libraryPlan().meals[0]!,
          items: [{ ...libraryPlan().meals[0]!.items[0]!, servings: 0.1 }],
        },
      ],
    });
    const replacePlan = vi.fn().mockResolvedValue(small);
    openEditor(
      "/coach/library/meal-plans/plan-train/edit",
      fakeApi({
        libraryPlans: vi.fn().mockResolvedValue([small]),
        replacePlan,
      }),
    );
    expect(await screen.findByText("80 g × 0.1")).toBeTruthy();
    // Less keeps 0.1 (never jumps up to the quarter step).
    fireEvent.click(screen.getByRole("button", { name: "Less Porridge oats" }));
    expect(screen.getByText("80 g × 0.1")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Plan name"), {
      target: { value: "Small" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(replacePlan).toHaveBeenCalled());
    expect(replacePlan.mock.calls[0]![1].meals[0].items[0].servings).toBe(0.1);
    cleanup();

    const zero = libraryPlan({
      meals: [
        {
          ...libraryPlan().meals[0]!,
          items: [{ ...libraryPlan().meals[0]!.items[0]!, servings: 0 }],
        },
      ],
    });
    const refused = vi.fn();
    openEditor(
      "/coach/library/meal-plans/plan-train/edit",
      fakeApi({
        libraryPlans: vi.fn().mockResolvedValue([zero]),
        replacePlan: refused,
      }),
    );
    fireEvent.change(await screen.findByLabelText("Plan name"), {
      target: { value: "Zero" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    expect(
      (
        await screen.findAllByText(
          "Portions must be more than 0 and up to 100.",
        )
      ).length,
    ).toBe(2);
    expect(refused).not.toHaveBeenCalled();
  });

  it("choosing another client starts a new send key; the same client keeps it", async () => {
    const ana = { ...ROSTER.data[0]!, id: "c-ana", name: "Ana Lee" };
    const assignPlan = vi
      .fn()
      .mockRejectedValueOnce(apiError(500, { message: "Boom" }))
      .mockRejectedValueOnce(apiError(500, { message: "Boom" }))
      .mockResolvedValueOnce({});
    openLibrary(
      fakeApi({
        roster: vi
          .fn()
          .mockResolvedValue({ ...ROSTER, data: [...ROSTER.data, ana] }),
        assignPlan,
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Send Lean bulk · Training day to a client",
      }),
    );
    const dlg = screen.getByRole("dialog");
    const pick = (id: string) =>
      fireEvent.change(within(dlg).getByLabelText("Send to"), {
        target: { value: id },
      });
    pick(CLIENT_ID);
    fireEvent.click(within(dlg).getByRole("button", { name: "Send to Sam" }));
    expect(await within(dlg).findByText("Boom")).toBeTruthy();
    pick(CLIENT_ID);
    fireEvent.click(within(dlg).getByRole("button", { name: "Send to Sam" }));
    await waitFor(() => expect(assignPlan).toHaveBeenCalledTimes(2));
    pick("c-ana");
    fireEvent.click(within(dlg).getByRole("button", { name: "Send to Ana" }));
    await waitFor(() => expect(assignPlan).toHaveBeenCalledTimes(3));
    const keys = assignPlan.mock.calls.map((c) => c[3]);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(assignPlan.mock.calls[2]![0]).toBe("c-ana");
  });
});

describe("Client → Nutrition (C3.2)", () => {
  it("shows the target, each plan's status, usage and calorie adherence", async () => {
    openTab();
    expect(
      await screen.findByText("In Sam’s plans · used 9 days"),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("tab", { name: "Nutrition" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByText("2,500 kcal")).toBeTruthy();
    expect(await screen.findByText(/Set by you/)).toBeTruthy();
    expect(screen.getByText("In Sam’s plans · used 9 days")).toBeTruthy();
    // No opened / not opened: the API has no "opened" signal.
    expect(screen.getByText("Sent 2 days ago")).toBeTruthy();
    expect(screen.queryByText(/opened/)).toBeNull();
    expect(screen.getByText("Plan meals logged this week: 19")).toBeTruthy();
    expect(
      await screen.findByText("5 of 7 days on target · 1 not logged"),
    ).toBeTruthy();
    // The first plan is open beside the list.
    const panel = screen.getByRole("complementary", { name: "Meal plan" });
    expect(within(panel).getByText("Against Sam’s target")).toBeTruthy();
    expect(within(panel).getByText("Meals · 2")).toBeTruthy();
    expect(
      within(panel).getByText("Porridge oats · Chicken, rice and greens bowl"),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Lean bulk · Rest day"));
    expect(within(panel).getByText("Meals · 0")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Edit plan" }));
    expect(currentPath()).toBe(
      `/coach/library/meal-plans/plan-rest/edit?client=${CLIENT_ID}`,
    );
  });

  it("no plans and no target", async () => {
    openTab(
      fakeApi({
        clientMealPlans: vi
          .fn()
          .mockResolvedValue({ assignments: [], target: null, asOf: "x" }),
        clientAdherence: vi.fn().mockResolvedValue({ asOf: "x" }),
      }),
    );
    expect(
      await screen.findByText(
        "No meal plans. Add one from your library or build one for Sam.",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Sam has no calorie target yet/)).toBeTruthy();
    expect(screen.getByText("Pick a plan to see its meals.")).toBeTruthy();
    expect(screen.queryByText(/Plan meals logged/)).toBeNull();
  });

  it("removes a plan from the client after confirming", async () => {
    const api = fakeApi();
    openTab(api);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Lean bulk · Training day options",
      }),
    );
    let dlg = screen.getByRole("dialog");
    expect(
      within(dlg).getByText("Changes reach Sam automatically"),
    ).toBeTruthy();
    expect(within(dlg).getByText("What Sam reads with the plan")).toBeTruthy();
    fireEvent.click(within(dlg).getByText("Remove from Sam"));
    dlg = screen.getByRole("dialog", {
      name: "Remove Lean bulk · Training day?",
    });
    expect(
      within(dlg).getByText(
        "Sam stops seeing it in their plans. Food they have already logged stays in their diary. It stays in your library.",
      ),
    ).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(api.removeAssignment).toHaveBeenCalledWith(CLIENT_ID, "asg-train"),
    );
  });

  it("a failed remove says so; the menu's Cancel and Edit plan", async () => {
    openTab(
      fakeApi({
        removeAssignment: vi.fn().mockRejectedValue(apiError(500, null)),
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Lean bulk · Training day options",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Lean bulk · Training day options" }),
    );
    fireEvent.click(screen.getByText("Remove from Sam"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Lean bulk · Training day options" }),
    );
    fireEvent.click(screen.getByText("Remove from Sam"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(
      await screen.findByText("We couldn’t remove that plan. Try again."),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Lean bulk · Training day options" }),
    );
    fireEvent.click(screen.getByText("Edit plan", { selector: ".n" }));
    expect(currentPath()).toBe(
      `/coach/library/meal-plans/plan-train/edit?client=${CLIENT_ID}`,
    );
  });

  it("changes the note, mapping the server's 422 onto the field", async () => {
    const patchAssignmentNote = vi
      .fn()
      .mockRejectedValueOnce(
        apiError(422, { validation: [{ path: "/note", message: "too long" }] }),
      )
      .mockResolvedValueOnce({});
    openTab(fakeApi({ patchAssignmentNote }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Lean bulk · Training day options",
      }),
    );
    fireEvent.click(screen.getByText("Change the note"));
    const dlg = screen.getByRole("dialog", { name: "Change the note" });
    const note = within(dlg).getByLabelText(
      "Note for Sam",
    ) as HTMLTextAreaElement;
    expect(note.value).toBe("Use this on lifting days.");
    fireEvent.change(note, { target: { value: "x".repeat(501) } });
    expect(
      await within(dlg).findByText("Keep the note under 500 characters."),
    ).toBeTruthy();
    const saveNote = within(dlg).getByRole("button", {
      name: "Save note",
    }) as HTMLButtonElement;
    expect(saveNote.disabled).toBe(true);
    expect(within(dlg).queryByText(/Plan vs Sam’s target/)).toBeNull();
    fireEvent.change(note, { target: { value: "Swap salmon for chicken" } });
    await waitFor(() => expect(saveNote.disabled).toBe(false));
    fireEvent.click(saveNote);
    // The server's refusal lands on the note.
    expect(
      await within(dlg).findByText("Keep the note under 500 characters."),
    ).toBeTruthy();
    expect(patchAssignmentNote).toHaveBeenCalledWith(
      CLIENT_ID,
      "asg-train",
      "Swap salmon for chicken",
    );
    fireEvent.change(note, { target: { value: "" } });
    await waitFor(() => expect(saveNote.disabled).toBe(false));
    fireEvent.click(saveNote);
    await waitFor(() =>
      expect(patchAssignmentNote).toHaveBeenLastCalledWith(
        CLIENT_ID,
        "asg-train",
        null,
      ),
    );
    expect(await screen.findByText("Note updated for Sam")).toBeTruthy();
  });

  it("+ Add picks a library plan and sends it; a sent one can't be picked", async () => {
    const api = fakeApi({
      libraryPlans: vi
        .fn()
        .mockResolvedValue([
          ...LIBRARY_PLANS,
          libraryPlan({ id: "plan-cut", name: "Cut · 1,900", meals: [] }),
        ]),
      assignPlan: vi
        .fn()
        .mockRejectedValueOnce(apiError(404, { error: "plan_not_found" }))
        .mockResolvedValueOnce({}),
    });
    openTab(api);
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    const pick = screen.getByRole("dialog", {
      name: "Add a meal plan for Sam",
    });
    const sent = within(pick).getAllByText("Already with Sam");
    expect(sent).toHaveLength(2);
    fireEvent.click(await within(pick).findByText("Cut · 1,900"));
    const dlg = screen.getByRole("dialog", { name: "Send meal plan" });
    expect(
      within(dlg).getByText(/It goes into Sam’s plans with your note/),
    ).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "Send to Sam" }));
    expect(
      await within(dlg).findByText(
        "This plan or client isn’t available any more.",
      ),
    ).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "Send to Sam" }));
    await waitFor(() => expect(api.assignPlan).toHaveBeenCalledTimes(2));
    // The same key both times, so a retry never sends twice.
    expect(api.assignPlan.mock.calls[0]![3]).toBe(
      api.assignPlan.mock.calls[1]![3],
    );
    expect(await screen.findByText("Sent to Sam")).toBeTruthy();
  });

  it("+ Add can build a new plan for the client", async () => {
    openTab();
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Build a new plan for Sam" }),
    );
    expect(currentPath()).toBe(
      `/coach/library/meal-plans/new?client=${CLIENT_ID}`,
    );
  });

  it("?send= opens Send for a plan just built; Cancel clears it", async () => {
    openTab(fakeApi(), "?send=plan-rest");
    const dlg = await screen.findByRole("dialog", { name: "Send meal plan" });
    expect(within(dlg).getByText("Lean bulk · Rest day")).toBeTruthy();
    expect(await within(dlg).findByText("2,310 / 2,500")).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(currentPath()).toBe(`/coach/clients/${CLIENT_ID}/nutrition`),
    );
  });

  it("shares a recipe with the client", async () => {
    const api = fakeApi({
      shareRecipe: vi
        .fn()
        .mockRejectedValueOnce(apiError(404, { error: "recipe_not_found" }))
        .mockResolvedValueOnce({ created: true }),
    });
    openTab(api);
    fireEvent.click(
      await screen.findByRole("button", { name: "Share a recipe with Sam" }),
    );
    const dlg = screen.getByRole("dialog", { name: "Share a recipe with Sam" });
    const share = within(dlg).getByRole("button", { name: "Share" });
    expect((share as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(await within(dlg).findByLabelText("Recipe"), {
      target: { value: "rec-chilli" },
    });
    fireEvent.click(share);
    expect(
      await within(dlg).findByText(
        "This recipe or client isn’t available any more.",
      ),
    ).toBeTruthy();
    fireEvent.click(share);
    expect(
      await screen.findByText("Turkey chilli with rice shared with Sam"),
    ).toBeTruthy();
  });

  it("offline: banner, and every change needs a connection", async () => {
    const api = fakeApi();
    openTab(api);
    expect(
      await screen.findByText("In Sam’s plans · used 9 days"),
    ).toBeTruthy();
    setOnline(false);
    expect(
      await screen.findByText(/Offline · showing Sam’s nutrition as of/),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Add" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Lean bulk · Training day options" }),
    );
    const dlg = screen.getByRole("dialog");
    for (const b of within(dlg).getAllByRole("button").slice(0, 3)) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("a load error, online and offline", async () => {
    openTab(
      fakeApi({
        clientMealPlans: vi.fn().mockRejectedValue(apiError(500, null)),
      }),
    );
    expect(
      await screen.findByText("We couldn’t load Sam’s meal plans."),
    ).toBeTruthy();
    cleanup();
    setOnline(false);
    openTab(
      fakeApi({
        clientMealPlans: vi.fn().mockRejectedValue(apiError(0, null, true)),
      }),
    );
    expect(
      await screen.findByText(
        "You’re offline. Sam’s meal plans load when you’re back online.",
      ),
    ).toBeTruthy();
  });

  it("send failures: offline and other errors keep the dialog", async () => {
    const assignPlan = vi
      .fn()
      .mockRejectedValueOnce(apiError(0, null, true))
      .mockRejectedValueOnce(apiError(500, { message: "Boom" }))
      .mockRejectedValueOnce(new Error("x"));
    openTab(fakeApi({ assignPlan }), "?send=plan-rest");
    const dlg = await screen.findByRole("dialog", { name: "Send meal plan" });
    const send = within(dlg).getByRole("button", { name: "Send to Sam" });
    fireEvent.click(send);
    expect(
      await within(dlg).findByText(/Try again when you’re back online/),
    ).toBeTruthy();
    fireEvent.click(send);
    expect(await within(dlg).findByText("Boom")).toBeTruthy();
    fireEvent.click(send);
    expect(
      await within(dlg).findByText("We couldn’t send that. Try again."),
    ).toBeTruthy();
  });
});

// Keep the fixture honest: two assignments, the C1b board's statuses.
it("fixtures match the board", () => {
  expect(CLIENT_MEAL_PLANS.assignments.map((a) => a.status)).toEqual([
    "added",
    "sent",
  ]);
  expect(assignment().plan.name).toBe("Lean bulk · Training day");
});
