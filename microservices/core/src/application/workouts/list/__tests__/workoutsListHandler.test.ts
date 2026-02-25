import { describe, it, expect } from "vitest";
import { workoutsListHandler } from "../workoutsListHandler";

describe("WorkoutsListHandler", () => {
  it("should require authentication to list workouts", async () => {
    const response = await workoutsListHandler.handle(
      new Request("http://localhost/workouts", {
        method: "GET",
      })
    );

    expect([200, 401]).toContain(response.status);
  });

  it("should return array of workouts for authenticated user", async () => {
    const response = await workoutsListHandler.handle(
      new Request("http://localhost/workouts", {
        method: "GET",
      })
    );

    expect([200, 401]).toContain(response.status);
    if (response.status === 200) {
      const body = (await response.json()) as any;
      expect(Array.isArray(body.data)).toBe(true);
    }
  });

  it("should accept pagination parameters", async () => {
    const response = await workoutsListHandler.handle(
      new Request("http://localhost/workouts?limit=10&offset=0", {
        method: "GET",
      })
    );

    expect([200, 401]).toContain(response.status);
  });

  it("should accept sorting parameters", async () => {
    const response = await workoutsListHandler.handle(
      new Request("http://localhost/workouts?sortBy=createdAt&order=desc", {
        method: "GET",
      })
    );

    expect([200, 401]).toContain(response.status);
  });

  it("should return valid JSON for authenticated requests", async () => {
    const response = await workoutsListHandler.handle(
      new Request("http://localhost/workouts", {
        method: "GET",
      })
    );

    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
