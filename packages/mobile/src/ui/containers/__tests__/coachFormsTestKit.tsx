/**
 * PER-129 test harness for the coach forms containers: in-memory adapters, a
 * coach session, a switchable network, and a `fetch` the sync drain uses
 * (records calls; answers like the backend, or fails like no signal).
 */
import type { ReactElement } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type {
  ClientForm,
  CoachForm,
  FormResponse,
  FormSchedule,
  Question,
} from "@/domain/models/coachForms";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { renderWithTheme } from "../../../../__tests__/test-utils";

export const COACH = "coach-1";

export type Call = {
  url: string;
  method: string;
  body: Record<string, unknown>;
  key?: string;
};

/** Answers the coach-forms writes; `status` overrides the next reply. */
export class FakeFetch {
  calls: Call[] = [];
  offline = false;
  nextStatus: number | null = null;
  nextBody: unknown = null;
  replyData: (call: Call) => unknown = (call) => ({
    id: call.url.split("/").at(-1),
    ...call.body,
  });

  fetch = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ) => {
    const body = init.body
      ? (JSON.parse(init.body) as Record<string, unknown>)
      : {};
    const call = {
      url,
      method: init.method,
      body,
      key: init.headers["Idempotency-Key"],
    };
    this.calls.push(call);
    if (this.offline) throw new TypeError("Network request failed");
    const status = this.nextStatus ?? (init.method === "POST" ? 201 : 200);
    const json =
      this.nextStatus !== null ? this.nextBody : { data: this.replyData(call) };
    this.nextStatus = null;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
      text: async () => JSON.stringify(json),
    };
  };
}

export function setupCoachForms(opts: { online?: boolean } = {}) {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const netInfo = new InMemoryNetInfoAdapter(opts.online ?? true);
  const server = new FakeFetch();
  (globalThis as Record<string, unknown>).fetch = jest.fn(server.fetch);
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: COACH,
    email: "coach@example.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  const adapters: Adapters = {
    api,
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    netInfo: netInfo as unknown as Adapters["netInfo"],
  };
  const render = (ui: ReactElement) =>
    renderWithTheme(
      <AdapterProvider adapters={adapters}>{ui}</AdapterProvider>,
    );
  return { api, storage, netInfo, server, adapters, render };
}

export const q = (
  id: string,
  type: Question["type"] = "short_text",
  extra: Partial<Question> = {},
): Question => ({ id, type, prompt: id, required: true, ...extra });

export function makeForm(
  id: string,
  title: string,
  questions: Question[] = [q("q1")],
  extra: Partial<CoachForm> = {},
): CoachForm {
  return {
    id,
    title,
    description: null,
    templateKey: null,
    available: true,
    revision: 2,
    archivedAt: null,
    createdAt: "2026-11-01T09:00:00Z",
    updatedAt: "2026-11-01T09:00:00Z",
    version: {
      id: `${id}-v`,
      version: 3,
      createdAt: "2026-11-01T09:00:00Z",
      questions,
    },
    ...extra,
  };
}

export function makeSchedule(
  id: string,
  formId: string,
  trigger: FormSchedule["trigger"],
  extra: Partial<FormSchedule> = {},
): FormSchedule {
  return {
    id,
    formId,
    trigger,
    audience: "all_clients",
    weekday: trigger === "weekly" ? 7 : null,
    timeLocal:
      trigger === "weekly" ? "09:00" : trigger === "daily" ? "08:00" : null,
    dueAfterHours: trigger === "weekly" ? 27 : null,
    reminders: trigger === "weekly" ? [{ afterHours: 9 }] : [],
    status: "active",
    revision: 4,
    clients: [],
    createdAt: "2026-11-20T09:00:00Z",
    updatedAt: "2026-11-20T09:00:00Z",
    ...extra,
  };
}

export function makeClientForm(
  formId: string,
  title: string,
  state: ClientForm["state"],
  trigger: FormSchedule["trigger"] = "weekly",
): ClientForm {
  const rule = {
    scheduleId: `s-${formId}`,
    trigger,
    audience: "all_clients" as const,
    status: "active",
    clientStatus: state === "paused" ? "paused" : null,
    weekday: trigger === "weekly" ? 7 : null,
    timeLocal: trigger === "weekly" ? "09:00" : null,
    dueAfterHours: trigger === "weekly" ? 27 : null,
    reminders: [],
    override: null,
  };
  return {
    form: { id: formId, title, archivedAt: null },
    rule,
    rules: [rule],
    lastDoneAt: state === "done" ? "2026-10-25T10:14:00" : null,
    lastSentAt: "2026-10-25T09:00:00",
    pendingRequestId: null,
    state,
  };
}

export function makeResponse(
  id: string,
  submittedAt: string,
  answers: Record<string, unknown>,
  extra: Partial<FormResponse> = {},
): FormResponse {
  return {
    id,
    requestId: `req-${id}`,
    formId: "f-week",
    title: "Weekly check-in",
    trigger: "weekly",
    periodKey: "w",
    sentAt: submittedAt,
    submittedAt,
    late: false,
    answers,
    reviewedAt: null,
    replyText: null,
    version: {
      id: "v",
      version: 1,
      questions: [
        {
          id: "energy",
          type: "scale",
          prompt: "Energy this week",
          required: true,
        },
        {
          id: "sleep",
          type: "number",
          prompt: "Sleep, average",
          required: true,
          unit: "h",
        },
        { id: "stress", type: "short_text", prompt: "Stress", required: false },
      ],
    },
    ...extra,
  };
}
