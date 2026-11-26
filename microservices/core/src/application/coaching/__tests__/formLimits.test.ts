import {
  MAX_HELP,
  MAX_OPTIONS,
  MAX_OPTION_LENGTH,
  MAX_PROMPT,
  MAX_QUESTIONS,
  MAX_UNIT_LENGTH,
  MIN_OPTIONS,
} from "../forms/questions";
import { TITLE_MAX } from "../forms/formRepository";
import { REPLY_MAX } from "../forms/requestsRepository";
import {
  MAX_DUE_HOURS,
  MAX_REMINDERS,
  MAX_REMINDER_HOURS,
  MAX_SELECTED_CLIENTS,
} from "../forms/scheduleRepository";
import { WELCOME_MESSAGE_MAX_LENGTH } from "../setupSections";
import { MAX_USER_MEALS } from "../../nutrition/userMeals/put/nutritionUserMealsPutHandler";
import { planBodyFields } from "../../nutrition/mealPlans/mealPlansHandlers";
import {
  MAX_SET_TARGETS,
  MAX_SET_TARGET_REPS,
  setTargetsInputSchema,
} from "../../workouts/shared/setTargets";

/**
 * PER-147: the routes now read their limits from `@persistence/form-limits`,
 * shared with the web and mobile forms. These pin the values the API used
 * before the move, so a 1.2.0 phone sees exactly the same validation.
 */
describe("API limits shared with the app forms (PER-147)", () => {
  it("coach forms: questions, options, title and reply", () => {
    expect(MAX_QUESTIONS).toBe(40);
    expect(MAX_PROMPT).toBe(300);
    expect(MAX_HELP).toBe(300);
    expect(MIN_OPTIONS).toBe(2);
    expect(MAX_OPTIONS).toBe(12);
    expect(MAX_OPTION_LENGTH).toBe(100);
    expect(MAX_UNIT_LENGTH).toBe(20);
    expect(TITLE_MAX).toBe(120);
    expect(REPLY_MAX).toBe(2000);
  });

  it("send rules", () => {
    expect(MAX_REMINDERS).toBe(5);
    expect(MAX_REMINDER_HOURS).toBe(720);
    expect(MAX_DUE_HOURS).toBe(2160);
    expect(MAX_SELECTED_CLIENTS).toBe(500);
  });

  it("set-up welcome message, Your meals and meal plans", () => {
    expect(WELCOME_MESSAGE_MAX_LENGTH).toBe(1000);
    expect(MAX_USER_MEALS).toBe(30);
    expect(planBodyFields.name.maxLength).toBe(200);
    expect(
      (
        planBodyFields.meals.items as {
          properties: { name: { maxLength: number } };
        }
      ).properties.name.maxLength,
    ).toBe(80);
  });

  it("reps per set: 1 to 20 sets, 1 to 100 reps (PER-139)", () => {
    expect(MAX_SET_TARGETS).toBe(20);
    expect(MAX_SET_TARGET_REPS).toBe(100);
    const list = (
      setTargetsInputSchema as unknown as {
        anyOf: {
          maxItems?: number;
          items?: { properties: { reps: { maximum: number } } };
        }[];
      }
    ).anyOf[0];
    expect(list.maxItems).toBe(20);
    expect(list.items?.properties.reps.maximum).toBe(100);
  });
});
