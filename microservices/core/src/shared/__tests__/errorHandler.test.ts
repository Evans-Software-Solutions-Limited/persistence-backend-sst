import Elysia, { t } from "elysia";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { coreErrorHandler } from "../errorHandler";
import { EntitlementError } from "../../application/entitlement/assertEntitlement";

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
    // Causes are folded INTO the main `[api:error]` summary line as
    // JSON. Earlier impl logged each cause on a separate line, but
    // CloudWatch sometimes orphaned those into separate entries when
    // copy/pasted, leaving triage users staring at "Failed query: ..."
    // without the postgres-side reason. The assertion now requires
    // the cause's driver code to appear inline in the summary log.
    const summaryLogs = consoleErrorSpy.mock.calls.filter((c) =>
      String(c[0]).startsWith("[api:error]"),
    );
    expect(summaryLogs.length).toBeGreaterThan(0);
    const summaryLine = String(summaryLogs[0]?.[0]);
    expect(summaryLine).toContain("28P01");
    expect(summaryLine).toContain("password authentication failed");
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

  // ─── EntitlementError → 402 mapping (M10.5) ────────────────────────
  //
  // Spec: specs/11-payments-subscriptions/design.md
  //       § Entitlement enforcement (M10.5) > 402 response shape
  // The wire field names MUST be snake_case and match the mobile
  // adapter's parser verbatim — these tests are the contract.
  describe("EntitlementError → HTTP 402 mapping", () => {
    it("maps a limit deny to 402 with the spec snake_case body", async () => {
      delete process.env.SST_STAGE;
      const app = new Elysia().use(coreErrorHandler).post("/workouts", () => {
        throw new EntitlementError(
          {
            allowed: false,
            reason: "limit",
            currentTier: "free",
            upgradeTo: "premium",
            upgradePriceMonthly: 7.99,
          },
          "create_workout",
        );
      });

      const response = await app.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
      );

      expect(response.status).toBe(402);
      const body = await jsonBody(response);
      // EXACT field names + values — mobile parses these verbatim.
      expect(body).toMatchObject({
        code: "ENTITLEMENT_DENIED",
        error: "Subscription does not include this feature",
        feature: "create_workout",
        reason: "limit",
        current_tier: "free",
        upgrade_to: "premium",
        upgrade_price_monthly: 7.99,
      });
    });

    it("maps a cancelled deny to 402 with null upgrade fields", async () => {
      delete process.env.SST_STAGE;
      const app = new Elysia().use(coreErrorHandler).post("/workouts", () => {
        throw new EntitlementError(
          {
            allowed: false,
            reason: "cancelled",
            currentTier: "premium",
            upgradeTo: null,
            upgradePriceMonthly: null,
          },
          "create_workout",
        );
      });

      const response = await app.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
      );

      expect(response.status).toBe(402);
      const body = await jsonBody(response);
      expect(body).toEqual(
        expect.objectContaining({
          code: "ENTITLEMENT_DENIED",
          feature: "create_workout",
          reason: "cancelled",
          current_tier: "premium",
          upgrade_to: null,
          upgrade_price_monthly: null,
        }),
      );
    });

    it("does NOT include stack / causes on the 402 response (it's not a server fault)", async () => {
      delete process.env.SST_STAGE;
      const app = new Elysia().use(coreErrorHandler).post("/workouts", () => {
        throw new EntitlementError(
          {
            allowed: false,
            reason: "limit",
            currentTier: "free",
            upgradeTo: "premium",
            upgradePriceMonthly: 7.99,
          },
          "create_workout",
        );
      });
      const response = await app.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
      );
      const body = await jsonBody(response);
      // The generic 500 path serializes stack + causes; the 402 branch
      // intentionally returns ONLY the entitlement contract fields so
      // the wire shape is stable for the mobile adapter.
      expect(body.stack).toBeUndefined();
      expect(body.causes).toBeUndefined();
      expect(body.detail).toBeUndefined();
    });

    it("logs a concise [api:402] line (not the generic [api:error] line)", async () => {
      delete process.env.SST_STAGE;
      const app = new Elysia().use(coreErrorHandler).post("/workouts", () => {
        throw new EntitlementError(
          {
            allowed: false,
            reason: "limit",
            currentTier: "free",
            upgradeTo: "premium",
            upgradePriceMonthly: 7.99,
          },
          "create_workout",
        );
      });
      await app.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
      );

      const calls = consoleErrorSpy.mock.calls.map((c) => String(c[0]));
      const has402Log = calls.some((line) => line.startsWith("[api:402]"));
      const hasGenericErrorLog = calls.some((line) =>
        line.startsWith("[api:error]"),
      );
      expect(has402Log).toBe(true);
      expect(hasGenericErrorLog).toBe(false);
    });

    it("surfaces requestId on the 402 body when x-amz-request-id is set", async () => {
      delete process.env.SST_STAGE;
      const app = new Elysia().use(coreErrorHandler).post("/workouts", () => {
        throw new EntitlementError(
          {
            allowed: false,
            reason: "limit",
            currentTier: "free",
            upgradeTo: "premium",
            upgradePriceMonthly: 7.99,
          },
          "create_workout",
        );
      });
      const response = await app.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-amz-request-id": "req-xyz",
          },
          body: "{}",
        }),
      );
      const body = await jsonBody(response);
      expect(body.requestId).toBe("req-xyz");
    });
  });
});
