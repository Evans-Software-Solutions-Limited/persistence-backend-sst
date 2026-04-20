import { InMemoryApiAdapter } from "./in-memory-api.adapter";
import type { Exercise } from "@/domain/models/exercise";
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

  describe("exercises", () => {
    const seedExercise = (overrides: Partial<Exercise> = {}): Exercise => ({
      id: overrides.id ?? `seed-${api.exercises.length + 1}`,
      name: "Bench Press",
      description: null,
      instructions: null,
      category: "strength",
      difficulty: "intermediate",
      primaryMuscleGroups: ["chest"],
      secondaryMuscleGroups: [],
      equipment: ["barbell"],
      videoUrl: null,
      thumbnailUrl: null,
      isCustom: false,
      createdBy: null,
      ...overrides,
    });

    it("returns all exercises paginated when no filters provided", async () => {
      api.exercises.push(seedExercise({ id: "e1", name: "Bench Press" }));
      api.exercises.push(seedExercise({ id: "e2", name: "Squat" }));

      const result = await api.getExercises();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data).toHaveLength(2);
        expect(result.value.hasMore).toBe(false);
        expect(result.value.cursor).toBeNull();
      }
    });

    it("applies filters when fetching exercises", async () => {
      api.exercises.push(seedExercise({ id: "e1", name: "Bench Press" }));
      api.exercises.push(
        seedExercise({
          id: "e2",
          name: "Squat",
          primaryMuscleGroups: ["quadriceps"],
          equipment: ["barbell"],
        }),
      );

      const result = await api.getExercises({ search: "bench" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data).toHaveLength(1);
        expect(result.value.data[0].id).toBe("e1");
      }
    });

    it("propagates failure flag on getExercises", async () => {
      api.shouldFail = true;
      const result = await api.getExercises();
      expect(result.ok).toBe(false);
    });

    it("gets exercise by id", async () => {
      api.exercises.push(seedExercise({ id: "e1" }));
      const result = await api.getExercise("e1");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.id).toBe("e1");
    });

    it("returns not_found when exercise missing", async () => {
      const result = await api.getExercise("nope");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("not_found");
    });

    it("creates a custom exercise and tags it", async () => {
      const result = await api.createExercise({
        name: "Pistol Squat",
        category: "strength",
        difficulty: "advanced",
        primaryMuscleGroups: ["quadriceps"],
        equipment: ["bodyweight"],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.isCustom).toBe(true);
        expect(result.value.createdBy).toBe("test-user");
        expect(api.exercises).toHaveLength(1);
      }
    });

    it("does not persist on create when shouldFail is true", async () => {
      api.shouldFail = true;
      const result = await api.createExercise({
        name: "Bad",
        category: "strength",
        difficulty: "beginner",
        primaryMuscleGroups: ["chest"],
        equipment: ["barbell"],
      });
      expect(result.ok).toBe(false);
      expect(api.exercises).toHaveLength(0);
    });

    it("updates an existing exercise", async () => {
      api.exercises.push(seedExercise({ id: "e1", name: "Old" }));
      const result = await api.updateExercise("e1", { name: "New" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.name).toBe("New");
    });

    it("returns not_found when updating missing exercise", async () => {
      const result = await api.updateExercise("missing", { name: "x" });
      expect(result.ok).toBe(false);
    });

    it("propagates failure flag on update", async () => {
      api.exercises.push(seedExercise({ id: "e1" }));
      api.shouldFail = true;
      const result = await api.updateExercise("e1", { name: "x" });
      expect(result.ok).toBe(false);
    });

    it("deletes an exercise", async () => {
      api.exercises.push(seedExercise({ id: "e1" }));
      const result = await api.deleteExercise("e1");
      expect(result.ok).toBe(true);
      expect(api.exercises).toHaveLength(0);
    });
  });
});
