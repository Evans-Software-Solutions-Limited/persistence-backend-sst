import React from "react";
import { fireEvent, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  TogetherSettingsContainer,
  loadBlocked,
} from "../TogetherSettingsContainer";
import { TogetherBlockedContainer } from "../TogetherBlockedContainer";
import { useTogetherSettings } from "@/state/together-settings";

const mockRouter = { push: jest.fn(), back: jest.fn() };
jest.mock("expo-router", () => ({
  useFocusEffect: (cb: any) => jest.requireActual("react").useEffect(cb, [cb]),
  router: {
    push: (...a: any[]) => mockRouter.push(...a),
    back: (...a: any[]) => mockRouter.back(...a),
  },
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "key-1" }));
let mockUser: string | null = "u";
jest.mock("@/ui/hooks/useAuth", () => ({
  useAuth: () => ({ session: mockUser ? { userId: mockUser } : null }),
}));
const ok = <T,>(value: T) => ({ ok: true as const, value });
const page = <T,>(data: T[], nextCursor: string | null = null) =>
  ok({ data, nextCursor });
const social: any = {
  getProfile: jest.fn(),
  profile: jest.fn(),
  friends: jest.fn(),
  blocked: jest.fn(),
  block: jest.fn(),
};
let mockSocial: any = social;
jest.mock("@/ui/hooks/useAdapters", () => ({
  useAdapters: () => ({ api: { togetherSocial: mockSocial } }),
}));
const person = (userId: string, displayName: string | null) => ({
  userId,
  displayName,
  avatarUrl: null,
});
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = "u";
  mockSocial = social;
  useTogetherSettings.getState().reset();
  social.getProfile.mockResolvedValue(ok({ discoverable: false }));
  social.profile.mockImplementation(async (_k: string, v: boolean) =>
    ok({ discoverable: v }),
  );
  social.friends.mockResolvedValue(
    page([
      {
        id: "r1",
        userId: "u",
        friendId: "tom",
        initiatedBy: "u",
        status: "accepted",
        createdAt: "2026-07-01",
        updatedAt: "2026-07-01",
        person: person("tom", "Tom Vance"),
      },
      {
        id: "r2",
        userId: "u",
        friendId: "p",
        initiatedBy: "p",
        status: "pending",
        createdAt: "2026-07-01",
        updatedAt: "2026-07-01",
      },
    ]),
  );
  social.blocked.mockResolvedValue(
    page([person("a", "Alex Mori"), person("b", null)]),
  );
  social.block.mockResolvedValue(ok({ blocked: false }));
});

it("loads the profile and the counts, edits the stored defaults, and toggles find-by-name", async () => {
  const r = renderWithTheme(<TogetherSettingsContainer />);
  await waitFor(() => expect(r.getByText("1")).toBeTruthy());
  expect(r.getByText("2")).toBeTruthy();
  expect(r.getByText("Off. Your code and QR work either way.")).toBeTruthy();
  fireEvent.press(r.getByRole("radio", { name: "Open nearby" }));
  await waitFor(() =>
    expect(useTogetherSettings.getState().audience).toBe("open"),
  );
  fireEvent.press(r.getByLabelText("Default: show my numbers"));
  await waitFor(() =>
    expect(useTogetherSettings.getState().sharing.numbers).toBe(false),
  );
  fireEvent.press(r.getByLabelText("Let people find me by name"));
  await waitFor(() =>
    expect(r.getByText("On. Your code and QR work either way.")).toBeTruthy(),
  );
  expect(social.profile).toHaveBeenCalledWith("key-1", true);
  fireEvent.press(r.getByLabelText("Training partners"));
  expect(mockRouter.push).toHaveBeenLastCalledWith("/(app)/together/partners");
  fireEvent.press(r.getByLabelText("Blocked people"));
  expect(mockRouter.push).toHaveBeenLastCalledWith("/(app)/together/blocked");
  fireEvent.press(r.getByLabelText("Back"));
  expect(mockRouter.back).toHaveBeenCalled();
});

it("a refused profile change flips the switch back and says so; failed counts stay as placeholders", async () => {
  social.profile.mockResolvedValue({
    ok: false,
    error: { kind: "api", code: "network", message: "offline" },
  });
  social.friends.mockResolvedValue({
    ok: false,
    error: { kind: "api", code: "network", message: "offline" },
  });
  social.blocked.mockRejectedValue(new Error("boom"));
  const r = renderWithTheme(<TogetherSettingsContainer />);
  await waitFor(() =>
    expect(r.getByLabelText("Let people find me by name")).toBeTruthy(),
  );
  expect(r.getAllByText("…")).toHaveLength(2);
  fireEvent.press(r.getByLabelText("Let people find me by name"));
  await waitFor(() => expect(r.getByRole("alert")).toBeTruthy());
  expect(r.getByText("Off. Your code and QR work either way.")).toBeTruthy();
});

it("without a social API or account nothing loads", async () => {
  mockSocial = undefined;
  const r = renderWithTheme(<TogetherSettingsContainer />);
  expect(r.getAllByText("…")).toHaveLength(3);
  expect(social.getProfile).not.toHaveBeenCalled();
});

it("loadBlocked walks pages and names the nameless; the blocked screen unblocks", async () => {
  social.blocked
    .mockResolvedValueOnce(page([person("a", "Alex Mori")], "next"))
    .mockResolvedValueOnce(page([person("b", "  ")]));
  await expect(loadBlocked(social)).resolves.toEqual([
    { userId: "a", name: "Alex Mori" },
    { userId: "b", name: "Blocked person" },
  ]);
  expect(social.blocked).toHaveBeenLastCalledWith("next");
  social.blocked.mockResolvedValue({
    ok: false,
    error: { kind: "api", code: "network", message: "offline" },
  });
  await expect(loadBlocked(social)).rejects.toBeTruthy();
  social.blocked.mockResolvedValue(page([person("a", "Alex Mori")]));
  const r = renderWithTheme(<TogetherBlockedContainer />);
  await waitFor(() => expect(r.getByText("Alex Mori")).toBeTruthy());
  fireEvent.press(r.getByLabelText("Unblock Alex Mori"));
  await waitFor(() => expect(r.getByText("Nobody is blocked.")).toBeTruthy());
  expect(social.block).toHaveBeenCalledWith("key-1", "a", false);
  fireEvent.press(r.getByLabelText("Back"));
  expect(mockRouter.back).toHaveBeenCalled();
});

it("the blocked screen reports a failed load and a refused unblock", async () => {
  social.blocked.mockRejectedValue(new Error("boom"));
  const r = renderWithTheme(<TogetherBlockedContainer />);
  await waitFor(() => expect(r.getByRole("alert")).toBeTruthy());
  social.blocked.mockResolvedValue(page([person("a", "Alex Mori")]));
  social.block.mockResolvedValue({
    ok: false,
    error: { kind: "api", code: "network", message: "offline" },
  });
  const again = renderWithTheme(<TogetherBlockedContainer />);
  await waitFor(() => expect(again.getByText("Alex Mori")).toBeTruthy());
  fireEvent.press(again.getByLabelText("Unblock Alex Mori"));
  await waitFor(() =>
    expect(again.getByText(/Could not unblock/)).toBeTruthy(),
  );
  expect(again.getByText("Alex Mori")).toBeTruthy();
});
