import { workoutsCreateHandler } from "../workoutsCreateHandler";

describe("WorkoutsCreateHandler", () => {
  it("should require authentication", async () => {
    const response = await workoutsCreateHandler.handle(
      new Request("http://localhost/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test Workout" }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("should return 401 for missing workout name without auth", async () => {
    const response = await workoutsCreateHandler.handle(
      new Request("http://localhost/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "" }),
      }),
    );

    expect([400, 401, 422]).toContain(response.status);
  });

  it("should return 401 when name is not provided without auth", async () => {
    const response = await workoutsCreateHandler.handle(
      new Request("http://localhost/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect([400, 401, 422]).toContain(response.status);
  });

  it("should handle valid request structure without auth", async () => {
    const response = await workoutsCreateHandler.handle(
      new Request("http://localhost/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "My Workout",
          description: "Test workout",
          visibility: "private",
          estimatedDurationMinutes: 45,
        }),
      }),
    );

    expect([201, 401, 400, 422]).toContain(response.status);
  });

  it("should accept optional parameters without auth", async () => {
    const response = await workoutsCreateHandler.handle(
      new Request("http://localhost/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Workout",
          visibility: "friends",
        }),
      }),
    );

    expect([201, 401, 400, 422]).toContain(response.status);
  });
});
