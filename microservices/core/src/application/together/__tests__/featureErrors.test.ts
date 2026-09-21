import { afterEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("../../../shared/sentry", () => ({
  captureServerError: mocks.capture,
}));
vi.mock("../transport", () => ({ wakeTogether: vi.fn() }));
vi.mock("../togetherRoutes", async () => {
  const { default: Elysia, t } = await import("elysia");
  const { TogetherError } = await import("../shared");
  return {
    togetherRoutes: new Elysia()
      .onError(({ error, code, set }) => {
        if (error instanceof TogetherError) {
          set.status = error.status;
          return { error: { code: error.code } };
        }
        if (code === "VALIDATION") {
          set.status = 400;
          return { error: { code: "INVALID_SCHEMA" } };
        }
      })
      .post("/together/json", ({ body }) => body, {
        body: t.Object({ value: t.String() }),
      })
      .get("/together/failure", () => {
        throw new Error("Failed query: private-health-row\nparams: secret");
      })
      .get("/together/forbidden", () => {
        throw new TogetherError("FORBIDDEN", 403);
      })
      .get("/together/validation", () => ({ ok: true }), {
        query: t.Object({ id: t.String({ format: "uuid" }) }),
      }),
  };
});
vi.mock("../../social/socialHandler", async () => {
  const { default: Elysia } = await import("elysia");
  return { socialHandler: new Elysia() };
});
vi.mock("../../places/placesHandler", async () => {
  const { default: Elysia } = await import("elysia");
  return { placesHandler: new Elysia() };
});
vi.mock("../templatesHandler", async () => {
  const { default: Elysia } = await import("elysia");
  return { templatesHandler: new Elysia() };
});
import { togetherFeatureRoutes } from "../featureRoutes";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("hides unknown driver errors and captures only method/path context", async () => {
  vi.stubEnv("TOGETHER_ENABLED", "true");
  const response = await togetherFeatureRoutes.handle(
    new Request(
      "http://localhost/together/failure?latitude=51.123&token=secret",
    ),
  );
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: { code: "INTERNAL_ERROR", message: "Unable to complete request" },
  });
  expect(mocks.capture).toHaveBeenCalledWith(expect.any(Error), {
    path: "/together/failure",
    method: "GET",
  });
});
it("preserves route-specific domain and validation failures", async () => {
  vi.stubEnv("TOGETHER_ENABLED", "true");
  for (const [path, status, code] of [
    ["forbidden", 403, "FORBIDDEN"],
    ["validation", 400, "INVALID_SCHEMA"],
  ] as const) {
    const response = await togetherFeatureRoutes.handle(
      new Request(`http://localhost/together/${path}`),
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code } });
  }
  expect(mocks.capture).not.toHaveBeenCalled();
});
it("formats missing feature routes without treating them as server faults", async () => {
  vi.stubEnv("TOGETHER_ENABLED", "true");
  const response = await togetherFeatureRoutes.handle(
    new Request("http://localhost/together/absent"),
  );
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    error: { code: "NOT_FOUND", message: "Not found" },
  });
  expect(mocks.capture).not.toHaveBeenCalled();
});

it("rejects malformed JSON as a safe client error", async () => {
  vi.stubEnv("TOGETHER_ENABLED", "true");
  const response = await togetherFeatureRoutes.handle(
    new Request("http://localhost/together/json", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad-json",
    }),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "INVALID_SCHEMA", message: "Invalid request" },
  });
  expect(mocks.capture).not.toHaveBeenCalled();
});
