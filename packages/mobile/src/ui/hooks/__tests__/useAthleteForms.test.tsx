import { act, renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { AthleteFormRequest } from "@/domain/models/athleteForms";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  readFormPhoto,
  useAthleteFormActions,
  useAthleteForms,
} from "@/ui/hooks/useAthleteForms";
import { processSyncQueue } from "@/application/commands/sync.command";

jest.mock("@/lib/sentry", () => ({ captureSyncFailure: jest.fn() }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: jest.fn(async () => ({ uri: "file://resized.jpg" })),
  SaveFormat: { JPEG: "jpeg" },
}));
jest.mock("@/application/commands/sync.command", () => ({
  processSyncQueue: jest.fn(async () => undefined),
}));

const USER = "athlete-1";

const REQUEST: AthleteFormRequest = {
  id: "req-1",
  formId: "f",
  title: "Weekly check-in",
  description: null,
  coach: { id: "ellie", name: "Ellie Hart" },
  trigger: "weekly",
  periodKey: "p",
  sentAt: "2026-11-23T09:00:00Z",
  dueAt: null,
  closesAt: null,
  status: "pending",
  late: false,
  version: { id: "v", version: 1, questions: [] },
};

function setup(signedIn = true) {
  const api = new InMemoryApiAdapter();
  api.formRequests = { requests: [REQUEST], asOf: "a" };
  const storage = new InMemoryStorageAdapter();
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: USER,
    email: "a@example.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    getSession: jest.fn(async () => ok(signedIn ? session : null)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(signedIn ? session : null);
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
    netInfo: {} as Adapters["netInfo"],
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
  );
  return { api, storage, wrapper };
}

describe("useAthleteForms", () => {
  it("reads the list, caches it, and sees local writes at once", async () => {
    const { storage, wrapper } = setup();
    const forms = renderHook(() => useAthleteForms(), { wrapper });
    const actions = renderHook(() => useAthleteFormActions(), { wrapper });
    await act(async () => {});
    expect(forms.result.current.requests.map((r) => r.id)).toEqual(["req-1"]);
    expect(storage.getCachedFormRequests(USER)?.requests).toHaveLength(1);

    await act(async () => {
      actions.result.current.markIntroSeen([REQUEST]);
    });
    expect(forms.result.current.locals[0]?.introSeen).toBe(true);

    await act(async () => {
      actions.result.current.saveDraft(REQUEST, { q0: 3 }, 0);
      actions.result.current.queueSend(REQUEST, { q0: 3 }, { energy: 3 });
    });
    expect(forms.result.current.locals[0]?.submittedAt).not.toBeNull();
    expect(processSyncQueue).toHaveBeenCalled();
  });

  it("a failed drain is logged, not thrown", async () => {
    (processSyncQueue as jest.Mock).mockRejectedValueOnce(new Error("boom"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { wrapper } = setup();
    const actions = renderHook(() => useAthleteFormActions(), { wrapper });
    await act(async () => {});
    await act(async () => {
      actions.result.current.queueSend(REQUEST, {}, {});
    });
    expect(spy).toHaveBeenCalledWith(
      "[useAthleteFormActions] queue flush failed:",
      expect.any(Error),
    );
    spy.mockRestore();
  });

  it("signed out: nothing is written or sent", async () => {
    const { storage, api, wrapper } = setup(false);
    const actions = renderHook(() => useAthleteFormActions(), { wrapper });
    const forms = renderHook(() => useAthleteForms(), { wrapper });
    await act(async () => {});
    actions.result.current.saveDraft(REQUEST, {}, 0);
    actions.result.current.markIntroSeen([REQUEST]);
    actions.result.current.queueSend(REQUEST, {}, {});
    const sent = await actions.result.current.sendNow(
      REQUEST,
      {},
      [],
      () => ({}),
    );
    expect(sent.outcome).toEqual({ kind: "failed", reason: "network" });
    expect(storage.getLocalFormStates(USER)).toEqual([]);
    expect(api.submitFormResponseCalls).toEqual([]);
    expect(forms.result.current.locals).toEqual([]);
  });

  it("readFormPhoto: a JPEG blob, and an empty file is an error", async () => {
    (globalThis as Record<string, unknown>).fetch = jest.fn(async () => ({
      blob: async () => ({ size: 10 }),
    }));
    await expect(readFormPhoto("file://a.heic")).resolves.toEqual({ size: 10 });
    (globalThis as Record<string, unknown>).fetch = jest.fn(async () => ({
      blob: async () => ({ size: 0 }),
    }));
    await expect(readFormPhoto("file://a.heic")).rejects.toThrow("empty");
  });
});
