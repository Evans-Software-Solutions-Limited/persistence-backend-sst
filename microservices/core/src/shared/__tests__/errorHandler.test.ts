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

    const app = new Elysia().use(coreErrorHandler).get("/boom", () => {
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

    const app = new Elysia().use(coreErrorHandler).get("/boom", () => {
      throw new Error("kaboom");
    });

    const response = await app.handle(new Request("http://localhost/boom"));
    expect(response.status).toBe(500);
    const body = await jsonBody(response);
    // Stack must NOT leak — may carry internal paths / env data
    expect(body.stack).toBeUndefined();
  });

  it("strips the raw detail on production 500s (CWE-209)", async () => {
    process.env.SST_STAGE = "production";

    const app = new Elysia().use(coreErrorHandler).get("/boom", () => {
      // Simulate a Postgres driver error leaking schema info
      throw new Error(
        'column "exercises.internal_hash" does not exist at host db.xyz.supabase.co',
      );
    });

    const response = await app.handle(new Request("http://localhost/boom"));
    expect(response.status).toBe(500);
    const body = await jsonBody(response);
    // Raw driver message must NOT leak — no column names, no hostnames
    expect(body.detail).not.toContain("exercises");
    expect(body.detail).not.toContain("supabase.co");
    expect(body.detail).not.toContain("internal_hash");
    // Generic replacement + still tells the client how to follow up
    expect(body.detail).toMatch(/internal error/i);
    expect(body.detail).toMatch(/server logs/i);
  });

  it("keeps detail on 4xx errors even in production (client-facing)", async () => {
    process.env.SST_STAGE = "production";

    const app = new Elysia()
      .use(coreErrorHandler)
      .post("/require-name", () => ({ ok: true }), {
        body: t.Object({ name: t.String() }),
      });

    const response = await app.handle(
      new Request("http://localhost/require-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(422);
    const body = await jsonBody(response);
    // Client needs to know WHICH field failed; stripping here would
    // make the API useless. Detail still carries Elysia's message.
    expect(typeof body.detail).toBe("string");
    expect((body.detail as string).length).toBeGreaterThan(0);
    expect(body.detail).not.toMatch(/internal error/i);
  });

  it("maps VALIDATION errors to 422", async () => {
    const app = new Elysia()
      .use(coreErrorHandler)
      .post("/require-name", () => ({ ok: true }), {
        body: t.Object({ name: t.String() }),
      });

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
    const app = new Elysia().use(coreErrorHandler).get("/exists", () => ({
      ok: true,
    }));

    const response = await app.handle(new Request("http://localhost/nope"));
    expect(response.status).toBe(404);
    const body = await jsonBody(response);
    expect(body.error).toBe("Not found");
    expect(body.code).toBe("NOT_FOUND");
  });

  it("leaves handler-set status codes alone (domain 400/403/404)", async () => {
    const app = new Elysia()
      .use(coreErrorHandler)
      .get("/forbidden", ({ set }) => {
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
    const app = new Elysia().use(coreErrorHandler).get("/trace", () => {
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
    const app = new Elysia().use(coreErrorHandler).get("/boom", () => {
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

  it("unwinds `.cause` chain and surfaces driver fields (dev-mode)", async () => {
    // Mirrors how Drizzle wraps a node-postgres / postgres.js driver error:
    // the outer Error carries "Failed query: ..." and the real PG error
    // hangs off `.cause` with its code/severity/detail as own fields.
    delete process.env.SST_STAGE;

    const app = new Elysia().use(coreErrorHandler).get("/boom", () => {
      const driverError = Object.assign(
        new Error("password authentication failed for user 'postgres'"),
        {
          code: "28P01",
          severity: "FATAL",
          routine: "auth_failed",
        },
      );
      const wrapper = new Error("Failed query: select 1", {
        cause: driverError,
      });
      throw wrapper;
    });

    const response = await app.handle(new Request("http://localhost/boom"));
    expect(response.status).toBe(500);
    const body = await jsonBody(response);
    // Causes surfaced on the response body so the Expo network tab shows
    // the real driver reason without CloudWatch.
    expect(Array.isArray(body.causes)).toBe(true);
    const causes = body.causes as Record<string, unknown>[];
    expect(causes[0]?.code).toBe("28P01");
    expect(causes[0]?.severity).toBe("FATAL");
    expect(causes[0]?.message).toContain("password authentication failed");
    // Each cause link also logged separately so CloudWatch has them.
    const causeLogs = consoleErrorSpy.mock.calls.filter((c) =>
      String(c[0]).startsWith("[api:error] cause["),
    );
    expect(causeLogs.length).toBeGreaterThan(0);
  });

  it("strips the `causes` field in production", async () => {
    process.env.SST_STAGE = "production";
    const app = new Elysia().use(coreErrorHandler).get("/boom", () => {
      throw new Error("outer", { cause: new Error("inner secret") });
    });
    const response = await app.handle(new Request("http://localhost/boom"));
    const body = await jsonBody(response);
    // Prod response must not leak driver internals in the body
    expect(body.causes).toBeUndefined();
    expect(body.stack).toBeUndefined();
  });
});
