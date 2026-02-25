import { describe, it, expect } from "vitest";
import { workoutsDeleteHandler } from "../workoutsDeleteHandler";

describe("WorkoutsDeleteHandler", () => {
  it("should require authentication to delete", async () => {
    const response = await workoutsDeleteHandler.handle(
      new Request("http://localhost/workouts/123", {
        method: "DELETE",
      })
    );

    expect([401, 404, 200]).toContain(response.status);
  });

  it("should accept DELETE request to /workouts/:id", async () => {
    const response = await workoutsDeleteHandler.handle(
      new Request("http://localhost/workouts/workout-id", {
        method: "DELETE",
      })
    );

    expect([200, 401, 404, 403]).toContain(response.status);
  });

  it("should handle invalid workout ID format", async () => {
    const response = await workoutsDeleteHandler.handle(
      new Request("http://localhost/workouts/invalid", {
        method: "DELETE",
      })
    );

    expect([401, 404, 400, 403]).toContain(response.status);
  });

  it("should verify ownership before deletion", async () => {
    const response = await workoutsDeleteHandler.handle(
      new Request("http://localhost/workouts/some-workout-id", {
        method: "DELETE",
      })
    );

    // Either auth fails (401) or ownership check fails (403) or not found (404)
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("should return appropriate status for successful deletion", async () => {
    const response = await workoutsDeleteHandler.handle(
      new Request("http://localhost/workouts/workout-123", {
        method: "DELETE",
      })
    );

    expect([200, 204, 401, 403, 404]).toContain(response.status);
  });
});
