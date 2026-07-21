import { act, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { useRecipeDraft } from "@/state/recipe-draft";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { RecipeImportPresenterProps } from "@/ui/presenters/RecipeImportPresenter";
import { RecipeImportContainer } from "../RecipeImportContainer";

const mockProbe: { last: RecipeImportPresenterProps | null } = { last: null };
jest.mock("@/ui/presenters/RecipeImportPresenter", () => ({
  RecipeImportPresenter: (props: RecipeImportPresenterProps) => {
    mockProbe.last = props;
    return null;
  },
}));

const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: {
    back: (...args: unknown[]) => mockRouterBack(...args),
    replace: (...args: unknown[]) => mockRouterReplace(...args),
  },
}));

function makeAdapters(): { adapters: Adapters; api: InMemoryApiAdapter } {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: "user-1",
    email: "a@b.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  return {
    api,
    adapters: {
      api,
      auth,
      storage,
      health: {} as Adapters["health"],
      notifications: {} as Adapters["notifications"],
      payments: {} as Adapters["payments"],
      netInfo: {} as Adapters["netInfo"],
    },
  };
}

function Wrapper({
  adapters,
  children,
}: {
  adapters: Adapters;
  children: ReactNode;
}) {
  return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
}

describe("RecipeImportContainer", () => {
  beforeEach(() => {
    mockProbe.last = null;
    mockRouterBack.mockClear();
    mockRouterReplace.mockClear();
    useRecipeDraft.getState().clear();
  });

  it("starts in the input stage with an empty URL", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeImportContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.stage).toBe("input");
    expect(mockProbe.last?.url).toBe("");
  });

  it("onUrlChange updates the URL", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeImportContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onUrlChange("https://x.test/soup"));
    expect(mockProbe.last?.url).toBe("https://x.test/soup");
  });

  it("onImport is a no-op with a blank/whitespace URL", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeImportContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onUrlChange("   "));
    await act(async () => {
      mockProbe.last!.onImport();
    });
    expect(mockProbe.last?.stage).toBe("input");
  });

  it("on success: seeds the draft store (source=import) and replaces to recipe-create", async () => {
    const { adapters, api } = makeAdapters();
    api.importedRecipe = {
      name: "Soup",
      servings: 4,
      instructions: "Boil it",
      ingredients: ["Water", "Salt"],
      sourceUrl: "",
      nutrition: null,
    };
    render(
      <Wrapper adapters={adapters}>
        <RecipeImportContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onUrlChange("https://x.test/soup"));
    await act(async () => {
      mockProbe.last!.onImport();
    });
    await waitFor(() =>
      expect(mockRouterReplace).toHaveBeenCalledWith(
        "/(app)/fuel/recipe-create",
      ),
    );
    expect(useRecipeDraft.getState().seed).toEqual({
      title: "Soup",
      servings: 4,
      instructions: "Boil it",
      ingredients: [
        { name: "Water", quantity: null, unit: null },
        { name: "Salt", quantity: null, unit: null },
      ],
      source: "import",
      nutrition: null,
      // The in-memory fake's importRecipeUrl echoes back the requested URL
      // (mirrors the real scrape endpoint returning the page it fetched).
      sourceUrl: "https://x.test/soup",
    });
  });

  it("on success with scraped per-serving nutrition: carries it through to the seed", async () => {
    const { adapters, api } = makeAdapters();
    api.importedRecipe = {
      name: "Soup",
      servings: 4,
      instructions: "Boil it",
      ingredients: ["Water", "Salt"],
      sourceUrl: "https://x.test/soup",
      nutrition: { kcal: 100, proteinG: 5, carbsG: 10, fatG: 2 },
    };
    render(
      <Wrapper adapters={adapters}>
        <RecipeImportContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onUrlChange("https://x.test/soup"));
    await act(async () => {
      mockProbe.last!.onImport();
    });
    await waitFor(() =>
      expect(mockRouterReplace).toHaveBeenCalledWith(
        "/(app)/fuel/recipe-create",
      ),
    );
    expect(useRecipeDraft.getState().seed?.nutrition).toEqual({
      kcal: 100,
      proteinG: 5,
      carbsG: 10,
      fatG: 2,
    });
    expect(useRecipeDraft.getState().seed?.sourceUrl).toBe(
      "https://x.test/soup",
    );
  });

  it("on 422 (no microdata): shows the no-microdata stage", async () => {
    const { adapters } = makeAdapters();
    // No `api.importedRecipe` set → InMemoryApiAdapter.importRecipeUrl 422s.
    render(
      <Wrapper adapters={adapters}>
        <RecipeImportContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onUrlChange("https://x.test/blank"));
    await act(async () => {
      mockProbe.last!.onImport();
    });
    await waitFor(() => expect(mockProbe.last?.stage).toBe("no-microdata"));
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it("Create manually navigates to recipe-create with no seed", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeImportContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onCreateManually());
    expect(mockRouterReplace).toHaveBeenCalledWith("/(app)/fuel/recipe-create");
    expect(useRecipeDraft.getState().seed).toBeNull();
  });

  it("on other failures: shows the error stage, and Retry resets to input", async () => {
    const { adapters, api } = makeAdapters();
    api.shouldFail = true;
    render(
      <Wrapper adapters={adapters}>
        <RecipeImportContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onUrlChange("https://x.test/x"));
    await act(async () => {
      mockProbe.last!.onImport();
    });
    await waitFor(() => expect(mockProbe.last?.stage).toBe("error"));

    act(() => mockProbe.last!.onRetry());
    expect(mockProbe.last?.stage).toBe("input");
  });

  it("Back routes back", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeImportContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onBack());
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });
});
