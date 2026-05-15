import {
  PROFILE_PAGE_STALE_AFTER_MS,
  getProfilePageQuery,
  refreshProfilePage,
} from "@/application/queries/profile-page.query";
import { isProfilePageStale } from "@/domain/models/profilePage";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { PROFILE_PAGE_FIXTURE } from "@/adapters/api/__tests__/fixtures/profile-page.fixture";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";

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
