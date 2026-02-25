import { describe, it, expect } from "vitest";
import { exercisesListHandler } from "../exercisesListHandler";

describe("ExercisesListHandler", () => {
  it("should return 200 with data array for list request", async () => {
    const response = await exercisesListHandler.handle(
      new Request("http://localhost/exercises", {
        method: "GET",
      })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("should accept query parameters for filtering", async () => {
    const response = await exercisesListHandler.handle(
      new Request("http://localhost/exercises?difficulty=beginner&muscleGroup=chest", {
        method: "GET",
      })
    );

    expect(response.status).toBe(200);
  });

  it("should accept search parameter", async () => {
    const response = await exercisesListHandler.handle(
      new Request("http://localhost/exercises?search=push", {
        method: "GET",
      })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("should accept pagination parameters", async () => {
    const response = await exercisesListHandler.handle(
      new Request("http://localhost/exercises?limit=10&offset=0", {
        method: "GET",
      })
    );

    expect(response.status).toBe(200);
  });

  it("should return valid JSON response", async () => {
    const response = await exercisesListHandler.handle(
      new Request("http://localhost/exercises", {
        method: "GET",
      })
    );

    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
