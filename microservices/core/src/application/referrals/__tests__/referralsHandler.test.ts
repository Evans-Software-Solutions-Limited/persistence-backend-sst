/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@persistence/api-utils/auth/supabaseAuth", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@persistence/api-utils/auth/supabaseAuth")
    >();
  return {
    ...actual,
    getAuthUser: vi.fn(async (authHeader: string | undefined) =>
      authHeader?.startsWith("Bearer ")
        ? {
            sub: authHeader.slice(7),
            email: "u@x.co",
            email_verified: true,
            iat: 0,
            exp: 9e9,
          }
        : null,
    ),
  };
});

const repo = {
  claim: vi.fn(),
  findAppliedForUser: vi.fn(),
  remove: vi.fn(),
};
vi.mock("../../repositories/referralRepository", () => ({
  ReferralRepository: vi.fn().mockImplementation(() => repo),
}));

const applied = {
  codeId: "c1",
  code: "UonFreshers",
  label: "UoN",
  partnerName: null,
  lockedAt: null,
  source: "app",
  createdAt: new Date(),
};

function claim(code: string, user = "user-1") {
  return new Request("http://localhost/referrals/claim", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${user}`,
    },
    body: JSON.stringify({ code }),
  });
}

describe("referralsHandler", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { resetClaimRateLimit } = await import("../referralsHandler");
    resetClaimRateLimit();
  });

  it("requires auth", async () => {
    const { referralsHandler } = await import("../referralsHandler");
    const res = await referralsHandler.handle(
      new Request("http://localhost/referrals/me"),
    );
    expect(res.status).toBe(401);
  });

  it("normalises the code and applies it", async () => {
    repo.claim.mockResolvedValue({
      kind: "applied",
      applied,
      replacedCodeId: null,
    });
    const { referralsHandler } = await import("../referralsHandler");
    const res = await referralsHandler.handle(claim(" uon-freshers "));
    expect(res.status).toBe(200);
    expect(repo.claim).toHaveBeenCalledWith({
      userId: "user-1",
      canonicalCode: "UONFRESHERS",
      source: "app",
    });
    expect(((await res.json()) as any).data.applied.code).toBe("UonFreshers");
  });

  it("returns the SAME 404 for malformed and unknown codes (no enumeration)", async () => {
    repo.claim.mockResolvedValue({ kind: "invalid" });
    const { referralsHandler } = await import("../referralsHandler");
    const malformed = await referralsHandler.handle(claim("a!"));
    const unknown = await referralsHandler.handle(claim("NOPE1234"));
    expect(malformed.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await malformed.json()).toEqual(await unknown.json());
    // Malformed codes never hit the database.
    expect(repo.claim).toHaveBeenCalledTimes(1);
  });

  it("409s when the attribution is locked", async () => {
    repo.claim.mockResolvedValue({
      kind: "locked",
      applied: { ...applied, lockedAt: new Date() },
    });
    const { referralsHandler } = await import("../referralsHandler");
    const res = await referralsHandler.handle(claim("OTHER123"));
    expect(res.status).toBe(409);
  });

  it("rate-limits the 11th attempt in an hour per user", async () => {
    repo.claim.mockResolvedValue({ kind: "invalid" });
    const { referralsHandler } = await import("../referralsHandler");
    for (let i = 0; i < 10; i++) {
      expect(
        (await referralsHandler.handle(claim("NOPE1234", "spammer"))).status,
      ).toBe(404);
    }
    expect(
      (await referralsHandler.handle(claim("NOPE1234", "spammer"))).status,
    ).toBe(429);
    // Other users unaffected.
    expect(
      (await referralsHandler.handle(claim("NOPE1234", "someone-else"))).status,
    ).toBe(404);
  });

  it("GET /referrals/me and DELETE /referrals/me", async () => {
    repo.findAppliedForUser.mockResolvedValue(applied);
    repo.remove
      .mockResolvedValueOnce("removed")
      .mockResolvedValueOnce("locked");
    const { referralsHandler } = await import("../referralsHandler");
    const me = await referralsHandler.handle(
      new Request("http://localhost/referrals/me", {
        headers: { authorization: "Bearer user-1" },
      }),
    );
    expect(((await me.json()) as any).data.applied.label).toBe("UoN");
    const del = await referralsHandler.handle(
      new Request("http://localhost/referrals/me", {
        method: "DELETE",
        headers: { authorization: "Bearer user-1" },
      }),
    );
    expect(((await del.json()) as any).data.removed).toBe(true);
    const locked = await referralsHandler.handle(
      new Request("http://localhost/referrals/me", {
        method: "DELETE",
        headers: { authorization: "Bearer user-1" },
      }),
    );
    expect(locked.status).toBe(409);
  });
});
