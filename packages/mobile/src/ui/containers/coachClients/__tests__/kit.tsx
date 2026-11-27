/**
 * PER-125 test fixtures for the iPhone add-client containers. The harness
 * (in-memory adapters, coach session, switchable network, a fake `fetch`
 * for the queue) is PER-129's `setupCoachForms`.
 */
import type {
  CachedClientProfile,
  ClientProfileDetail,
  ClientSettings,
} from "@/domain/models/coachClientProfiles";
import type { ProgramDetail, ProgramSummary } from "@/domain/models/program";
import {
  COACH,
  makeForm,
  makeSchedule,
  q,
  setupCoachForms,
} from "../../__tests__/coachFormsTestKit";

export { COACH, setupCoachForms };

export function profile(
  id = "p-lena",
  extra: Partial<CachedClientProfile> = {},
): CachedClientProfile {
  return {
    id,
    displayName: "Lena Ortiz",
    contactEmail: "lena@example.com",
    contactPhone: null,
    goal: "First pull-up, then a strength base",
    privateNotes: null,
    status: "invited",
    clientId: null,
    relationshipId: null,
    acceptedAt: null,
    cancelledAt: null,
    revision: 3,
    createdAt: "2026-11-26T09:00:00Z",
    updatedAt: "2026-11-26T09:00:00Z",
    setup: {},
    invite: null,
    conflictAt: null,
    ...extra,
  };
}

export const FULL_SETUP: ClientProfileDetail["setup"] = {
  starter_form: [
    { refId: "f-join", config: {}, sortOrder: 0 },
    { refId: "f-life", config: {}, sortOrder: 1 },
  ],
  repeating_form: [{ refId: "s-week", config: {}, sortOrder: 0 }],
  programme: [{ refId: "pr-1", config: {}, sortOrder: 0 }],
  nutrition_target: [
    {
      refId: null,
      config: { dailyKcal: 2100, proteinG: 150, carbsG: 230, fatG: 65 },
      sortOrder: 0,
    },
  ],
  resource: [
    { refId: "r-1", config: {}, sortOrder: 0 },
    { refId: "r-2", config: {}, sortOrder: 1 },
  ],
  welcome_message: [
    {
      refId: null,
      config: {
        text: "Hi Lena, excited to start. Fill in the two forms first.",
      },
      sortOrder: 0,
    },
  ],
};

export const FORMS = [
  makeForm("f-join", "New client: goals and health", [
    q("q1", "long_text", { prompt: "What do you want from coaching?" }),
    q("q2", "short_text", { prompt: "By when?" }),
  ]),
  makeForm("f-life", "Lifestyle and schedule", [q("q1")]),
  makeForm("f-week", "Weekly check-in", [
    q("w1"),
    q("w2", "number", { prefill: "weight" }),
  ]),
];

export const SCHEDULES = [
  makeSchedule("s-week", "f-week", "weekly", {
    audience: "selected",
    reminders: [{ afterHours: 9 }, { afterHours: 24 }],
  }),
  makeSchedule("s-daily", "f-life", "daily", { audience: "selected" }),
  makeSchedule("s-all", "f-life", "weekly", { audience: "all_clients" }),
];

export const PROGRAMMES: ProgramSummary[] = [
  {
    id: "pr-1",
    name: "Lean bulk · Upper / Lower",
    description: null,
    durationWeeks: 12,
    daysPerWeek: 4,
    workoutCount: 48,
    activeClientCount: 0,
    createdAt: null,
    updatedAt: null,
  },
  {
    id: "pr-2",
    name: "Strength base",
    description: null,
    durationWeeks: null,
    daysPerWeek: 3,
    workoutCount: 3,
    activeClientCount: 0,
    createdAt: null,
    updatedAt: null,
  },
];

export function programmeDetail(id = "pr-1"): ProgramDetail {
  const base = PROGRAMMES.find((p) => p.id === id)!;
  return {
    ...base,
    assignments: [],
    workouts: ["Upper A", "Lower A", "Upper B", "Lower B"].map((name, i) => ({
      id: `pw-${i}`,
      workoutId: `w-${i}`,
      position: i,
      name,
      estimatedDurationMinutes: i === 0 ? 55 : null,
    })),
  };
}

export function clientSettings(
  extra: Partial<ClientSettings> = {},
): ClientSettings {
  return {
    relationshipId: "rel-1",
    clientId: "c-sam",
    trackTraining: false,
    trackCalories: false,
    sessionsPerWeek: null,
    features: {
      messages: true,
      checkIns: true,
      photos: true,
      habits: true,
      nutrition: true,
      resources: true,
    },
    alertMode: "default",
    revision: 2,
    updatedAt: null,
    ...extra,
  };
}

/** A harness with the coach's library cached (forms, rules, programmes). */
export function setupClients(opts: { online?: boolean } = {}) {
  const h = setupCoachForms(opts);
  h.storage.cacheCoachForms(COACH, { forms: FORMS, templates: [], asOf: "a" });
  h.storage.cacheCoachFormSchedules(COACH, SCHEDULES);
  h.storage.cachePrograms(COACH, PROGRAMMES);
  h.api.coachFormsLibrary = { forms: FORMS, templates: [], asOf: "a" };
  h.api.coachFormSchedules = SCHEDULES;
  h.api.programs = PROGRAMMES;
  return h;
}
