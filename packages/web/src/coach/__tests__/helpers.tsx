/* eslint-disable react-refresh/only-export-components -- test helpers */
import { useEffect, type ReactElement } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import {
  QueryClient,
  QueryClientProvider,
  onlineManager,
} from "@tanstack/react-query";
import { vi } from "vitest";
import { CoachApiError, type CoachApi } from "../api/coachApi";
import type {
  ClientFormEntry,
  ClientProfileDetail,
  ClientSettings,
  CoachForm,
  FormResponse,
  FormSchedule,
  FormStats,
  MealPlan,
  Roster,
} from "../api/types";
import { CoachApiContext } from "../hooks/coachQueries";
import {
  ADHERENCE,
  CLIENT_MEAL_PLANS,
  FOODS,
  LIBRARY_PLANS,
  RECIPES,
  SAVED_MEALS,
} from "./mealPlanFixtures";

/** Shared fixtures and a fake API for the coach container tests. */

export const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
export const CLIENT_ID = "22222222-2222-4222-8222-222222222222";

export function detail(
  over: Partial<ClientProfileDetail> = {},
): ClientProfileDetail {
  return {
    id: PROFILE_ID,
    displayName: "Lena Ortiz",
    contactEmail: "lena.ortiz@example.com",
    contactPhone: null,
    goal: "First pull-up, then a strength base",
    privateNotes: "Desk job, left shoulder tight.",
    status: "invited",
    clientId: null,
    relationshipId: null,
    acceptedAt: null,
    cancelledAt: null,
    revision: 3,
    createdAt: "2026-11-20T10:00:00.000Z",
    updatedAt: "2026-11-20T10:00:00.000Z",
    setup: {},
    invite: null,
    ...over,
  };
}

export const FORMS: CoachForm[] = [
  {
    id: "f-goals",
    title: "New client: goals and health",
    description: null,
    archivedAt: null,
    version: {
      id: "v1",
      version: 1,
      questions: Array.from({ length: 14 }, (_, i) => ({
        id: `q${i}`,
        type: i === 0 ? "long_text" : "yes_no",
        prompt:
          i === 0 ? "What do you want from coaching?" : `Question ${i + 1}`,
        required: true,
      })),
    },
  },
  {
    id: "f-life",
    title: "Lifestyle and schedule",
    description: null,
    archivedAt: null,
    version: {
      id: "v2",
      version: 1,
      questions: Array.from({ length: 9 }, (_, i) => ({
        id: `l${i}`,
        type: "short_text",
        prompt: `Life ${i + 1}`,
        required: false,
      })),
    },
  },
  {
    id: "f-weekly",
    title: "Weekly check-in",
    description: null,
    archivedAt: null,
    version: {
      id: "v3",
      version: 1,
      questions: [
        { id: "w1", type: "scale", prompt: "Energy this week", required: true },
      ],
    },
  },
];

export const SCHEDULES: FormSchedule[] = [
  {
    id: "s-weekly",
    formId: "f-weekly",
    trigger: "weekly",
    audience: "selected",
    weekday: 7,
    timeLocal: "09:00",
    dueAfterHours: 27,
    reminders: [{ afterHours: 9 }, { afterHours: 24 }],
    status: "active",
  },
];

export const PLANS: MealPlan[] = [
  {
    id: "p-train",
    name: "Training day meals",
    totals: { kcal: 2450, proteinG: 180, carbsG: 250, fatG: 70 },
    meals: [1, 2, 3, 4, 5].map((n) => ({ id: `m${n}`, name: `Meal ${n}` })),
  },
];

export const ROSTER: Roster = {
  data: [
    {
      id: CLIENT_ID,
      name: "Sam Patel",
      initials: "SP",
      avatarUrl: null,
      status: "active",
      programLabel: "Lean bulk · Wk 6 / 12",
      lastSeenAt: null,
    },
  ],
  invited: [
    {
      profileId: PROFILE_ID,
      displayName: "Lena Ortiz",
      goal: "First pull-up, then a strength base",
      inviteExpiresAt: "2099-01-01T00:00:00.000Z",
      inviteStatus: "active",
      readyCount: 2,
    },
  ],
};

export function settings(over: Partial<ClientSettings> = {}): ClientSettings {
  return {
    relationshipId: "rel-1",
    clientId: CLIENT_ID,
    trackTraining: false,
    trackCalories: true,
    sessionsPerWeek: null,
    features: {
      nutrition: true,
      checkIns: true,
      photos: true,
      habits: true,
      messages: true,
      resources: true,
    },
    alertMode: "default",
    revision: 4,
    updatedAt: null,
    ...over,
  };
}

export function apiError(
  status: number,
  body: Record<string, unknown> | null,
  offline = false,
) {
  return new CoachApiError(status, body, offline);
}

// ─── PER-129 forms fixtures ──────────────────────────────────────────────────

export const STATS: FormStats = {
  forms: [
    {
      formId: "f-weekly",
      reached: 2,
      done: 1,
      outstanding: 1,
      clients: [
        {
          clientId: "c-tom",
          name: "Tom Reid",
          requestId: "r-tom",
          status: "pending",
          late: false,
          sentAt: "2026-11-22T09:00:00.000Z",
          dueAt: "2026-11-23T12:00:00.000Z",
          completedAt: null,
          remindersSent: 1,
          lastReminderAt: "2026-11-22T18:00:00.000Z",
        },
        {
          clientId: CLIENT_ID,
          name: "Sam Patel",
          requestId: "r-sam",
          status: "done",
          late: false,
          sentAt: "2026-11-22T09:00:00.000Z",
          dueAt: "2026-11-23T12:00:00.000Z",
          completedAt: "2026-11-22T10:14:00.000Z",
          remindersSent: 0,
          lastReminderAt: null,
        },
      ],
    },
  ],
  totals: {
    forms: 3,
    repeating: 1,
    outstanding: 1,
    onTimeRate: 0.86,
    onTimeSample: 7,
  },
};

const WEEKLY_QUESTIONS = [
  { id: "w1", type: "scale", prompt: "Energy this week", required: true },
  {
    id: "w2",
    type: "number",
    prompt: "Sleep, average",
    required: false,
    unit: "h",
  },
  { id: "w3", type: "short_text", prompt: "Stress", required: false },
];

export function response(over: Partial<FormResponse> = {}): FormResponse {
  return {
    id: "resp-1",
    requestId: "req-1",
    formId: "f-weekly",
    title: "Weekly check-in",
    trigger: "weekly",
    periodKey: "2026-W47",
    sentAt: "2026-11-22T09:00:00.000Z",
    submittedAt: "2026-11-22T10:14:00.000Z",
    late: false,
    answers: { w1: 4, w2: 6.5, w3: "Work deadline" },
    reviewedAt: null,
    replyText: null,
    version: { id: "v3", version: 1, questions: WEEKLY_QUESTIONS },
    ...over,
  };
}

export const RESPONSES: FormResponse[] = [
  response(),
  response({
    id: "resp-0",
    requestId: "req-0",
    periodKey: "2026-W46",
    submittedAt: "2026-11-15T10:00:00.000Z",
    answers: { w1: 3, w2: 7, w3: "Fine" },
    reviewedAt: "2026-11-15T12:00:00.000Z",
    replyText: "Nice week",
  }),
];

export const CLIENT_FORMS: ClientFormEntry[] = [
  {
    form: { id: "f-weekly", title: "Weekly check-in", archivedAt: null },
    rule: {
      scheduleId: "s-weekly",
      trigger: "weekly",
      audience: "selected",
      status: "active",
      clientStatus: "active",
      weekday: 7,
      timeLocal: "09:00",
      dueAfterHours: 27,
      reminders: [{ afterHours: 9 }],
      override: null,
    },
    rules: [],
    lastDoneAt: "2026-11-22T10:14:00.000Z",
    lastSentAt: "2026-11-22T09:00:00.000Z",
    pendingRequestId: null,
    state: "done",
  },
  {
    form: { id: "f-goals", title: "Progress review", archivedAt: null },
    rule: {
      scheduleId: "s-once",
      trigger: "once",
      audience: "selected",
      status: "active",
      clientStatus: "active",
      weekday: null,
      timeLocal: null,
      dueAfterHours: null,
      reminders: [],
      override: null,
    },
    rules: [],
    lastDoneAt: null,
    lastSentAt: "2026-11-20T09:00:00.000Z",
    pendingRequestId: "req-x",
    state: "notDoneYet",
  },
];

export type FakeApi = { [K in keyof CoachApi]: ReturnType<typeof vi.fn> };

export function fakeApi(over: Partial<FakeApi> = {}): FakeApi {
  const api: FakeApi = {
    profile: vi.fn().mockResolvedValue({
      id: "coach-1",
      fullName: "Ellie Hart",
      avatarUrl: null,
      role: "personal_trainer",
    }),
    roster: vi.fn().mockResolvedValue(ROSTER),
    createProfile: vi.fn(),
    profileDetail: vi.fn().mockResolvedValue(detail()),
    patchProfile: vi.fn(),
    replaceSection: vi.fn(),
    copyFrom: vi.fn(),
    preview: vi.fn().mockResolvedValue({
      sections: [],
      welcomeMessage: "Hi Lena, excited to start.",
      programmes: [],
      plans: [],
      forms: [],
    }),
    issueInvite: vi.fn().mockResolvedValue({
      code: "LN4Q8T",
      link: "persistencemobile://accept-invite?code=LN4Q8T",
      expiresAt: "2099-01-01T00:00:00.000Z",
    }),
    cancelInvite: vi.fn().mockResolvedValue(undefined),
    deleteProfile: vi.fn(),
    forms: vi.fn().mockResolvedValue(FORMS),
    formSchedules: vi.fn().mockResolvedValue(SCHEDULES),
    mealPlans: vi.fn().mockResolvedValue(PLANS),
    templates: vi.fn().mockResolvedValue([]),
    createFromTemplate: vi.fn(),
    formStats: vi.fn().mockResolvedValue(STATS),
    createForm: vi.fn(),
    patchForm: vi.fn(),
    archiveForm: vi.fn(),
    createSchedule: vi.fn(),
    patchSchedule: vi.fn(),
    clientForms: vi.fn().mockResolvedValue(CLIENT_FORMS),
    clientFormSetup: vi.fn(),
    responses: vi.fn().mockResolvedValue({ data: RESPONSES, nextCursor: null }),
    reviewResponse: vi.fn(),
    settings: vi.fn().mockResolvedValue(settings()),
    patchSettings: vi.fn(),
    endCoaching: vi.fn().mockResolvedValue(undefined),
    declaration: vi.fn().mockResolvedValue({
      currentVersion: "2026-11-v1",
      acceptedVersion: "2026-11-v1",
      acceptedAt: "2026-11-20T00:00:00.000Z",
    }),
    acceptDeclaration: vi.fn().mockResolvedValue({
      currentVersion: "2026-11-v1",
      acceptedVersion: "2026-11-v1",
      acceptedAt: "2026-11-23T00:00:00.000Z",
    }),
    // PER-135: meal-plan library and the Nutrition tab.
    libraryPlans: vi.fn().mockResolvedValue(LIBRARY_PLANS),
    createPlan: vi.fn(),
    replacePlan: vi.fn(),
    archivePlan: vi.fn().mockResolvedValue(undefined),
    clientMealPlans: vi.fn().mockResolvedValue(CLIENT_MEAL_PLANS),
    assignPlan: vi.fn(),
    patchAssignmentNote: vi.fn(),
    removeAssignment: vi.fn().mockResolvedValue(undefined),
    shareRecipe: vi.fn(),
    recipes: vi.fn().mockResolvedValue(RECIPES),
    savedMeals: vi.fn().mockResolvedValue(SAVED_MEALS),
    searchFoods: vi.fn().mockResolvedValue(FOODS),
    clientAdherence: vi.fn().mockResolvedValue(ADHERENCE),
    ...over,
  };
  return api;
}

let lastPath = "";
export const currentPath = () => lastPath;

function LocationSpy() {
  const loc = useLocation();
  useEffect(() => {
    lastPath = loc.pathname + loc.search;
  }, [loc]);
  return null;
}

/** Render a coach screen at `route`, matched by `path`, with a fake API. */
export function renderCoach(
  ui: ReactElement,
  {
    route,
    path,
    api,
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  }: {
    route: string;
    path: string;
    api: FakeApi;
    queryClient?: QueryClient;
  },
) {
  lastPath = route;
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <CoachApiContext.Provider value={api as unknown as CoachApi}>
        <MemoryRouter initialEntries={[route]}>
          <div className="persistence-coach">
            <Routes>
              <Route path={path} element={ui} />
              <Route path="*" element={<p>elsewhere</p>} />
            </Routes>
          </div>
          <LocationSpy />
        </MemoryRouter>
      </CoachApiContext.Provider>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

export function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
  onlineManager.setOnline(online);
}
