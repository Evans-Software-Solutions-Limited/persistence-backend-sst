import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let envMap: Record<string, string> = {};

vi.mock("@persistence/api-utils/env", () => ({
  getEnvOrDefault: vi.fn((name: string, def: string) => envMap[name] ?? def),
}));

import { isTurnstileConfigured, verifyTurnstile } from "../turnstile";

function stubFetch(impl: () => Promise<Response> | Response) {
  const fetchMock = vi.fn<(...args: unknown[]) => Promise<Response> | Response>(
    () => impl(),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("verifyTurnstile", () => {
  beforeEach(() => {
    envMap = {};
  });
  afterEach(() => vi.unstubAllGlobals());

  it("skips (allow) + no fetch when unconfigured", async () => {
    const fetchMock = stubFetch(() => new Response("{}"));
    expect(isTurnstileConfigured()).toBe(false);
    expect(await verifyTurnstile("anything")).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports missing_token when configured but no token given", async () => {
    envMap = { TURNSTILE_SECRET: "s" };
    const fetchMock = stubFetch(() => new Response("{}"));
    expect(await verifyTurnstile(undefined)).toBe("missing_token");
    expect(await verifyTurnstile("")).toBe("missing_token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes when Cloudflare returns success:true", async () => {
    envMap = { TURNSTILE_SECRET: "s" };
    const fetchMock = stubFetch(
      () => new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    expect(await verifyTurnstile("tok")).toBe("passed");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("challenges.cloudflare.com");
    // secret goes in the urlencoded body
    expect(init.body).toContain("response=tok");
  });

  it("fails when success is not true", async () => {
    envMap = { TURNSTILE_SECRET: "s" };
    stubFetch(
      () => new Response(JSON.stringify({ success: false }), { status: 200 }),
    );
    expect(await verifyTurnstile("tok")).toBe("failed");
  });

  it("fails closed on a non-2xx or a thrown fetch", async () => {
    envMap = { TURNSTILE_SECRET: "s" };
    stubFetch(() => new Response("nope", { status: 500 }));
    expect(await verifyTurnstile("tok")).toBe("failed");

    stubFetch(() => {
      throw new Error("network down");
    });
    expect(await verifyTurnstile("tok")).toBe("failed");
  });
});
