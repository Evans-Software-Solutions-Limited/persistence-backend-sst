import {
  PROFILE_PAGE_STALE_AFTER_MS,
  getProfilePageQuery,
  refreshProfilePage,
} from "@/application/queries/profile-page.query";
import { isProfilePageStale } from "@/domain/models/profilePage";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { PROFILE_PAGE_FIXTURE } from "@/adapters/api/__tests__/fixtures/profile-page.fixture";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { updateProfileCommand } from "@/application/commands/update-profile.command";

describe("profile-page.query", () => {
  const USER_ID = "user-1";

  describe("getProfilePageQuery", () => {
    it("returns null + stale=true when cache is empty", () => {
      const storage = new InMemoryStorageAdapter();
      const result = getProfilePageQuery(storage, USER_ID);
      expect(result.payload).toBeNull();
      expect(result.isStale).toBe(true);
      expect(result.cached).toBeNull();
    });

    it("returns cached payload + stale=false when fresh", () => {
      const storage = new InMemoryStorageAdapter();
      storage.cacheProfilePage(USER_ID, PROFILE_PAGE_FIXTURE);
      const result = getProfilePageQuery(storage, USER_ID);
      expect(result.payload).toEqual(PROFILE_PAGE_FIXTURE);
      expect(result.isStale).toBe(false);
      expect(result.cached).not.toBeNull();
    });

    it("marks cache stale when older than PROFILE_PAGE_STALE_AFTER_MS", () => {
      const storage = new InMemoryStorageAdapter();
      storage.cacheProfilePage(USER_ID, PROFILE_PAGE_FIXTURE);
      const row = storage.getCachedProfilePage(USER_ID);
      expect(row).not.toBeNull();

      const now =
        Date.parse(row!.syncedAt) + PROFILE_PAGE_STALE_AFTER_MS + 1_000;
      const result = getProfilePageQuery(storage, USER_ID, () => now);
      expect(result.payload).toEqual(PROFILE_PAGE_FIXTURE);
      expect(result.isStale).toBe(true);
    });
  });

  describe("refreshProfilePage", () => {
    it("writes through to storage on API success", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      api.profilePage = PROFILE_PAGE_FIXTURE;
      const result = await refreshProfilePage(api, storage, USER_ID);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(PROFILE_PAGE_FIXTURE);
      expect(storage.getCachedProfilePage(USER_ID)?.payload).toEqual(
        PROFILE_PAGE_FIXTURE,
      );
    });

    it("leaves cache untouched on API failure", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      api.profilePage = PROFILE_PAGE_FIXTURE;
      api.shouldFail = true;
      const result = await refreshProfilePage(api, storage, USER_ID);
      expect(result.ok).toBe(false);
      expect(storage.getCachedProfilePage(USER_ID)).toBeNull();
    });

    it("keeps a queued template preference over an older server response", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      const serverPayload = {
        ...PROFILE_PAGE_FIXTURE,
        profile: {
          ...PROFILE_PAGE_FIXTURE.profile,
          showTemplateWorkouts: true,
        },
      };
      storage.cacheProfilePage(USER_ID, serverPayload);
      updateProfileCommand(
        { storage, userId: USER_ID },
        { showTemplateWorkouts: false },
      );
      api.profilePage = serverPayload;

      const result = await refreshProfilePage(api, storage, USER_ID);

      expect(result.ok && result.value.profile.showTemplateWorkouts).toBe(
        false,
      );
      expect(
        storage.getCachedProfilePage(USER_ID)?.payload.profile
          .showTemplateWorkouts,
      ).toBe(false);
    });

    it("does not apply a permanently failed preference over server truth", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      const serverPayload = {
        ...PROFILE_PAGE_FIXTURE,
        profile: {
          ...PROFILE_PAGE_FIXTURE.profile,
          showTemplateWorkouts: true,
        },
      };
      storage.cacheProfilePage(USER_ID, serverPayload);
      updateProfileCommand(
        { storage, userId: USER_ID },
        { showTemplateWorkouts: false },
      );
      const [failed] = storage.getPendingMutations();
      storage.patchQueueEntryForTest(failed.id, {
        status: "permanently_failed",
      });
      api.profilePage = serverPayload;

      const result = await refreshProfilePage(api, storage, USER_ID);

      expect(result.ok && result.value.profile.showTemplateWorkouts).toBe(true);
      expect(
        storage.getCachedProfilePage(USER_ID)?.payload.profile
          .showTemplateWorkouts,
      ).toBe(true);
    });

    it("propagates the ApiError unchanged on failure", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      api.profilePage = PROFILE_PAGE_FIXTURE;
      api.shouldFail = true;
      api.failError = {
        kind: "api",
        code: "network",
        message: "No connection",
      };
      const result = await refreshProfilePage(api, storage, USER_ID);
      if (result.ok) throw new Error("Expected failure");
      expect(result.error.code).toBe("network");
      expect(result.error.message).toBe("No connection");
    });
  });

  describe("isProfilePageStale", () => {
    it("treats null cache as stale", () => {
      expect(isProfilePageStale(null)).toBe(true);
    });

    it("treats an unparseable syncedAt as stale", () => {
      expect(
        isProfilePageStale({
          userId: "u",
          payload: PROFILE_PAGE_FIXTURE,
          syncedAt: "not-a-date",
        }),
      ).toBe(true);
    });
  });
});

describe("offline profile intent reconciliation", () => {
  it.each([
    {
      fullName: "Updated",
      dateOfBirth: "1990-01-01",
      gender: "male",
      heightCm: 180,
      weightUnit: "lb",
      heightUnit: "ftin",
      fitnessLevel: "beginner",
      isProfilePublic: true,
      showTemplateWorkouts: false,
    },
    {
      fullName: null,
      dateOfBirth: null,
      gender: null,
      heightCm: null,
      weightUnit: "kg",
      heightUnit: "cm",
      fitnessLevel: null,
    },
    { gender: "female", fitnessLevel: "intermediate" },
    { gender: "other", fitnessLevel: "advanced" },
    { fitnessLevel: "elite" },
  ])(
    "overlays all accepted fields without changing server identity",
    async (patch) => {
      const storage = new InMemoryStorageAdapter();
      const api = new InMemoryApiAdapter();
      api.profilePage = PROFILE_PAGE_FIXTURE;
      storage.enqueueMutation({
        entityType: "profile",
        entityId: "user-1",
        operation: "update",
        endpoint: "/profile",
        method: "PATCH",
        payload: { ...patch, id: "another-user" },
      });
      const result = await refreshProfilePage(api, storage, "user-1");
      expect(result.ok && result.value.profile).toMatchObject(patch);
      expect(result.ok && result.value.profile.id).toBe(
        PROFILE_PAGE_FIXTURE.profile.id,
      );
    },
  );

  it("merges independent in-flight and later fields with last-write-wins including clears", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    api.profilePage = PROFILE_PAGE_FIXTURE;
    storage.enqueueMutation({
      entityType: "profile",
      entityId: "user-1",
      operation: "update",
      endpoint: "/profile",
      method: "PATCH",
      payload: { heightCm: 180, gender: "female" },
    });
    storage.patchQueueEntryForTest(storage.getUncompletedMutations()[0].id, {
      status: "in_flight",
    });
    storage.enqueueMutation({
      entityType: "profile",
      entityId: "user-1",
      operation: "update",
      endpoint: "/profile",
      method: "PATCH",
      payload: { gender: null },
    });
    const result = await refreshProfilePage(api, storage, "user-1");
    expect(result.ok && result.value.profile).toMatchObject({
      heightCm: 180,
      gender: null,
    });
    // Even a cache populated by an older reader must recover outstanding intent.
    storage.cacheProfilePage("user-1", PROFILE_PAGE_FIXTURE);
    expect(
      getProfilePageQuery(storage, "user-1").payload?.profile,
    ).toMatchObject({ heightCm: 180, gender: null });
  });

  it("ignores malformed, wrong-route and invalid typed fields", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    api.profilePage = PROFILE_PAGE_FIXTURE;
    for (const payload of [
      null,
      [],
      "bad",
      {
        gender: "bad",
        heightCm: "bad",
        fitnessLevel: "bad",
        fullName: 3,
        dateOfBirth: 2,
        weightUnit: "bad",
        heightUnit: "bad",
      },
    ]) {
      storage.enqueueMutation({
        entityType: "profile",
        entityId: "user-1",
        operation: "update",
        endpoint: "/profile",
        method: "PATCH",
        payload,
      });
    }
    for (const override of [
      { payload: "bad json" },
      { endpoint: "/other" },
      { method: "POST" as const },
    ]) {
      storage.enqueueMutation({
        entityType: "profile",
        entityId: "user-1",
        operation: "update",
        endpoint: "/profile",
        method: "PATCH",
        payload: { heightCm: 200 },
      });
      storage.patchQueueEntryForTest(
        storage.getUncompletedMutations().at(-1)!.id,
        override,
      );
    }
    const result = await refreshProfilePage(api, storage, "user-1");
    expect(result.ok && result.value).toEqual(PROFILE_PAGE_FIXTURE);
  });
});
