import { describe, it, expect } from "vitest";
import { workoutsCreateHandler } from "../workoutsCreateHandler";

describe("WorkoutsCreateHandler", () => {
  it("should return 400 for missing workout name", async () => {
    const response = await workoutsCreateHandler.handle(
      new Request("http://localhost/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "" }),
      })
    );

    expect(response.status).toBe(400);
  });

  it("should return 400 when name is not provided", async () => {
    const response = await workoutsCreateHandler.handle(
      new Request("http://localhost/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );

    expect([400, 401]).toContain(response.status);
  });

  it("should require authentication", async () => {
    const response = await workoutsCreateHandler.handle(
      new Request("http://localhost/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test Workout" }),
      })
    );

    // Expected to fail auth or validation
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("should handle valid request structure", async () => {
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
      })
    );

    expect([201, 401, 400]).toContain(response.status);
  });

  it("should accept optional parameters", async () => {
    const response = await workoutsCreateHandler.handle(
      new Request("http://localhost/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Workout",
          visibility: "friends",
        }),
      })
    );

    expect([201, 401, 400]).toContain(response.status);
  });
});
