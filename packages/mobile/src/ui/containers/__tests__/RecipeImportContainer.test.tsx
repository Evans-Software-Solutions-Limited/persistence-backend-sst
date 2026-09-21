import { act, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import * as Clipboard from "expo-clipboard";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { useRecipeDraft } from "@/state/recipe-draft";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { RecipeImportPresenterProps } from "@/ui/presenters/RecipeImportPresenter";
import { RecipeImportContainer } from "../RecipeImportContainer";

jest.mock("expo-clipboard", () => ({ getStringAsync: jest.fn() }));

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
    jest.mocked(Clipboard.getStringAsync).mockReset();
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

  it("reads clipboard only on demand and fills the URL without importing", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeImportContainer />
      </Wrapper>,
    );
    expect(Clipboard.getStringAsync).not.toHaveBeenCalled();
    jest
      .mocked(Clipboard.getStringAsync)
      .mockResolvedValue(" https://recipes.example/chicken?token=abc ");
    await act(async () => {
      mockProbe.last!.onPasteUrl();
    });
    expect(mockProbe.last?.url).toBe(
      "https://recipes.example/chicken?token=abc",
    );
    expect(mockProbe.last?.stage).toBe("input");
    expect(mockProbe.last?.isPasting).toBe(false);
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it.each(["", "   ", "Some recipe text", "javascript:alert(1)"])(
    "keeps the entered URL and explains unusable clipboard content: %p",
    async (value) => {
      const { adapters } = makeAdapters();
      render(
        <Wrapper adapters={adapters}>
          <RecipeImportContainer />
        </Wrapper>,
      );
      act(() =>
        mockProbe.last!.onUrlChange("https://recipes.example/original"),
      );
      jest.mocked(Clipboard.getStringAsync).mockResolvedValue(value);
      await act(async () => {
        mockProbe.last!.onPasteUrl();
      });
      expect(mockProbe.last?.url).toBe("https://recipes.example/original");
      expect(mockProbe.last?.pasteError).toBeTruthy();
      expect(mockProbe.last?.isPasting).toBe(false);
      act(() => mockProbe.last!.onUrlChange("https://recipes.example/new"));
      expect(mockProbe.last?.pasteError).toBeNull();
    },
  );

  it("handles clipboard permission errors and allows another attempt", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeImportContainer />
      </Wrapper>,
    );
    jest
      .mocked(Clipboard.getStringAsync)
      .mockRejectedValueOnce(new Error("Denied"));
    await act(async () => {
      mockProbe.last!.onPasteUrl();
    });
    expect(mockProbe.last?.pasteError).toContain(
      "Couldn’t read your clipboard",
    );
    expect(mockProbe.last?.isPasting).toBe(false);
    jest
      .mocked(Clipboard.getStringAsync)
      .mockResolvedValueOnce("https://recipes.example/soup");
    await act(async () => {
      mockProbe.last!.onPasteUrl();
    });
    expect(mockProbe.last?.pasteError).toBeNull();
    expect(mockProbe.last?.url).toBe("https://recipes.example/soup");
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
      extractionMethod: "ai",
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
      extractionMethod: "ai",
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

  it("Create manually navigates with a fresh draft", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeImportContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onCreateManually());
    expect(mockRouterReplace).toHaveBeenCalledWith("/(app)/fuel/recipe-create");
    expect(useRecipeDraft.getState().seed).toMatchObject({
      source: "manual",
      title: "",
      sourceUrl: null,
    });
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
  it("pasted recovery retains the source and exact lines for review without inventing macros", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeImportContainer />
      </Wrapper>,
    );
    act(() => {
      mockProbe.last!.onUrlChange(" https://recipes.example/soup ");
      mockProbe.last!.onPasteRecipe();
    });
    expect(mockProbe.last!.stage).toBe("paste");
    act(() => mockProbe.last!.onReviewPasted());
    expect(mockRouterReplace).not.toHaveBeenCalled();
    act(() => {
      mockProbe.last!.onPastedTitleChange(" Soup ");
      mockProbe.last!.onPastedIngredientsChange(" 200g lentils\r\n\n1 onion ");
      mockProbe.last!.onPastedInstructionsChange(" Simmer for 20 minutes ");
    });
    act(() => mockProbe.last!.onReviewPasted());
    expect(useRecipeDraft.getState().seed).toEqual({
      title: "Soup",
      servings: null,
      source: "manual",
      sourceUrl: "https://recipes.example/soup",
      instructions: "Simmer for 20 minutes",
      ingredients: [
        { name: "200g lentils", quantity: null, unit: null },
        { name: "1 onion", quantity: null, unit: null },
      ],
    });
    expect(mockRouterReplace).toHaveBeenCalledWith("/(app)/fuel/recipe-create");
  });
  it("keeps source in manual recovery and rejects non-web source schemes", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeImportContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onUrlChange("https://recipes.example/soup"));
    act(() => mockProbe.last!.onCreateManually());
    expect(useRecipeDraft.getState().seed?.sourceUrl).toBe(
      "https://recipes.example/soup",
    );
    act(() => mockProbe.last!.onUrlChange("javascript:alert(1)"));
    act(() => mockProbe.last!.onCreateManually());
    expect(useRecipeDraft.getState().seed?.sourceUrl).toBeNull();
    act(() => {
      mockProbe.last!.onPastedTitleChange("Soup");
      mockProbe.last!.onPastedIngredientsChange("\n  ");
    });
    mockRouterReplace.mockClear();
    act(() => mockProbe.last!.onReviewPasted());
    expect(mockRouterReplace).not.toHaveBeenCalled();
    act(() => mockProbe.last!.onPastedIngredientsChange("Rice"));
    act(() => mockProbe.last!.onReviewPasted());
    expect(useRecipeDraft.getState().seed?.instructions).toBeNull();
  });
});
