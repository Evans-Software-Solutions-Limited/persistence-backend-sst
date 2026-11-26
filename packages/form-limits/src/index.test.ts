import {
  CLIENT_PROFILE_LIMITS,
  CLIENT_SETTINGS_LIMITS,
  CLIENT_SETUP_LIMITS,
  COACH_FORM_LIMITS,
  FORM_REPLY_MAX,
  FORM_SCHEDULE_LIMITS,
  MEAL_PLAN_LIMITS,
  USER_MEAL_LIMITS,
} from "./index";

/**
 * Pins the values the API enforced before they moved here (PER-147), so a
 * change is deliberate: 1.2.0 phones send against these limits.
 */
describe("form limits", () => {
  it("match what the API enforced before they were shared", () => {
    expect(CLIENT_PROFILE_LIMITS).toEqual({
      displayNameMax: 80,
      contactEmailMax: 320,
      contactPhoneMax: 40,
      goalMax: 200,
      privateNotesMax: 4000,
    });
    expect(CLIENT_SETUP_LIMITS).toEqual({
      maxKcal: 20_000,
      maxMacroG: 2_000,
      welcomeMessageMax: 1000,
    });
    expect(CLIENT_SETTINGS_LIMITS).toEqual({
      sessionsPerWeekMin: 1,
      sessionsPerWeekMax: 14,
    });
    expect(COACH_FORM_LIMITS).toEqual({
      titleMax: 120,
      maxQuestions: 40,
      promptMax: 300,
      helpMax: 300,
      minOptions: 2,
      maxOptions: 12,
      optionMax: 100,
      unitMax: 20,
    });
    expect(FORM_SCHEDULE_LIMITS).toEqual({
      weekdayMin: 1,
      weekdayMax: 7,
      maxReminders: 5,
      maxReminderHours: 720,
      maxDueHours: 2160,
      maxSelectedClients: 500,
    });
    expect(FORM_REPLY_MAX).toBe(2000);
    expect(USER_MEAL_LIMITS).toEqual({ nameMax: 80, maxMeals: 30 });
    expect(MEAL_PLAN_LIMITS).toEqual({ nameMax: 200, mealNameMax: 80 });
  });
});
