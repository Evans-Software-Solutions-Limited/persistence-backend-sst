import { exercisesListHandler } from "../exercisesListHandler";

const MOCK_MUSCLE_GROUP_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

vi.mock("../../../repositories/exerciseRepository", () => ({
  ExerciseRepository: vi.fn().mockImplementation(() => ({
    list: vi.fn().mockResolvedValue([
      {
        id: "1",
        name: "Push-ups",
        description: "Basic push-up exercise",
        difficultyLevel: "beginner",
        isPublic: true,
      },
    ]),
  })),
}));

describe("ExercisesListHandler", () => {
  it("should return 200 with data array for list request", async () => {
    const response = await exercisesListHandler.handle(
      new Request("http://localhost/exercises", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[] };
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("should accept difficulty filter", async () => {
    const response = await exercisesListHandler.handle(
      new Request("http://localhost/exercises?difficulty=beginner", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(200);
  });

  it("should accept muscleGroup filter as a UUID", async () => {
    const response = await exercisesListHandler.handle(
      new Request(
        `http://localhost/exercises?muscleGroup=${MOCK_MUSCLE_GROUP_UUID}`,
        { method: "GET" },
      ),
    );

    expect(response.status).toBe(200);
  });

  it("should reject non-UUID muscleGroup with 422", async () => {
    const response = await exercisesListHandler.handle(
      new Request("http://localhost/exercises?muscleGroup=chest", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(422);
  });

  it("should accept search parameter", async () => {
    const response = await exercisesListHandler.handle(
      new Request("http://localhost/exercises?search=push", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("should accept pagination parameters", async () => {
    const response = await exercisesListHandler.handle(
      new Request("http://localhost/exercises?limit=10&offset=0", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(200);
  });

  it("should reject non-numeric limit with 422", async () => {
    const response = await exercisesListHandler.handle(
      new Request("http://localhost/exercises?limit=abc", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(422);
  });

  it("should return valid JSON response", async () => {
    const response = await exercisesListHandler.handle(
      new Request("http://localhost/exercises", {
        method: "GET",
      }),
    );

    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
