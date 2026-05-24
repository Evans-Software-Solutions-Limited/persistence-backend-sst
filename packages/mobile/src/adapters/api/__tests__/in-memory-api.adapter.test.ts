import { InMemoryApiAdapter } from "./in-memory-api.adapter";
import type { Exercise } from "@/domain/models/exercise";
import type {
  ApiPersonalRecord,
  ApiProfile,
  RecordSessionInput,
} from "@/domain/ports/api.port";

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
      const createResult = await api.createWorkout({
        name: "Push Day",
        exercises: [],
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const listResult = await api.getWorkouts();
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        expect(listResult.value.workouts).toHaveLength(1);
        expect(listResult.value.workouts[0].name).toBe("Push Day");
      }
    });

    it("deletes a workout", async () => {
      await api.createWorkout({ name: "Push Day", exercises: [] });
      const listBefore = await api.getWorkouts();
      if (listBefore.ok) {
        await api.deleteWorkout(listBefore.value.workouts[0].id);
      }

      const listAfter = await api.getWorkouts();
      if (listAfter.ok) {
        expect(listAfter.value.workouts).toHaveLength(0);
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

    describe("getActiveSession", () => {
      it("returns null when no session is in_progress", async () => {
        const result = await api.getActiveSession();
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBeNull();
      });

      it("returns the in_progress session when one exists", async () => {
        await api.createSession({ name: "Active workout" });
        const result = await api.getActiveSession();
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value?.name).toBe("Active workout");
          expect(result.value?.status).toBe("in_progress");
        }
      });

      it("ignores completed / cancelled sessions", async () => {
        // Seed two non-active sessions; expect ok(null) — distinct from
        // the failure case which exercises shouldFail below.
        const created = await api.createSession({ name: "Done session" });
        if (created.ok) {
          await api.updateSession(created.value.id, { status: "completed" });
        }
        const result = await api.getActiveSession();
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBeNull();
      });

      it("propagates the failure flag", async () => {
        api.shouldFail = true;
        const result = await api.getActiveSession();
        expect(result.ok).toBe(false);
      });
    });

    describe("recordSession (bulk-record path)", () => {
      // Minimal valid payload mirroring the M3 BACKEND_BRIEF § 7 wire
      // shape — single exercise, single set. Tests at the call sites
      // can spread + extend this without re-stating boilerplate.
      const basePayload = (
        overrides: Partial<RecordSessionInput> = {},
      ): RecordSessionInput => ({
        workoutId: "workout-1",
        name: "Push Day",
        startedAt: "2026-05-04T10:00:00.000Z",
        completedAt: "2026-05-04T11:00:00.000Z",
        status: "completed",
        totalDurationSeconds: 3600,
        exercises: [
          {
            exerciseId: "ex-1",
            sortOrder: 1,
            sets: [
              {
                setNumber: 1,
                reps: 5,
                weightKg: 100,
                isCompleted: true,
                completedAt: "2026-05-04T10:05:00.000Z",
              },
            ],
          },
        ],
        ...overrides,
      });

      it("returns the recorded session with nested exercises + sets", async () => {
        const result = await api.recordSession(basePayload());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.status).toBe("completed");
        expect(result.value.exercises).toHaveLength(1);
        expect(result.value.exercises[0]?.sets).toHaveLength(1);
        expect(result.value.exercises[0]?.sets[0]?.reps).toBe(5);
        expect(result.value.exercises[0]?.sets[0]?.weightKg).toBe(100);
      });

      it("registers the recorded session in the flat sessions list (so getSession finds it)", async () => {
        // The mobile sync intent flushes recordSession then expects the
        // returned id to be queryable via getSession for the Summary
        // screen's post-flush re-fetch. This invariant is set in the
        // adapter to mirror the SST adapter's same behaviour
        // post-`POST /sessions/record`.
        const result = await api.recordSession(basePayload());
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const fetched = await api.getSession(result.value.id);
        expect(fetched.ok).toBe(true);
        if (fetched.ok) expect(fetched.value.id).toBe(result.value.id);
      });

      it("accepts a status: cancelled payload (discard flow)", async () => {
        const result = await api.recordSession(
          basePayload({ status: "cancelled", completedAt: null }),
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.status).toBe("cancelled");
      });

      it("propagates the failure flag", async () => {
        api.shouldFail = true;
        const result = await api.recordSession(basePayload());
        expect(result.ok).toBe(false);
      });
    });

    describe("createSessionExercise", () => {
      it("creates an exercise scoped to the given session id", async () => {
        const result = await api.createSessionExercise("session-99", {
          exerciseId: "ex-1",
          sortOrder: 2,
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.sessionId).toBe("session-99");
          expect(result.value.exerciseId).toBe("ex-1");
          expect(result.value.sortOrder).toBe(2);
        }
      });

      it("propagates the failure flag", async () => {
        api.shouldFail = true;
        const result = await api.createSessionExercise("s1", {
          exerciseId: "e1",
        });
        expect(result.ok).toBe(false);
      });
    });
  });

  describe("personal records", () => {
    const seedPR = (
      overrides: Partial<ApiPersonalRecord> = {},
    ): ApiPersonalRecord => ({
      id: overrides.id ?? `pr-${api.personalRecords.length + 1}`,
      userId: "test-user",
      exerciseId: "ex-1",
      recordType: "1rm",
      value: "120.50",
      setId: "set-1",
      achievedAt: "2026-05-01T10:00:00.000Z",
      ...overrides,
    });

    it("returns an empty list by default (nothing seeded)", async () => {
      const result = await api.getPersonalRecords();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual([]);
    });

    it("returns seeded records unfiltered when no params are given", async () => {
      api.personalRecords.push(seedPR({ id: "pr-1", exerciseId: "ex-1" }));
      api.personalRecords.push(seedPR({ id: "pr-2", exerciseId: "ex-2" }));
      const result = await api.getPersonalRecords();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toHaveLength(2);
    });

    it("filters by exerciseId when provided (quick-fill flow)", async () => {
      api.personalRecords.push(seedPR({ id: "pr-1", exerciseId: "ex-1" }));
      api.personalRecords.push(seedPR({ id: "pr-2", exerciseId: "ex-2" }));
      const result = await api.getPersonalRecords({ exerciseId: "ex-1" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.exerciseId).toBe("ex-1");
      }
    });

    it("filters by recordType when provided", async () => {
      api.personalRecords.push(
        seedPR({ id: "pr-1", recordType: "1rm" }),
        seedPR({ id: "pr-2", recordType: "max_reps" }),
      );
      const result = await api.getPersonalRecords({ recordType: "max_reps" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.recordType).toBe("max_reps");
      }
    });

    it("applies offset + limit slicing to the filtered set", async () => {
      // 3 PRs, limit 2 with offset 1 — expect IDs 2 and 3 in order.
      api.personalRecords.push(
        seedPR({ id: "pr-1" }),
        seedPR({ id: "pr-2" }),
        seedPR({ id: "pr-3" }),
      );
      const result = await api.getPersonalRecords({ limit: 2, offset: 1 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.map((r) => r.id)).toEqual(["pr-2", "pr-3"]);
      }
    });

    it("propagates the failure flag", async () => {
      api.personalRecords.push(seedPR());
      api.shouldFail = true;
      const result = await api.getPersonalRecords();
      expect(result.ok).toBe(false);
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

  describe("subscriptions (M7 / M10)", () => {
    it("getSubscriptionTiers returns the configured catalog", async () => {
      api.subscriptionTiers = [
        {
          tierName: "basic",
          displayName: "Basic",
          description: null,
          priceMonthly: 4.99,
          priceYearly: 49.99,
          currency: "GBP",
          features: {},
          workoutLimit: 10,
          aiAccess: true,
          aiWorkoutLimit: 1,
          gymBuddyAccess: false,
          trainerClientLimit: null,
          isTrainerTier: false,
          analyticsAccess: false,
          exportAccess: false,
          stripePriceIdMonthly: "price_basic_m",
          stripePriceIdYearly: "price_basic_y",
        },
      ];
      const result = await api.getSubscriptionTiers();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0].tierName).toBe("basic");
    });

    it("getSubscriptionTiers surfaces failure flag", async () => {
      api.shouldFail = true;
      const result = await api.getSubscriptionTiers();
      expect(result.ok).toBe(false);
    });

    it("getMySubscription returns not_found when mySubscription is null", async () => {
      const result = await api.getMySubscription();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("not_found");
    });

    it("getMySubscription returns the configured shape when set", async () => {
      api.mySubscription = {
        subscriptionId: "us_1",
        tierName: "premium",
        paymentStatus: "active",
        billingCycle: "monthly",
        startsAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2030-01-01T00:00:00.000Z",
        cancelledAt: null,
        trialEndsAt: null,
        externalSubscriptionId: "sub_1",
        tierDisplayName: "Premium",
        tierDescription: null,
        workoutLimit: null,
        aiAccess: true,
        aiWorkoutLimit: 6,
        gymBuddyAccess: true,
        trainerClientLimit: null,
        isTrainerTier: false,
        role: "user",
        hasUsedUserTrial: false,
        hasUsedTrainerTrial: false,
        isEligibleForUserTrial: true,
        isEligibleForTrainerTrial: true,
        scheduledChange: null,
      };
      const result = await api.getMySubscription();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.tierName).toBe("premium");
    });

    it("createSubscription captures input + counter + returns the canned response", async () => {
      const result = await api.createSubscription({
        tierName: "premium",
        billingCycle: "monthly",
        paymentMethodId: "pm_card",
        useTrial: true,
        platform: "ios",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toMatchObject({
        success: true,
        requiresAction: false,
        subscriptionId: "us_test_1",
        stripeSubscriptionId: "sub_test_1",
        paymentStatus: "active",
        changeType: "new",
        scheduled: false,
        effectiveAt: null,
        isTrial: false,
      });
      expect(api.createSubscriptionCalls).toBe(1);
      expect(api.lastCreateSubscriptionInput).toEqual({
        tierName: "premium",
        billingCycle: "monthly",
        paymentMethodId: "pm_card",
        useTrial: true,
        platform: "ios",
      });
    });

    it("createSubscription returns a configurable requiresAction shape", async () => {
      api.setNextCreateSubscriptionResponse({
        requiresAction: true,
        clientSecret: "pi_3ds_secret",
        paymentStatus: "incomplete",
      });
      const result = await api.createSubscription({
        tierName: "premium",
        billingCycle: "monthly",
        paymentMethodId: "pm_card",
        useTrial: true,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.requiresAction).toBe(true);
      expect(result.value.clientSecret).toBe("pi_3ds_secret");
      expect(result.value.paymentStatus).toBe("incomplete");
    });

    it("createSubscription supports M10 discriminator overrides (downgrade)", async () => {
      api.setNextCreateSubscriptionResponse({
        changeType: "downgrade",
        scheduled: true,
        effectiveAt: "2026-07-01T00:00:00.000Z",
      });
      const result = await api.createSubscription({
        tierName: "basic",
        billingCycle: "monthly",
        useTrial: false,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.changeType).toBe("downgrade");
      expect(result.value.scheduled).toBe(true);
      expect(result.value.effectiveAt).toBe("2026-07-01T00:00:00.000Z");
    });

    it("createSubscription surfaces api failure when shouldFail flips", async () => {
      api.shouldFail = true;
      const result = await api.createSubscription({
        tierName: "premium",
        billingCycle: "monthly",
        paymentMethodId: "pm_card",
        useTrial: false,
      });
      expect(result.ok).toBe(false);
    });

    it("cancelSubscription captures (subscriptionId, input) pair and counts calls", async () => {
      const result = await api.cancelSubscription("us_123", {
        cancelImmediately: true,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toMatchObject({
        success: true,
        cancelledAt: expect.any(String),
        subscriptionEndsAt: expect.any(String),
      });
      expect(api.cancelSubscriptionCalls).toBe(1);
      expect(api.lastCancelSubscription).toEqual({
        subscriptionId: "us_123",
        input: { cancelImmediately: true },
      });
    });

    it("cancelSubscription defaults the input to {} when omitted", async () => {
      await api.cancelSubscription("us_default_input");
      expect(api.lastCancelSubscription).toEqual({
        subscriptionId: "us_default_input",
        input: {},
      });
    });

    it("cancelSubscription surfaces api failure when shouldFail flips", async () => {
      api.shouldFail = true;
      const result = await api.cancelSubscription("us_123");
      expect(result.ok).toBe(false);
    });
  });
});
