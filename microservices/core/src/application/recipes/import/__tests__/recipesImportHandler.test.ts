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

const entitlement = vi.hoisted(() => vi.fn());
const reserve = vi.hoisted(() => vi.fn());
const extract = vi.hoisted(() => vi.fn());
vi.mock("../../../entitlement/assertEntitlement", () => ({
  assertEntitlement: entitlement,
}));
vi.mock("../../../repositories/aiUsageLogRepository", () => ({
  AiUsageLogRepository: vi
    .fn()
    .mockImplementation(() => ({ reserveForUserToday: reserve })),
}));
vi.mock("../../services/aiRecipeFromText", async (orig) => ({
  ...(await orig<typeof import("../../services/aiRecipeFromText")>()),
  extractRecipeFromText: extract,
}));

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
  beforeEach(() => {
    vi.clearAllMocks();
    entitlement.mockResolvedValue({ allowed: true });
    reserve.mockResolvedValue(true);
    extract.mockResolvedValue(null);
  });

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
    expect(data.extractionMethod).toBe("structured");
    expect(extract).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(data.sourceUrl).toBe("https://x.test/final");
  });
  it("uses entitled AI fallback only after deterministic failure and reserves before inference", async () => {
    vi.mocked(safeRecipeFetch).mockResolvedValue({
      html: "<main>Soup Ingredients 100g peas. Simmer peas.</main>",
      finalUrl: "https://x.test/final",
    });
    vi.mocked(parseRecipeFromHtml).mockReturnValue(null);
    extract.mockImplementation(async () => {
      expect(reserve).toHaveBeenCalledWith({
        userId: "test-user-id",
        endpoint: "/recipes/import",
        limit: 12,
        requestSizeBytes: expect.any(Number),
      });
      return {
        name: "Soup",
        ingredients: ["100g peas"],
        instructions: "Simmer peas.",
        servings: null,
        nutrition: null,
        extractionMethod: "ai",
      };
    });
    const { recipesImportHandler } = await import("../recipesImportHandler");
    const res = await recipesImportHandler.handle(
      post("https://x.test/r?secret=token"),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data).toMatchObject({
      extractionMethod: "ai",
      sourceUrl: "https://x.test/final",
    });
    expect(extract.mock.calls[0][0]).not.toContain("token");
    expect(extract.mock.calls[0][0]).not.toContain("<main>");
  });

  it.each(["entitlement", "quota", "storage", "provider"])(
    "retains manual recovery on %s rejection",
    async (failure) => {
      vi.mocked(safeRecipeFetch).mockResolvedValue({
        html: "<main>Soup Ingredients 100g peas. Simmer peas.</main>",
        finalUrl: "https://x.test/r",
      });
      vi.mocked(parseRecipeFromHtml).mockReturnValue(null);
      if (failure === "entitlement")
        entitlement.mockResolvedValue({ allowed: false });
      if (failure === "quota") reserve.mockResolvedValue(false);
      if (failure === "storage")
        reserve.mockRejectedValue(new Error("DB down"));
      if (failure === "provider")
        extract.mockRejectedValue(new Error("timeout"));
      const { recipesImportHandler } = await import("../recipesImportHandler");
      const res = await recipesImportHandler.handle(post("https://x.test/r"));
      expect(res.status).toBe(422);
      if (failure !== "provider") expect(extract).not.toHaveBeenCalled();
      if (failure === "entitlement") expect(reserve).not.toHaveBeenCalled();
    },
  );

  it("never calls AI after blocked private URL fetch", async () => {
    vi.mocked(safeRecipeFetch).mockRejectedValue(
      new RecipeFetchError("hostname_resolves_to_private_address"),
    );
    const { recipesImportHandler } = await import("../recipesImportHandler");
    expect(
      (await recipesImportHandler.handle(post("http://169.254.169.254/")))
        .status,
    ).toBe(400);
    expect(extract).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });
});
