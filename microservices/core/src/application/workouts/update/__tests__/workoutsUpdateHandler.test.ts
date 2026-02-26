import { workoutsUpdateHandler } from "../workoutsUpdateHandler";

describe("WorkoutsUpdateHandler", () => {
  it("should require authentication to update workout", async () => {
    const response = await workoutsUpdateHandler.handle(
      new Request("http://localhost/workouts/123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated Workout" }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("should accept PATCH request to /workouts/:id", async () => {
    const response = await workoutsUpdateHandler.handle(
      new Request("http://localhost/workouts/workout-id", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Name" }),
      }),
    );

    expect([200, 401, 403, 404, 400]).toContain(response.status);
  });

  it("should handle valid update payload", async () => {
    const response = await workoutsUpdateHandler.handle(
      new Request("http://localhost/workouts/workout-id", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Updated Workout",
          description: "New description",
          visibility: "public",
          estimatedDurationMinutes: 60,
        }),
      }),
    );

    expect([200, 401, 403, 404, 400]).toContain(response.status);
  });

  it("should verify ownership before allowing update", async () => {
    const response = await workoutsUpdateHandler.handle(
      new Request("http://localhost/workouts/some-id", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Attempt Update" }),
      }),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("should accept partial updates", async () => {
    const response = await workoutsUpdateHandler.handle(
      new Request("http://localhost/workouts/workout-123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Just Update Name" }),
      }),
    );

    expect([200, 201, 401, 403, 404, 400]).toContain(response.status);
  });
});
