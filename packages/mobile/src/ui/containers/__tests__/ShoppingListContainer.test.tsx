import { act, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { ShoppingList } from "@/domain/models/shoppingList";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { ShoppingListProps } from "@/ui/presenters/mealprint/ShoppingListPresenter";
import { ShoppingListContainer } from "../ShoppingListContainer";

const mockProbe: { last: ShoppingListProps | null } = { last: null };
jest.mock("@/ui/presenters/mealprint/ShoppingListPresenter", () => ({
  ShoppingListPresenter: (props: ShoppingListProps) => {
    mockProbe.last = props;
    return null;
  },
}));

const mockBack = jest.fn();
let mockSearchParams: { planId?: string } = { planId: "plan-1" };
jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: jest.fn(), back: (...a: unknown[]) => mockBack(...a) },
  useLocalSearchParams: () => mockSearchParams,
}));

function makeAdapters(api: InMemoryApiAdapter): Adapters {
  const auth = new InMemoryAuthAdapter();
  auth.currentSession = {
    accessToken: "tok",
    refreshToken: "rtok",
    userId: "user-1",
    email: "u@example.com",
    expiresAt: Date.now() + 3600_000,
  };
  return {
    api,
    auth,
    storage: new InMemoryStorageAdapter(),
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
  };
}

function fixtureList(over: Partial<ShoppingList> = {}): ShoppingList {
  return {
    planId: "plan-1",
    aisles: [
      {
        aisle: "Meat & fish",
        items: [{ id: "food-1", name: "Chicken breast", quantity: "300g" }],
      },
    ],
    totalItems: 1,
    ...over,
  };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

async function mount(seed?: (api: InMemoryApiAdapter) => void) {
  const api = new InMemoryApiAdapter();
  seed?.(api);
  const queryClient = makeQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AdapterProvider adapters={makeAdapters(api)}>
          {children}
        </AdapterProvider>
      </QueryClientProvider>
    );
  }
  const utils = render(<ShoppingListContainer />, { wrapper: Wrapper });
  await waitFor(() => expect(mockProbe.last).not.toBeNull());
  return { ...utils, api, probe: () => mockProbe.last! };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockProbe.last = null;
  mockSearchParams = { planId: "plan-1" };
});

describe("ShoppingListContainer", () => {
  it("maps the API response through to the presenter", async () => {
    const remote = fixtureList();
    const { probe } = await mount((api) => {
      api.shoppingListByPlanId.set("plan-1", remote);
    });
    await waitFor(() => expect(probe().list).not.toBeNull());
    expect(probe().list).toEqual(remote);
    expect(probe().error).toBeNull();
  });

  it("settles to loading:false once the fetch resolves", async () => {
    const { probe } = await mount((api) => {
      api.shoppingListByPlanId.set("plan-1", fixtureList());
    });
    await waitFor(() => expect(probe().loading).toBe(false));
    expect(probe().list).not.toBeNull();
  });

  it("surfaces a 404 as a not-found error message and no list", async () => {
    const { probe } = await mount((api) => {
      api.nextGetShoppingListError = { status: 404, message: "not_found" };
    });
    await waitFor(() => expect(probe().error).not.toBeNull());
    expect(probe().list).toBeNull();
    expect(probe().error).toBe("This plan couldn't be found.");
  });

  it("owns local checked-state and toggles it without touching the network", async () => {
    const { probe, api } = await mount((api) => {
      api.shoppingListByPlanId.set("plan-1", fixtureList());
    });
    await waitFor(() => expect(probe().list).not.toBeNull());
    const spy = jest.spyOn(api, "getShoppingList");

    act(() => probe().onToggleItem("food-1"));
    await waitFor(() => expect(probe().checked["food-1"]).toBe(true));

    act(() => probe().onToggleItem("food-1"));
    await waitFor(() => expect(probe().checked["food-1"]).toBe(false));

    expect(spy).not.toHaveBeenCalled();
  });

  it("onBack navigates back", async () => {
    const { probe } = await mount((api) => {
      api.shoppingListByPlanId.set("plan-1", fixtureList());
    });
    await waitFor(() => expect(probe().list).not.toBeNull());
    act(() => probe().onBack());
    expect(mockBack).toHaveBeenCalled();
  });

  it("does not fetch when there is no planId route param", async () => {
    mockSearchParams = {};
    const { probe, api } = await mount((api) => {
      api.shoppingListByPlanId.set("plan-1", fixtureList());
    });
    const spy = jest.spyOn(api, "getShoppingList");
    await waitFor(() => expect(probe().loading).toBe(false));
    expect(probe().list).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
