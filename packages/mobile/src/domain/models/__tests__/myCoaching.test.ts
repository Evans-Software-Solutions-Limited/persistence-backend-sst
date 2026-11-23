import { firstName, readyLine, type AcceptPreview } from "../myCoaching";

const preview = (
  sections: AcceptPreview["sections"],
  extra: Partial<AcceptPreview> = {},
): AcceptPreview => ({
  sections,
  programmes: [],
  plans: [],
  forms: [],
  ...extra,
});

describe("readyLine (C11j 'what's ready')", () => {
  it("is empty for a general code or an empty set-up", () => {
    expect(readyLine(null)).toBe("");
    expect(readyLine(preview([]))).toBe("");
  });

  it("names a single programme, counts the rest, in section order", () => {
    expect(
      readyLine(
        preview(
          [
            { section: "starter_form", label: "Starter forms", count: 2 },
            { section: "repeating_form", label: "Check-ins", count: 1 },
            { section: "programme", label: "Programme", count: 1 },
            { section: "nutrition_target", label: "Target", count: 1 },
            { section: "meal_plan", label: "Meal plans", count: 1 },
            { section: "resource", label: "Resources", count: 2 },
            { section: "welcome_message", label: "Welcome", count: 1 },
          ],
          { programmes: [{ name: "Lean bulk", workouts: 4 }] },
        ),
      ),
    ).toBe(
      "2 forms · 1 check-in · Lean bulk programme · calorie target · 1 meal plan · 2 resources · welcome message",
    );
  });

  it("plurals, and counts programmes when there are several", () => {
    expect(
      readyLine(
        preview(
          [
            { section: "starter_form", label: "Starter forms", count: 1 },
            { section: "repeating_form", label: "Check-ins", count: 2 },
            { section: "programme", label: "Programme", count: 2 },
            { section: "meal_plan", label: "Meal plans", count: 3 },
            { section: "resource", label: "Resources", count: 1 },
          ],
          {
            programmes: [
              { name: "A", workouts: 3 },
              { name: "B", workouts: 3 },
            ],
          },
        ),
      ),
    ).toBe("1 form · 2 check-ins · 2 programmes · 3 meal plans · 1 resource");
  });
});

describe("firstName", () => {
  it("takes the first word, or the whole name when there isn't one", () => {
    expect(firstName("Ellie Hart")).toBe("Ellie");
    expect(firstName("  Marcus   Lee ")).toBe("Marcus");
    expect(firstName("   ")).toBe("   ");
  });
});
