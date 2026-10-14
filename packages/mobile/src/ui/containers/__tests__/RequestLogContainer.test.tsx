import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Share } from "react-native";
import { RequestLog } from "@/adapters/api/requestLog";
import { RequestLogContainer } from "@/ui/containers/RequestLogContainer";

let mockVariant = "staging";
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: { appVariant: mockVariant } };
    },
  },
}));
jest.mock("expo-router", () => ({
  Redirect: ({ href }: { href: string }) => {
    const { Text } = jest.requireActual("react-native");
    return <Text testID="redirect">{href}</Text>;
  },
}));
const mockLog = new RequestLog(10, () => 5_000);
jest.mock("@/ui/hooks/useAdapters", () => ({
  useAdapters: () => ({ api: { requestLog: mockLog } }),
}));

const devFlag = globalThis as unknown as { __DEV__: boolean };
beforeEach(() => {
  devFlag.__DEV__ = false;
  mockVariant = "staging";
  mockLog.clear();
});
afterAll(() => {
  devFlag.__DEV__ = true;
});

describe("RequestLogContainer", () => {
  it("redirects production builds to Home", () => {
    mockVariant = "production";
    render(<RequestLogContainer />);
    expect(screen.getByTestId("redirect").props.children).toBe("/(app)/(tabs)");
  });

  it("lists the recorded requests, refreshes, shares JSON and clears", async () => {
    const id = mockLog.start("GET", "/users/me/bootstrap");
    mockLog.end(id, 200);
    const share = jest
      .spyOn(Share, "share")
      .mockResolvedValue({ action: "sharedAction" } as never);
    render(<RequestLogContainer />);
    expect(screen.getAllByTestId("request-log-row")).toHaveLength(1);
    expect(screen.getByText(/GET\s+\/users\/me\/bootstrap/)).toBeTruthy();
    mockLog.start("GET", "/profile/page");
    fireEvent.press(screen.getByTestId("request-log-refresh"));
    expect(screen.getAllByTestId("request-log-row")).toHaveLength(2);
    expect(screen.getByText(/pending · …/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("request-log-share"));
    });
    expect(share).toHaveBeenCalledTimes(1);
    expect(JSON.parse(share.mock.calls[0][0].message!)).toHaveLength(2);
    fireEvent.press(screen.getByTestId("request-log-clear"));
    expect(screen.getByText("No requests recorded yet.")).toBeTruthy();
    expect(mockLog.entries()).toEqual([]);
    // Share is inert without entries, and a rejected share sheet is swallowed.
    await act(async () => {
      fireEvent.press(screen.getByTestId("request-log-share"));
    });
    expect(share).toHaveBeenCalledTimes(1);
    mockLog.start("GET", "/x");
    fireEvent.press(screen.getByTestId("request-log-refresh"));
    share.mockRejectedValueOnce(new Error("dismissed"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("request-log-share"));
    });
    expect(share).toHaveBeenCalledTimes(2);
  });
});
