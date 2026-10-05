import { router } from "expo-router";
import React from "react";
import { AppState } from "react-native";
import * as Clipboard from "expo-clipboard";
import { act, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherPartnersContainer } from "../TogetherPartnersContainer";
import {
  TogetherPartnersPresenter,
  type TogetherPartnersPresenterProps,
} from "../../presenters/TogetherPartnersPresenter";
import type { TogetherSocialApi } from "@/domain/ports/togetherSocial.port";
let mockPermission: { granted: boolean } | null = { granted: false };
const mockRequestPermission = jest.fn(async () => ({ granted: true }));
jest.mock("expo-camera", () => ({
  CameraView: jest.requireActual("react-native").View,
  useCameraPermissions: () => [mockPermission, mockRequestPermission],
}));
jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn(async () => {}),
}));
jest.mock("expo-crypto", () => ({
  randomUUID: () => "9cadb8b7-c5ce-4c74-b458-e78296864282",
}));
let mockUser: string | null = "u";
let mockApi: TogetherSocialApi | undefined;
jest.mock("@/ui/hooks/useAdapters", () => ({
  useAdapters: () => ({ api: { togetherSocial: mockApi } }),
}));
jest.mock("@/ui/hooks/useAuth", () => ({
  useAuth: () => ({ session: mockUser ? { userId: mockUser } : null }),
}));
jest.mock("expo-router", () => ({ router: { back: jest.fn() } }));
const ok = <T,>(value: T) => ({ ok: true as const, value });
const page = <T,>(data: T[]) => ok({ data, nextCursor: null });
const friend = {
  id: "r",
  userId: "u",
  friendId: "f",
  initiatedBy: "f",
  status: "accepted" as const,
  createdAt: "2026-10-01",
  updatedAt: "2026-10-01",
  person: { userId: "f", displayName: "Mia", avatarUrl: null },
};
function setup() {
  mockUser = "u";
  mockPermission = { granted: false };
  mockRequestPermission.mockResolvedValue({ granted: true });
  mockApi = {
    personCode: jest.fn(async () =>
      ok({ code: "a".repeat(32), expiresAt: "2026-10-12T00:00:00Z" }),
    ),
    resolvePersonCode: jest.fn(async () =>
      ok({ userId: "private", displayName: "Private person", avatarUrl: null }),
    ),
    getProfile: jest.fn(async () => ok({ discoverable: false })),
    profile: jest.fn(async () => ok({ discoverable: true })),
    friends: jest.fn(async () => page([friend])),
    requests: jest.fn(async () =>
      page([{ ...friend, id: "pending", status: "pending" as const }]),
    ),
    offers: jest.fn(async () => page([])),
    people: jest.fn(async () =>
      page([{ userId: "x", displayName: "Tom", avatarUrl: null }]),
    ),
    request: jest.fn(async () => ok({ requestId: "new", status: "pending" })),
    decide: jest.fn(async () =>
      ok({ requestId: "pending", status: "accepted" }),
    ),
    remove: jest.fn(async () => ok({ removed: true })),
    block: jest.fn(async () => ok({ blocked: true })),
    report: jest.fn(async () => ok({ reportId: "report" })),
    offer: jest.fn(),
    template: jest.fn(),
    copy: jest.fn(async () => ok({ workoutId: "copy" })),
    revoke: jest.fn(),
  };
  return mockApi;
}
const props = (r: ReturnType<typeof renderWithTheme>) =>
  r.UNSAFE_getByType(TogetherPartnersPresenter)
    .props as TogetherPartnersPresenterProps;
beforeEach(async () => {
  jest.clearAllMocks();
  jest
    .spyOn(AppState, "addEventListener")
    .mockReturnValue({ remove: jest.fn() });
  await AsyncStorage.clear();
});
it("loads real relationship names and sends deliberate accept once", async () => {
  const api = setup();
  const r = renderWithTheme(<TogetherPartnersContainer />);
  await waitFor(() => expect(props(r).loading).toBe(false));
  expect(props(r).friends[0].displayName).toBe("Mia");
  await act(async () => {
    props(r).onDecide("pending", "accept");
    props(r).onDecide("pending", "accept");
  });
  expect(api.decide).toHaveBeenCalledTimes(1);
  expect(api.decide).toHaveBeenCalledWith(
    expect.any(String),
    "pending",
    "accept",
  );
});
it("keeps durable mutation identity across ambiguous failure and screen remount", async () => {
  const api = setup();
  (api.remove as jest.Mock).mockResolvedValueOnce({
    ok: false,
    error: { code: "network" },
  });
  const r = renderWithTheme(<TogetherPartnersContainer />);
  await waitFor(() => expect(props(r).loading).toBe(false));
  await act(async () => props(r).onRemove("f"));
  const key = (api.remove as jest.Mock).mock.calls[0][0];
  expect(props(r).error).toMatch(/Could not confirm/);
  r.unmount();
  const next = renderWithTheme(<TogetherPartnersContainer />);
  await waitFor(() => expect(props(next).loading).toBe(false));
  await act(async () => props(next).onRemove("f"));
  expect((api.remove as jest.Mock).mock.calls[1][0]).toBe(key);
  expect(
    await AsyncStorage.getItem("together.social.retry.v1:u:remove:f"),
  ).toBeNull();
});
it("drops late account responses and retained callbacks", async () => {
  const api = setup();
  let resolve!: (v: unknown) => void;
  (api.friends as jest.Mock).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const r = renderWithTheme(<TogetherPartnersContainer />);
  const old = props(r);
  mockUser = "v";
  (api.friends as jest.Mock).mockResolvedValue(page([]));
  r.rerender(<TogetherPartnersContainer />);
  await waitFor(() => expect(props(r).loading).toBe(false));
  await act(async () => {
    resolve(page([friend]));
    old.onRemove("f");
  });
  expect(props(r).friends).toEqual([]);
  expect(api.remove).not.toHaveBeenCalled();
});
it("does not send when account changes while persisting a command", async () => {
  const api = setup();
  const r = renderWithTheme(<TogetherPartnersContainer />);
  await waitFor(() => expect(props(r).loading).toBe(false));
  let resolve!: (v: string | null) => void;
  jest.spyOn(AsyncStorage, "getItem").mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  act(() => props(r).onBlock("f"));
  mockUser = "v";
  r.rerender(<TogetherPartnersContainer />);
  await act(async () => resolve(null));
  expect(api.block).not.toHaveBeenCalled();
});
it("does not show stale search results after query changes", async () => {
  const api = setup();
  let resolve!: (v: unknown) => void;
  (api.people as jest.Mock).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const r = renderWithTheme(<TogetherPartnersContainer />);
  await waitFor(() => expect(props(r).loading).toBe(false));
  act(() => props(r).onQuery("Tom"));
  act(() => props(r).onSearch());
  act(() => props(r).onQuery("Mia"));
  await act(async () =>
    resolve(page([{ userId: "x", displayName: "Tom", avatarUrl: null }])),
  );
  expect(props(r).results).toEqual([]);
});
it("fails closed without authentication or a supported API", async () => {
  setup();
  mockApi = undefined;
  const r = renderWithTheme(<TogetherPartnersContainer />);
  expect(props(r).available).toBe(false);
  expect(props(r).error).toMatch(/unavailable/);
  mockUser = null;
  r.rerender(<TogetherPartnersContainer />);
  expect(props(r).error).toMatch(/Sign in/);
});
it("copies only a rendered authorized offer selected for review", async () => {
  const api = setup();
  const offer = {
    id: "offer",
    senderId: "f",
    recipientId: "u",
    plan: { name: "Push", exercises: [] },
    createdAt: "2026-10-01",
    revoked: false,
  };
  (api.offers as jest.Mock).mockResolvedValue(
    page([
      offer,
      { ...offer, id: "wrong", recipientId: "other" },
      { ...offer, id: "revoked", revoked: true },
    ]),
  );
  const r = renderWithTheme(<TogetherPartnersContainer />);
  await waitFor(() => expect(props(r).loading).toBe(false));
  expect(props(r).offers).toHaveLength(1);
  await act(async () => props(r).onCopy("offer"));
  expect(api.copy).not.toHaveBeenCalled();
  act(() => props(r).onOffer(offer));
  await act(async () => props(r).onCopy("offer"));
  expect(api.copy).toHaveBeenCalledWith(expect.any(String), "offer");
});
it("does not replace a known preference until server confirmation", async () => {
  const api = setup();
  (api.profile as jest.Mock).mockResolvedValue({
    ok: false,
    error: { code: "network" },
  });
  const r = renderWithTheme(<TogetherPartnersContainer />);
  await waitFor(() => expect(props(r).loading).toBe(false));
  await act(async () => props(r).onDiscoverable(true));
  expect(props(r).discoverable).toBe(false);
});

it("resolves a private code and requires a separate invitation with its proof", async () => {
  const api = setup();
  const r = renderWithTheme(<TogetherPartnersContainer />);
  await waitFor(() => expect(props(r).loading).toBe(false));
  act(() => props(r).onCode("b".repeat(32)));
  await act(async () => props(r).onResolve());
  expect(api.request).not.toHaveBeenCalled();
  expect(props(r).results[0].displayName).toBe("Private person");
  await act(async () => props(r).onRequest("private"));
  expect(api.request).toHaveBeenCalledWith(
    expect.any(String),
    "private",
    "b".repeat(32),
  );
});
it("opens an issued own code and rotates deliberately", async () => {
  const api = setup();
  const r = renderWithTheme(<TogetherPartnersContainer />);
  await waitFor(() => expect(props(r).loading).toBe(false));
  await act(async () => props(r).onShowCode());
  expect(props(r).codeVisible).toBe(true);
  expect(props(r).ownCode?.code).toBe("a".repeat(32));
  act(() => props(r).onCloseCode());
  await act(async () => props(r).onShowCode());
  expect(api.personCode).toHaveBeenCalledTimes(1);
  await act(async () => props(r).onNewCode());
  expect(api.personCode).toHaveBeenCalledTimes(2);
});
it("reports, blocks and changes privacy only through confirmed mutations", async () => {
  const api = setup();
  const r = renderWithTheme(<TogetherPartnersContainer />);
  await waitFor(() => expect(props(r).loading).toBe(false));
  await act(async () => props(r).onReport("f", "spam"));
  expect(api.report).toHaveBeenCalledWith(expect.any(String), {
    subjectUserId: "f",
    context: "together",
    reason: "spam",
  });
  await act(async () => props(r).onBlock("f"));
  expect(api.block).toHaveBeenCalledWith(expect.any(String), "f", true);
  await act(async () => props(r).onDiscoverable(true));
  expect(api.profile).toHaveBeenCalledWith(expect.any(String), true);
});
it("explains rejected loads, search and code lookup without fake data", async () => {
  const api = setup();
  (api.friends as jest.Mock).mockRejectedValueOnce(new Error("offline"));
  const r = renderWithTheme(<TogetherPartnersContainer />);
  await waitFor(() => expect(props(r).error).toMatch(/Could not refresh/));
  expect(props(r).friends).toEqual([]);
  await act(async () => props(r).onRefresh());
  act(() => props(r).onQuery("Mia"));
  (api.people as jest.Mock).mockRejectedValueOnce(new Error("offline"));
  await act(async () => props(r).onSearch());
  expect(props(r).error).toMatch(/Search is unavailable/);
  act(() => props(r).onCode("invalid"));
  await act(async () => props(r).onResolve());
  expect(api.resolvePersonCode).not.toHaveBeenCalled();
  act(() => props(r).onCode("b".repeat(32)));
  (api.resolvePersonCode as jest.Mock).mockRejectedValueOnce(
    new Error("expired"),
  );
  await act(async () => props(r).onResolve());
  expect(props(r).error).toMatch(/unavailable or expired/);
});
it("loads remaining relationship pages and honest limited search", async () => {
  const api = setup();
  (api.friends as jest.Mock)
    .mockResolvedValueOnce(ok({ data: [friend], nextCursor: "second" }))
    .mockResolvedValueOnce(
      page([
        {
          ...friend,
          id: "second",
          friendId: "g",
          person: { userId: "g", displayName: "Tom", avatarUrl: null },
        },
      ]),
    );
  const r = renderWithTheme(<TogetherPartnersContainer />);
  await waitFor(() => expect(props(r).loading).toBe(false));
  expect(props(r).friends).toHaveLength(2);
  (api.people as jest.Mock).mockResolvedValueOnce(
    ok({ data: [], nextCursor: "more" }),
  );
  act(() => props(r).onQuery("Mi"));
  await act(async () => props(r).onSearch());
  expect(props(r).notice).toMatch(/Refine the name/);
  act(() => props(r).onTab("Partners"));
  expect(props(r).results).toEqual([]);
});

it("requests camera only deliberately, deduplicates scans and closes it in background", async () => {
  const api = setup();
  const listener = jest.spyOn(AppState, "addEventListener");
  const r = renderWithTheme(<TogetherPartnersContainer />);
  await waitFor(() => expect(props(r).loading).toBe(false));
  expect(mockRequestPermission).not.toHaveBeenCalled();
  await act(async () => props(r).onScan());
  const scanner = props(r).scanner as React.ReactElement<{
    onBarcodeScanned(v: { data: string }): void;
  }>;
  expect(scanner).toBeTruthy();
  await act(async () => {
    scanner.props.onBarcodeScanned({ data: "b".repeat(32) });
    scanner.props.onBarcodeScanned({ data: "b".repeat(32) });
  });
  expect(api.resolvePersonCode).toHaveBeenCalledTimes(1);
  expect(props(r).scanner).toBeUndefined();
  mockPermission = { granted: true };
  await act(async () => props(r).onScan());
  act(() => listener.mock.calls.at(-1)![1]("background"));
  expect(props(r).scanner).toBeUndefined();
  listener.mockRestore();
});
it("rejects late permission results after switching tabs or unmounting", async () => {
  setup();
  let resolve!: (v: { granted: boolean }) => void;
  mockRequestPermission.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const r = renderWithTheme(<TogetherPartnersContainer />);
  await waitFor(() => expect(props(r).loading).toBe(false));
  act(() => props(r).onScan());
  act(() => props(r).onTab("Partners"));
  await act(async () => resolve({ granted: true }));
  expect(props(r).scanner).toBeUndefined();
  mockRequestPermission.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const old = props(r);
  act(() => old.onScan());
  r.unmount();
  await act(async () => {
    resolve({ granted: true });
    old.onScan();
    old.onRefresh();
    old.onSearch();
    old.onResolve();
  });
});
it("offers paste fallback after camera denial or failure and reports copy failure", async () => {
  setup();
  mockRequestPermission.mockResolvedValueOnce({ granted: false });
  const r = renderWithTheme(<TogetherPartnersContainer />);
  await waitFor(() => expect(props(r).loading).toBe(false));
  await act(async () => props(r).onScan());
  expect(props(r).error).toMatch(/Camera permission/);
  mockRequestPermission.mockRejectedValueOnce(new Error("camera"));
  await act(async () => props(r).onScan());
  expect(props(r).error).toMatch(/Camera is unavailable/);
  await act(async () => props(r).onCopyCode());
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  await act(async () => props(r).onShowCode());
  (Clipboard.setStringAsync as jest.Mock).mockRejectedValueOnce(
    new Error("clipboard"),
  );
  await act(async () => props(r).onCopyCode());
  expect(props(r).error).toMatch(/Could not copy/);
  act(() => props(r).onBack());
  expect(router.back).toHaveBeenCalled();
});
it("hides a deferred code resolution and mutation response after unmount", async () => {
  const api = setup();
  let resolve!: (v: unknown) => void;
  (api.resolvePersonCode as jest.Mock).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const r = renderWithTheme(<TogetherPartnersContainer />);
  await waitFor(() => expect(props(r).loading).toBe(false));
  act(() => props(r).onCode("b".repeat(32)));
  act(() => props(r).onResolve());
  r.unmount();
  await act(async () =>
    resolve(ok({ userId: "f", displayName: "Private", avatarUrl: null })),
  );
  const next = renderWithTheme(<TogetherPartnersContainer />);
  await waitFor(() => expect(props(next).loading).toBe(false));
  (api.report as jest.Mock).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await act(async () => props(next).onReport("f", "other"));
  next.unmount();
  await act(async () => resolve(ok({ reportId: "r" })));
});
it("rejects repeated cursors and null names without fabricating profile data", async () => {
  const api = setup();
  (api.friends as jest.Mock).mockResolvedValue(
    ok({ data: [], nextCursor: "repeat" }),
  );
  const r = renderWithTheme(<TogetherPartnersContainer />);
  await waitFor(() => expect(props(r).error).toMatch(/Could not refresh/));
  (api.friends as jest.Mock).mockResolvedValue(
    page([{ ...friend, userId: "f", friendId: "u", person: undefined }]),
  );
  await act(async () => props(r).onRefresh());
  expect(props(r).friends[0]).toMatchObject({
    userId: "f",
    displayName: null,
    avatarUrl: null,
  });
  await act(async () => props(r).onSearch());
  expect(api.people).not.toHaveBeenCalled();
});

it("does not report stale errors from searches or code requests after account changes", async () => {
  const api = setup();
  let reject!: (reason: unknown) => void;
  (api.people as jest.Mock).mockReturnValueOnce(
    new Promise((_, r) => {
      reject = r;
    }),
  );
  const r = renderWithTheme(<TogetherPartnersContainer />);
  await waitFor(() => expect(props(r).loading).toBe(false));
  act(() => props(r).onQuery("Mia"));
  act(() => props(r).onSearch());
  mockUser = "v";
  r.rerender(<TogetherPartnersContainer />);
  await act(async () => reject(new Error("old")));
  await waitFor(() => expect(props(r).loading).toBe(false));
  expect(props(r).error).toBe("");
  (api.resolvePersonCode as jest.Mock).mockReturnValueOnce(
    new Promise((_, r) => {
      reject = r;
    }),
  );
  act(() => props(r).onCode("b".repeat(32)));
  act(() => props(r).onResolve());
  r.unmount();
  await act(async () => reject(new Error("old")));
});
it("never exposes or mutates another account after a queued storage write", async () => {
  const api = setup();
  let finish!: (v: void) => void;
  const r = renderWithTheme(<TogetherPartnersContainer />);
  await waitFor(() => expect(props(r).loading).toBe(false));
  jest.spyOn(AsyncStorage, "setItem").mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  await act(async () => props(r).onRemove("f"));
  mockUser = "v";
  r.rerender(<TogetherPartnersContainer />);
  await act(async () => finish());
  expect(api.remove).not.toHaveBeenCalled();
});
it("declines explicitly and filters self from search", async () => {
  const api = setup();
  const r = renderWithTheme(<TogetherPartnersContainer />);
  await waitFor(() => expect(props(r).loading).toBe(false));
  await act(async () => props(r).onDecide("pending", "reject"));
  expect(api.decide).toHaveBeenCalledWith(
    expect.any(String),
    "pending",
    "reject",
  );
  (api.people as jest.Mock).mockResolvedValue(
    page([
      { userId: "u", displayName: "Self", avatarUrl: null },
      { userId: "other", displayName: "Other", avatarUrl: null },
    ]),
  );
  act(() => props(r).onQuery("Other"));
  await act(async () => props(r).onSearch());
  expect(props(r).results.map((p) => p.userId)).toEqual(["other"]);
  await act(async () => props(r).onRequest("other"));
  expect(api.request).toHaveBeenCalledWith(
    expect.any(String),
    "other",
    undefined,
  );
});
