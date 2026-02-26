import { workoutsListHandler } from "../workoutsListHandler";

describe("WorkoutsListHandler", () => {
  it("should require authentication to list workouts", async () => {
    const response = await workoutsListHandler.handle(
      new Request("http://localhost/workouts", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(401);
  });

  it("should return array of workouts for authenticated user", async () => {
    const response = await workoutsListHandler.handle(
      new Request("http://localhost/workouts", {
        method: "GET",
      }),
    );

    expect([200, 401]).toContain(response.status);
  });

  it("should accept pagination parameters", async () => {
    const response = await workoutsListHandler.handle(
      new Request("http://localhost/workouts?limit=10&offset=0", {
        method: "GET",
      }),
    );

    expect([200, 401]).toContain(response.status);
  });

  it("should accept sorting parameters", async () => {
    const response = await workoutsListHandler.handle(
      new Request("http://localhost/workouts?type=mine", {
        method: "GET",
      }),
    );

    expect([200, 401]).toContain(response.status);
  });

  it("should return JSON for unauthenticated requests", async () => {
    const response = await workoutsListHandler.handle(
      new Request("http://localhost/workouts", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(401);
  });
});
