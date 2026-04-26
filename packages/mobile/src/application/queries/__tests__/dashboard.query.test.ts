import {
  DASHBOARD_STALE_AFTER_MS,
  getDashboardQuery,
  refreshDashboard,
} from "@/application/queries/dashboard.query";
import { isDashboardStale } from "@/domain/models/dashboard";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { DASHBOARD_FIXTURE } from "@/adapters/api/__tests__/fixtures/dashboard.fixture";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";

describe("dashboard.query", () => {
  const USER_ID = "user-1";

  describe("getDashboardQuery", () => {
    it("returns null + stale=true when cache is empty", () => {
      const storage = new InMemoryStorageAdapter();
      const result = getDashboardQuery(storage, USER_ID);
      expect(result.payload).toBeNull();
      expect(result.isStale).toBe(true);
      expect(result.cached).toBeNull();
    });

    it("returns cached payload + stale=false when fresh", () => {
      const storage = new InMemoryStorageAdapter();
      storage.cacheDashboard(USER_ID, DASHBOARD_FIXTURE);
      const result = getDashboardQuery(storage, USER_ID);
      expect(result.payload).toEqual(DASHBOARD_FIXTURE);
      expect(result.isStale).toBe(false);
      expect(result.cached).not.toBeNull();
    });

    it("marks cache stale when older than DASHBOARD_STALE_AFTER_MS", () => {
      const storage = new InMemoryStorageAdapter();
      storage.cacheDashboard(USER_ID, DASHBOARD_FIXTURE);
      const row = storage.getCachedDashboard(USER_ID);
      expect(row).not.toBeNull();

      // Advance the clock past the TTL.
      const now = Date.parse(row!.syncedAt) + DASHBOARD_STALE_AFTER_MS + 1_000;
      const result = getDashboardQuery(storage, USER_ID, () => now);
      expect(result.payload).toEqual(DASHBOARD_FIXTURE);
      expect(result.isStale).toBe(true);
    });
  });

  describe("refreshDashboard", () => {
    it("writes through to storage on API success", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      api.dashboard = DASHBOARD_FIXTURE;
      const result = await refreshDashboard(api, storage, USER_ID);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(DASHBOARD_FIXTURE);
      expect(storage.getCachedDashboard(USER_ID)?.payload).toEqual(
        DASHBOARD_FIXTURE,
      );
    });

    it("leaves cache untouched on API failure", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      api.dashboard = DASHBOARD_FIXTURE;
      api.shouldFail = true;
      const result = await refreshDashboard(api, storage, USER_ID);
      expect(result.ok).toBe(false);
      expect(storage.getCachedDashboard(USER_ID)).toBeNull();
    });

    it("propagates the ApiError unchanged on failure", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      api.dashboard = DASHBOARD_FIXTURE;
      api.shouldFail = true;
      api.failError = {
        kind: "api",
        code: "network",
        message: "No connection",
      };
      const result = await refreshDashboard(api, storage, USER_ID);
      if (result.ok) throw new Error("Expected failure");
      expect(result.error.code).toBe("network");
      expect(result.error.message).toBe("No connection");
    });
  });

  describe("isDashboardStale", () => {
    it("treats null cache as stale", () => {
      expect(isDashboardStale(null)).toBe(true);
    });

    it("treats an unparseable syncedAt as stale", () => {
      expect(
        isDashboardStale({
          userId: "u",
          payload: DASHBOARD_FIXTURE,
          syncedAt: "not-a-date",
        }),
      ).toBe(true);
    });
  });
});
