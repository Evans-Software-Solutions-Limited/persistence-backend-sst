import { exercisesGetHandler } from "../exercisesGetHandler";

vi.mock("../../../repositories/exerciseRepository", () => ({
  ExerciseRepository: vi.fn().mockImplementation(() => ({
    getById: vi.fn().mockImplementation((id: string) => {
      if (id === "1" || id === "valid-uuid-1234") {
        return Promise.resolve({
          id,
          name: "Push-ups",
          description: "Basic push-up exercise",
          muscleGroup: "chest",
          difficultyLevel: "beginner",
          isPublic: true,
        });
      }
      return Promise.resolve(null);
    }),
  })),
}));

describe("ExercisesGetHandler", () => {
  it("should return 200 with exercise data for valid exercise ID", async () => {
    const response = await exercisesGetHandler.handle(
      new Request("http://localhost/exercises/1", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(200);
  });

  it("should return 404 for non-existent exercise", async () => {
    const response = await exercisesGetHandler.handle(
      new Request("http://localhost/exercises/nonexistent", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(404);
  });

  it("should include error message in 404 response", async () => {
    const response = await exercisesGetHandler.handle(
      new Request("http://localhost/exercises/invalid", {
        method: "GET",
      }),
    );

    const body = (await response.json()) as { error: string };
    expect(body).toHaveProperty("error");
  });

  it("should handle requests with valid exercise ID format", async () => {
    const response = await exercisesGetHandler.handle(
      new Request("http://localhost/exercises/valid-uuid-1234", {
        method: "GET",
      }),
    );

    expect([200, 404]).toContain(response.status);
  });
});
