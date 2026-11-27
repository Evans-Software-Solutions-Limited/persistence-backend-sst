import { apiBase } from "@/admin/adminApi";
import {
  endSession,
  getAccessToken,
  loadSession,
  refreshStored,
} from "./coachAuth";
import type {
  AcceptPreview,
  ClientProfile,
  ClientProfileDetail,
  ClientSettings,
  ClientFormEntry,
  ClientSetupInput,
  CoachForm,
  CoachProfile,
  DeclarationStatus,
  FormResponse,
  FormSchedule,
  FormStats,
  FormQuestion,
  IssuedInvite,
  MealPlan,
  NewProfileInput,
  NewSchedule,
  SchedulePatch,
  Roster,
  SettingsPatch,
  SetupItem,
  SetupSection,
  ClientAdherence,
  ClientMealPlans,
  CoachRecipe,
  CoachSavedMeal,
  FoodResult,
  LibraryPlan,
  PlanAssignment,
  PlanInput,
  RecipeShare,
} from "./types";

/**
 * Fetch wrapper for the coach routes (PER-124). Every call carries the coach's
 * JWT; the API decides what the caller may do. Errors keep the server's
 * `code` (`revision_conflict`, `section_unavailable`, `declaration_required`…)
 * so containers can show the right state. A request that never reached the
 * server is `offline: true`.
 */
export class CoachApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly body: Record<string, unknown> | null;
  readonly offline: boolean;
  constructor(
    status: number,
    body: Record<string, unknown> | null,
    offline = false,
  ) {
    super(
      typeof body?.message === "string"
        ? body.message
        : offline
          ? "You're offline"
          : `Request failed (${status})`,
    );
    this.name = "CoachApiError";
    this.status = status;
    this.body = body;
    this.offline = offline;
    this.code =
      typeof body?.code === "string"
        ? body.code
        : typeof body?.error === "string"
          ? body.error
          : null;
  }
}

export function isCoachApiError(e: unknown): e is CoachApiError {
  return e instanceof CoachApiError;
}

/**
 * PER-146: the API refuses every coach route without an active coach
 * subscription (403 with this code), including when one lapses mid-session.
 */
export const COACH_SUBSCRIPTION_REQUIRED = "coach_subscription_required";

export function isCoachSubscriptionRequired(e: unknown): boolean {
  return (
    isCoachApiError(e) &&
    e.status === 403 &&
    e.code === COACH_SUBSCRIPTION_REQUIRED
  );
}

const subscriptionRequiredListeners = new Set<() => void>();

/**
 * Called whenever any coach call is refused for want of a coach subscription,
 * so the workspace can leave for the coach plans page. Returns an unsubscribe.
 */
export function onCoachSubscriptionRequired(listener: () => void): () => void {
  subscriptionRequiredListeners.add(listener);
  return () => {
    subscriptionRequiredListeners.delete(listener);
  };
}

export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** The sign-in couldn't be checked (Supabase Auth unreachable): try again. */
export const AUTH_UNAVAILABLE = "auth_unavailable";

export async function coachFetch<T>(
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const token = await getAccessToken(fetchImpl);
  if (!token) {
    endSession();
    throw new CoachApiError(401, { message: "Signed out" });
  }
  const send = async (bearer: string): Promise<Response> => {
    try {
      return await fetchImpl(`${apiBase()}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearer}`,
          ...(init.headers ?? {}),
        },
      });
    } catch {
      throw new CoachApiError(0, null, true);
    }
  };
  let res = await send(token);
  if (res.status === 401) {
    // A 401 can mean an expired token, or that the API couldn't check a good
    // one while Supabase Auth is down. Only GoTrue refusing the refresh token
    // ends the session; an outage keeps it and asks the coach to try again.
    let current = loadSession();
    if (current && current.accessToken !== token) {
      // Another call already refreshed while this request was out: try its
      // token first, and only refresh again if that is refused too.
      res = await send(current.accessToken);
      if (res.status !== 401) return readBody<T>(res);
      current = loadSession();
    }
    const refreshed = current
      ? await refreshStored(current, fetchImpl)
      : ({ kind: "signedOut" } as const);
    if (refreshed.kind === "unavailable") {
      throw new CoachApiError(503, {
        code: AUTH_UNAVAILABLE,
        message:
          "We couldn't confirm your sign-in just now. Try again in a moment.",
      });
    }
    if (refreshed.kind === "signedOut") {
      // Refused by GoTrue (refreshStored has ended the session), or the coach
      // signed out while the refresh ran: never bring it back.
      throw new CoachApiError(401, { message: "Signed out" });
    }
    res = await send(refreshed.session.accessToken);
    if (res.status === 401) {
      // A token GoTrue has just issued (or another call just stored) was
      // refused: the API couldn't check it (e.g. its JWKS fetch failed), not
      // a sign-out. A real revocation shows up as rejected on the next refresh.
      throw new CoachApiError(503, {
        code: AUTH_UNAVAILABLE,
        message:
          "We couldn't confirm your sign-in just now. Try again in a moment.",
      });
    }
  }
  return readBody<T>(res);
}

async function readBody<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const error = new CoachApiError(res.status, body);
    if (isCoachSubscriptionRequired(error)) {
      for (const listener of [...subscriptionRequiredListeners]) listener();
    }
    throw error;
  }
  return body as T;
}

const json = (method: string, body?: unknown, headers?: HeadersInit) => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  ...(headers ? { headers } : {}),
});

type Data<T> = { data: T };

export const coachApi = {
  profile: async () => (await coachFetch<Data<CoachProfile>>("/profile")).data,

  roster: () => coachFetch<Roster>("/trainers/me/clients"),

  createProfile: async (input: NewProfileInput, idempotencyKey: string) =>
    (
      await coachFetch<Data<ClientProfile>>(
        "/trainers/me/client-profiles",
        json("POST", input, { "Idempotency-Key": idempotencyKey }),
      )
    ).data,

  profileDetail: async (id: string) =>
    (
      await coachFetch<Data<ClientProfileDetail>>(
        `/trainers/me/client-profiles/${encodeURIComponent(id)}`,
      )
    ).data,

  patchProfile: async (
    id: string,
    fields: Partial<NewProfileInput>,
    expectedRevision?: number,
  ) =>
    (
      await coachFetch<Data<ClientProfile>>(
        `/trainers/me/client-profiles/${encodeURIComponent(id)}`,
        json("PATCH", { ...fields, expectedRevision }),
      )
    ).data,

  replaceSection: async (
    id: string,
    section: SetupSection,
    items: SetupItem[],
    expectedRevision?: number,
  ) =>
    (
      await coachFetch<Data<ClientProfileDetail>>(
        `/trainers/me/client-profiles/${encodeURIComponent(id)}/setup/${section}`,
        json("PUT", {
          items: items.map((i) => ({
            refId: i.refId,
            config: i.config,
            sortOrder: i.sortOrder,
          })),
          expectedRevision,
        }),
      )
    ).data,

  copyFrom: async (
    id: string,
    source: { sourceClientId: string } | { sourceProfileId: string },
  ) =>
    (
      await coachFetch<Data<ClientProfileDetail>>(
        `/trainers/me/client-profiles/${encodeURIComponent(id)}/setup/copy-from`,
        json("POST", source),
      )
    ).data,

  preview: async (id: string) =>
    (
      await coachFetch<Data<AcceptPreview>>(
        `/trainers/me/client-profiles/${encodeURIComponent(id)}/preview`,
      )
    ).data,

  issueInvite: async (id: string, idempotencyKey: string) =>
    (
      await coachFetch<Data<IssuedInvite>>(
        `/trainers/me/client-profiles/${encodeURIComponent(id)}/invite`,
        json("POST", undefined, { "Idempotency-Key": idempotencyKey }),
      )
    ).data,

  cancelInvite: async (id: string) => {
    await coachFetch<null>(
      `/trainers/me/client-profiles/${encodeURIComponent(id)}/invite`,
      json("DELETE"),
    );
  },

  deleteProfile: async (id: string) => {
    await coachFetch<null>(
      `/trainers/me/client-profiles/${encodeURIComponent(id)}`,
      json("DELETE"),
    );
  },

  forms: async () =>
    (await coachFetch<Data<{ forms: CoachForm[] }>>("/trainers/me/forms")).data
      .forms,

  formSchedules: async () =>
    (
      await coachFetch<Data<{ schedules: FormSchedule[] }>>(
        "/trainers/me/form-schedules",
      )
    ).data.schedules,

  // ─── Forms (PER-129, C10 and C3.3) ────────────────────────────────────────

  templates: async () =>
    (
      await coachFetch<Data<{ templates?: CoachForm[] }>>(
        "/trainers/me/forms?include=templates",
      )
    ).data.templates ?? [],

  createFromTemplate: async (templateKey: string, idempotencyKey: string) =>
    (
      await coachFetch<Data<CoachForm>>(
        "/trainers/me/forms",
        json(
          "POST",
          { fromTemplateKey: templateKey },
          { "Idempotency-Key": idempotencyKey },
        ),
      )
    ).data,

  formStats: async () =>
    (await coachFetch<Data<FormStats>>("/trainers/me/forms/stats")).data,

  createForm: async (
    input: {
      title: string;
      description?: string | null;
      questions: FormQuestion[];
    },
    idempotencyKey: string,
  ) =>
    (
      await coachFetch<Data<CoachForm>>(
        "/trainers/me/forms",
        json("POST", input, { "Idempotency-Key": idempotencyKey }),
      )
    ).data,

  patchForm: async (
    id: string,
    patch: {
      title?: string;
      description?: string | null;
      questions?: FormQuestion[];
    },
    expectedRevision?: number,
  ) =>
    (
      await coachFetch<Data<CoachForm>>(
        `/trainers/me/forms/${encodeURIComponent(id)}`,
        json("PATCH", { ...patch, expectedRevision }),
      )
    ).data,

  archiveForm: async (id: string) => {
    await coachFetch<null>(
      `/trainers/me/forms/${encodeURIComponent(id)}`,
      json("DELETE"),
    );
  },

  createSchedule: async (input: NewSchedule, idempotencyKey: string) =>
    (
      await coachFetch<Data<FormSchedule>>(
        "/trainers/me/form-schedules",
        json("POST", input, { "Idempotency-Key": idempotencyKey }),
      )
    ).data,

  patchSchedule: async (
    id: string,
    patch: SchedulePatch,
    expectedRevision?: number,
  ) =>
    (
      await coachFetch<Data<FormSchedule>>(
        `/trainers/me/form-schedules/${encodeURIComponent(id)}`,
        json("PATCH", { ...patch, expectedRevision }),
      )
    ).data,

  clientForms: async (clientId: string) =>
    (
      await coachFetch<Data<ClientFormEntry[]>>(
        `/trainers/me/clients/${encodeURIComponent(clientId)}/forms`,
      )
    ).data,

  clientFormSetup: async (
    clientId: string,
    formId: string,
    input: ClientSetupInput,
  ) =>
    (
      await coachFetch<Data<ClientFormEntry | null>>(
        `/trainers/me/clients/${encodeURIComponent(clientId)}/forms/${encodeURIComponent(formId)}/setup`,
        json("PUT", input),
      )
    ).data,

  responses: async (clientId: string, cursor?: string) => {
    const q = new URLSearchParams({ limit: "50" });
    if (cursor) q.set("cursor", cursor);
    return coachFetch<{ data: FormResponse[]; nextCursor: string | null }>(
      `/trainers/me/clients/${encodeURIComponent(clientId)}/form-responses?${q}`,
    );
  },

  reviewResponse: async (
    clientId: string,
    responseId: string,
    replyText?: string,
  ) =>
    (
      await coachFetch<Data<FormResponse>>(
        `/trainers/me/clients/${encodeURIComponent(clientId)}/form-responses/${encodeURIComponent(responseId)}/review`,
        json("POST", replyText === undefined ? {} : { replyText }),
      )
    ).data,

  mealPlans: async () =>
    (await coachFetch<Data<{ plans: MealPlan[] }>>("/trainers/me/meal-plans"))
      .data.plans,

  settings: async (clientId: string) =>
    (
      await coachFetch<Data<ClientSettings>>(
        `/trainers/me/clients/${encodeURIComponent(clientId)}/settings`,
      )
    ).data,

  patchSettings: async (
    clientId: string,
    patch: SettingsPatch,
    expectedRevision?: number,
  ) =>
    (
      await coachFetch<Data<ClientSettings>>(
        `/trainers/me/clients/${encodeURIComponent(clientId)}/settings`,
        json("PATCH", { ...patch, expectedRevision }),
      )
    ).data,

  endCoaching: async (clientId: string) => {
    await coachFetch<unknown>(
      `/trainers/me/clients/${encodeURIComponent(clientId)}`,
      json("DELETE"),
    );
  },

  declaration: async () =>
    (await coachFetch<Data<DeclarationStatus>>("/trainers/me/declaration"))
      .data,

  acceptDeclaration: async (
    statementVersion: string,
    statementTextHash: string | undefined,
    idempotencyKey: string,
  ) =>
    (
      await coachFetch<Data<DeclarationStatus>>(
        "/trainers/me/declaration",
        json(
          "POST",
          { statementVersion, statementTextHash },
          { "Idempotency-Key": idempotencyKey },
        ),
      )
    ).data,

  // ─── PER-135: meal-plan library (C1) and the Nutrition tab (C3.2) ─────────

  libraryPlans: async () =>
    (
      await coachFetch<Data<{ plans: LibraryPlan[] }>>(
        "/trainers/me/meal-plans",
      )
    ).data.plans,

  createPlan: async (input: PlanInput, idempotencyKey: string) =>
    (
      await coachFetch<Data<LibraryPlan>>(
        "/trainers/me/meal-plans",
        json("POST", input, { "Idempotency-Key": idempotencyKey }),
      )
    ).data,

  replacePlan: async (id: string, input: PlanInput, expectedRevision: number) =>
    (
      await coachFetch<Data<LibraryPlan>>(
        `/trainers/me/meal-plans/${encodeURIComponent(id)}`,
        json("PUT", { ...input, expectedRevision }),
      )
    ).data,

  archivePlan: async (id: string) => {
    await coachFetch<null>(
      `/trainers/me/meal-plans/${encodeURIComponent(id)}`,
      json("DELETE"),
    );
  },

  clientMealPlans: async (clientId: string) =>
    (
      await coachFetch<Data<ClientMealPlans>>(
        `/trainers/me/clients/${encodeURIComponent(clientId)}/meal-plans`,
      )
    ).data,

  assignPlan: async (
    clientId: string,
    planId: string,
    note: string | null,
    idempotencyKey: string,
  ) =>
    (
      await coachFetch<Data<PlanAssignment>>(
        `/trainers/me/clients/${encodeURIComponent(clientId)}/meal-plans`,
        json("POST", { planId, note }, { "Idempotency-Key": idempotencyKey }),
      )
    ).data,

  patchAssignmentNote: async (
    clientId: string,
    assignmentId: string,
    note: string | null,
  ) =>
    (
      await coachFetch<Data<PlanAssignment>>(
        `/trainers/me/clients/${encodeURIComponent(clientId)}/meal-plans/${encodeURIComponent(assignmentId)}`,
        json("PATCH", { note }),
      )
    ).data,

  removeAssignment: async (clientId: string, assignmentId: string) => {
    await coachFetch<null>(
      `/trainers/me/clients/${encodeURIComponent(clientId)}/meal-plans/${encodeURIComponent(assignmentId)}`,
      json("DELETE"),
    );
  },

  shareRecipe: async (clientId: string, recipeId: string) =>
    (
      await coachFetch<Data<RecipeShare>>(
        `/trainers/me/clients/${encodeURIComponent(clientId)}/recipes/${encodeURIComponent(recipeId)}/share`,
        json("POST"),
      )
    ).data,

  recipes: async () => (await coachFetch<Data<CoachRecipe[]>>("/recipes")).data,

  savedMeals: async () =>
    (await coachFetch<Data<CoachSavedMeal[]>>("/meals")).data,

  searchFoods: async (query: string) =>
    (
      await coachFetch<Data<FoodResult[]>>(
        `/foods?${new URLSearchParams({ query })}`,
      )
    ).data,

  clientAdherence: async (clientId: string) =>
    (
      await coachFetch<Data<ClientAdherence>>(
        `/trainers/me/clients/${encodeURIComponent(clientId)}/adherence?window=7d`,
      )
    ).data,
};

export type CoachApi = typeof coachApi;
