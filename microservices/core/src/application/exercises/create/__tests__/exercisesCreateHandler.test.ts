/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const exerciseRepositoryMocks = {
  create: vi.fn(),
  list: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getMuscleGroups: vi.fn(),
  getEquipmentTypes: vi.fn(),
  getCategories: vi.fn(),
};

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "user-1",
      email: "user-1@example.com",
      email_verified: true,
      iat: 0,
      exp: 9999999999,
    };
  }),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user || { sub: "user-1" }),
}));

vi.mock("../../../repositories/exerciseRepository", () => ({
  ExerciseRepository: vi.fn().mockImplementation(() => exerciseRepositoryMocks),
}));

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

describe("ExercisesCreateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exerciseRepositoryMocks.create.mockImplementation(
      async (userId: string, data: any) => ({
        id: "ex-new",
        createdBy: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
        isPublic: data.isPublic ?? false,
        ...data,
      }),
    );
  });

  describe("auth", () => {
    it("requires authentication", async () => {
      const { exercisesCreateHandler } =
        await import("../exercisesCreateHandler");
      const response = await exercisesCreateHandler.handle(
        new Request("http://localhost/exercises", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Squat" }),
        }),
      );
      expect(response.status).toBe(401);
    });
  });

  describe("validation", () => {
    it("rejects missing name with 422 (schema)", async () => {
      const { exercisesCreateHandler } =
        await import("../exercisesCreateHandler");
      const response = await exercisesCreateHandler.handle(
        new Request("http://localhost/exercises", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer token",
          },
          body: JSON.stringify({}),
        }),
      );
      expect(response.status).toBe(422);
    });

    it("rejects empty name with 400", async () => {
      const { exercisesCreateHandler } =
        await import("../exercisesCreateHandler");
      const response = await exercisesCreateHandler.handle(
        new Request("http://localhost/exercises", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer token",
          },
          body: JSON.stringify({ name: "   " }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it("rejects 1-char name with 400 (spec: 2–100 chars)", async () => {
      const { exercisesCreateHandler } =
        await import("../exercisesCreateHandler");
      const response = await exercisesCreateHandler.handle(
        new Request("http://localhost/exercises", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer token",
          },
          body: JSON.stringify({ name: "X" }),
        }),
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as any;
      expect(body.error).toMatch(/at least 2/i);
    });

    it("accepts 2-char name (spec: minimum boundary)", async () => {
      const { exercisesCreateHandler } =
        await import("../exercisesCreateHandler");
      const response = await exercisesCreateHandler.handle(
        new Request("http://localhost/exercises", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer token",
          },
          body: JSON.stringify({ name: "Ab" }),
        }),
      );
      expect(response.status).toBe(201);
    });

    it("rejects names over 100 chars with 400", async () => {
      const { exercisesCreateHandler } =
        await import("../exercisesCreateHandler");
      const response = await exercisesCreateHandler.handle(
        new Request("http://localhost/exercises", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer token",
          },
          body: JSON.stringify({ name: "x".repeat(101) }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it("rejects invalid category enum with 422", async () => {
      const { exercisesCreateHandler } =
        await import("../exercisesCreateHandler");
      const response = await exercisesCreateHandler.handle(
        new Request("http://localhost/exercises", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer token",
          },
          body: JSON.stringify({ name: "Squat", category: "not-a-category" }),
        }),
      );
      expect(response.status).toBe(422);
    });

    it("rejects invalid difficulty_level enum with 422", async () => {
      const { exercisesCreateHandler } =
        await import("../exercisesCreateHandler");
      const response = await exercisesCreateHandler.handle(
        new Request("http://localhost/exercises", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer token",
          },
          body: JSON.stringify({
            name: "Squat",
            difficulty_level: "impossible",
          }),
        }),
      );
      expect(response.status).toBe(422);
    });

    it("rejects non-UUID primary_muscles entries with 422", async () => {
      const { exercisesCreateHandler } =
        await import("../exercisesCreateHandler");
      const response = await exercisesCreateHandler.handle(
        new Request("http://localhost/exercises", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer token",
          },
          body: JSON.stringify({
            name: "Squat",
            primary_muscles: ["chest"],
          }),
        }),
      );
      expect(response.status).toBe(422);
    });
  });

  describe("happy path", () => {
    it("creates an exercise with minimal payload → 201", async () => {
      const { exercisesCreateHandler } =
        await import("../exercisesCreateHandler");
      const response = await exercisesCreateHandler.handle(
        new Request("http://localhost/exercises", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer token",
          },
          body: JSON.stringify({ name: "Test Lift" }),
        }),
      );
      expect(response.status).toBe(201);
      const body = (await response.json()) as any;
      expect(body.data).toHaveProperty("id");
      expect(body.data.name).toBe("Test Lift");
      expect(body.data.createdBy).toBe("user-1");
    });

    it("forces created_by to JWT sub regardless of body", async () => {
      const { exercisesCreateHandler } =
        await import("../exercisesCreateHandler");
      await exercisesCreateHandler.handle(
        new Request("http://localhost/exercises", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer token",
          },
          body: JSON.stringify({
            name: "Spoofed Lift",
            // body field the handler must ignore
            created_by: "attacker-id",
          }),
        }),
      );
      const [userIdArg] = exerciseRepositoryMocks.create.mock.calls[0];
      expect(userIdArg).toBe("user-1");
    });

    it("persists full legacy payload shape (snake_case → domain)", async () => {
      const { exercisesCreateHandler } =
        await import("../exercisesCreateHandler");
      await exercisesCreateHandler.handle(
        new Request("http://localhost/exercises", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer token",
          },
          body: JSON.stringify({
            name: "Full Payload",
            description: "Full description",
            instructions: "Step-by-step",
            video_url: "https://example.com/video.mp4",
            thumbnail_url: "https://example.com/thumb.jpg",
            category: "strength",
            difficulty_level: "intermediate",
            region_type: "Upper",
            movement_type: "Push",
            primary_muscles: [VALID_UUID],
            secondary_muscles: [VALID_UUID],
            equipment_required: [VALID_UUID],
            accessibility_requirements: [],
            accessibility_modifications: "none",
            is_public: false,
          }),
        }),
      );
      const [, payload] = exerciseRepositoryMocks.create.mock.calls[0];
      expect(payload.name).toBe("Full Payload");
      expect(payload.videoUrl).toBe("https://example.com/video.mp4");
      expect(payload.thumbnailUrl).toBe("https://example.com/thumb.jpg");
      expect(payload.category).toBe("strength");
      expect(payload.difficultyLevel).toBe("intermediate");
      expect(payload.regionType).toBe("Upper");
      expect(payload.movementType).toBe("Push");
      expect(payload.primaryMuscles).toEqual([VALID_UUID]);
      expect(payload.equipmentRequired).toEqual([VALID_UUID]);
      expect(payload.isPublic).toBe(false);
    });

    it("defaults is_public to false when not provided", async () => {
      const { exercisesCreateHandler } =
        await import("../exercisesCreateHandler");
      await exercisesCreateHandler.handle(
        new Request("http://localhost/exercises", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer token",
          },
          body: JSON.stringify({ name: "Defaulted" }),
        }),
      );
      const [, payload] = exerciseRepositoryMocks.create.mock.calls[0];
      expect(payload.isPublic).toBe(false);
    });
  });
});
