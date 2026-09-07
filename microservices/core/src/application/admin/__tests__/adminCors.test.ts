import { describe, expect, it, vi } from "vitest";
import Elysia from "elysia";

/**
 * CORS on `/admin/*`, driven through `adminRoutes` as it is actually mounted.
 *
 * Deliberately an integration-shaped test rather than a unit test of the
 * header builder. What broke the admin panel was not the header VALUES — it
 * was that no hook ran for a preflight at all, and Elysia's hook scoping is
 * not something you can settle by reading. So these assertions go through the
 * real barrel, with the real guard in front of the real handlers.
 */

const getAuthUserMock = vi.hoisted(() => vi.fn());
vi.mock("@persistence/api-utils/auth/supabaseAuth", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@persistence/api-utils/auth/supabaseAuth")
    >();
  return { ...actual, getAuthUser: getAuthUserMock };
});
// Never reached: every assertion here stops at the preflight or the guard.
vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { adminRoutes } from "../../adminRoutes";
import { adminCorsHeaders, isAllowedAdminOrigin } from "../adminCors";

const WEB = "https://persistence.evans-software-solutions.com";
const app = new Elysia().use(adminRoutes);

const call = (
  method: string,
  path: string,
  origin: string | undefined,
  extra: Record<string, string> = {},
) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(origin ? { origin } : {}),
        ...extra,
      },
    }),
  );

describe("the admin preflight", () => {
  it("answers OPTIONS with the allow headers, without a bearer token", async () => {
    // The whole bug. A preflight carries no Authorization header, so if it
    // reaches `adminGuard` it is refused — and the browser reports that as a
    // CORS error, which is why the panel could not reach one endpoint.
    getAuthUserMock.mockRejectedValue(new Error("guard must not run"));
    const res = await call("OPTIONS", "/admin/summary", WEB);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(WEB);
    expect(res.headers.get("access-control-allow-headers")).toContain(
      "authorization",
    );
    expect(res.headers.get("access-control-allow-methods")).toContain("PATCH");
    expect(getAuthUserMock).not.toHaveBeenCalled();
  });

  it("allows every method the panel actually uses", async () => {
    // `adminFetch` issues GET, POST, PATCH and DELETE. A method missing here
    // fails only the calls that use it, so a partial list looks fine until
    // somebody tries to revoke a grant.
    const res = await call("OPTIONS", "/admin/summary", WEB);
    const allowed = res.headers.get("access-control-allow-methods") ?? "";
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      expect(allowed).toContain(method);
    }
  });

  it("refuses to name an origin it does not know", async () => {
    const res = await call("OPTIONS", "/admin/summary", "https://evil.test");
    // Still 204 — a preflight is a question, and the answer is simply an
    // absent allow header, which the browser treats as "no".
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("varies on Origin even when it refuses", async () => {
    // The response body/headers depend on the request origin either way, so a
    // shared cache must key on it either way — otherwise one origin can be
    // served another's allow header.
    for (const origin of [WEB, "https://evil.test"]) {
      const res = await call("OPTIONS", "/admin/summary", origin);
      expect(res.headers.get("vary")).toContain("Origin");
    }
  });
});

describe("CORS on the admin responses themselves", () => {
  it("puts the allow header on a REFUSAL, so the panel can read the 401", async () => {
    // Without this the page sees a CORS error rather than 401, so
    // `adminFetch` never clears the stored session and the user is stuck on a
    // dead panel instead of being sent back to sign in.
    getAuthUserMock.mockRejectedValue(
      Object.assign(new Error("no token"), { status: 401 }),
    );
    const res = await call("GET", "/admin/summary", WEB);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get("access-control-allow-origin")).toBe(WEB);
  });

  it("puts the allow header on a SUCCESSFUL admin response", async () => {
    // The refusal case above exercises `onError`; this exercises `onRequest`'s
    // header injection on the path that matters most. Without it every 2xx the
    // panel receives is unreadable, which is the same outcome as a 401 being
    // unreadable but far easier to miss in testing, because the request does
    // reach the server and does succeed.
    const probed = new Elysia()
      .use(adminRoutes)
      .get("/admin/_probe", () => ({ ok: true }));
    const res = await probed.handle(
      new Request("http://localhost/admin/_probe", {
        headers: { origin: WEB },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(WEB);
    expect(res.headers.get("vary")).toContain("Origin");
  });

  it("leaves non-admin routes alone", async () => {
    // `onRequest` runs before routing, so once this plugin is merged into the
    // root chain its hook sees every request the API serves. `/leads` and
    // `/founding/*` set their own permissive policy and must not be given the
    // admin allow-list — nor have their preflights answered here.
    const bare = new Elysia()
      .use(adminRoutes)
      .get("/exercises", () => ({ ok: true }));
    const res = await bare.handle(
      new Request("http://localhost/exercises", { headers: { origin: WEB } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBeNull();
  });

  it("does not answer a non-admin OPTIONS", async () => {
    const bare = new Elysia()
      .use(adminRoutes)
      .options("/leads/waitlist", () => new Response(null, { status: 200 }));
    const res = await bare.handle(
      new Request("http://localhost/leads/waitlist", {
        method: "OPTIONS",
        headers: { origin: "https://anywhere.test" },
      }),
    );
    // 200 from the route's own handler, not 204 from this plugin.
    expect(res.status).toBe(200);
  });
});

describe("the allowed origin", () => {
  it("is the website origin, and nothing else", () => {
    expect(isAllowedAdminOrigin(WEB)).toBe(true);
    expect(isAllowedAdminOrigin(`${WEB}.evil.test`)).toBe(false);
    expect(
      isAllowedAdminOrigin("http://persistence.evans-software-solutions.com"),
    ).toBe(false);
    expect(isAllowedAdminOrigin(undefined)).toBe(false);
    expect(isAllowedAdminOrigin("null")).toBe(false);
  });

  it("never answers a missing Origin with an allow header", () => {
    // Same-origin and server-to-server callers send no Origin. Echoing
    // anything there would be meaningless at best.
    expect(adminCorsHeaders(undefined)).toEqual({ vary: "Origin" });
  });

  it("tracks WEB_ORIGIN rather than hard-coding a host", () => {
    // Staging and production are different hosts from the same code.
    vi.stubEnv("WEB_ORIGIN", "https://staging.persistence.example");
    try {
      expect(isAllowedAdminOrigin("https://staging.persistence.example")).toBe(
        true,
      );
      expect(isAllowedAdminOrigin(WEB)).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
