import NetInfo from "@react-native-community/netinfo";
import { RNNetInfoAdapter } from "../rnNetInfo.adapter";

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { fetch: jest.fn(), addEventListener: jest.fn() },
}));
const mocked = jest.mocked(NetInfo);

const state = (
  isConnected: boolean | null,
  isInternetReachable: boolean | null,
) => ({ isConnected, isInternetReachable }) as never;

describe("RNNetInfoAdapter", () => {
  beforeEach(() => jest.clearAllMocks());

  it("is online only when connected and reachability is not explicitly false", async () => {
    const adapter = new RNNetInfoAdapter();
    mocked.fetch.mockResolvedValueOnce(state(true, true));
    await expect(adapter.isConnected()).resolves.toBe(true);
    // Reachability is null until the first probe: treat as online enough to try.
    mocked.fetch.mockResolvedValueOnce(state(true, null));
    await expect(adapter.isConnected()).resolves.toBe(true);
    mocked.fetch.mockResolvedValueOnce(state(true, false));
    await expect(adapter.isConnected()).resolves.toBe(false);
    mocked.fetch.mockResolvedValueOnce(state(false, true));
    await expect(adapter.isConnected()).resolves.toBe(false);
    mocked.fetch.mockResolvedValueOnce(state(null, null));
    await expect(adapter.isConnected()).resolves.toBe(false);
    expect(mocked.fetch).toHaveBeenCalledTimes(5);
  });

  it("maps subscription events through the same rule and returns the unsubscribe", () => {
    const unsubscribe = jest.fn();
    let handler: ((s: unknown) => void) | undefined;
    mocked.addEventListener.mockImplementation((cb) => {
      handler = cb as (s: unknown) => void;
      return unsubscribe;
    });
    const listener = jest.fn();
    const adapter = new RNNetInfoAdapter();
    expect(adapter.subscribe(listener)).toBe(unsubscribe);
    handler!(state(true, null));
    handler!(state(true, false));
    handler!(state(false, null));
    expect(listener.mock.calls).toEqual([[true], [false], [false]]);
  });
});
