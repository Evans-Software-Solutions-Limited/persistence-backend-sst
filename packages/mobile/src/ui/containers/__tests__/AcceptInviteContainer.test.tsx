import { act, fireEvent } from "@testing-library/react-native";
import { Alert, Linking } from "react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { InvitePreview, MyCoach } from "@/domain/models/myCoaching";
import type { AcceptInviteCodeApiError } from "@/domain/models/trainerInviteCode";
import { fail, ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { usePendingInvite } from "@/state/pending-invite";
import {
  AcceptInviteContainer,
  acceptErrorCopy,
  previewErrorCopy,
} from "@/ui/containers/AcceptInviteContainer";

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

const IN_A_WEEK = new Date(Date.now() + 7 * 86_400_000).toISOString();

const PERSONAL: InvitePreview = {
  kind: "personal",
  coach: { name: "Ellie Hart", avatarUrl: null },
  ready: {
    sections: [
      { section: "starter_form", label: "Starter forms", count: 2 },
      {
        section: "nutrition_target",
        label: "Calorie and macro target",
        count: 1,
      },
      { section: "welcome_message", label: "Welcome message", count: 1 },
    ],
    welcomeMessage: "Hi Lena",
    programmes: [],
    plans: [],
    forms: [{ title: "Goals" }, { title: "Lifestyle" }],
  },
  expiresAt: IN_A_WEEK,
};

const GENERAL: InvitePreview = {
  kind: "general",
  coach: { name: "Marcus Lee", avatarUrl: null },
  ready: null,
  expiresAt: IN_A_WEEK,
};

const ELLIE: MyCoach = {
  relationshipId: "rel-ellie",
  trainerId: "coach-ellie",
  name: "Ellie Hart",
  avatarUrl: null,
  since: "2026-11-23T09:00:00Z",
  features: {
    nutrition: true,
    checkIns: true,
    photos: true,
    habits: true,
    messages: true,
    resources: true,
  },
  due: { forms: 2 },
  newPlans: 0,
  resources: 0,
};

/** A NetInfo whose connectivity the test flips. */
function makeNetInfo(initial: boolean) {
  let listener: ((c: boolean) => void) | null = null;
  return {
    port: {
      isConnected: jest.fn(async () => initial),
      subscribe: jest.fn((l: (c: boolean) => void) => {
        listener = l;
        return () => {
          listener = null;
        };
      }),
    } as unknown as Adapters["netInfo"],
    set(connected: boolean) {
      listener?.(connected);
    },
  };
}

function makeAdapters(online = true) {
  const api = new InMemoryApiAdapter();
  api.invitePreviews = { ELLIE1: PERSONAL, MARC12: GENERAL };
  const storage = new InMemoryStorageAdapter();
  const net = makeNetInfo(online);
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
  const adapters: Adapters = {
    api,
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    netInfo: net.port,
  };
  return { api, storage, net, adapters };
}

async function renderFlow(online = true) {
  const ctx = makeAdapters(online);
  const utils = renderWithTheme(
    <AdapterProvider adapters={ctx.adapters}>
      <AcceptInviteContainer />
    </AdapterProvider>,
  );
  // Let the NetInfo probe and the auth session settle.
  await act(async () => {});
  return { ...ctx, ...utils };
}

async function previewCode(
  utils: Awaited<ReturnType<typeof renderFlow>>,
  code: string,
) {
  fireEvent.changeText(utils.getByTestId("accept-invite-code-input"), code);
  await act(async () => {
    fireEvent.press(utils.getByTestId("accept-invite-submit"));
  });
}

describe("AcceptInviteContainer", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    delete mockParams.code;
    mockNav.canGoBack = true;
    mockBack.mockReset();
    mockReplace.mockReset();
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });
  afterEach(() => {
    alertSpy.mockRestore();
  });

  it("prefills the code from the ?code= deep-link param", async () => {
    mockParams.code = "ab23cd";
    const { getByTestId } = await renderFlow();
    expect(getByTestId("accept-invite-code-input").props.value).toBe("AB23CD");
  });

  it("clears the carry-through-signup stash on arrival", async () => {
    usePendingInvite.getState().setPendingCode("AB23CD");
    await renderFlow();
    expect(usePendingInvite.getState().pendingCode).toBeNull();
  });

  describe("enter code → preview", () => {
    it("Join previews the code and accepts nothing", async () => {
      const utils = await renderFlow();
      await previewCode(utils, "ELLIE1");

      expect(utils.api.getInvitePreviewCalls).toEqual(["ELLIE1"]);
      expect(utils.api.acceptInviteCodeCalls).toEqual([]);
      expect(utils.getByText("Ellie Hart wants to coach you")).toBeTruthy();
      expect(utils.getByText("Ellie has ready for you")).toBeTruthy();
      expect(
        utils.getByText("2 forms · calorie target · welcome message"),
      ).toBeTruthy();
      expect(utils.getByText("Ellie can see")).toBeTruthy();
    });

    it("a general code shows the coach only, with no ready section", async () => {
      const utils = await renderFlow();
      await previewCode(utils, "MARC12");
      expect(utils.getByText("Marcus Lee wants to coach you")).toBeTruthy();
      expect(utils.queryByTestId("invite-preview-ready")).toBeNull();
    });

    it("invalid or expired code: inline copy, stays on the code screen", async () => {
      const utils = await renderFlow();
      await previewCode(utils, "NOPE99");
      expect(utils.getByTestId("accept-invite-error")).toBeTruthy();
      expect(
        utils.getByText(
          "Invalid or expired code. Ask your coach for a new one.",
        ),
      ).toBeTruthy();
      expect(utils.queryByTestId("invite-preview")).toBeNull();
    });

    it("too many guesses: the rate-limit copy", async () => {
      const utils = await renderFlow();
      utils.api.nextInvitePreviewError = {
        code: "rate_limited",
        status: 429,
        message: "Too many attempts. Try again later.",
      };
      await previewCode(utils, "ELLIE1");
      expect(
        utils.getByText("Too many tries. Wait a while, then try again."),
      ).toBeTruthy();
    });

    it("offline: Join is disabled, the screen says so, nothing is called", async () => {
      const utils = await renderFlow(false);
      fireEvent.changeText(
        utils.getByTestId("accept-invite-code-input"),
        "ELLIE1",
      );
      expect(utils.getByTestId("accept-invite-offline")).toBeTruthy();
      await act(async () => {
        fireEvent.press(utils.getByTestId("accept-invite-submit"));
      });
      expect(utils.api.getInvitePreviewCalls).toEqual([]);
    });

    it("a dropped connection during the lookup reads as offline", async () => {
      const utils = await renderFlow();
      utils.api.shouldFail = true;
      utils.api.failError = {
        kind: "api",
        code: "network",
        message: "Network request failed",
      };
      await previewCode(utils, "ELLIE1");
      expect(
        utils.getByText("You're offline. Entering a code needs a connection."),
      ).toBeTruthy();
    });
  });

  describe("consent and accept (C11j)", () => {
    it("Accept stays disabled until the never-pre-ticked agreement is ticked", async () => {
      const utils = await renderFlow();
      await previewCode(utils, "ELLIE1");
      const agree = utils.getByTestId("invite-preview-agree");
      expect(agree.props.accessibilityState?.checked).toBe(false);
      expect(
        utils.getByTestId("invite-preview-accept").props.accessibilityState
          ?.disabled,
      ).toBe(true);

      await act(async () => {
        fireEvent.press(utils.getByTestId("invite-preview-accept"));
      });
      expect(utils.api.acceptInviteCodeCalls).toEqual([]);

      fireEvent.press(agree);
      expect(
        utils.getByTestId("invite-preview-accept").props.accessibilityState
          ?.disabled,
      ).toBe(false);
    });

    it("personal code: accepts with consent, loads the coach, lands on the Coach tab and says 'You're connected'", async () => {
      const utils = await renderFlow();
      utils.api.nextAcceptInviteCodeResult = {
        success: true,
        relationshipId: "rel-ellie",
        trainerName: "Ellie Hart",
        message: "You're now connected with Ellie Hart",
        relationshipStatus: "active",
        ready: PERSONAL.ready,
      };
      utils.api.myCoaching = { coaches: [ELLIE], asOf: "2026-11-23T09:00:00Z" };
      await previewCode(utils, "ELLIE1");
      fireEvent.press(utils.getByTestId("invite-preview-agree"));
      await act(async () => {
        fireEvent.press(utils.getByTestId("invite-preview-accept"));
      });

      expect(utils.api.acceptInviteCodeCalls).toEqual(["ELLIE1"]);
      expect(utils.api.acceptInviteCodeConsentCalls).toEqual([
        { consent: true, consentVersion: "v1-2026-07" },
      ]);
      // The coach is cached before landing, so the Coach tab is there.
      expect(utils.storage.getCachedMyCoaches("athlete-1")?.coaches).toEqual([
        ELLIE,
      ]);
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringMatching(
          /^\/\(app\)\/\(tabs\)\/coach\?coachId=rel-ellie&nav=\d+$/,
        ),
      );
      expect(alertSpy).toHaveBeenCalledWith("You're connected with Ellie Hart");
      const copy = JSON.stringify(alertSpy.mock.calls);
      expect(copy).not.toMatch(/awaiting/i);
    });

    it("a second coach's personal code opens the tab on the new coach, not the existing one (Inspector Brad, #547)", async () => {
      const utils = await renderFlow();
      const marcus = {
        ...ELLIE,
        relationshipId: "rel-marcus",
        trainerId: "coach-marcus",
        name: "Marcus Lee",
        since: "2026-03-01T09:00:00Z",
      };
      utils.storage.cacheMyCoaches("athlete-1", {
        coaches: [marcus],
        asOf: "2026-11-22T09:00:00Z",
      });
      utils.api.myCoaching = {
        coaches: [marcus, ELLIE],
        asOf: "2026-11-23T09:00:00Z",
      };
      utils.api.nextAcceptInviteCodeResult = {
        success: true,
        relationshipId: "rel-ellie",
        trainerName: "Ellie Hart",
        message: "ok",
        relationshipStatus: "active",
        ready: null,
      };
      await previewCode(utils, "ELLIE1");
      fireEvent.press(utils.getByTestId("invite-preview-agree"));
      await act(async () => {
        fireEvent.press(utils.getByTestId("invite-preview-accept"));
      });
      const target = String(mockReplace.mock.calls.at(-1)?.[0]);
      expect(target).toContain("coachId=rel-ellie");
      expect(target).toMatch(/&nav=\d+$/);
    });

    it("personal code, coaching read fails: lands on You, not bounced Home by the tab guard (Inspector Brad, #547)", async () => {
      const utils = await renderFlow();
      utils.api.nextAcceptInviteCodeResult = {
        success: true,
        relationshipId: "rel-ellie",
        trainerName: "Ellie Hart",
        message: "You're now connected with Ellie Hart",
        relationshipStatus: "active",
        ready: null,
      };
      utils.api.getMyCoaching = jest.fn(async () =>
        fail({ kind: "api" as const, code: "server" as const, message: "x" }),
      );
      await previewCode(utils, "ELLIE1");
      fireEvent.press(utils.getByTestId("invite-preview-agree"));
      await act(async () => {
        fireEvent.press(utils.getByTestId("invite-preview-accept"));
      });
      expect(mockReplace).toHaveBeenCalledWith("/(app)/(tabs)/you");
      expect(mockReplace).not.toHaveBeenCalledWith(
        expect.stringContaining("/(app)/(tabs)/coach"),
      );
      expect(alertSpy).toHaveBeenCalledWith("You're connected with Ellie Hart");
    });

    it("general code: says the request awaits the coach, then goes back", async () => {
      const utils = await renderFlow();
      utils.api.nextAcceptInviteCodeResult = {
        success: true,
        relationshipId: "rel-marcus",
        trainerName: "Marcus Lee",
        message: "Training request sent to Marcus Lee",
        relationshipStatus: "pending",
        ready: null,
      };
      await previewCode(utils, "MARC12");
      fireEvent.press(utils.getByTestId("invite-preview-agree"));
      await act(async () => {
        fireEvent.press(utils.getByTestId("invite-preview-accept"));
      });

      expect(mockReplace).not.toHaveBeenCalledWith(
        expect.stringContaining("/(app)/(tabs)/coach"),
      );
      expect(alertSpy).toHaveBeenCalledWith(
        "Request sent",
        "Request sent to Marcus Lee — awaiting their acceptance.",
        expect.any(Array),
      );
      const buttons = alertSpy.mock.calls[0][2] as { onPress: () => void }[];
      buttons[0]!.onPress();
      expect(mockBack).toHaveBeenCalled();
    });

    it("an older backend without relationshipStatus is treated as a request", async () => {
      const utils = await renderFlow();
      await previewCode(utils, "MARC12");
      fireEvent.press(utils.getByTestId("invite-preview-agree"));
      await act(async () => {
        fireEvent.press(utils.getByTestId("invite-preview-accept"));
      });
      expect(alertSpy).toHaveBeenCalledWith(
        "Request sent",
        "Request sent to Test Trainer — awaiting their acceptance.",
        expect.any(Array),
      );
    });

    it("seat cap reached: inline on the preview, nothing cached", async () => {
      const utils = await renderFlow();
      utils.api.nextAcceptInviteCodeError = {
        code: "coach_client_limit_reached",
        message: "This coach can't take on new clients right now.",
      };
      await previewCode(utils, "ELLIE1");
      fireEvent.press(utils.getByTestId("invite-preview-agree"));
      await act(async () => {
        fireEvent.press(utils.getByTestId("invite-preview-accept"));
      });
      expect(utils.getByTestId("invite-preview-error")).toBeTruthy();
      expect(utils.getByText("This coach's client list is full.")).toBeTruthy();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(utils.storage.getCachedMyCoaches("athlete-1")).toBeNull();
    });

    it("expired while open: says so and doesn't call accept", async () => {
      const utils = await renderFlow();
      utils.api.invitePreviews.OLD123 = {
        ...PERSONAL,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      };
      await previewCode(utils, "OLD123");
      fireEvent.press(utils.getByTestId("invite-preview-agree"));
      await act(async () => {
        fireEvent.press(utils.getByTestId("invite-preview-accept"));
      });
      expect(utils.getByTestId("invite-preview-expired")).toBeTruthy();
      expect(
        utils.getByText("This code has expired. Ask Ellie for a new one."),
      ).toBeTruthy();
      expect(utils.api.acceptInviteCodeCalls).toEqual([]);
      expect(
        utils.getByTestId("invite-preview-accept").props.accessibilityState
          ?.disabled,
      ).toBe(true);
    });

    it("code stopped working before accept (cancelled or resent): inline copy", async () => {
      const utils = await renderFlow();
      utils.api.nextAcceptInviteCodeError = {
        code: "invalid_code",
        message: "Invalid or expired invite code.",
      };
      await previewCode(utils, "ELLIE1");
      fireEvent.press(utils.getByTestId("invite-preview-agree"));
      await act(async () => {
        fireEvent.press(utils.getByTestId("invite-preview-accept"));
      });
      expect(
        utils.getByText("This code no longer works. Ask Ellie for a new one."),
      ).toBeTruthy();
    });

    it("offline on the preview: says accepting needs a connection, Accept disabled", async () => {
      const utils = await renderFlow();
      await previewCode(utils, "ELLIE1");
      fireEvent.press(utils.getByTestId("invite-preview-agree"));
      act(() => utils.net.set(false));

      expect(utils.getByTestId("invite-preview-offline")).toBeTruthy();
      expect(
        utils.getByText("You're offline. Accepting needs a connection."),
      ).toBeTruthy();
      expect(
        utils.getByTestId("invite-preview-accept").props.accessibilityState
          ?.disabled,
      ).toBe(true);
      await act(async () => {
        fireEvent.press(utils.getByTestId("invite-preview-accept"));
      });
      expect(utils.api.acceptInviteCodeCalls).toEqual([]);

      act(() => utils.net.set(true));
      expect(utils.queryByTestId("invite-preview-offline")).toBeNull();
    });

    it("connection lost mid-accept: the offline copy", async () => {
      const utils = await renderFlow();
      await previewCode(utils, "ELLIE1");
      fireEvent.press(utils.getByTestId("invite-preview-agree"));
      utils.api.shouldFail = true;
      utils.api.failError = { kind: "api", code: "timeout", message: "t" };
      await act(async () => {
        fireEvent.press(utils.getByTestId("invite-preview-accept"));
      });
      expect(
        utils.getByText("You're offline. Accepting needs a connection."),
      ).toBeTruthy();
    });

    it("Not now and Cancel leave the flow without accepting", async () => {
      const utils = await renderFlow();
      await previewCode(utils, "ELLIE1");
      fireEvent.press(utils.getByTestId("invite-preview-not-now"));
      expect(mockBack).toHaveBeenCalledTimes(1);

      mockNav.canGoBack = false;
      await previewCode(utils, "ELLIE1");
      fireEvent.press(utils.getByTestId("invite-preview-cancel"));
      expect(mockReplace).toHaveBeenCalledWith("/(app)/(tabs)/you");
      expect(utils.api.acceptInviteCodeCalls).toEqual([]);
    });

    it("opens the privacy policy", async () => {
      const spy = jest
        .spyOn(Linking, "openURL")
        .mockImplementation(async () => true);
      const utils = await renderFlow();
      await previewCode(utils, "ELLIE1");
      fireEvent.press(utils.getByTestId("invite-preview-privacy"));
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});

describe("error copy", () => {
  const err = (
    acceptCode: AcceptInviteCodeApiError["acceptCode"],
    message = "server said",
  ): AcceptInviteCodeApiError => ({
    kind: "api",
    code: "server",
    message,
    acceptCode,
  });

  it.each([
    ["exists", "You're already connected to this coach."],
    ["code_already_used", "This code has already been used."],
    ["self_invite", "You can't use your own code."],
    ["rate_limited", "Too many tries. Wait a while, then try again."],
    ["consent_required", "Please confirm you agree to share your data."],
  ] as const)("accept %s", (code, copy) => {
    expect(acceptErrorCopy(err(code), "Ellie")).toBe(copy);
  });

  it("falls back to the server message, then a generic line", () => {
    expect(acceptErrorCopy(err(undefined), "Ellie")).toBe("server said");
    expect(acceptErrorCopy(err(undefined, ""), "Ellie")).toBe(
      "Couldn't accept the invite. Please try again.",
    );
    expect(previewErrorCopy(err(undefined))).toBe("server said");
    expect(previewErrorCopy(err(undefined, ""))).toBe(
      "Couldn't check the code. Please try again.",
    );
  });
});
