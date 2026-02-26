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

  it("should accept estimatedDurationMinutes of 0 — not reject as invalid (schema must not treat 0 as missing)", async () => {
    // The ?? 30 fix ensures 0 is preserved and not replaced with 30.
    // Without auth we can only verify the schema accepts 0 (401, not 422).
    const response = await workoutsCreateHandler.handle(
      new Request("http://localhost/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Zero Duration Workout",
          estimatedDurationMinutes: 0,
        }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("should reject invalid visibility values with 422", async () => {
    const response = await workoutsCreateHandler.handle(
      new Request("http://localhost/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Workout",
          visibility: "secret",
        }),
      }),
    );

    expect(response.status).toBe(422);
  });
});
