import {
  asNutritionTarget,
  assignmentStatus,
  calorieLine,
  daysAgo,
  firstName,
  kcalText,
  librarySubline,
  loggedThisWeek,
  macroLine,
  plannedLine,
  targetSetBy,
} from "../coachMealPlans.service";
import { emptyPlanMeal, newDraftPlan } from "../nutritionPlans.service";

const NOW = new Date("2026-11-26T12:00:00").getTime();

describe("coach meal plans copy (PER-135)", () => {
  it("numbers and plan lines", () => {
    expect(kcalText(2476.4)).toBe("2,476");
    expect(macroLine({ proteinG: 186.2, carbsG: 294, fatG: 62.6 })).toBe(
      "186P 294C 63F",
    );
    const one = newDraftPlan({
      id: "p",
      ownerId: "c",
      name: "Cut",
      now: "x",
      meals: [emptyPlanMeal("m", "Meal 1", "breakfast", 0)],
    });
    expect(librarySubline(one)).toBe("1 meal · 0P 0C 0F");
    expect(plannedLine({ ...one, meals: [] })).toBe("0 meals · 0 planned");
  });

  it("days ago", () => {
    expect(daysAgo("2026-11-26T08:00:00", NOW)).toBe("today");
    expect(daysAgo("2026-11-25T08:00:00", NOW)).toBe("yesterday");
    expect(daysAgo("2026-11-23T08:00:00", NOW)).toBe("3 days ago");
    expect(daysAgo("2026-10-21T08:00:00", NOW)).toBe("21 Oct");
  });

  it("status of each plan with the client", () => {
    const base = {
      status: "added" as const,
      seenRevision: 1,
      sentAt: "2026-11-24T09:00:00",
      usedDays: 9,
    };
    expect(assignmentStatus(base, "Sam", NOW)).toEqual({
      text: "In Sam’s plans · used 9 days",
      tone: "done",
    });
    expect(assignmentStatus({ ...base, usedDays: 1 }, "Sam", NOW).text).toBe(
      "In Sam’s plans · used 1 day",
    );
    expect(assignmentStatus({ ...base, usedDays: 0 }, "Sam", NOW).text).toBe(
      "In Sam’s plans",
    );
    expect(
      assignmentStatus({ ...base, status: "dismissed" }, "Sam", NOW),
    ).toEqual({ text: "Sam chose Not now", tone: "paused" });
    expect(assignmentStatus({ ...base, status: "sent" }, "Sam", NOW)).toEqual({
      text: "Sent 2 days ago",
      tone: "waiting",
    });
    expect(
      assignmentStatus(
        { ...base, status: "sent", sentAt: "2026-10-21T09:00:00" },
        "Sam",
        NOW,
      ).text,
    ).toBe("Sent 21 Oct");
  });

  it("usage, adherence, who set the target, names", () => {
    expect(
      loggedThisWeek([{ loggedThisWeek: 12 }, { loggedThisWeek: 7 }] as never),
    ).toBe(19);
    expect(calorieLine(null)).toBeNull();
    expect(
      calorieLine({ daysOnTarget: 0, daysCounted: 0, daysNotLogged: 0 }),
    ).toBeNull();
    expect(
      calorieLine({ daysOnTarget: 1, daysCounted: 1, daysNotLogged: 0 }),
    ).toBe("1 of 1 day on target");
    expect(
      calorieLine({ daysOnTarget: 5, daysCounted: 7, daysNotLogged: 1 }),
    ).toBe("5 of 7 days on target · 1 not logged");
    expect(targetSetBy("me", "me", "c", "Sam")).toBe("Set by you");
    expect(targetSetBy(null, "me", "c", "Sam")).toBe("Sam’s own target");
    expect(targetSetBy("c", "me", "c", "Sam")).toBe("Sam’s own target");
    expect(targetSetBy("x", "me", "c", "Sam")).toBe("Set by another coach");
    expect(firstName("Sam Patel")).toBe("Sam");
    expect(firstName(null)).toBe("your client");
    expect(asNutritionTarget(null, "c")).toBeNull();
    expect(
      asNutritionTarget(
        {
          dailyKcal: 2500,
          proteinG: 180,
          carbsG: 300,
          fatG: 70,
          setByUserId: null,
        },
        "c",
      ),
    ).toMatchObject({ userId: "c", dailyKcal: 2500, fatG: 70 });
  });
});
