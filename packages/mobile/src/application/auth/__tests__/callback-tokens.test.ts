import { parseAuthCallbackUrl } from "../callback-tokens";

describe("parseAuthCallbackUrl", () => {
  it("reads tokens and type from the fragment (Supabase implicit flow)", () => {
    const result = parseAuthCallbackUrl(
      "persistencemobile://auth/callback#access_token=abc&refresh_token=def&type=signup",
    );
    expect(result).toEqual({
      accessToken: "abc",
      refreshToken: "def",
      type: "signup",
      error: null,
      errorDescription: null,
    });
  });

  it("falls back to the query string when there is no fragment", () => {
    const result = parseAuthCallbackUrl(
      "persistencemobile://auth/callback?access_token=q-access&refresh_token=q-refresh&type=recovery",
    );
    expect(result.accessToken).toBe("q-access");
    expect(result.refreshToken).toBe("q-refresh");
    expect(result.type).toBe("recovery");
  });

  it("does not read the query when a fragment is present but only carries the query token", () => {
    // Fragment wins, but a value missing from the fragment is still picked up
    // from the query rather than clobbered to null.
    const result = parseAuthCallbackUrl(
      "persistencemobile://auth/callback?refresh_token=from-query#access_token=from-fragment",
    );
    expect(result.accessToken).toBe("from-fragment");
    expect(result.refreshToken).toBe("from-query");
  });

  it("surfaces an error fragment with no tokens", () => {
    const result = parseAuthCallbackUrl(
      "persistencemobile://auth/callback#error=access_denied&error_description=Email+link+is+invalid",
    );
    expect(result.accessToken).toBeNull();
    expect(result.refreshToken).toBeNull();
    expect(result.error).toBe("access_denied");
    // URLSearchParams decodes `+` to a space.
    expect(result.errorDescription).toBe("Email link is invalid");
  });

  it("returns all-null for null, empty, or paramless URLs", () => {
    const allNull = {
      accessToken: null,
      refreshToken: null,
      type: null,
      error: null,
      errorDescription: null,
    };
    expect(parseAuthCallbackUrl(null)).toEqual(allNull);
    expect(parseAuthCallbackUrl(undefined)).toEqual(allNull);
    expect(parseAuthCallbackUrl("")).toEqual(allNull);
    expect(parseAuthCallbackUrl("persistencemobile://auth/callback")).toEqual(
      allNull,
    );
  });
});
