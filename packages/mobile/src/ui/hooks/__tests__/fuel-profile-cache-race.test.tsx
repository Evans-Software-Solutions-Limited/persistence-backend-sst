import { act, renderHook, waitFor } from "@testing-library/react-native";
import { PROFILE_PAGE_FIXTURE } from "@/adapters/api/__tests__/fixtures/profile-page.fixture";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { logMeasurementCommand } from "@/application/commands/log-measurement.command";
import { updateProfileCommand } from "@/application/commands/update-profile.command";
import { ok } from "@/shared/errors";
import { localDayISO } from "@/shared/utils";
import { useProfilePage } from "../useProfilePage";
import { useGetBodyMeasurements } from "../useGetBodyMeasurements";
import { useFuelProfileEditor } from "../useFuelProfileEditor";

let mockStorage = new InMemoryStorageAdapter();
const mockApi = { getProfilePage: jest.fn(), getBodyTrend: jest.fn() };
jest.mock("../useAdapters", () => ({
  useAdapters: () => ({ storage: mockStorage, api: mockApi, auth: {} }),
}));
jest.mock("../useAuth", () => ({
  useAuth: () => ({ session: { userId: "user-1" } }),
}));
jest.mock("@/adapters/api", () => ({
  getApiBaseUrl: () => "https://example.test",
}));
jest.mock("@/application/commands/sync.command", () => ({
  processSyncQueue: async () => {},
}));

it.each([false, true])(
  "keeps quick edits after delayed pre-save GETs and offline remount (acknowledged: %s)",
  async (acknowledged) => {
    mockStorage = new InMemoryStorageAdapter();
    jest.clearAllMocks();
    const serverProfile = {
      ...PROFILE_PAGE_FIXTURE,
      profile: { ...PROFILE_PAGE_FIXTURE.profile, heightCm: 160 },
    };
    const serverBody = [{ date: localDayISO(), weightKg: 60, bodyFat: 20 }];
    mockStorage.cacheProfilePage("user-1", serverProfile);
    mockStorage.cacheBodyTrend("user-1", serverBody);
    let finishProfile!: (
      value: ReturnType<typeof ok<typeof serverProfile>>,
    ) => void;
    let finishBody!: (value: ReturnType<typeof ok<typeof serverBody>>) => void;
    mockApi.getProfilePage.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishProfile = resolve;
        }),
    );
    mockApi.getBodyTrend.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishBody = resolve;
        }),
    );
    const screen = renderHook(() => {
      const profile = useProfilePage(false);
      const body = useGetBodyMeasurements(30, false);
      const edit = useFuelProfileEditor(
        profile.payload?.profile ?? null,
        body.data?.at(-1)?.weightKg ?? null,
      );
      return { profile, body, edit };
    });
    let pendingProfile!: Promise<void>;
    let pendingBody!: Promise<boolean>;
    act(() => {
      pendingProfile = screen.result.current.profile.refresh();
      pendingBody = screen.result.current.body.refresh();
    });
    await waitFor(() => expect(mockApi.getBodyTrend).toHaveBeenCalled());
    act(() => screen.result.current.edit.open("height"));
    act(() => screen.result.current.edit.change("180"));
    await act(async () => screen.result.current.edit.save());
    act(() => screen.result.current.edit.open("weight"));
    act(() => screen.result.current.edit.change("80"));
    await act(async () => screen.result.current.edit.save());
    if (acknowledged) {
      for (const entry of mockStorage.getUncompletedMutations())
        mockStorage.markMutationCompleted(entry.id);
      expect(mockStorage.getUncompletedMutations()).toHaveLength(0);
    }
    await act(async () => {
      finishProfile(ok(serverProfile));
      finishBody(ok(serverBody));
      await Promise.all([pendingProfile, pendingBody]);
    });
    expect(screen.result.current.profile.payload?.profile.heightCm).toBe(180);
    expect(screen.result.current.body.data?.at(-1)).toMatchObject({
      weightKg: 80,
      bodyFat: 20,
    });
    expect(
      mockStorage.getCachedProfilePage("user-1")?.payload.profile.heightCm,
    ).toBe(180);
    expect(mockStorage.getCachedBodyTrend("user-1").at(-1)?.weightKg).toBe(80);
    screen.unmount();
    const offline = renderHook(() => ({
      profile: useProfilePage(false),
      body: useGetBodyMeasurements(30, false),
    }));
    expect(offline.result.current.profile.payload?.profile.heightCm).toBe(180);
    expect(offline.result.current.body.data?.at(-1)?.weightKg).toBe(80);
    expect(mockApi.getProfilePage).toHaveBeenCalledTimes(1);
    expect(mockApi.getBodyTrend).toHaveBeenCalledTimes(1);
    expect(mockStorage.getUncompletedMutations()).toHaveLength(
      acknowledged ? 0 : 2,
    );
  },
);

it("keeps profile intent queued before GET when it is acknowledged during that request", async () => {
  mockStorage = new InMemoryStorageAdapter();
  jest.clearAllMocks();
  const server = {
    ...PROFILE_PAGE_FIXTURE,
    profile: { ...PROFILE_PAGE_FIXTURE.profile, heightCm: 160 },
  };
  mockStorage.cacheProfilePage("user-1", server);
  updateProfileCommand(
    { storage: mockStorage, userId: "user-1" },
    { heightCm: 180 },
  );
  let finish!: (value: ReturnType<typeof ok<typeof server>>) => void;
  mockApi.getProfilePage.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const screen = renderHook(() => useProfilePage(false));
  let pending!: Promise<void>;
  act(() => {
    pending = screen.result.current.refresh();
  });
  const [entry] = mockStorage.getUncompletedMutations();
  mockStorage.markMutationCompleted(entry.id);
  await act(async () => {
    finish(ok(server));
    await pending;
  });
  expect(screen.result.current.payload?.profile.heightCm).toBe(180);
  screen.unmount();
  const remount = renderHook(() => useProfilePage(false));
  expect(remount.result.current.payload?.profile.heightCm).toBe(180);
});

it("keeps an in-flight weight queued before GET when another drain acknowledges it", async () => {
  mockStorage = new InMemoryStorageAdapter();
  jest.clearAllMocks();
  const server = [{ date: localDayISO(), weightKg: 60, bodyFat: 20 }];
  mockStorage.cacheBodyTrend("user-1", server);
  logMeasurementCommand(
    { storage: mockStorage, userId: "user-1", day: localDayISO() },
    { weightKg: 80 },
  );
  const [entry] = mockStorage.getUncompletedMutations();
  mockStorage.patchQueueEntryForTest(entry.id, { status: "in_flight" });
  let finish!: (value: ReturnType<typeof ok<typeof server>>) => void;
  mockApi.getBodyTrend.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const screen = renderHook(() => useGetBodyMeasurements(30, false));
  let pending!: Promise<boolean>;
  act(() => {
    pending = screen.result.current.refresh();
  });
  await waitFor(() => expect(mockApi.getBodyTrend).toHaveBeenCalled());
  mockStorage.markMutationCompleted(entry.id);
  await act(async () => {
    finish(ok(server));
    await pending;
  });
  expect(screen.result.current.data?.at(-1)?.weightKg).toBe(80);
  screen.unmount();
  const remount = renderHook(() => useGetBodyMeasurements(30, false));
  expect(remount.result.current.data?.at(-1)?.weightKg).toBe(80);
});
