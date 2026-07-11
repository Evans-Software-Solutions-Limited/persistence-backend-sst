import { act, fireEvent } from "@testing-library/react-native";
import { Alert } from "react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { AcceptInviteContainer } from "@/ui/containers/AcceptInviteContainer";

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockNav = { canGoBack: true };
const mockParams: { code?: string } = {};
jest.mock("expo-router", () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => mockNav.canGoBack,
  }),
  useLocalSearchParams: () => mockParams,
}));

function makeAdapters(): { adapters: Adapters; api: InMemoryApiAdapter } {
  const api = new InMemoryApiAdapter();
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: "athlete-1",
    email: "athlete@example.com",
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
      storage: new InMemoryStorageAdapter(),
      health: {} as Adapters["health"],
      notifications: {} as Adapters["notifications"],
      payments: {} as Adapters["payments"],
      netInfo: {} as Adapters["netInfo"],
    },
  };
}

describe("AcceptInviteContainer", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    delete mockParams.code;
    mockNav.canGoBack = true;
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });
  afterEach(() => {
    alertSpy.mockRestore();
  });

  it("prefills the code from the ?code= deep-link param", () => {
    mockParams.code = "ab23cd";
    const { api, adapters } = makeAdapters();
    const { getByTestId } = renderWithTheme(
      <AdapterProvider adapters={adapters}>
        <AcceptInviteContainer />
      </AdapterProvider>,
    );
    expect(getByTestId("accept-invite-code-input").props.value).toBe("AB23CD");
    void api;
  });

  it("success: alerts 'Request sent to <trainer> — awaiting their acceptance', then navigates back on OK", async () => {
    const { api, adapters } = makeAdapters();
    api.nextAcceptInviteCodeResult = {
      success: true,
      relationshipId: "rel-1",
      trainerName: "Coach Carter",
      message: "ok",
    };
    const { getByTestId } = renderWithTheme(
      <AdapterProvider adapters={adapters}>
        <AcceptInviteContainer />
      </AdapterProvider>,
    );
    fireEvent.changeText(getByTestId("accept-invite-code-input"), "AB23CD");
    await act(async () => {
      fireEvent.press(getByTestId("accept-invite-submit"));
    });
    expect(api.acceptInviteCodeCalls).toEqual(["AB23CD"]);
    expect(alertSpy).toHaveBeenCalledWith(
      "Request sent",
      "Request sent to Coach Carter — awaiting their acceptance.",
      expect.any(Array),
    );
    const buttons = alertSpy.mock.calls[0][2] as {
      text: string;
      onPress?: () => void;
    }[];
    act(() => buttons[0]?.onPress?.());
    expect(mockBack).toHaveBeenCalled();
  });

  it.each([
    ["invalid_code", "Invalid or expired code. Ask your coach for a new one."],
    ["self_invite", "You can't use your own code."],
    ["exists", "You're already connected to this coach."],
    ["code_already_used", "This code has already been used."],
    ["coach_client_limit_reached", "This coach's client list is full."],
  ] as const)(
    "maps the %s domain error to inline copy (not a paywall)",
    async (code, expectedMessage) => {
      const { api, adapters } = makeAdapters();
      api.nextAcceptInviteCodeError = { code, message: "backend message" };
      const { getByTestId } = renderWithTheme(
        <AdapterProvider adapters={adapters}>
          <AcceptInviteContainer />
        </AdapterProvider>,
      );
      fireEvent.changeText(getByTestId("accept-invite-code-input"), "BAD000");
      await act(async () => {
        fireEvent.press(getByTestId("accept-invite-submit"));
      });
      expect(getByTestId("accept-invite-error").props.children).toBe(
        expectedMessage,
      );
      // Inline only — never an Alert (not a paywall/upsell).
      expect(alertSpy).not.toHaveBeenCalled();
    },
  );

  it("back button goes back when possible", () => {
    const { adapters } = makeAdapters();
    const { getByLabelText } = renderWithTheme(
      <AdapterProvider adapters={adapters}>
        <AcceptInviteContainer />
      </AdapterProvider>,
    );
    fireEvent.press(getByLabelText("Back"));
    expect(mockBack).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("back button replaces to You when there's no back stack", () => {
    mockNav.canGoBack = false;
    const { adapters } = makeAdapters();
    const { getByLabelText } = renderWithTheme(
      <AdapterProvider adapters={adapters}>
        <AcceptInviteContainer />
      </AdapterProvider>,
    );
    fireEvent.press(getByLabelText("Back"));
    expect(mockReplace).toHaveBeenCalledWith("/(app)/(tabs)/you");
  });
});
