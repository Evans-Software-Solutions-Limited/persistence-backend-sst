/** PER-130 — C10q: a coach's joining forms, in their order. */
import { act, fireEvent } from "@testing-library/react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { AthleteFormRequest } from "@/domain/models/athleteForms";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { JoiningFormsContainer } from "../JoiningFormsContainer";

const mockRouter = {
  back: jest.fn(),
  replace: jest.fn(),
  canGoBack: jest.fn(() => true),
};
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ coachId: "ellie" }),
}));

const USER = "athlete-1";

function joining(id: string, title: string, n: number): AthleteFormRequest {
  return {
    id,
    formId: `f-${id}`,
    title,
    description: null,
    coach: { id: "ellie", name: "Ellie Hart" },
    trigger: "on_join",
    periodKey: "join",
    sentAt: "2026-11-26T09:00:00Z",
    dueAt: null,
    closesAt: null,
    status: "pending",
    late: false,
    version: {
      id: "v",
      version: 1,
      questions: Array.from({ length: n }, (_, i) => ({
        id: `q${i}`,
        type: "short_text" as const,
        prompt: `Q${i}`,
        required: false,
      })),
    },
  };
}

function setup(requests: AthleteFormRequest[]) {
  const api = new InMemoryApiAdapter();
  api.formRequests = { requests, asOf: "a" };
  const storage = new InMemoryStorageAdapter();
  storage.cacheFormRequests(USER, { requests, asOf: "a" });
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: USER,
    email: "a@example.com",
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
  const adapters: Adapters = {
    api,
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    netInfo: {} as Adapters["netInfo"],
  };
  const utils = renderWithTheme(
    <AdapterProvider adapters={adapters}>
      <JoiningFormsContainer />
    </AdapterProvider>,
  );
  return { storage, ...utils };
}

const FORMS = [
  joining("j1", "New client: goals and health", 14),
  joining("j2", "Lifestyle and schedule", 9),
];

beforeEach(() => {
  for (const fn of Object.values(mockRouter)) fn.mockClear();
  mockRouter.canGoBack.mockReturnValue(true);
});

describe("JoiningFormsContainer (C10q)", () => {
  it("lists every joining form in order with the strip", async () => {
    const utils = setup(FORMS);
    await act(async () => {});
    expect(utils.getByText("From Ellie · before you start")).toBeTruthy();
    expect(utils.getByText("Two forms to get started")).toBeTruthy();
    expect(utils.getByText("23")).toBeTruthy();
    expect(utils.getByText("New client: goals and health")).toBeTruthy();
    expect(utils.getByText("14 questions · about 7 min")).toBeTruthy();
    expect(utils.getAllByText("To do")).toHaveLength(2);
    expect(utils.getByText("Only Ellie sees your answers.")).toBeTruthy();
  });

  it("Start opens the first one and carries on in order; the page is seen", async () => {
    const utils = setup(FORMS);
    await act(async () => {});
    fireEvent.press(utils.getByTestId("joining-start"));
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: "/(app)/forms/[id]",
      params: { id: "j1", then: "joining" },
    });
    expect(
      utils.storage.getLocalFormStates(USER).map((l) => l.introSeen),
    ).toEqual([true, true]);
  });

  it("Later leaves them on the Coach tab", async () => {
    const utils = setup(FORMS);
    await act(async () => {});
    fireEvent.press(utils.getByTestId("joining-later"));
    expect(mockRouter.back).toHaveBeenCalled();
    expect(utils.storage.getLocalFormStates(USER)).toHaveLength(2);

    mockRouter.canGoBack.mockReturnValue(false);
    fireEvent.press(utils.getByTestId("joining-later"));
    expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/(tabs)/coach");
  });

  it("nothing to show without joining forms", async () => {
    const utils = setup([]);
    await act(async () => {});
    expect(utils.queryByTestId("joining-forms")).toBeNull();
  });
});
