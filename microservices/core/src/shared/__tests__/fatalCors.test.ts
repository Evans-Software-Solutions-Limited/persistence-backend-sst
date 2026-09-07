import { describe, expect, it } from "vitest";

// Extracted from `api.ts` precisely so it can be tested: importing `api.ts`
// requires live SST resource links, so nothing in it was coverable.
// No mocks needed: `fatalCors.ts` is a leaf module that touches nothing.

import { fatalCorsHeaders } from "../fatalCors";

const WEB = "https://persistence.evans-software-solutions.com";

/**
 * The 500 the Lambda synthesises when an error ESCAPES Elysia's lifecycle.
 *
 * `adminGuard` calls `getAuthUser` inside `.derive`, and a JWKS fetch failing
 * there is one of the errors known to land here rather than in
 * `coreErrorHandler`. Without CORS on this response the admin panel shows an
 * opaque CORS failure and `adminFetch` never sees the 500 — an outage that
 * cannot be read from the client is far worse than one that can.
 */
describe("fatalCorsHeaders", () => {
  it("allows the website to read a fatal admin 500", () => {
    expect(
      fatalCorsHeaders({ rawPath: "/admin/summary", headers: { origin: WEB } }),
    ).toMatchObject({ "access-control-allow-origin": WEB });
  });

  it("adds nothing for a non-admin path", () => {
    // Those routes set their own policy; this backstop must not impose the
    // admin one on them.
    expect(
      fatalCorsHeaders({
        rawPath: "/leads/waitlist",
        headers: { origin: WEB },
      }),
    ).toEqual({});
  });

  it("does not name an origin it does not know", () => {
    const headers = fatalCorsHeaders({
      rawPath: "/admin/summary",
      headers: { origin: "https://evil.test" },
    });
    expect(headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("finds Origin whatever its casing", () => {
    // API Gateway v2 lower-cases header names, but this runs on the path where
    // something has already gone wrong — it should not also assume.
    expect(
      fatalCorsHeaders({ rawPath: "/admin/x", headers: { Origin: WEB } }),
    ).toMatchObject({ "access-control-allow-origin": WEB });
  });

  it("never throws on a malformed event", () => {
    // It runs while handling a crash; throwing here would replace a readable
    // 500 with an unhandled rejection.
    for (const event of [undefined, null, {}, { rawPath: 5 }, "nonsense"]) {
      expect(() => fatalCorsHeaders(event)).not.toThrow();
    }
  });
});
