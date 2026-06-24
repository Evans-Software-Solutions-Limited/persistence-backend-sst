import { describe, it, expect, vi } from "vitest";
import {
  safeRecipeFetch,
  RecipeFetchError,
  isPrivateIpv4,
  isPrivateIpv6,
  makePinnedLookup,
} from "../url-fetch";

const PUBLIC: { address: string; family: number }[] = [
  { address: "93.184.216.34", family: 4 },
];
const lookupPublic = async () => PUBLIC;
const lookupPrivate =
  (address: string, family = 4) =>
  async () => [{ address, family }];

function html200(body = "<html>ok</html>"): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

describe("isPrivateIpv4", () => {
  it.each([
    "10.0.0.1",
    "172.16.5.4",
    "192.168.1.1",
    "127.0.0.1",
    "169.254.169.254", // AWS metadata
    "0.0.0.0",
    "100.64.0.1",
    "198.18.0.1",
  ])("rejects private/reserved %s", (ip) => {
    expect(isPrivateIpv4(ip)).toBe(true);
  });
  it("allows a public address", () => {
    expect(isPrivateIpv4("93.184.216.34")).toBe(false);
  });
  it("fails closed on garbage", () => {
    expect(isPrivateIpv4("not.an.ip")).toBe(true);
  });
});

describe("isPrivateIpv6", () => {
  it.each([
    "::1",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "::ffff:169.254.169.254",
  ])("rejects %s", (ip) => {
    expect(isPrivateIpv6(ip)).toBe(true);
  });
  it("allows a public v6", () => {
    expect(isPrivateIpv6("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
  });
});

describe("makePinnedLookup (DNS-rebinding defeat)", () => {
  it("returns the validated IP for ANY hostname (single-address form)", () => {
    const lookup = makePinnedLookup({ address: "93.184.216.34", family: 4 });
    const cb = vi.fn();
    lookup("attacker.internal", {}, cb);
    expect(cb).toHaveBeenCalledWith(null, "93.184.216.34", 4);
  });

  it("returns the validated IP in the all-addresses form", () => {
    const lookup = makePinnedLookup({ address: "93.184.216.34", family: 4 });
    const cb = vi.fn();
    lookup("attacker.internal", { all: true }, cb);
    expect(cb).toHaveBeenCalledWith(null, [
      { address: "93.184.216.34", family: 4 },
    ]);
  });
});

describe("safeRecipeFetch — guards", () => {
  it("rejects a disallowed scheme without any network call", async () => {
    const fetcher = vi.fn();
    await expect(
      safeRecipeFetch("file:///etc/passwd", { fetcher, lookup: lookupPublic }),
    ).rejects.toMatchObject({ reason: "scheme_not_allowed" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a malformed URL", async () => {
    await expect(safeRecipeFetch("http://", {})).rejects.toBeInstanceOf(
      RecipeFetchError,
    );
  });

  it("rejects when the host resolves to a private address (no fetch)", async () => {
    const fetcher = vi.fn();
    await expect(
      safeRecipeFetch("http://attacker.test/recipe", {
        fetcher,
        lookup: lookupPrivate("169.254.169.254"),
      }),
    ).rejects.toMatchObject({ reason: "hostname_resolves_to_private_address" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("re-validates on redirect and blocks a redirect to a private host", async () => {
    const lookup = vi
      .fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]) // first host public
      .mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]); // redirect target private
    const fetcher = vi.fn().mockResolvedValue(
      new Response("", {
        status: 302,
        headers: { location: "http://internal.test/" },
      }),
    );
    await expect(
      safeRecipeFetch("https://recipes.test/r", { fetcher, lookup }),
    ).rejects.toMatchObject({ reason: "hostname_resolves_to_private_address" });
  });

  it("rejects too many redirects", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("", {
        status: 302,
        headers: { location: "https://recipes.test/next" },
      }),
    );
    await expect(
      safeRecipeFetch("https://recipes.test/r", {
        fetcher,
        lookup: lookupPublic,
      }),
    ).rejects.toMatchObject({ reason: "too_many_redirects" });
  });

  it("rejects a redirect without a Location header", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 302 }));
    await expect(
      safeRecipeFetch("https://recipes.test/r", {
        fetcher,
        lookup: lookupPublic,
      }),
    ).rejects.toMatchObject({ reason: "redirect_without_location" });
  });

  it("rejects a disallowed Content-Type", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );
    await expect(
      safeRecipeFetch("https://recipes.test/r", {
        fetcher,
        lookup: lookupPublic,
      }),
    ).rejects.toMatchObject({ reason: "content_type_not_allowed" });
  });

  it("rejects an oversized body", async () => {
    const big = "a".repeat(2 * 1024 * 1024 + 10);
    const fetcher = vi.fn().mockResolvedValue(html200(big));
    await expect(
      safeRecipeFetch("https://recipes.test/r", {
        fetcher,
        lookup: lookupPublic,
      }),
    ).rejects.toMatchObject({ reason: "body_too_large" });
  });

  it("surfaces a non-2xx upstream status", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 404 }));
    await expect(
      safeRecipeFetch("https://recipes.test/r", {
        fetcher,
        lookup: lookupPublic,
      }),
    ).rejects.toMatchObject({ reason: "upstream_status_404" });
  });

  it("rejects a scheme change on redirect", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("", {
        status: 302,
        headers: { location: "ftp://recipes.test/file" },
      }),
    );
    await expect(
      safeRecipeFetch("https://recipes.test/r", {
        fetcher,
        lookup: lookupPublic,
      }),
    ).rejects.toMatchObject({ reason: "scheme_not_allowed_after_redirect" });
  });

  it("wraps a network error", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      safeRecipeFetch("https://recipes.test/r", {
        fetcher,
        lookup: lookupPublic,
      }),
    ).rejects.toMatchObject({ reason: "fetch_failed" });
  });

  it("returns html on a clean public fetch", async () => {
    const fetcher = vi.fn().mockResolvedValue(html200("<html>recipe</html>"));
    const out = await safeRecipeFetch("https://recipes.test/r", {
      fetcher,
      lookup: lookupPublic,
    });
    expect(out.html).toContain("recipe");
    expect(out.finalUrl).toBe("https://recipes.test/r");
  });

  it("follows one public redirect to a clean page", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", {
          status: 301,
          headers: { location: "https://recipes.test/final" },
        }),
      )
      .mockResolvedValueOnce(html200("<html>final</html>"));
    const out = await safeRecipeFetch("https://recipes.test/r", {
      fetcher,
      lookup: lookupPublic,
    });
    expect(out.finalUrl).toBe("https://recipes.test/final");
    expect(out.html).toContain("final");
  });
});
