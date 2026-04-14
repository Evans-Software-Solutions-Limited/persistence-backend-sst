import { InMemoryApiAdapter } from "./in-memory-api.adapter";
import type { ApiProfile } from "@/domain/ports/api.port";

describe("InMemoryApiAdapter", () => {
  let api: InMemoryApiAdapter;

  beforeEach(() => {
    api = new InMemoryApiAdapter();
  });

  describe("healthCheck", () => {
    it("returns ok status", async () => {
      const result = await api.healthCheck();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("ok");
      }
    });

    it("returns error when shouldFail is true", async () => {
      api.shouldFail = true;
      const result = await api.healthCheck();
      expect(result.ok).toBe(false);
    });
  });

  describe("workouts CRUD", () => {
    it("creates and retrieves a workout", async () => {
      const createResult = await api.createWorkout({ name: "Push Day" });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const listResult = await api.getWorkouts();
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        expect(listResult.value).toHaveLength(1);
        expect(listResult.value[0].name).toBe("Push Day");
      }
    });

    it("deletes a workout", async () => {
      await api.createWorkout({ name: "Push Day" });
      const listBefore = await api.getWorkouts();
      if (listBefore.ok) {
        await api.deleteWorkout(listBefore.value[0].id);
      }

      const listAfter = await api.getWorkouts();
      if (listAfter.ok) {
        expect(listAfter.value).toHaveLength(0);
      }
    });
  });

  describe("profile", () => {
    it("returns not found when no profile exists", async () => {
      const result = await api.getProfile();
      expect(result.ok).toBe(false);
    });

    it("returns profile when one exists", async () => {
      const profile: ApiProfile = {
        id: "u1",
        email: "test@test.com",
        fullName: "Test User",
        role: "user",
        fitnessLevel: "intermediate",
        avatarUrl: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      api.profiles.push(profile);

      const result = await api.getProfile();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.email).toBe("test@test.com");
      }
    });
  });

  describe("sessions", () => {
    it("creates a session", async () => {
      const result = await api.createSession({ name: "Morning workout" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe("Morning workout");
        expect(result.value.status).toBe("in_progress");
      }
    });
  });

  describe("goals", () => {
    it("creates and lists goals", async () => {
      await api.createGoal({ goalTypeId: "strength" });
      const result = await api.getGoals();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
      }
    });
  });
});
