import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { useState } from "react";
import { Alert, Pressable, Share } from "react-native";
import * as Clipboard from "expo-clipboard";

import { InviteStepContainer } from "../InviteStepContainer";
import { InvitedClientContainer, inviteLine } from "../InvitedClientContainer";
import { ClientSettingsContainer } from "../ClientSettingsContainer";
import { resetSyncedProfileIdsForTest } from "@/application/commands/coachClientProfiles.command";
import {
  INVITE_REFUSAL_COPY,
  inviteRefusalOf,
} from "@/ui/hooks/useCoachClientProfiles";
import {
  COACH,
  FULL_SETUP,
  clientSettings,
  profile,
  setupClients,
} from "./kit";

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  Redirect: ({ href }: { href: string }) => {
    const { Text: T } = jest.requireActual("react-native");
    return <T testID="redirect">{href}</T>;
  },
}));
jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn(async () => true),
}));
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: jest.fn(async () => "abc123"),
}));
jest.mock("@/lib/sentry", () => ({ captureSyncFailure: jest.fn() }));

const share = jest
  .spyOn(Share, "share")
  .mockResolvedValue({ action: "sharedAction" });
const alert = jest.spyOn(Alert, "alert");

beforeEach(() => {
  mockParams = {};
  resetSyncedProfileIdsForTest();
  Object.values(mockRouter).forEach((f) => f.mockClear());
  share.mockClear();
  alert.mockReset();
  (Clipboard.setStringAsync as jest.Mock).mockClear();
});

const LIVE = {
  code: "LN4Q8T",
  link: "https://persistence.app/invite/LN4Q8T",
  expiresAt: new Date(Date.now() + 7 * 86_400_000 - 60_000).toISOString(),
  status: "active" as const,
};

describe("C11h Invite", () => {
  function open(extra: Parameters<typeof profile>[1] = {}, online = true) {
    const h = setupClients({ online });
    const p = profile("p-lena", extra);
    h.storage.cacheCoachClientProfile(COACH, p);
    h.api.clientProfiles["p-lena"] = { ...p };
    mockParams = { profileId: "p-lena" };
    return h;
  }

  it("issues Lena's code on arrival, then Share invite and Copy code", async () => {
    const h = open();
    const view = h.render(<InviteStepContainer />);
    expect(view.getByText("Invite Lena")).toBeTruthy();
    await waitFor(() => expect(view.getByTestId("invite-code")).toBeTruthy());
    expect(view.getByTestId("invite-code").props.children).toBe("LN4Q81");
    expect(view.getByText("Just for Lena · expires in 7 days")).toBeTruthy();
    expect(view.getByTestId("invite-qr")).toBeTruthy();
    expect(
      h.api.coachClientCalls.filter((c) => c.startsWith("issue:")),
    ).toHaveLength(1);

    fireEvent.press(view.getByTestId("invite-share"));
    expect(share).toHaveBeenCalledWith({
      message:
        "Hi Lena, join me on Persistence: use code LN4Q81 or tap https://persistence.app/invite/LN4Q81",
    });
    fireEvent.press(view.getByTestId("invite-copy"));
    await waitFor(() => expect(view.getByText("Copied")).toBeTruthy());
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("LN4Q81");

    fireEvent.press(view.getByTestId("invite-done"));
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: "/(app)/coach-clients/[profileId]",
      params: { profileId: "p-lena" },
    });
    fireEvent.press(view.getByTestId("invite-back"));
    expect(mockRouter.replace).toHaveBeenLastCalledWith({
      pathname: "/(app)/coach-clients/[profileId]/setup",
      params: { profileId: "p-lena", flow: "add" },
    });
  });

  it("never voids a live code: a code made elsewhere is shown, not reissued", async () => {
    const h = open({ invite: LIVE });
    const view = h.render(<InviteStepContainer />);
    expect(view.getByTestId("invite-code").props.children).toBe("LN4Q8T");
    await waitFor(() =>
      expect(h.api.coachClientCalls).toContain("detail:p-lena"),
    );
    expect(h.api.coachClientCalls.some((c) => c.startsWith("issue:"))).toBe(
      false,
    );
  });

  it("asks for the declaration first; the tick is required; then the code is issued", async () => {
    const h = open();
    h.api.declaration = {
      currentVersion: "2026-11-v1",
      acceptedVersion: null,
      acceptedAt: null,
    };
    const { digestStringAsync } = jest.requireMock("expo-crypto");
    (digestStringAsync as jest.Mock).mockRejectedValueOnce(
      new Error("no crypto"),
    );
    const view = h.render(<InviteStepContainer />);
    await waitFor(() =>
      expect(view.getByText("Before you invite clients")).toBeTruthy(),
    );
    fireEvent.press(view.getByTestId("declaration-confirm"));
    await waitFor(() =>
      expect(view.getByText("Tick the box to confirm.")).toBeTruthy(),
    );

    h.api.coachClientFailures.declaration = {
      kind: "api",
      code: "unknown",
      status: 409,
      message: "Version mismatch",
      serverCode: "declaration_version_mismatch",
    };
    fireEvent.press(view.getByTestId("declaration-tick"));
    fireEvent.press(view.getByTestId("declaration-confirm"));
    await waitFor(() =>
      expect(
        view.getByText(
          "The declaration has changed. Close this and try again.",
        ),
      ).toBeTruthy(),
    );
    fireEvent.press(view.getByTestId("declaration-confirm"));
    await waitFor(() => expect(view.getByTestId("invite-code")).toBeTruthy());
    // The first try had no hash (crypto failed); the retry sent one.
    expect(h.api.coachClientCalls).toContain(
      "accept-declaration:2026-11-v1:none:key",
    );
    expect(h.api.coachClientCalls).toContain(
      "accept-declaration:2026-11-v1:hash:key",
    );
  });

  it("a 403 declaration_required from the invite opens it too; Not now closes it", async () => {
    const h = open();
    h.api.coachClientFailures.issue = {
      kind: "api",
      code: "unknown",
      status: 403,
      message: "Confirm",
      serverCode: "declaration_required",
    };
    const view = h.render(<InviteStepContainer />);
    await waitFor(() =>
      expect(view.getByText("Before you invite clients")).toBeTruthy(),
    );
    fireEvent.press(view.getByTestId("declaration-cancel"));
    await waitFor(() => expect(view.getByTestId("invite-issue")).toBeTruthy());
    expect(view.getByText("Lena doesn't have a code yet.")).toBeTruthy();
  });

  it("no seats: says so and offers to try again", async () => {
    const h = open();
    h.api.coachClientFailures.issue = {
      kind: "api",
      code: "entitlement_denied",
      status: 402,
      message: "No seats",
    };
    const view = h.render(<InviteStepContainer />);
    await waitFor(() =>
      expect(view.getByText(INVITE_REFUSAL_COPY.no_seats)).toBeTruthy(),
    );
    fireEvent.press(view.getByTestId("invite-issue"));
    await waitFor(() => expect(view.getByTestId("invite-code")).toBeTruthy());
  });

  it("offline: the C9c note, and nothing is issued", async () => {
    const h = open({}, false);
    const view = h.render(<InviteStepContainer />);
    await waitFor(() =>
      expect(view.getByTestId("invite-offline")).toBeTruthy(),
    );
    expect(
      view.getByTestId("invite-issue").props.accessibilityState.disabled,
    ).toBe(true);
    expect(h.api.coachClientCalls.some((c) => c.startsWith("issue:"))).toBe(
      false,
    );
  });

  it("an expired or cancelled code asks for a new one; an accepted client redirects", async () => {
    const expired = open({ invite: { ...LIVE, status: "expired" } });
    const v1 = expired.render(<InviteStepContainer />);
    expect(
      v1.getByText("Lena's code has expired. Send a new one."),
    ).toBeTruthy();
    v1.unmount();
    const cancelled = open({ status: "cancelled" });
    const v2 = cancelled.render(<InviteStepContainer />);
    expect(
      v2.getByText(
        "This invite was cancelled. Send a new one to invite them again.",
      ),
    ).toBeTruthy();
    v2.unmount();
    const accepted = open({ status: "active", clientId: "c-lena" });
    const v3 = accepted.render(<InviteStepContainer />);
    expect(v3.getByTestId("redirect").props.children).toBe(
      "/(app)/clients/c-lena",
    );
  });

  it("a profile still only on this phone can't be invited yet", async () => {
    const h = setupClients();
    h.server.offline = true;
    const { createProfileCommand } = jest.requireActual(
      "@/application/commands/coachClientProfiles.command",
    );
    const local = createProfileCommand(
      { storage: h.storage, userId: COACH },
      {
        displayName: "Lena",
        contactEmail: null,
        contactPhone: null,
        goal: null,
        privateNotes: null,
      },
    );
    mockParams = { profileId: local.id };
    const view = h.render(<InviteStepContainer />);
    await waitFor(() =>
      expect(view.getByText(INVITE_REFUSAL_COPY.offline)).toBeTruthy(),
    );
    expect(h.api.coachClientCalls.some((c) => c.startsWith("issue:"))).toBe(
      false,
    );
  });

  it("a profile made offline is sent first, then invited under its server id", async () => {
    const h = setupClients();
    h.server.replyData = (call) => ({
      ...profile("p-new"),
      ...call.body,
      revision: 1,
    });
    h.api.clientProfiles["p-new"] = profile("p-new");
    // Made on this phone; the queue still has its create.
    const { createProfileCommand } = jest.requireActual(
      "@/application/commands/coachClientProfiles.command",
    );
    const local = createProfileCommand(
      { storage: h.storage, userId: COACH },
      {
        displayName: "Lena Ortiz",
        contactEmail: null,
        contactPhone: null,
        goal: null,
        privateNotes: null,
      },
    );
    mockParams = { profileId: local.id };
    const view = h.render(<InviteStepContainer />);
    await waitFor(() => expect(view.getByTestId("invite-code")).toBeTruthy());
    expect(
      h.api.coachClientCalls.some((c) => c.startsWith("issue:p-new:")),
    ).toBe(true);
  });
});

describe("C11i invited client", () => {
  function open(extra: Parameters<typeof profile>[1] = {}, online = true) {
    const h = setupClients({ online });
    const p = profile("p-lena", { setup: FULL_SETUP, invite: LIVE, ...extra });
    h.storage.cacheCoachClientProfile(COACH, p);
    h.api.clientProfiles["p-lena"] = { ...p };
    mockParams = { profileId: "p-lena" };
    return h;
  }

  it("only Overview is open; what's ready, notes, and each row opens its page", async () => {
    const h = open({ privateNotes: "Left knee" });
    const view = h.render(<InvitedClientContainer />);
    expect(view.getByText("Lena Ortiz")).toBeTruthy();
    expect(view.getByText("Invited")).toBeTruthy();
    expect(
      view.getByTestId("invited-tab-overview").props.accessibilityState,
    ).toEqual({
      selected: true,
      disabled: false,
    });
    expect(
      view.getByTestId("invited-tab-training").props.accessibilityLabel,
    ).toBe("Training, opens when they accept");
    expect(view.getByText("Ready when Lena accepts")).toBeTruthy();
    expect(view.getByText("Weekly check-in")).toBeTruthy();
    expect(view.getByText("Sun 09:00 · 2 reminders")).toBeTruthy();
    expect(view.getByText("Ready to send")).toBeTruthy();
    expect(view.getByText("Left knee")).toBeTruthy();
    expect(view.getByTestId("invited-invite-line").props.children).toBe(
      "Code LN4Q8T · expires in 7 days",
    );

    fireEvent.press(view.getByTestId("invited-row-programme"));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: "/(app)/coach-clients/[profileId]/section",
      params: { profileId: "p-lena", section: "programme" },
    });
    fireEvent.press(view.getByTestId("invited-add-more"));
    expect(mockRouter.push).toHaveBeenLastCalledWith({
      pathname: "/(app)/coach-clients/[profileId]/setup",
      params: { profileId: "p-lena", flow: "edit" },
    });
    fireEvent.press(view.getByTestId("invited-notes"));
    expect(mockRouter.push).toHaveBeenLastCalledWith({
      pathname: "/(app)/coach-clients/[profileId]/who",
      params: { profileId: "p-lena", flow: "edit" },
    });
    fireEvent.press(view.getByTestId("invited-back"));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("Copy link, Resend invite and Cancel invite (confirmed) go online", async () => {
    const h = open();
    const view = h.render(<InvitedClientContainer />);
    fireEvent.press(view.getByTestId("invited-copy-link"));
    await waitFor(() => expect(view.getByText("Copied")).toBeTruthy());
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(LIVE.link);

    fireEvent.press(view.getByTestId("invited-resend"));
    await waitFor(() =>
      expect(
        h.api.coachClientCalls.some((c) => c.startsWith("issue:p-lena")),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(view.getByTestId("invited-invite-line").props.children).toMatch(
        /^Code LN4Q81/,
      ),
    );

    fireEvent.press(view.getByTestId("invited-cancel"));
    expect(alert).toHaveBeenCalledWith(
      "Cancel Lena's invite?",
      expect.any(String),
      expect.any(Array),
    );
    const buttons = alert.mock.calls[0]![2] as {
      text: string;
      onPress?: () => void;
    }[];
    await act(async () => {
      buttons.find((b) => b.text === "Cancel invite")!.onPress!();
    });
    await waitFor(() => expect(view.getByText("Cancelled")).toBeTruthy());
    expect(h.api.coachClientCalls).toContain("cancel:p-lena");
    expect(view.getByText("Send a new invite")).toBeTruthy();
    expect(view.queryByTestId("invited-cancel")).toBeNull();
    expect(view.getByTestId("invited-invite-line").props.children).toBe(
      "Invite cancelled.",
    );
  });

  it("a refused cancel says why and keeps the invite", async () => {
    const h = open();
    h.api.coachClientFailures.cancel = {
      kind: "api",
      code: "unknown",
      status: 409,
      message: "Accepted",
      serverCode: "profile_not_editable",
    };
    const view = h.render(<InvitedClientContainer />);
    fireEvent.press(view.getByTestId("invited-cancel"));
    const buttons = alert.mock.calls[0]![2] as {
      text: string;
      onPress?: () => void;
    }[];
    await act(async () => {
      buttons.find((b) => b.text === "Cancel invite")!.onPress!();
    });
    await waitFor(() =>
      expect(view.getByText(INVITE_REFUSAL_COPY.not_editable)).toBeTruthy(),
    );
    expect(view.getByText("Invited")).toBeTruthy();
  });

  it("offline: edits still work, invite actions wait; a 409 shows and dismisses", async () => {
    const h = open({ conflictAt: "2026-11-27T09:00:00Z" }, false);
    const view = h.render(<InvitedClientContainer />);
    await waitFor(() =>
      expect(view.getByTestId("invited-offline")).toBeTruthy(),
    );
    expect(
      view.getByTestId("invited-resend").props.accessibilityState.disabled,
    ).toBe(true);
    fireEvent.press(view.getByTestId("invited-conflict-dismiss"));
    await waitFor(() =>
      expect(view.queryByTestId("invited-conflict")).toBeNull(),
    );
  });

  it("nothing set up yet, an expired code, a missing or accepted client", async () => {
    const h = open({ setup: {}, invite: { ...LIVE, status: "expired" } });
    const v1 = h.render(<InvitedClientContainer />);
    expect(v1.getByTestId("invited-empty")).toBeTruthy();
    expect(
      v1.getByText("The code has expired. Resend to send a new one."),
    ).toBeTruthy();
    v1.unmount();
    const missing = setupClients({ online: false });
    mockParams = { profileId: "p-none" };
    const v2 = missing.render(<InvitedClientContainer />);
    expect(await v2.findByText("We couldn't find this client.")).toBeTruthy();
    v2.unmount();
    const accepted = open({ status: "active", clientId: "c-lena" });
    const v3 = accepted.render(<InvitedClientContainer />);
    expect(v3.getByTestId("redirect").props.children).toBe(
      "/(app)/clients/c-lena",
    );
    expect(inviteLine(null, "invited")).toBe("No code sent yet.");
  });
});

describe("invite refusals", () => {
  it("maps the server's answers to the screen's terms", () => {
    const base = { kind: "api" as const, message: "" };
    expect(inviteRefusalOf({ ...base, code: "network" })).toBe("offline");
    expect(inviteRefusalOf({ ...base, code: "timeout" })).toBe("offline");
    expect(
      inviteRefusalOf({
        ...base,
        code: "unknown",
        serverCode: "profile_not_editable",
      }),
    ).toBe("not_editable");
    expect(inviteRefusalOf({ ...base, code: "not_found", status: 404 })).toBe(
      "not_found",
    );
    expect(inviteRefusalOf({ ...base, code: "server", status: 500 })).toBe(
      "failed",
    );
  });
});

describe("C3.9 client settings", () => {
  function open(conflictAt: string | null = null, cached = true) {
    const h = setupClients({ online: false });
    h.server.offline = true;
    const s = clientSettings();
    if (cached) {
      h.storage.cacheCoachClientSettings(COACH, "c-sam", { ...s, conflictAt });
      h.api.clientSettings["c-sam"] = s;
    } else {
      h.api.shouldFail = true;
    }
    const onEnd = jest.fn();
    const view = h.render(
      <ClientSettingsContainer
        clientId="c-sam"
        clientFirst="Sam"
        ending={false}
        onEndCoaching={onEnd}
      />,
    );
    return { h, view, onEnd };
  }
  const payloads = (h: ReturnType<typeof setupClients>) =>
    h.storage.getUncompletedMutations().map((e) => JSON.parse(e.payload));

  it("each switch saves on its own, offline, through one queued PATCH", async () => {
    const { h, view, onEnd } = open();
    expect(view.getByText("Tracked for Sam")).toBeTruthy();
    expect(view.getByText("Features for Sam")).toBeTruthy();
    fireEvent.press(view.getByTestId("settings-feature-photos"));
    await waitFor(() =>
      expect(
        view.getByTestId("settings-feature-photos").props.accessibilityState
          .checked,
      ).toBe(false),
    );
    fireEvent.press(view.getByTestId("settings-training"));
    await waitFor(() =>
      expect(view.getByTestId("settings-sessions-value").props.children).toBe(
        3,
      ),
    );
    fireEvent.press(view.getByTestId("settings-sessions-plus"));
    await waitFor(() =>
      expect(view.getByTestId("settings-sessions-value").props.children).toBe(
        4,
      ),
    );
    fireEvent.press(view.getByTestId("settings-sessions-minus"));
    fireEvent.press(view.getByTestId("settings-calories"));
    fireEvent.press(view.getByTestId("settings-alerts"));
    fireEvent.press(view.getByTestId("settings-alert-mode-mute"));
    await waitFor(() => expect(view.getByText("Muted")).toBeTruthy());
    // Each change was tried at once (offline, so each waits as its own
    // row), all against the revision the phone had; together they hold
    // every change.
    const rows = payloads(h);
    expect(rows.every((r) => r.expectedRevision === 2)).toBe(true);
    expect(Object.assign({}, ...rows)).toEqual({
      features: { photos: false },
      trackTraining: true,
      sessionsPerWeek: 3,
      trackCalories: true,
      alertMode: "mute",
      expectedRevision: 2,
    });
    expect(
      h.storage.getCachedCoachClientSettings(COACH, "c-sam"),
    ).toMatchObject({
      trackTraining: true,
      sessionsPerWeek: 3,
      trackCalories: true,
      alertMode: "mute",
    });
    fireEvent.press(view.getByTestId("settings-end"));
    expect(onEnd).toHaveBeenCalled();
  });

  it("shows the conflict note and clears it", async () => {
    const { view } = open("2026-11-27T09:00:00Z");
    expect(view.getByTestId("settings-conflict")).toBeTruthy();
    fireEvent.press(view.getByTestId("settings-conflict-dismiss"));
    await waitFor(() =>
      expect(view.queryByTestId("settings-conflict")).toBeNull(),
    );
  });

  it("loads from the server when nothing is cached, and says when it can't", async () => {
    const online = setupClients();
    online.api.clientSettings["c-sam"] = clientSettings({
      trackCalories: true,
    });
    const v1 = online.render(
      <ClientSettingsContainer
        clientId="c-sam"
        clientFirst="Sam"
        ending
        onEndCoaching={() => {}}
      />,
    );
    expect(v1.getByText("Loading settings…")).toBeTruthy();
    await waitFor(() =>
      expect(
        v1.getByTestId("settings-calories").props.accessibilityState.checked,
      ).toBe(true),
    );
    expect(v1.getByText("Ending…")).toBeTruthy();
    v1.unmount();
    const { view } = open(null, false);
    // The first load retries (cold start) before it gives up.
    await waitFor(
      () =>
        expect(
          view.getByText("Couldn't load the settings. Pull down to try again."),
        ).toBeTruthy(),
      { timeout: 9000 },
    );
  });

  it("a new refresh key re-reads the settings", async () => {
    const h = setupClients();
    h.api.clientSettings["c-sam"] = clientSettings();
    function Host() {
      const [key, setKey] = useState(0);
      return (
        <>
          <Pressable testID="bump" onPress={() => setKey((k) => k + 1)} />
          <ClientSettingsContainer
            clientId="c-sam"
            clientFirst="Sam"
            refreshKey={key}
            ending={false}
            onEndCoaching={() => {}}
          />
        </>
      );
    }
    const view = h.render(<Host />);
    await waitFor(() =>
      expect(view.getByTestId("client-settings")).toBeTruthy(),
    );
    const before = h.api.coachClientCalls.length;
    fireEvent.press(view.getByTestId("bump"));
    await waitFor(() =>
      expect(h.api.coachClientCalls.length).toBeGreaterThan(before),
    );
  });
});
