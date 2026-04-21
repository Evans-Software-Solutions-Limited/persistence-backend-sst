/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const MOCK_MUSCLE_UUID_A = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const MOCK_MUSCLE_UUID_B = "b1b2c3d4-e5f6-7890-abcd-ef1234567890";
const MOCK_EQUIPMENT_UUID = "c1b2c3d4-e5f6-7890-abcd-ef1234567890";

const exerciseRepositoryMocks = {
  list: vi.fn().mockResolvedValue([
    {
      id: "1",
      name: "Push-ups",
      difficultyLevel: "beginner",
      createdBy: null,
    },
  ]),
  count: vi.fn().mockResolvedValue(1),
  getById: vi.fn(),
  create: vi.fn(),
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
      email: "u@e.com",
      email_verified: true,
      iat: 0,
      exp: 9999999999,
    };
  }),
  requireAuth: vi.fn(),
  getUser: vi.fn((ctx) => ctx.user || { sub: "user-1" }),
}));

vi.mock("../../../repositories/exerciseRepository", () => ({
  ExerciseRepository: vi.fn().mockImplementation(() => exerciseRepositoryMocks),
}));

describe("ExercisesListHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exerciseRepositoryMocks.list.mockResolvedValue([
      { id: "1", name: "Push-ups", difficultyLevel: "beginner" },
    ]);
    exerciseRepositoryMocks.count.mockResolvedValue(1);
  });

  describe("basic contract", () => {
    // Wire shape: `{ data: { data: ApiExercise[], meta: {...} } }` — the
    // outer `data` is the generic success envelope, the inner object is
    // the paginated-page payload the mobile adapter expects. See
    // sst-api.adapter.ts `ApiExercisesPage` and `requestEnvelope`.
    it("returns 200 with double-envelope { data: { data: [...], meta } }", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const response = await exercisesListHandler.handle(
        new Request("http://localhost/exercises"),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: {
          data: unknown[];
          meta: { total: number; offset: number; limit: number };
        };
      };
      expect(Array.isArray(body.data.data)).toBe(true);
      expect(body.data.meta).toEqual({ total: 1, offset: 0, limit: 20 });
    });

    it("forwards limit/offset from query string into meta", async () => {
      exerciseRepositoryMocks.count.mockResolvedValue(42);
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const response = await exercisesListHandler.handle(
        new Request("http://localhost/exercises?limit=5&offset=10"),
      );
      const body = (await response.json()) as {
        data: { meta: { total: number; offset: number; limit: number } };
      };
      expect(body.data.meta).toEqual({ total: 42, offset: 10, limit: 5 });
    });

    it("runs list + count against the same filters in parallel", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      await exercisesListHandler.handle(
        new Request("http://localhost/exercises?category=strength"),
      );
      // Both must be called — parallel invocation is the perf contract
      // for the handler. Both must receive the same filter shape.
      expect(exerciseRepositoryMocks.list).toHaveBeenCalledTimes(1);
      expect(exerciseRepositoryMocks.count).toHaveBeenCalledTimes(1);
      const listArgs = exerciseRepositoryMocks.list.mock.calls[0][0];
      const countArgs = exerciseRepositoryMocks.count.mock.calls[0][0];
      expect(listArgs).toEqual(countArgs);
      expect(listArgs.category).toEqual(["strength"]);
    });

    it("returns JSON content-type", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const response = await exercisesListHandler.handle(
        new Request("http://localhost/exercises"),
      );
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
    });
  });

  describe("back-compat single-value params", () => {
    it("accepts ?difficulty=beginner (alias of difficulty_level)", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const response = await exercisesListHandler.handle(
        new Request("http://localhost/exercises?difficulty=beginner"),
      );
      expect(response.status).toBe(200);
      const [filters] = exerciseRepositoryMocks.list.mock.calls[0];
      expect(filters.difficultyLevel).toContain("beginner");
    });

    it("accepts ?muscleGroup=<uuid> (alias of targeted_muscles_any)", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const response = await exercisesListHandler.handle(
        new Request(
          `http://localhost/exercises?muscleGroup=${MOCK_MUSCLE_UUID_A}`,
        ),
      );
      expect(response.status).toBe(200);
      const [filters] = exerciseRepositoryMocks.list.mock.calls[0];
      expect(filters.targetedMusclesAny).toContain(MOCK_MUSCLE_UUID_A);
    });

    it("accepts ?search=push (alias of q)", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const response = await exercisesListHandler.handle(
        new Request("http://localhost/exercises?search=push"),
      );
      expect(response.status).toBe(200);
      const [filters] = exerciseRepositoryMocks.list.mock.calls[0];
      expect(filters.q).toBe("push");
    });
  });

  describe("M0 filter wire format", () => {
    it("accepts ?q=push", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const response = await exercisesListHandler.handle(
        new Request("http://localhost/exercises?q=push"),
      );
      expect(response.status).toBe(200);
      const [filters] = exerciseRepositoryMocks.list.mock.calls[0];
      expect(filters.q).toBe("push");
    });

    it("accepts repeated targeted_muscles_any[]", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const url = `http://localhost/exercises?targeted_muscles_any=${MOCK_MUSCLE_UUID_A}&targeted_muscles_any=${MOCK_MUSCLE_UUID_B}`;
      const response = await exercisesListHandler.handle(new Request(url));
      expect(response.status).toBe(200);
      const [filters] = exerciseRepositoryMocks.list.mock.calls[0];
      expect(filters.targetedMusclesAny).toEqual([
        MOCK_MUSCLE_UUID_A,
        MOCK_MUSCLE_UUID_B,
      ]);
    });

    it("accepts repeated equipment_any[]", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const url = `http://localhost/exercises?equipment_any=${MOCK_EQUIPMENT_UUID}`;
      const response = await exercisesListHandler.handle(new Request(url));
      expect(response.status).toBe(200);
      const [filters] = exerciseRepositoryMocks.list.mock.calls[0];
      expect(filters.equipmentAny).toEqual([MOCK_EQUIPMENT_UUID]);
    });

    it("accepts repeated category[]", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const response = await exercisesListHandler.handle(
        new Request(
          "http://localhost/exercises?category=strength&category=cardio",
        ),
      );
      expect(response.status).toBe(200);
      const [filters] = exerciseRepositoryMocks.list.mock.calls[0];
      expect(filters.category).toEqual(["strength", "cardio"]);
    });

    it("accepts pagination parameters", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const response = await exercisesListHandler.handle(
        new Request("http://localhost/exercises?limit=10&offset=20"),
      );
      expect(response.status).toBe(200);
      const [filters] = exerciseRepositoryMocks.list.mock.calls[0];
      expect(filters.limit).toBe(10);
      expect(filters.offset).toBe(20);
    });

    it("rejects non-numeric limit with 422", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const response = await exercisesListHandler.handle(
        new Request("http://localhost/exercises?limit=abc"),
      );
      expect(response.status).toBe(422);
    });

    it("rejects non-UUID muscleGroup with 422", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const response = await exercisesListHandler.handle(
        new Request("http://localhost/exercises?muscleGroup=chest"),
      );
      expect(response.status).toBe(422);
    });

    it("rejects non-UUID targeted_muscles_any with 422", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const response = await exercisesListHandler.handle(
        new Request(
          "http://localhost/exercises?targeted_muscles_any=chest&targeted_muscles_any=back",
        ),
      );
      expect(response.status).toBe(422);
    });

    it("rejects non-UUID equipment_any with 422", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const response = await exercisesListHandler.handle(
        new Request("http://localhost/exercises?equipment_any=barbell"),
      );
      expect(response.status).toBe(422);
    });
  });

  describe("created_by filter (AC 7.7)", () => {
    it("accepts created_by=system without auth", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const response = await exercisesListHandler.handle(
        new Request("http://localhost/exercises?created_by=system"),
      );
      expect(response.status).toBe(200);
      const [filters, userId] = exerciseRepositoryMocks.list.mock.calls[0];
      expect(filters.createdByFilter).toEqual(["system"]);
      expect(userId).toBeNull();
    });

    it("accepts created_by=all without auth", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const response = await exercisesListHandler.handle(
        new Request("http://localhost/exercises?created_by=all"),
      );
      expect(response.status).toBe(200);
    });

    it("rejects created_by=mine without auth with 400", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const response = await exercisesListHandler.handle(
        new Request("http://localhost/exercises?created_by=mine"),
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as any;
      expect(body.error).toContain("requires authentication");
    });

    it("rejects created_by=pt without auth with 400", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const response = await exercisesListHandler.handle(
        new Request("http://localhost/exercises?created_by=pt"),
      );
      expect(response.status).toBe(400);
    });

    it("rejects created_by=physio without auth with 400", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const response = await exercisesListHandler.handle(
        new Request("http://localhost/exercises?created_by=physio"),
      );
      expect(response.status).toBe(400);
    });

    it("accepts created_by=mine with auth and passes sub to repo", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const response = await exercisesListHandler.handle(
        new Request("http://localhost/exercises?created_by=mine", {
          headers: { authorization: "Bearer token" },
        }),
      );
      expect(response.status).toBe(200);
      const [filters, userId] = exerciseRepositoryMocks.list.mock.calls[0];
      expect(filters.createdByFilter).toEqual(["mine"]);
      expect(userId).toBe("user-1");
    });

    it("accepts multiple created_by values (union)", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const response = await exercisesListHandler.handle(
        new Request(
          "http://localhost/exercises?created_by=mine&created_by=system",
          { headers: { authorization: "Bearer token" } },
        ),
      );
      expect(response.status).toBe(200);
      const [filters] = exerciseRepositoryMocks.list.mock.calls[0];
      expect(filters.createdByFilter).toEqual(["mine", "system"]);
    });

    it("rejects unknown created_by value with 400", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      const response = await exercisesListHandler.handle(
        new Request("http://localhost/exercises?created_by=hacker"),
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as any;
      expect(body.error).toContain("Invalid created_by");
    });
  });

  describe("visibility plumbing", () => {
    it("passes null userId to repo when unauth", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      await exercisesListHandler.handle(
        new Request("http://localhost/exercises"),
      );
      const [, userId] = exerciseRepositoryMocks.list.mock.calls[0];
      expect(userId).toBeNull();
    });

    it("passes sub to repo when authed", async () => {
      const { exercisesListHandler } = await import("../exercisesListHandler");
      await exercisesListHandler.handle(
        new Request("http://localhost/exercises", {
          headers: { authorization: "Bearer token" },
        }),
      );
      const [, userId] = exerciseRepositoryMocks.list.mock.calls[0];
      expect(userId).toBe("user-1");
    });
  });
});
