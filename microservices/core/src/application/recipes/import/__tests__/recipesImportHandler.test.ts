/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (h: string | undefined) =>
    !h || !h.startsWith("Bearer ")
      ? null
      : { sub: "test-user-id", email: "t@e.com", iat: 0, exp: 9999999999 },
  ),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user || { sub: "test-user-id" }),
}));
// Keep RecipeFetchError real (handler uses instanceof); mock only the fetch.
vi.mock("../../services/url-fetch", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, safeRecipeFetch: vi.fn() };
});
vi.mock("../../services/parseRecipe", () => ({
  parseRecipeFromHtml: vi.fn(),
}));
import { safeRecipeFetch, RecipeFetchError } from "../../services/url-fetch";
import { parseRecipeFromHtml } from "../../services/parseRecipe";

function post(url: string, auth = true) {
  return new Request("http://localhost/recipes/import", {
    method: "POST",
    body: JSON.stringify({ url }),
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: "Bearer token" } : {}),
    },
  });
}

describe("recipesImportHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires auth", async () => {
    const { recipesImportHandler } = await import("../recipesImportHandler");
    expect(
      (await recipesImportHandler.handle(post("https://x.test/r", false)))
        .status,
    ).toBe(401);
  });

  it("400s on an SSRF / fetch guard failure, surfacing the reason", async () => {
    (safeRecipeFetch as any).mockRejectedValue(
      new RecipeFetchError("hostname_resolves_to_private_address"),
    );
    const { recipesImportHandler } = await import("../recipesImportHandler");
    const res = await recipesImportHandler.handle(
      post("http://169.254.169.254/"),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe(
      "hostname_resolves_to_private_address",
    );
  });

  it("422s when the page has no Recipe microdata", async () => {
    (safeRecipeFetch as any).mockResolvedValue({
      html: "<html>no recipe</html>",
      finalUrl: "https://x.test/r",
    });
    (parseRecipeFromHtml as any).mockReturnValue(null);
    const { recipesImportHandler } = await import("../recipesImportHandler");
    const res = await recipesImportHandler.handle(post("https://x.test/r"));
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error).toBe("no_recipe_microdata");
  });

  it("returns the parsed pre-fill payload with the final URL", async () => {
    (safeRecipeFetch as any).mockResolvedValue({
      html: "<html>ok</html>",
      finalUrl: "https://x.test/final",
    });
    (parseRecipeFromHtml as any).mockReturnValue({
      name: "Bowl",
      servings: 2,
      instructions: "mix",
      ingredients: ["rice"],
    });
    const { recipesImportHandler } = await import("../recipesImportHandler");
    const res = await recipesImportHandler.handle(post("https://x.test/r"));
    expect(res.status).toBe(200);
    const data = ((await res.json()) as any).data;
    expect(data.name).toBe("Bowl");
    expect(data.sourceUrl).toBe("https://x.test/final");
  });
});
