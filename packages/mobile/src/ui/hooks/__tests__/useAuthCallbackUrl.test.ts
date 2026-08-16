import { renderHook, act, waitFor } from "@testing-library/react-native";

// Controllable expo-linking mock: capture the registered `url` listener and the
// resolved initial URL so we can simulate cold-start (getInitialURL) and
// warm-start (url event) delivery independently.
let mockInitialUrl: string | null = null;
let mockUrlListener: ((e: { url: string }) => void) | null = null;
const mockRemoveSpy = jest.fn();
jest.mock("expo-linking", () => ({
  getInitialURL: jest.fn(() => Promise.resolve(mockInitialUrl)),
  addEventListener: jest.fn(
    (_event: string, cb: (e: { url: string }) => void) => {
      mockUrlListener = cb;
      return { remove: mockRemoveSpy };
    },
  ),
}));

import * as Linking from "expo-linking";
import {
  initAuthCallbackCapture,
  clearAuthCallbackUrl,
  useAuthCallbackUrl,
  __resetAuthCallbackCaptureForTests,
} from "../useAuthCallbackUrl";

const COLD = "persistencemobile://auth/callback#access_token=a&refresh_token=b";
const WARM =
  "persistencemobile://auth/callback#access_token=warm&refresh_token=warm2&type=signup";

beforeEach(() => {
  __resetAuthCallbackCaptureForTests();
  mockInitialUrl = null;
  mockUrlListener = null;
  mockRemoveSpy.mockClear();
  (Linking.getInitialURL as jest.Mock).mockClear();
  (Linking.addEventListener as jest.Mock).mockClear();
});

it("captures a cold-start auth link via getInitialURL", async () => {
  mockInitialUrl = COLD;
  initAuthCallbackCapture();
  const { result } = renderHook(() => useAuthCallbackUrl());
  await waitFor(() => expect(result.current).toBe(COLD));
});

it("captures a warm-start auth link that arrives AFTER the hook mounts", async () => {
  // The regression case: nothing on launch, the deep link arrives later. The
  // root-installed listener catches it and the hook re-renders.
  initAuthCallbackCapture();
  const { result } = renderHook(() => useAuthCallbackUrl());
  expect(result.current).toBeNull();
  act(() => {
    mockUrlListener?.({ url: WARM });
  });
  await waitFor(() => expect(result.current).toBe(WARM));
});

it("ignores non-auth-callback deep links (invite codes, notification taps)", async () => {
  initAuthCallbackCapture();
  const { result } = renderHook(() => useAuthCallbackUrl());
  act(() => {
    mockUrlListener?.({ url: "persistencemobile://accept-invite?code=XYZ" });
  });
  // Never captured — stays null.
  await waitFor(() => expect(Linking.getInitialURL).toHaveBeenCalled());
  expect(result.current).toBeNull();
});

it("clears the captured URL so a later mount can't reprocess it", async () => {
  mockInitialUrl = COLD;
  initAuthCallbackCapture();
  const { result } = renderHook(() => useAuthCallbackUrl());
  await waitFor(() => expect(result.current).toBe(COLD));
  act(() => {
    clearAuthCallbackUrl();
  });
  await waitFor(() => expect(result.current).toBeNull());
});

it("installs listeners only once even if init is called repeatedly", () => {
  initAuthCallbackCapture();
  initAuthCallbackCapture();
  initAuthCallbackCapture();
  expect(Linking.addEventListener).toHaveBeenCalledTimes(1);
  expect(Linking.getInitialURL).toHaveBeenCalledTimes(1);
});
