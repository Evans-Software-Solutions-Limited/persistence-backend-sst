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
  ClientProfileDetail,
  ClientSettings,
  CoachForm,
  FormSchedule,
  MealPlan,
  Roster,
} from "../api/types";
import { CoachApiContext } from "../hooks/coachQueries";

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
