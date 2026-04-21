import Elysia, { t } from "elysia";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { coreErrorHandler } from "../errorHandler";

describe("coreErrorHandler", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalStage = process.env.SST_STAGE;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    if (originalStage === undefined) {
      delete process.env.SST_STAGE;
    } else {
      process.env.SST_STAGE = originalStage;
    }
  });

  async function jsonBody(response: Response) {
    return (await response.json()) as Record<string, unknown>;
  }

  it("returns structured 500 body with stack outside production", async () => {
    delete process.env.SST_STAGE;

    const app = coreErrorHandler(new Elysia()).get("/boom", () => {
      throw new Error("kaboom");
    });

    const response = await app.handle(new Request("http://localhost/boom"));
    expect(response.status).toBe(500);
    const body = await jsonBody(response);
    expect(body.code).toBeDefined();
    expect(body.error).toBe("Internal server error");
    expect(body.detail).toBe("kaboom");
    expect(typeof body.stack).toBe("string");
    expect(body.stack).toMatch(/kaboom/);
  });

  it("strips the stack in production", async () => {
    process.env.SST_STAGE = "production";

    const app = coreErrorHandler(new Elysia()).get("/boom", () => {
      throw new Error("prod secret");
    });

    const response = await app.handle(new Request("http://localhost/boom"));
    expect(response.status).toBe(500);
    const body = await jsonBody(response);
    expect(body.detail).toBe("prod secret");
    // Stack must NOT leak — may carry internal paths / env data
    expect(body.stack).toBeUndefined();
  });

  it("maps VALIDATION errors to 422", async () => {
    const app = coreErrorHandler(new Elysia()).post(
      "/require-name",
      () => ({ ok: true }),
      {
        body: t.Object({ name: t.String() }),
      },
    );

    const response = await app.handle(
      new Request("http://localhost/require-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(422);
    const body = await jsonBody(response);
    expect(body.error).toBe("Validation failed");
    expect(body.code).toBe("VALIDATION");
  });

  it("maps unknown routes to 404 with structured body", async () => {
    const app = coreErrorHandler(new Elysia()).get("/exists", () => ({
      ok: true,
    }));

    const response = await app.handle(new Request("http://localhost/nope"));
    expect(response.status).toBe(404);
    const body = await jsonBody(response);
    expect(body.error).toBe("Not found");
    expect(body.code).toBe("NOT_FOUND");
  });

  it("leaves handler-set status codes alone (domain 400/403/404)", async () => {
    const app = coreErrorHandler(new Elysia()).get("/forbidden", ({ set }) => {
      set.status = 403;
      return { error: "nope" };
    });

    const response = await app.handle(
      new Request("http://localhost/forbidden"),
    );
    expect(response.status).toBe(403);
    // Handler's own body shape preserved — onError didn't fire because
    // the handler didn't throw.
    const body = await jsonBody(response);
    expect(body.error).toBe("nope");
  });

  it("logs method + path + code + message to console.error", async () => {
    const app = coreErrorHandler(new Elysia()).get("/trace", () => {
      throw new Error("traced");
    });

    await app.handle(new Request("http://localhost/trace"));

    // Two log calls: the summary line, then the stack
    expect(consoleErrorSpy).toHaveBeenCalled();
    const summary = consoleErrorSpy.mock.calls[0]?.[0] as string;
    expect(summary).toContain("GET");
    expect(summary).toContain("/trace");
    expect(summary).toContain("traced");
    expect(summary).toContain("500");
  });

  it("surfaces requestId from x-amz-request-id when present", async () => {
    delete process.env.SST_STAGE;
    const app = coreErrorHandler(new Elysia()).get("/boom", () => {
      throw new Error("kaboom");
    });

    const response = await app.handle(
      new Request("http://localhost/boom", {
        headers: { "x-amz-request-id": "abc-123-def" },
      }),
    );
    const body = await jsonBody(response);
    expect(body.requestId).toBe("abc-123-def");
  });
});
