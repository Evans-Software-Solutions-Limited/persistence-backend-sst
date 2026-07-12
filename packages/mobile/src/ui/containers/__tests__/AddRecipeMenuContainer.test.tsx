import { act, render } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { useAddRecipeMenu } from "@/state/add-recipe-menu";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { AddRecipeMenuPresenterProps } from "@/ui/presenters/AddRecipeMenuPresenter";
import { AddRecipeMenuContainer } from "../AddRecipeMenuContainer";

const mockProbe: { last: AddRecipeMenuPresenterProps | null } = { last: null };
jest.mock("@/ui/presenters/AddRecipeMenuPresenter", () => ({
  AddRecipeMenuPresenter: (props: AddRecipeMenuPresenterProps) => {
    mockProbe.last = props;
    return null;
  },
}));

const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
}));

const mockAiGate: { allowed: boolean; onUpgrade: jest.Mock } = {
  allowed: false,
  onUpgrade: jest.fn(),
};
jest.mock("@/ui/hooks/useNutritionAiGate", () => ({
  useNutritionAiGate: () => ({
    allowed: mockAiGate.allowed,
    reason: "tier",
    gateProps: { onUpgrade: mockAiGate.onUpgrade },
  }),
}));

function makeAdapters(online = true): Adapters {
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
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    payments: {} as Adapters["payments"],
    netInfo: {
      isConnected: async () => online,
      subscribe: (cb: (c: boolean) => void) => {
        cb(online);
        return () => {};
      },
    } as unknown as Adapters["netInfo"],
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

describe("AddRecipeMenuContainer", () => {
  beforeEach(() => {
    mockProbe.last = null;
    mockRouterPush.mockClear();
    mockAiGate.allowed = false;
    mockAiGate.onUpgrade.mockClear();
    useAddRecipeMenu.getState().closeMenu();
  });

  it("reflects the store's open state", () => {
    render(
      <Wrapper adapters={makeAdapters()}>
        <AddRecipeMenuContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.visible).toBe(false);
    act(() => useAddRecipeMenu.getState().openMenu());
    expect(mockProbe.last?.visible).toBe(true);
  });

  it("onClose closes the store only while visible", () => {
    render(
      <Wrapper adapters={makeAdapters()}>
        <AddRecipeMenuContainer />
      </Wrapper>,
    );
    act(() => useAddRecipeMenu.getState().openMenu());
    act(() => mockProbe.last!.onClose());
    expect(useAddRecipeMenu.getState().open).toBe(false);
  });

  it("onClose is a no-op when the sheet is already closed", () => {
    render(
      <Wrapper adapters={makeAdapters()}>
        <AddRecipeMenuContainer />
      </Wrapper>,
    );
    expect(useAddRecipeMenu.getState().open).toBe(false);
    act(() => mockProbe.last!.onClose());
    expect(useAddRecipeMenu.getState().open).toBe(false);
  });

  it("onSaveMeal closes the menu and routes to save-meal", () => {
    render(
      <Wrapper adapters={makeAdapters()}>
        <AddRecipeMenuContainer />
      </Wrapper>,
    );
    act(() => useAddRecipeMenu.getState().openMenu());
    act(() => mockProbe.last!.onSaveMeal());
    expect(useAddRecipeMenu.getState().open).toBe(false);
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/fuel/save-meal");
  });

  it("onCreateRecipe closes the menu and routes to recipe-create", () => {
    render(
      <Wrapper adapters={makeAdapters()}>
        <AddRecipeMenuContainer />
      </Wrapper>,
    );
    act(() => useAddRecipeMenu.getState().openMenu());
    act(() => mockProbe.last!.onCreateRecipe());
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/fuel/recipe-create");
  });

  it("onImportUrl closes the menu and routes to recipe-import", () => {
    render(
      <Wrapper adapters={makeAdapters()}>
        <AddRecipeMenuContainer />
      </Wrapper>,
    );
    act(() => useAddRecipeMenu.getState().openMenu());
    act(() => mockProbe.last!.onImportUrl());
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/fuel/recipe-import");
  });

  it("onSnapRecipe routes to recipe-snap when the AI gate allows", () => {
    mockAiGate.allowed = true;
    render(
      <Wrapper adapters={makeAdapters()}>
        <AddRecipeMenuContainer />
      </Wrapper>,
    );
    act(() => useAddRecipeMenu.getState().openMenu());
    act(() => mockProbe.last!.onSnapRecipe());
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/fuel/recipe-snap");
    expect(mockAiGate.onUpgrade).not.toHaveBeenCalled();
    expect(useAddRecipeMenu.getState().open).toBe(false);
  });

  it("onSnapRecipe routes to the upgrade prompt when the AI gate denies", () => {
    mockAiGate.allowed = false;
    render(
      <Wrapper adapters={makeAdapters()}>
        <AddRecipeMenuContainer />
      </Wrapper>,
    );
    act(() => useAddRecipeMenu.getState().openMenu());
    act(() => mockProbe.last!.onSnapRecipe());
    expect(mockAiGate.onUpgrade).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).not.toHaveBeenCalledWith("/(app)/fuel/recipe-snap");
  });

  it("passes snapDisabled=true when offline", () => {
    render(
      <Wrapper adapters={makeAdapters(false)}>
        <AddRecipeMenuContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.snapDisabled).toBe(true);
  });

  it("passes snapDisabled=false when online", () => {
    render(
      <Wrapper adapters={makeAdapters(true)}>
        <AddRecipeMenuContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.snapDisabled).toBe(false);
  });
});
