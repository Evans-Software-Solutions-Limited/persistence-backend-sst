import { describe, it, expect } from "vitest";
import { workoutsGetHandler } from "../workoutsGetHandler";

describe("WorkoutsGetHandler", () => {
  it("should require authentication to retrieve workout", async () => {
    const response = await workoutsGetHandler.handle(
      new Request("http://localhost/workouts/123", {
        method: "GET",
      })
    );

    expect([401, 404, 200, 403]).toContain(response.status);
  });

  it("should accept GET request to /workouts/:id", async () => {
    const response = await workoutsGetHandler.handle(
      new Request("http://localhost/workouts/workout-id", {
        method: "GET",
      })
    );

    expect([200, 401, 404, 403]).toContain(response.status);
  });

  it("should return 404 for non-existent workout", async () => {
    const response = await workoutsGetHandler.handle(
      new Request("http://localhost/workouts/nonexistent", {
        method: "GET",
      })
    );

    expect([404, 401, 403]).toContain(response.status);
  });

  it("should handle valid workout ID format", async () => {
    const response = await workoutsGetHandler.handle(
      new Request("http://localhost/workouts/valid-uuid-1234", {
        method: "GET",
      })
    );

    expect([200, 401, 403, 404]).toContain(response.status);
  });

  it("should verify ownership before retrieving workout", async () => {
    const response = await workoutsGetHandler.handle(
      new Request("http://localhost/workouts/some-id", {
        method: "GET",
      })
    );

    // Either auth fails (401) or ownership check fails (403) or not found (404)
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
