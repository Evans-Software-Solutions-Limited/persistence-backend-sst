import { apiBase } from "@/admin/adminApi";
import { endSession, getAccessToken } from "./coachAuth";
import type {
  AcceptPreview,
  ClientProfile,
  ClientProfileDetail,
  ClientSettings,
  CoachForm,
  CoachProfile,
  DeclarationStatus,
  FormSchedule,
  IssuedInvite,
  MealPlan,
  NewProfileInput,
  Roster,
  SettingsPatch,
  SetupItem,
  SetupSection,
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

export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function coachFetch<T>(
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    endSession();
    throw new CoachApiError(401, { message: "Signed out" });
  }
  let res: Response;
  try {
    res = await fetchImpl(`${apiBase()}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new CoachApiError(0, null, true);
  }
  if (res.status === 401) endSession();
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  if (!res.ok) throw new CoachApiError(res.status, body);
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
};

export type CoachApi = typeof coachApi;
